// Bundles the effects engine fixture into dist/test-site (see tests/README.md).
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'test-site');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['tests/power-engine-entry.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'PowerTest',
  alias: { sonner: './tests/toast-stub.ts' },
  outfile: join(out, 'engine.js'),
  logLevel: 'warning',
});
await copyFile(join(root, 'tests', 'power-engine.html'), join(out, 'power-engine.html'));
console.log(`Built test site in ${out}`);
