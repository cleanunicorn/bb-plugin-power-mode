// One-command browser regression run: build the fixture site, serve it on
// 127.0.0.1:9146 (the port the fixtures hard-code), run every tests/*.browser.js
// through BetterWright, and always stop the server afterwards (browser runs use --no-daemon --close).
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'dist', 'test-site');
const HOST = '127.0.0.1';
const PORT = 9146;
// Dedicated profile so the run never touches the developer's own BetterWright sessions.
const PROFILE = 'power-mode-tests';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'betterwright.cmd' : 'betterwright');

const fail = message => { console.error(`\n[test:browser] ${message}`); process.exit(1); };

if (!existsSync(bin)) fail('betterwright is not installed. Run `npm ci` first.');

const fixtures = readdirSync(join(root, 'tests')).filter(f => f.endsWith('.browser.js')).sort();
if (!fixtures.length) fail('No tests/*.browser.js fixtures found.');

const build = spawnSync(process.execPath, [join(root, 'scripts', 'build-test-site.mjs')], { stdio: 'inherit' });
if (build.status !== 0) fail('Building the test site failed.');

// Probe first so we never test against someone else's server on this port.
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(site, path === sep || path === '/' ? 'power-engine.html' : path);
  if (!file.startsWith(site + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((resolve, reject) => {
  server.once('error', error => reject(error.code === 'EADDRINUSE'
    ? new Error(`Port ${PORT} is already in use; the fixtures hard-code http://${HOST}:${PORT}. Free it and retry.`)
    : error));
  server.listen(PORT, HOST, resolve);
}).catch(error => fail(error.message));

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  server.closeAllConnections?.();
  server.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(130); });

// BetterWright 2.9.1 fails to parse a snippet whose first statement starts with
// `await` ("Unexpected token ';'"). Run a copy with a declaration in front
// so the fixtures themselves stay untouched.
const snippets = join(root, 'dist', 'snippets');
function snippetFor(file) {
  mkdirSync(snippets, { recursive: true });
  const target = join(snippets, file);
  writeFileSync(target, `const __fixture = 0;\n${readFileSync(join(root, 'tests', file), 'utf8')}`);
  return target;
}

function runFixture(file) {
  return new Promise(resolve => {
    const child = spawn(bin, ['run', '--no-daemon', '--close', '--profile', PROFILE, snippetFor(file)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk); });
    child.on('error', error => resolve({ ok: false, reason: `could not start betterwright: ${error.message}`, setup: true }));
    child.on('close', code => {
      const missing = /betterwright setup|browser (is )?not (found|installed)|no managed browser/i.test(output);
      resolve({ ok: code === 0 && !/"ok"\s*:\s*false/.test(output), reason: `exit code ${code}`, setup: code !== 0 && missing });
    });
  });
}

const results = [];
try {
  for (const file of fixtures) {
    console.log(`\n[test:browser] ${file}`);
    const result = await runFixture(file);
    results.push({ file, ...result });
    if (result.setup) {
      console.error('\n[test:browser] BetterWright browser is not set up. Run `npx betterwright setup` and retry.');
      break;
    }
  }
} finally {
  cleanup();
}

console.log('\n[test:browser] summary');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.file}${r.ok ? '' : ` (${r.reason})`}`);
const failed = results.filter(r => !r.ok).length + (fixtures.length - results.length);
process.exit(failed ? 1 : 0);
