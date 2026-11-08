// Records the Power Mode demo video against a running bb web UI.
// See docs/demo/README.md for setup, editing and verification.
//
//   BB_URL=http://127.0.0.1:38886 OUT_DIR=raw node record-demo.mjs
//
// Uses a fresh headless Chromium profile, so Power Mode settings and stats
// (browser localStorage) start at their defaults and the user's own bb windows
// are untouched. The sidebar thread list is blurred (except on Settings) and
// captions are overlaid; neither changes bb or the plugin. The agent segment
// sends one real prompt, which creates a disposable thread: archive it after.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BB_URL || 'http://127.0.0.1:38886';
const W = 1280, H = 800;
const t0 = Date.now(); const marks = [];
const mark = (name) => { const s = (Date.now() - t0) / 1000; marks.push({ name, s }); console.log(s.toFixed(1), name); };
const b = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, permissions: ['clipboard-read', 'clipboard-write'],
  recordVideo: { dir: process.env.OUT_DIR || 'raw', size: { width: W, height: H } } });
const CSS = `
#demo-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;
 background:rgba(15,15,20,.88);color:#fff;font:600 22px/1.3 system-ui,sans-serif;padding:12px 22px;border-radius:12px;
 box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:900px;text-align:center;transition:opacity .25s}
#demo-caption small{display:block;font-weight:400;font-size:15px;opacity:.8;margin-top:2px}
html:not(.demo-noblur) [data-sidebar="content"]{filter:blur(6px)}
.demo-hl{outline:3px solid #ffcc00 !important;outline-offset:3px;border-radius:8px}`;
await ctx.addInitScript(css => {
  const ensure = () => {
    const root = document.documentElement; if (!root) return;
    let st = document.getElementById('demo-style');
    if (!st) { st = document.createElement('style'); st.id = 'demo-style'; st.textContent = css; root.appendChild(st); }
    root.classList.toggle('demo-noblur', location.pathname.startsWith('/settings'));
  };
  ensure(); setInterval(ensure, 30); document.addEventListener('DOMContentLoaded', ensure);
}, CSS);
const p = await ctx.newPage();
await p.exposeFunction('logSlam', t => mark('SLAM ' + t));
async function setup() {
  await p.addStyleTag({ content: CSS });
  await p.evaluate(() => { if (window.__slamObs) return; window.__slamObs = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('pm-slam')) { window.__lastSlam = n.textContent; window.logSlam(n.textContent); } }); window.__slamObs.observe(document.documentElement, { childList: true }); });
}
async function caption(title, sub = '') {
  await p.evaluate(([t, s]) => {
    let c = document.getElementById('demo-caption');
    if (!c) { c = document.createElement('div'); c.id = 'demo-caption'; document.body.appendChild(c); }
    c.innerHTML = t ? `${t}${s ? `<small>${s}</small>` : ''}` : ''; c.style.opacity = t ? '1' : '0';
  }, [title, sub]);
}
async function highlightClick(loc, pause = 900) {
  await loc.evaluate(e => e.classList.add('demo-hl'));
  await p.waitForTimeout(pause);
  await loc.click();
  await loc.evaluate(e => e.classList.remove('demo-hl')).catch(() => {});
}
const sleep = ms => p.waitForTimeout(ms);
const editor = () => p.locator('.ProseMirror[contenteditable=true]').first();
async function paste(text) {
  await p.evaluate(t => navigator.clipboard.writeText(t), text);
  await p.keyboard.press('Control+V');
}
const para = 'Power Mode turns every keystroke into fireworks: particles, shake, combos and lightning. ';

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await setup(); await sleep(800);
mark('intro');
await caption('⚡ Power Mode for bb', 'Particles, shake, combos and lightning while you type');
await sleep(2500);

mark('toggle');
await caption('Turn it on with the ⚡ button in the sidebar footer', 'or Mod+Alt+P');
await highlightClick(p.getByRole('button', { name: 'Toggle Power Mode' }), 1600);
await sleep(1000);

mark('typing');
await caption('Type anywhere: particles, shake and a combo counter', 'Keep typing to climb tiers; the timer drains when you stop');
await editor().click();
await p.keyboard.type('Hello bb! Watch the combo counter climb as I keep typing faster and faster...', { delay: 45 });
await p.keyboard.press('Shift+Enter');
await p.keyboard.type('Enter fires a shockwave, and Backspace throws red shards.', { delay: 40 });
await sleep(300);
for (let i = 0; i < 12; i++) { await p.keyboard.press('Backspace'); await sleep(60); }
await sleep(1500);

mark('paste');
await caption('Paste drops ordnance that scales with the paste', '~150 chars: dynamite');
await p.keyboard.press('Shift+Enter');
await paste(para + para.slice(0, 60));
await sleep(3000);
await caption('Bigger paste, bigger weapon', '~2,500 chars: carpet bombing');
await paste(para.repeat(28));
await sleep(4500);
await caption('Clearing the box');
await p.keyboard.press('Control+A'); await p.keyboard.press('Backspace');
await sleep(1500);

mark('settings');
await caption('Tune it under Settings → Power Mode', 'Intensity, theme, particles, glow, sound, Agent Power Mode');
await p.goto(BASE + '/settings/plugins/power-mode', { waitUntil: 'networkidle' });
await setup(); await caption('Tune it under Settings → Power Mode', 'Intensity, theme, particles, glow, sound, Agent Power Mode');
await sleep(2500);
await caption('Pick a theme: 🔥 Inferno', 'Six themes: Neon, Inferno, Matrix, Sakura, Cyberpunk, Retro 8-bit');
await highlightClick(p.getByRole('radio', { name: /Inferno/ }), 1200);
await sleep(1500);
await caption('Agent Power Mode is on by default', 'Effects while an agent writes its reply');
await p.mouse.wheel(0, 500); await sleep(2500);
await p.mouse.wheel(0, -500);

mark('inferno');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await setup();
await caption('Same effects, new theme', '🔥 Inferno: embers rise and sparks burn red to white-hot');
await editor().click();
await p.keyboard.type('Inferno theme: embers and sparks burning red to white-hot gold!', { delay: 40 });
await sleep(1500);
await p.keyboard.press('Control+A'); await p.keyboard.press('Backspace');

mark('agent-prompt');
await caption('Agent Power Mode: ask an agent something', 'A real agent turn in a disposable thread');
await p.keyboard.type('Write two lively paragraphs (about 250 words total) about fireworks over a harbor at night. No tools, no headings.', { delay: 25 });
await sleep(600);
await p.keyboard.press('Enter');
mark('agent-sent');
await sleep(1500);
await setup();
await caption('Agent Power Mode', 'Sparks and an agent word combo while the reply streams');
// wait for the TURN COMPLETE finale
let streaming = false;
for (let i = 0; i < 480; i++) {
  await sleep(250);
  const last = await p.evaluate(() => window.__lastSlam || '');
  if (!streaming && /AGENT/.test(last)) { streaming = true; }
  if (/TURN COMPLETE/.test(last)) break;
}
mark('agent-done');
await caption('🏁 TURN COMPLETE finale', 'Plays when the agent finishes its turn');
await sleep(5000);
mark('end');
await caption('');
await sleep(500);
fs.writeFileSync((process.env.OUT_DIR || 'raw') + '/marks.json', JSON.stringify({ url: p.url(), marks }, null, 1));
await ctx.close(); await b.close();
