// Records the Power Mode demo against the live bb UI in headless Chrome (Playwright recordVideo).
// Run from a scratch dir that has `playwright-core` installed (see docs/demo-video.md).
// Env: BB_URL (default http://127.0.0.1:38886), DEMO_PROJECT_ID (id of the disposable "power-demo" project).
// Output: raw/<name>.webm + marks.json (segment start offsets, seconds from video start)
import { chromium } from 'playwright-core';
import fs from 'fs';
const W=1280,H=800, URL=process.env.BB_URL || 'http://127.0.0.1:38886';
const PROJECT_ID = process.env.DEMO_PROJECT_ID || (() => { throw new Error('set DEMO_PROJECT_ID'); })();
const PROJECT = 'power-demo';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const HIDE = `(() => { setInterval(() => { document.querySelectorAll('[class*="group/sidebar-section"]').forEach(s => { s.style.display = /${PROJECT}/.test(s.textContent||'') ? '' : 'none'; }); }, 100); })();`;
const LOREM = ('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. ').repeat(4).slice(0,1500);
const AGENT_PROMPT = 'Describe a thunderstorm in 200 words.';

fs.rmSync('raw',{recursive:true,force:true});
const browser = await chromium.launch({ executablePath:'/usr/bin/google-chrome', headless:true });
const ctx = await browser.newContext({ viewport:{width:W,height:H}, recordVideo:{dir:'raw',size:{width:W,height:H}}, permissions:['clipboard-read','clipboard-write'] });
await ctx.addInitScript(HIDE);
const t0 = Date.now();
const page = await ctx.newPage();
const marks = {};
const mark = n => { marks[n] = (Date.now()-t0)/1000; console.log('mark', n, marks[n].toFixed(1)); };
const type = (s, d=55) => page.keyboard.type(s, {delay:d});

await page.goto(URL, {waitUntil:'domcontentloaded'});
await sleep(3500);
// open the demo project's composer first so the footer ⚡ is on a clean screen
const nt = page.getByRole('button',{name:`New thread in ${PROJECT}`,exact:true});
await nt.hover({force:true}); await nt.click({force:true});
await sleep(1500);

// 1. toggle
mark('1-toggle');
await sleep(1500);
const tog = page.getByRole('button',{name:'Toggle Power Mode'});
await tog.hover(); await sleep(1800);
await tog.click(); await sleep(1500);

// 2. typing
mark('2-typing');
const ed = page.locator('[contenteditable="true"], textarea').first();
await ed.click();
await type('Power Mode turns every keystroke into a tiny fireworks show. ');
await type('Watch the combo climb while the editor shakes and sparks fly from the caret.');
await type(' ');   // (Enter can't be shown: bb's TipTap composer emits no input event for Enter/Shift+Enter, so the shockwave never fires there)
await type('The faster I type, the bigger oops');
for (let i=0;i<5;i++){ await page.keyboard.press('Backspace'); await sleep(160); } // Backspace -> red shards
await sleep(300);
await type(' explosions get!');
await sleep(2500);

// 3. settings: theme + slider
mark('3-settings');
await page.keyboard.press('Control+,'); await sleep(1500);
await page.getByText('Power Mode',{exact:true}).first().click(); await sleep(1500);
await page.getByText('Inferno').first().click({timeout:5000}); await sleep(1500);
await page.mouse.move(800,450); await page.mouse.wheel(0,300); await sleep(900); // scroll so the sliders clear the bottom caption
const sl = page.locator('[role="slider"], input[type="range"]').first();
await sl.focus();
for (let i=0;i<6;i++){ await page.keyboard.press('ArrowRight'); await sleep(250); }
await sleep(1200);
await page.getByRole('button',{name:'Home'}).click(); await sleep(1200);
const nt2 = page.getByRole('button',{name:`New thread in ${PROJECT}`,exact:true});
await nt2.hover({force:true}); await nt2.click({force:true}); await sleep(1200);
mark('3b-theme-typing');
await page.locator('[contenteditable="true"], textarea').first().click();
await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await sleep(900);
await type('Now it is Inferno: embers rise from every key!');
await sleep(2200);

// 4. paste
mark('4-paste');
await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await sleep(1200);
await page.evaluate(t => navigator.clipboard.writeText(t), LOREM);
await page.keyboard.press('Control+V');
await sleep(7000);

// 5. agent
mark('5-agent');
await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await sleep(800);
await page.getByRole('button',{name:/Provider, model and reasoning/}).click(); await sleep(900);
await page.mouse.click(530,197); await sleep(900);   // Claude Code tab
await page.getByRole('option',{name:'Haiku 5.5'}).click(); await sleep(700);
await page.keyboard.press('Escape'); await sleep(600);
await page.locator('[contenteditable="true"], textarea').first().click();
await type(AGENT_PROMPT, 70); await sleep(600);
mark('5b-send');
await page.keyboard.press('Enter');
mark('5c-streaming');
const { execSync } = await import('child_process');
const t1 = Date.now(); let st='?';
while (Date.now()-t1 < 180000) {
  await sleep(2000);
  try { const j = JSON.parse(execSync(`bb thread list --project ${PROJECT_ID} --json`,{encoding:'utf8'})); const arr = Array.isArray(j)?j:(j.threads||[]); st = arr[0]?.status ?? 'none'; } catch(e){ st='err'; }
  console.log('status', st);
  if (st !== 'none' && st !== 'err' && st !== 'active' && st !== 'running' && Date.now()-t1 > 6000) break;
}
mark('5d-finished');
await sleep(9000);
mark('end');
await page.screenshot({path:'final.png'});
fs.writeFileSync('marks.json', JSON.stringify(marks,null,1));
await ctx.close(); await browser.close();
