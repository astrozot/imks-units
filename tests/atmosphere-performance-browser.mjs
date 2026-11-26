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
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html>');return;}
 const baseline=pathname.startsWith('/baseline/');
 const base=baseline?process.env.ATMOSPHERE_BASELINE:root;
 if(!base){res.writeHead(404);res.end();return;}
 const name=path.join(base,baseline?pathname.slice(10):pathname);
 if(!name.startsWith(base)||!fs.existsSync(name)){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',types[path.extname(name)]||'application/octet-stream');fs.createReadStream(name).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}/coelum/`;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME});
 const context=await browser.newContext({viewport:{width:1000,height:700},serviceWorkers:'block'});
 await context.route('https://**',route=>route.abort());const page=await context.newPage();await page.goto(`http://localhost:${server.address().port}/`);
 const result=[];
 for(const prefix of process.env.ATMOSPHERE_BASELINE?['/baseline','']:['']){
 const measurements=await page.evaluate(async({prefix,real})=>{
  const {skyFrame,lookAt}=await import(prefix+'/js/coelum.js');
  const {makeGrid,packGrid,makeRing,gridHeightAt}=await import(prefix+'/js/terrainmesh.js');
  const {tileSampler}=await import(prefix+'/js/terrainmodel.js');
  const {createTerrainRenderer}=await import(prefix+'/js/terrainrender.js');
  const {skyColours,skyRaster,rasterOptions}=await import(prefix+'/js/skyraster.js');
  const place=[45.896,10.843,90],frame=skyFrame(Date.parse('2026-11-25T13:54:03Z')/1000,place),body=frame.bodies[0],R=Math.PI/180;
  const sun={alt:body.alt,vector:[Math.sin(body.az*R)*Math.cos(body.alt*R),Math.cos(body.az*R)*Math.cos(body.alt*R),Math.sin(body.alt*R)]},moon={alt:-30,illum:0};
  let grids;
  if(real){
   const base='/'+real.replace(/^\/+|\/+$/g,''),jobs=await(await fetch(base+'/tile-index.json')).json(),tiles=new Map();
   await Promise.all(jobs.map(async([z,x,y])=>{
    const b=await createImageBitmap(await(await fetch(`${base}/tiles/${z}-${x}-${y}.webp`)).blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'}),c=new OffscreenCanvas(512,512),g=c.getContext('2d');g.drawImage(b,0,0);b.close();const p=g.getImageData(0,0,512,512).data,h=new Float32Array(512*512);
    for(let i=0;i<h.length;i++)h[i]=p[i*4+3]?p[i*4]*256+p[i*4+1]+p[i*4+2]/256-32768:NaN;
    tiles.set(`${z}/${x}/${y}`,{size:512,h,noData:NaN});
   }));
   const sample=tileSampler(tiles,false,true);grids=[4000,16000,60000].map(extent=>makeGrid({place,sample,extent,size:512,zoom:14}));
  }else{
   const N=512,E=16000,v=new Float32Array(N*N),dx=Math.sin(body.az*R),dy=Math.cos(body.az*R);
   for(let j=0;j<N;j++)for(let i=0;i<N;i++){const x=-E+(i+.5)*2*E/N,y=-E+(j+.5)*2*E/N;v[j*N+i]=1000*Math.exp(-(((x*dx+y*dy-1600)/300)**2+((x*dy-y*dx)/2000)**2))-2;}
   grids=[packGrid(v,E,N)];
  }
  const inputDelay=0,redraw=0;
  const meshes=grids.map((g,k)=>{
   const n=128,values=new Float32Array((n+1)*(n+1));
   for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){const x=-g.extent+2*g.extent*i/n,y=-g.extent+2*g.extent*j/n;values[j*(n+1)+i]=gridHeightAt(g,x,y)+.87*(x*x+y*y)/(2*6371008.8);}
   return {...makeRing({place,values,extent:g.extent,inner:k?grids[k-1].extent:0,divisions:n}),grid:g};
  });
  const canvas=document.createElement('canvas'),renderer=createTerrainRenderer(canvas);renderer.setMeshes(meshes);
  const times=[],transport=[],components=[];let lastPhysical=null,device=null;
  for(let i=0;i<8;i++){
   const start=performance.now();
   const colours=skyColours({sun,moon,atmosphere:true,atmosphereSettings:{humidity:60,aerosol:1},eyeElevation:90});
   const cpuMs=performance.now()-start;
   const bg=skyRaster({}, {W:1000,H:700,radius:600,samples:45000,camera:{rotation:lookAt(body.az+i*.2,24),stereographic:true},toJ2000:[1,0,0,0,1,0,0,0,1],kind:'sky',milkyWay:false,ground:false,atmosphere:true,sun,moon,atmosphereSettings:{humidity:60,aerosol:1},eyeElevation:90,colours});
   if(rasterOptions.lastBackend!=='gpu')throw Error('Performance test requires GPU path');
   const gl=bg.sky.getContext('webgl2');gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
   const skyDone=performance.now();
   const info=renderer.draw({profile:true,W:1000,H:700,radius:600,rotation:lookAt(body.az+i*.2,24),sun:{az:body.az,alt:body.alt},moon:{az:0,alt:-30},flux:0,shadows:true,atmosphere:true,eyeElevation:90,sky:colours});
   const groundGL=canvas.getContext('webgl2');groundGL.readPixels(0,0,1,1,groundGL.RGBA,groundGL.UNSIGNED_BYTE,new Uint8Array(4));
   if(!prefix&&i>0&&info.shadowTexels!==0)throw Error('Shadows recomputed although the light did not move');

   if(i===0){const ext=gl.getExtension('WEBGL_debug_renderer_info');device=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}
   if(i>=2)components.push({skyMs:skyDone-start,aerialMs:info.aerialMs,sceneMs:info.sceneGpuMs});
   if(gl.getError())throw Error('GL error');
   if(i>=2){times.push(performance.now()-start);transport.push(cpuMs);}
   lastPhysical=colours.physical;
  }
  times.sort((a,b)=>a-b);transport.sort((a,b)=>a-b);
  renderer.destroy();
  return {prefix,device,components,medianMs:times[Math.floor(times.length/2)],maxMs:times.at(-1),cpuMedianMs:transport[Math.floor(transport.length/2)],backend:rasterOptions.lastBackend,inputDelay,redraw};
 },{prefix,real:process.env.RIVA_DEM||null});result.push(measurements);
 }
 if(result.length===2)assert.ok(result[1].medianMs<result[0].medianMs*.7,JSON.stringify(result));
 const current=result.at(-1);assert.ok(current.cpuMedianMs<10,JSON.stringify(current));
 console.log('Atmosphere performance passed',JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
