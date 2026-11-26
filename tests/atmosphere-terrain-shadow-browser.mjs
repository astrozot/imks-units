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
try{
 browser=await chromium.launch({executablePath:process.env.CHROME});
 const context=await browser.newContext({viewport:{width:960,height:500},serviceWorkers:'block'});
 await context.route('https://**',route=>route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://localhost:${server.address().port}/`);
 // A ridge 1800 m from the eye with the Sun low behind it: the GPU shadow job
 // writes both surface visibility and the air's shadow ceiling.
 const result=await page.evaluate(async()=>{
  const {lookAt}=await import('/js/coelum.js'),{packGrid,makeRing,gridHeightAt,lightVector}=await import('/js/terrainmesh.js');
  const {createTerrainRenderer}=await import('/js/terrainrender.js'),{skyColours}=await import('/js/skyraster.js');
  const N=512,E=12000,az=200,alt=6,R=Math.PI/180,dir=[Math.sin(az*R),Math.cos(az*R)],values=new Float32Array(N*N);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const x=-E+(i+.5)*2*E/N,y=-E+(j+.5)*2*E/N,along=x*dir[0]+y*dir[1],cross=x*dir[1]-y*dir[0];values[j*N+i]=700*Math.exp(-(((along-1800)/250)**2+(cross/900)**2))-2;}
  const grid=packGrid(values,E,N),M=128,ring=Float32Array.from({length:(M+1)*(M+1)},(_,k)=>{const x=-E+2*E*(k%(M+1))/M,y=-E+2*E*Math.floor(k/(M+1))/M;return gridHeightAt(grid,x,y)+.87*(x*x+y*y)/(2*6371008.8);});
  const mesh={...makeRing({place:[45,10,0],values:ring,extent:E,divisions:M}),grid};
  const c=document.createElement('canvas'),r=createTerrainRenderer(c);r.setMeshes([mesh]);
  const sun={az,alt},L=lightVector(az,alt),colours=skyColours({sun:{alt,vector:L,flux:1},moon:null,atmosphere:true,eyeElevation:0});
  const options={W:800,H:500,radius:700,rotation:lookAt(az,3),sun,moon:{az:0,alt:-90},flux:0,atmosphere:true,eyeElevation:0,sky:colours,nearField:2};
  const info=r.draw(options),ceiling=r.readCeiling(0);
  if(!ceiling)return {skipped:'no half-float render targets'};
  // Exact ceiling by a fine CPU march on the same grid (gridHeightAt includes
  // the curvature drop).
  const H=(x,y)=>{if(Math.max(Math.abs(x),Math.abs(y))>=E)return -1e6;const h=gridHeightAt(grid,x,y);return Number.isFinite(h)?h:-1e6;};
  const h=Math.hypot(L[0],L[1]),d=[L[0]/h,L[1]/h],tan=L[2]/h,deviation=[];
  for(let k=0;k<400;k++){
   const i=(37*k+5)%ceiling.size,j=(101*k+11)%ceiling.size,x=(i+.5)/ceiling.size*2*E-E,y=(j+.5)/ceiling.size*2*E-E;
   let top=H(x,y);for(let t=2;t<3*E;t+=Math.max(2,t*.004))top=Math.max(top,H(x+d[0]*t,y+d[1]*t)-t*tan);
   deviation.push(Math.abs(ceiling.values[j*ceiling.size+i]-top));
  }
  deviation.sort((a,b)=>a-b);
  const pixels=on=>{r.draw({...options,shadows:on});const gl=c.getContext('webgl2'),p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  // Shaded air in front of the ridge must darken its haze, never brighten it.
  const lit=pixels(false),shaded=pixels(true);let darker=0,brighter=0,n=0;
  for(let y=Math.floor(c.height*.4);y<c.height*.6;y++)for(let x=Math.floor(c.width*.4);x<c.width*.6;x++){const o=4*(y*c.width+x);if(lit[o+3]<255)continue;n++;const a=lit[o]+lit[o+1]+lit[o+2],b=shaded[o]+shaded[o+1]+shaded[o+2];if(b<a-3)darker++;if(b>a+6)brighter++;}
  r.destroy();
  return {volumeShadows:info.volumeShadows,median:deviation[200],p95:deviation[380],n,darker,brighter};
 });
 assert.deepEqual(errors,[]);
 if(result.skipped){console.log('Skipped:',result.skipped);process.exit(0);}
 assert.ok(result.volumeShadows,'The air must use the terrain shadow job');
 assert.ok(result.median<3&&result.p95<25,`Shadow ceiling must match an exact march: ${JSON.stringify(result)}`);
 assert.ok(result.n>1000&&result.darker>result.n*.3&&result.brighter===0,`Shadowed air must darken the haze: ${JSON.stringify(result)}`);
 console.log('Atmosphere terrain shadow passed',JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
