// Build an isolated static phone test; no app deployment or credentials involved.
// node tools/terrain-lab/prepare-phone-site.mjs OUTPUT_DIRECTORY SURFACE_JSON
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackSurface } from './surface-io.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)), out=path.resolve(process.argv[2]), surface=path.resolve(process.argv[3]);
const saved=JSON.parse(await fs.readFile(surface,'utf8'));const data=unpackSurface(saved);
if(data.config.quality!==256)throw new Error('Use a Preview (256) surface for the phone test');
if((await fs.stat(surface)).size>24e6)throw new Error('Prepared surface exceeds static-hosting file budget');
await fs.mkdir(out,{recursive:true});
const copied=new Set();
async function copy(relative){
  if(copied.has(relative))return;copied.add(relative);
  if(relative.startsWith('../')||path.isAbsolute(relative))throw new Error('Dependency outside project');
  const source=await fs.readFile(path.join(root,relative)),target=path.join(out,relative);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);
  if(/\.(mjs|js)$/.test(relative))for(const match of source.toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await copy(path.normalize(path.join(path.dirname(relative),match[1])));
}
for(const name of ['panorama.mjs','panorama-worker.mjs'])await copy('tools/terrain-lab/'+name);
let html=await fs.readFile(path.join(root,'tools/terrain-lab/panorama.html'),'utf8');
html=html.replace('Riva · terrain and light laboratory','Riva · private iPhone terrain test').replace('<h1>Mountains, light & shadow</h1>','<h1>Mountains, light & shadow</h1>\n<p><button id="prepared">Load Riva panorama</button> · Prepared mobile surface · no computer connection needed.</p>').replace('<a href="/?proxy=1">Skyline comparison lab</a>','Private iPhone test.').replace('<script type="module" src="panorama.mjs"></script>','<script type="module" src="phone-entry.mjs"></script>');
await fs.writeFile(path.join(out,'index.html'),html);
await fs.writeFile(path.join(out,'phone-entry.mjs'),`import './tools/terrain-lab/panorama.mjs';\nconst button=document.getElementById('prepared');\ndocument.getElementById('status').textContent='Load the prepared Riva panorama to start. It downloads about ${Math.ceil((await fs.stat(surface)).size/1e6)} MB from this site; your computer can be switched off.';\nbutton.onclick=async()=>{button.disabled=true;try{await window.panoramaLab.loadSurface('./riva-preview.json');document.getElementById('status').textContent='Riva panorama ready. Try the lighting examples or drag to look around.';}catch(e){document.getElementById('status').textContent='Failed: '+e.message;}finally{button.disabled=false;}};\n`);
if(data.config.water && data.metrics.water?.model!=='natural-earth-v1')throw new Error('Rebuild the surface using the general water data');
await fs.cp(path.join(root,'data/water'),path.join(out,'data/water'),{recursive:true});
await fs.rm(path.join(out,'tools/terrain-lab/garda-water.json'),{force:true});
await fs.copyFile(surface,path.join(out,'riva-preview.json'));
console.log(JSON.stringify({directory:out,dependencies:copied.size,surfaceBytes:(await fs.stat(surface)).size}));
