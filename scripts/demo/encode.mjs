// Builds an ffconcat list from record.mjs frames, keeping their real timing.
// Usage: node encode.mjs <frames-dir>, then run ffmpeg as in docs/demo-video.md.
import fs from 'node:fs';
const dir=process.argv[2], out=process.argv[3];
const fr=JSON.parse(fs.readFileSync(dir+'/frames.json'));
let s='ffconcat version 1.0\n';
for(let i=0;i<fr.length;i++){ const d=i+1<fr.length? Math.max(0.001,fr[i+1].t-fr[i].t):0.5; s+=`file '${fr[i].f.split('/').pop()}'\nduration ${d.toFixed(4)}\n`; }
s+=`file '${fr.at(-1).f.split('/').pop()}'\n`;
fs.writeFileSync(dir+'/list.txt',s);
