// On an illuminated plane, changing the light must not introduce shadow bands.
// No external imagery or elevation provider is used.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let type;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)){try{type=(await import(name))[process.env.TERRAIN_BROWSER||'chromium'];break;}catch{}}
if(!type)throw new Error('Playwright required');
const root=fileURLToPath(new URL('../',import.meta.url)),server=http.createServer((req,res)=>{
 const name=path.join(root,new URL(req.url,'http://localhost').pathname);
 if(!name.startsWith(root)||!fs.existsSync(name)||fs.statSync(name).isDirectory()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(name).pipe(res);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await type.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
try{
 const page=await browser.newPage({viewport:{width:900,height:600}});await page.goto(`http://127.0.0.1:${server.address().port}/coelum/index.html`);
 const results=await page.evaluate(async()=>{
  const{createTerrainRenderer}=await import('/js/terrainrender.js'),{lookAt}=await import('/js/coelum.js');
  const c=document.createElement('canvas'),r=createTerrainRenderer(c,{shadowSize:1024}),n=65,positions=new Float32Array(n*n*3),normals=new Float32Array(n*n*3),indices=[];
  const norm=Math.hypot(.35,.18,1);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=(i/64*2-1)*30000,y=(j/64*2-1)*30000,k=j*n+i;positions.set([x,y,.35*x+.18*y-200],k*3);normals.set([-.35/norm,-.18/norm,1/norm],k*3);if(i<64&&j<64)indices.push(k,k+1,k+n,k+1,k+n+1,k+n);}
  r.setMeshes([{positions,normals,indices:Uint32Array.from(indices)}]);const results=[];
  const pixels=()=>{const g=c.getContext('webgl2'),p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);return p;};
  for(const az of [140,180,220,260])for(const alt of [8,17,35,60]){
   const options={W:700,H:400,radius:550,rotation:lookAt(0,10),sun:{az,alt},moon:{az:0,alt:-90},flux:0,exposure:1.6,outlines:false};
   r.draw({...options,shadows:false});const plain=pixels();r.draw({...options,shadows:true});const shaded=pixels();let compared=0,dark=0,max=0;
   for(let i=0;i<plain.length;i+=4)if(plain[i+3]&&shaded[i+3]){compared++;for(let j=0;j<3;j++){const d=plain[i+j]-shaded[i+j];if(d>3)dark++;max=Math.max(max,d);}}
   results.push({az,alt,compared,dark,max});
  }
  // A separate high ridge must still cast a real shadow after biasing.
  const wall={positions:Float32Array.from([-4000,5000,-4000,4000,5000,-4000,-4000,5000,6000,4000,5000,6000]),normals:Float32Array.from([0,-1,0,0,-1,0,0,-1,0,0,-1,0]),indices:Uint32Array.from([0,1,2,1,3,2])};
  r.setMeshes([{positions,normals,indices:Uint32Array.from(indices)},wall]);
  const options={W:700,H:400,radius:550,rotation:lookAt(0,10),sun:{az:0,alt:35},moon:{az:0,alt:-90},flux:0,exposure:1.6,outlines:false};
  r.draw({...options,shadows:false});const unshadowed=pixels();r.draw({...options,shadows:true});const shadowed=pixels();let cast=0;
  for(let i=0;i<shadowed.length;i+=4)if(unshadowed[i]-shadowed[i]>20)cast++;
  results.push({cast});r.destroy();return results;
 });
 assert.ok(results.pop().cast>1000,'A separate ridge must cast a shadow');
 for(const result of results){assert.ok(result.compared>1000);assert.ok(result.dark<result.compared*.001,JSON.stringify(result));}
 console.log(JSON.stringify({status:'passed',cases:results.length,maxFalseDarkChannels:Math.max(...results.map(x=>x.dark)),maxDifference:Math.max(...results.map(x=>x.max))}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
