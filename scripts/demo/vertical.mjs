// Reframe the finished demo as a captioned 9:16 portrait video.
// Usage: node scripts/demo/vertical.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const media = fileURLToPath(new URL('../../docs/media/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'power-mode-vertical-'));
const font = process.env.DEMO_FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
let count = 0;
const text = (value, y, size, color, enable) => {
  const file = join(temp, `${count++}.txt`);
  writeFileSync(file, value);
  return `drawtext=fontfile='${font}':textfile='${file}':expansion=none:fontsize=${size}:fontcolor=${color}:x=(w-tw)/2:y=${y}${enable ? `:enable='${enable}'` : ''}`;
};
const scenes = [
  [0, 4, 'EQUIP YOUR LOADOUT', 'GODLIKE  /  RETRO 8-BIT', 'PARTICLES 1.5x  /  GLOW 70%'],
  [4, 20, 'EVERY KEY. MORE CHAOS.', 'TYPE. COMBO. LEVEL UP.', 'Watch the cursor. Every key makes pixels.'],
  [20, 26, 'CTRL+V CALLS AN AIRSTRIKE', 'PASTE THE CODE. DROP THE BOMBS.', 'BOMBER RUN + Bombardier unlocked'],
  [26, 36, 'PLAYER TWO HAS ENTERED', 'SEND YOUR AGENT A PROMPT.', 'The fireworks go both ways.'],
  [36, 43, 'YOUR AGENT GETS FIREWORKS', 'AGENT IS COOKING', 'Real streamed reply. Real finale.'],
  [43, 47, 'YOUR NEXT TASK IS A BOSS FIGHT', 'EQUIP YOUR KEYBOARD.', 'Install Power Mode for bb.'],
];
const layers = [
  'drawbox=x=0:y=0:w=1080:h=12:color=0xff41cc:t=fill',
  'drawbox=x=0:y=1908:w=1080:h=12:color=0x38e8ff:t=fill',
  text('POWER MODE', 115, 100, '0xffdf39'),
  text('YOUR KEYBOARD IS AN ARCADE.', 250, 38, 'white'),
  text('RETRO 8-BIT  //  GODLIKE', 335, 36, '0x38e8ff'),
  'drawbox=x=27:y=481:w=1026:h=682:color=0xff41cc:t=5',
  text('PRESS START', 1600, 54, '0xffdf39'),
  text('bb plugin install', 1698, 33, 'white'),
  text('https://github.com/cleanunicorn/', 1755, 30, '0x38e8ff'),
  text('bb-plugin-power-mode', 1800, 34, '0x38e8ff'),
];
for (const [start, end, title, line1, line2] of scenes) {
  const enable = `gte(t,${start})*lt(t,${end})`;
  layers.push(text(title, 1230, 43, '0xffdf39', enable));
  layers.push(text(line1, 1330, 35, 'white', enable));
  layers.push(text(line2, 1395, 30, '0x38e8ff', enable));
}
// Remove the blurred sidebar and editorial caption; retain the composer,
// combo HUD and reply. The full-width gameplay panel sits inside a 9:16 card.
const filter = '[0:v]crop=940:620:320:0,scale=1020:672:flags=lanczos,pad=1080:1920:30:486:color=0x0d1028,' + layers.join(',') + ',setsar=1,format=yuv420p';
try {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${media}power-mode-demo.mp4`,
    '-vf', filter, '-an', '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
    '-movflags', '+faststart', `${media}power-mode-vertical.mp4`], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '12.35', '-i', `${media}power-mode-vertical.mp4`,
    '-frames:v', '1', '-q:v', '2', `${media}power-mode-vertical-poster.jpg`], { stdio: 'inherit' });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
