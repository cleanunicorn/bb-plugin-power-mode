// Records the Power Mode demo video from a running bb (see docs/demo-video.md).
// Usage: node record.mjs <frames-dir>   (SEND=1 to really send the agent prompt)
// Env: BB_URL (default http://127.0.0.1:38886), CHROME (default /usr/bin/google-chrome),
//      DEMO_PROJECT (sidebar project for the agent turn, default bb-plugin-power-mode).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const OUT = process.argv[2] || 'frames';
const SEND = process.env.SEND === '1';
const BB = (process.env.BB_URL || 'http://127.0.0.1:38886').replace(/\/$/, '');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const PROJECT = process.env.DEMO_PROJECT || 'bb-plugin-power-mode';
fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT);
// Fresh profile: Power Mode settings live in localStorage, so the demo starts from defaults.
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'power-mode-demo-'));
const W=1280,H=800;
const b = await puppeteer.launch({executablePath:CHROME, headless:'new', args:['--no-sandbox',`--window-size=${W},${H}`], defaultViewport:{width:W,height:H}, userDataDir: PROFILE});
await b.defaultBrowserContext().overridePermissions(BB,['clipboard-read','clipboard-write','clipboard-sanitized-write']);
const p = await b.newPage();
await p.evaluateOnNewDocument(()=>{ document.addEventListener('DOMContentLoaded',()=>{ const s=document.createElement('style'); s.id='demo-pre'; s.textContent='[class*="group/sidebar-section"]{filter:blur(5px)!important}'; document.head.appendChild(s); }); });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const CSS = `
[class*="group/sidebar-section"],[role=listbox] [role=option]{filter:blur(5px)!important}
#demo-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;
 background:rgba(15,15,20,.88);color:#fff;font:600 20px/1.3 system-ui,sans-serif;padding:10px 20px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:900px;text-align:center;transition:opacity .25s}
#demo-cur{position:fixed;z-index:2147483646;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid #ffcc00;background:rgba(255,204,0,.25);pointer-events:none;transition:left .5s ease,top .5s ease, transform .15s}
`;
async function setup(){
  await p.evaluate((css)=>{ if(document.getElementById('demo-css'))return; const s=document.createElement('style'); s.id='demo-css'; s.textContent=css; document.head.appendChild(s);
    const c=document.createElement('div'); c.id='demo-cap'; c.style.opacity='0'; document.body.appendChild(c);
    const k=document.createElement('div'); k.id='demo-cur'; k.style.left='640px'; k.style.top='400px'; document.body.appendChild(k);},CSS);
}
async function cap(text){ await p.evaluate(t=>{const c=document.getElementById('demo-cap'); c.textContent=t; c.style.opacity=t?'1':'0';},text); }
async function moveTo(x,y){ await p.evaluate((x,y)=>{const k=document.getElementById('demo-cur'); k.style.left=x+'px'; k.style.top=y+'px';},x,y); await p.mouse.move(x,y,{steps:10}); await sleep(550); }
async function clickEl(handle){ handle=handle.asElement?handle.asElement():handle; await handle.evaluate(e=>e.scrollIntoView({block:'nearest'})); await sleep(250); const bb=await handle.boundingBox(); const x=bb.x+bb.width/2,y=bb.y+bb.height/2; await moveTo(x,y);
  await p.evaluate(()=>{const k=document.getElementById('demo-cur'); k.style.transform='scale(.7)'; setTimeout(()=>k.style.transform='',150);}); await p.mouse.click(x,y); }
async function typeHuman(text, base=55){ for(const ch of text){ if(ch==='\n'){await p.keyboard.press('Enter');} else await p.keyboard.type(ch); await sleep(base*(0.6+Math.random()*0.8)); } }
async function paste(text){ await p.evaluate(t=>navigator.clipboard.writeText(t),text); await p.keyboard.down('Control'); await p.keyboard.press('KeyV',{commands:['Paste']}); await p.keyboard.up('Control'); }
async function clearBox(){ await p.keyboard.down('Control'); await p.keyboard.press('KeyA',{commands:['SelectAll']}); await p.keyboard.up('Control'); await p.keyboard.press('Backspace'); }
const composer = async()=> (await p.$('[contenteditable="true"]')) || (await p.$('textarea'));

// --- recorder
const cdp = await p.createCDPSession(); const frames=[];
cdp.on('Page.screencastFrame', async ({data,metadata,sessionId})=>{ const i=frames.length; const f=`${OUT}/${String(i).padStart(6,'0')}.jpg`; frames.push({f,t:metadata.timestamp}); fs.writeFileSync(f,Buffer.from(data,'base64')); cdp.send('Page.screencastFrameAck',{sessionId}).catch(()=>{}); });

await p.goto(BB+'/', {waitUntil:'networkidle2'}); await sleep(2500); await setup();
await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:W,maxHeight:H,everyNthFrame:1});
const T0=Date.now(); const mark=(m)=>console.log(((Date.now()-T0)/1000).toFixed(1)+'s',m);

