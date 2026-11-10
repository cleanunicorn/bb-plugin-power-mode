// Edit the 2026-11-10 BetterWright/Xvfb take. See docs/demo-video.md.
// Usage: node scripts/demo/edit-retro.mjs <original-take> [clear-typing-take] [typing-start-seconds]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const input = process.argv[2];
const clearTyping = process.argv[3];
const typingStart = Number(process.argv[4] ?? 3);
if (!Number.isFinite(typingStart) || typingStart < 0) throw new Error('Invalid typing start time.');
if (!input) throw new Error('Pass the raw Xvfb recording path.');
const out = fileURLToPath(new URL('../../docs/media/', import.meta.url));
mkdirSync(out, { recursive: true });
const scenes = [
  [14, 18],       // Verified Godlike / Retro / 1.5x / 70% controls.
  [42, 58],      // Real typing, achievements and GODLIKE combo.
  [118.7, 124.7],// Native clipboard paste, bomber and Bombardier unlock.
  [156, 166],    // Type and submit the demo agent prompt.
  [193, 200],    // Actual reply streaming, AGENT IS COOKING, TURN COMPLETE.
  [219, 223],    // Closing caption.
];
const filters = scenes.map(([start, end], i) => {
  const replacement = i === 1 && clearTyping;
  if (replacement) { start = typingStart; end = start + 16; }
  return `[${replacement ? 1 : 0}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`;
});
filters.push(scenes.map((_, i) => `[v${i}]`).join('') + `concat=n=${scenes.length}:v=1:a=0,fps=30,format=yuv420p[out]`);
const run = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
run(['-i', input, ...(clearTyping ? ['-i', clearTyping] : []), '-filter_complex', filters.join(';'), '-map', '[out]',
  '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart',
  `${out}power-mode-demo.mp4`]);
run(['-ss', '12.35', '-i', `${out}power-mode-demo.mp4`, '-frames:v', '1', '-q:v', '2', `${out}power-mode-demo-poster.jpg`]);
// A short motion preview renders directly in GitHub Markdown.
run(['-ss', '8', '-t', '5', '-i', `${out}power-mode-demo.mp4`, '-filter_complex',
  'fps=12,scale=840:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
  '-loop', '0', `${out}power-mode-preview.gif`]);
