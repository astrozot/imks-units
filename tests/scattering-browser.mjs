// Physical sky CPU/GPU agreement and visual regression gallery. Same PLAYWRIGHT/CHROME as browser.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* try next */ }
}
if (!chromium) { console.log('Skipped: Playwright is not installed'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}/coelum/`;
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.CHROME});
 const context=await browser.newContext({viewport:{width:960,height:1120},serviceWorkers:'block'});
 await context.route('https://**',route=>route.abort());
 const page=await context.newPage();
 await page.goto(`http://localhost:${server.address().port}/`);
 const result=await page.evaluate(async()=>{
  const {skyRaster,rasterOptions}=await import('/js/skyraster.js');
  const {lookAt}=await import('/js/coelum.js');
  const {physicalSky,skyRadiance,displayRadiance}=await import('/js/scattering.js');
  document.body.innerHTML='';document.body.style='margin:0;background:#070b12;color:white;font:16px system-ui;display:grid;grid-template-columns:480px 480px';
  const configurations=[
   {label:'Clear daylight',sun:45,view:25,humidity:10},
   {label:'Humid daylight',sun:45,view:25,humidity:90},
   {label:'Sunset, clear air',sun:0,view:8,humidity:10},
   {label:'Sunset, humid air',sun:0,view:8,humidity:90},
   {label:'Twilight, Sun −6°',sun:-6,view:8,humidity:40},
   {label:'Late twilight, Sun −12°',sun:-12,view:8,humidity:40},
   {label:'Full Moon, dry air',sun:-30,view:30,humidity:10,illum:1},
   {label:'Full Moon, humid air',sun:-30,view:30,humidity:90,illum:1}
  ];
  const values=[];
  for(const config of configurations){
   const W=321,H=241,rad=280,S=[0,Math.cos(config.sun*Math.PI/180),Math.sin(config.sun*Math.PI/180)],M=[0,Math.cos(Math.PI/6),.5];
   const sun={alt:config.sun,vector:S},moon={alt:30,illum:config.illum||0,vector:M},settings={humidity:config.humidity},v=[0,Math.cos(config.view*Math.PI/180),Math.sin(config.view*Math.PI/180)];
   const sky=physicalSky(settings,90,sun,moon),L=skyRadiance(sky,v);
   const ref=displayRadiance(L.map((x,k)=>x+[1e-7,1.8e-7,2.4e-7][k]),sky.exposure).map(x=>Math.round(255*x));
   const pixels=[];
   for(const gpu of [false,true]){
    rasterOptions.gl=gpu;
    const start=performance.now(),bg=skyRaster({}, {W,H,radius:rad,samples:W*H,camera:{rotation:lookAt(0,config.view),stereographic:true},toJ2000:[1,0,0,0,1,0,0,0,1],kind:'sky',milkyWay:false,atmosphere:true,sun,moon,atmosphereSettings:settings,eyeElevation:90});
    if(gpu&&rasterOptions.lastBackend!=='gpu')throw Error('Physical sky GPU fallback');
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext('2d');ctx.drawImage(bg.sky,0,0,bg.w,bg.h,0,0,bg.width,bg.height);
    pixels.push({gpu,rgb:Array.from(ctx.getImageData(160,120,1,1).data).slice(0,3),ms:performance.now()-start});
    if(gpu){const figure=document.createElement('figure');figure.style='margin:0;position:relative';canvas.style='width:480px;height:280px;object-fit:cover';const caption=document.createElement('figcaption');caption.textContent=config.label;caption.style='position:absolute;top:8px;left:12px;text-shadow:0 1px 3px black';figure.append(canvas,caption);document.body.append(figure);}
   }
   values.push({label:config.label,ref,pixels});
  }
  return values;
 });
 for(const r of result)for(const p of r.pixels)assert.ok(Math.max(...p.rgb.map((x,k)=>Math.abs(x-r.ref[k])))<(p.gpu?4:9),JSON.stringify(r));
 if(process.env.SCATTERING_PREVIEW)await page.screenshot({path:process.env.SCATTERING_PREVIEW,fullPage:true});
 console.log('Physical sky RGB reference, CPU fallback and GPU agree across day, sunset, twilight and lunar humidity cases',JSON.stringify(result));
} finally {await browser?.close();await new Promise(r=>server.close(r));}