mark('intro'); await cap('⚡ Power Mode for bb: typing effects, combos, paste ordnance and agent hype'); await sleep(3000);
// 1 toggle
await cap('1 · Turn it on with the ⚡ button in the sidebar footer'); await sleep(1200);
await clickEl(await p.$('button[aria-label="Toggle Power Mode"]')); await sleep(1800);
// 2 typing
mark('typing'); await cap('2 · Type anywhere: particles, editor shake and a combo counter'); 
await clickEl(await composer()); await sleep(400);
await typeHuman('Power Mode turns every keystroke into a tiny fireworks show. Keep typing to build the combo and hit the milestones!', 45);
await sleep(1500);
await cap('Backspace throws red shards'); for(let i=0;i<30;i++){ await p.keyboard.press('Backspace'); await sleep(45);} await sleep(1200);
await clearBox(); await sleep(800);
// 3 paste
mark('paste'); await cap('3 · Paste drops ordnance, scaled to the paste: ~120 chars = dynamite');
await paste('const greet = (name) => `Hello, ${name}!`;\nconsole.log(greet("Power Mode"));\n// dynamite-sized paste: ~120 chars\n'); await sleep(3500);
await clearBox(); await sleep(500);
await cap('~1,000 chars = rocket barrage'); await paste(('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ').repeat(18)); await sleep(4500);
await clearBox(); await sleep(500);
await cap('~3,000 chars = carpet bombing'); await paste(('The quick brown fox jumps over the lazy dog. ').repeat(67)); await sleep(6000);
await clearBox(); await sleep(800);
// 4 settings
mark('settings'); await cap('4 · Settings → Power Mode: intensity, theme, particles, glow, effects'); 
await clickEl(await p.$('button[aria-label^="Settings"]')); await sleep(1500); await setup();
const pmLink = await p.evaluateHandle(()=>document.querySelector('a[href="/settings/plugins/power-mode"]'));
if (pmLink.asElement()) { await clickEl(pmLink); } else console.log('no power mode nav');
await sleep(2000);
const fire = await p.evaluateHandle(()=>[...document.querySelectorAll('[role=radiogroup][aria-label=Theme] [role=radio]')].find(e=>e.textContent.includes('Inferno')));
if (fire.asElement()) { await fire.asElement().scrollIntoView(); await sleep(600); await cap('Switch the theme to 🔥 Inferno'); await sleep(800); await clickEl(fire); } else console.log('no inferno');
await sleep(2200);
const agentCb = await p.$('#power-mode-agentMode'); if(agentCb){ await agentCb.scrollIntoView(); await sleep(400); await cap('Agent Power Mode is on by default'); const bx=await agentCb.boundingBox(); await moveTo(bx.x+bx.width/2,bx.y+bx.height/2); await sleep(2200);} 
// 5 agent
mark('agent'); await cap('5 · Ask an agent: Agent Power Mode cheers its reply as it streams');
await p.keyboard.press('Escape'); await sleep(300);
await p.goto(BB+'/', {waitUntil:'networkidle2'}); await sleep(1500); await setup(); await cap('5 · Ask an agent: Agent Power Mode cheers its reply as it streams');
const projBtn = await p.evaluateHandle(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('No project')));
await clickEl(projBtn); await sleep(900);
const opt = await p.evaluateHandle((name)=>[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===name), PROJECT);
await opt.asElement().evaluate(e=>e.style.setProperty('filter','none','important'));
await clickEl(opt); await sleep(900);
await clickEl(await composer()); await sleep(300);
await typeHuman('Without using any tools, write three short upbeat paragraphs (about 200 words total) about why typing with particle effects is fun.', 30);
await sleep(800);
if (SEND) {
  await p.keyboard.press('Enter'); mark('sent');
  const { execSync } = await import('node:child_process');
  let tid=null; for(let i=0;i<20 && !tid;i++){ await sleep(500); tid=(p.url().match(/threads\/(thr_[a-z0-9]+)/)||[])[1]; }
  mark('thread '+tid); fs.writeFileSync(path.join(OUT,'demo-thread.txt'), String(tid)); await setup(); await cap('Sparks fly from the newest text, an agent word combo builds, then a TURN COMPLETE finale');
  const start=Date.now(); let seen=false;
  while(tid && Date.now()-start<300000){ await sleep(1000); let st=''; try{ st=JSON.parse(execSync(`bb thread show ${tid} --json`).toString()).thread.status; }catch{} if(st && st!=='idle') seen=true; if(seen && st==='idle') break; }
  mark('turn done'); await sleep(5000); await cap('⚡ Power Mode for bb · github.com/cleanunicorn/bb-plugin-power-mode'); await sleep(3500);
}
await cap(''); await sleep(500);
await cdp.send('Page.stopScreencast'); await sleep(300);
fs.writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames)); console.log('frames',frames.length, 'url', p.url());
await b.close();
fs.rmSync(PROFILE,{recursive:true,force:true});
