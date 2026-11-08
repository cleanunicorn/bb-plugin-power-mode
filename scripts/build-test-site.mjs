// Bundles the effects engine fixture into dist/test-site (see tests/README.md).
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
// Achievement gallery / native-input fixture (#32). app.css only exists after
// `bb plugin build`; the fixtures run without it.
await build({
  absWorkingDir: root,
  entryPoints: ['tests/achievements-entry.tsx'],
  bundle: true,
  format: 'iife',
  globalName: 'AchievementTest',
  alias: {
    sonner: './tests/toast-stub.ts',
    '@get-bb/plugin-sdk/app': './tests/achievement-sdk-stub.ts',
  },
  outfile: join(out, 'achievements.js'),
  logLevel: 'warning',
});
await copyFile(join(root, 'tests', 'achievements.html'), join(out, 'achievements.html'));
if (existsSync(join(root, 'dist', 'app.css'))) await copyFile(join(root, 'dist', 'app.css'), join(out, 'app.css'));
console.log(`Built test site in ${out}`);
