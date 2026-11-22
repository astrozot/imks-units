// Sparse regional DEMs and absent offshore tiles must use real lower zooms.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
let chromium;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean))try{({chromium}=await import(name));break;}catch{}
if(!chromium)throw new Error('Playwright required');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=http.createServer(async(req,res)=>{try{
 const name=path.join(root,new URL(req.url,'http://x').pathname);
 if(!name.startsWith(root))throw Error('Invalid path');
 if(req.url==='/'){res.end('<!doctype html>');return;}
 const body=await fs.readFile(name);res.setHeader('content-type',name.endsWith('.js')?'text/javascript':'application/json');res.end(body);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const tile=Buffer.from((await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');g.fillStyle='rgb(129,148,0)';g.fillRect(0,0,512,512);return c.toDataURL('image/png');})).split(',')[1],'base64'); // 404 m
 const zooms=new Set();
 await context.route('https://tiles.mapterhorn.com/**',r=>{
  const z=Number(new URL(r.request().url()).pathname.split('/')[1]);zooms.add(z);
  return r.fulfill(z===14||z===10||z===9?{status:404,body:'Tile not found'}:{contentType:'image/png',body:tile});
 });
 await context.route('https://planetarycomputer.microsoft.com/**',r=>r.abort());
 const result=await page.evaluate(async()=>new Promise((resolve,reject)=>{
  const w=new Worker('/js/terrainworker.js',{type:'module'});
  w.onerror=e=>{w.terminate();reject(Error(e.message));};
  w.onmessage=({data:d})=>{if(d.type==='error'){w.terminate();reject(Error(d.text));}if(d.type==='ready'){
   const s=d.surface;w.terminate();resolve({eye:s.eye,ground:s.pointGround,min:Math.min(...s.profile),max:Math.max(...s.profile),metrics:s.metrics});
  }};
  w.postMessage({place:[42.4025479,12.8605297,404],options:{divisions:[32,32,32,32,32]}});
 }));
 assert.equal(result.eye,406);assert.equal(result.ground,404);
 assert.equal(result.metrics.missingVertices,0);
 assert.equal(result.metrics.samplingCoverage.missingSamples,0);
 assert.ok(result.metrics.samplingCoverage.fallbackZooms['10->8']>0);
 assert.ok(result.metrics.unavailable.length>0);
 assert.deepEqual(result.metrics.errors,[],'Expected sparse 404s are distinct from connection failures');
 assert.ok(result.max<=0,'A level DEM must not generate false peaks');
 assert.ok(zooms.has(9)&&zooms.has(8)&&!zooms.has(7),'Stop once the full baseline is present');
 console.log('Sparse terrain, offshore fallback, complete coverage and skyline checks passed');
}finally{await browser.close();server.close();}
