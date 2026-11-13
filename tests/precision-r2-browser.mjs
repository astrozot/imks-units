// Actual app with a cross-origin R2 range server; optionally use full staged kernels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
let chromium,webkit;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)){
 try{({chromium,webkit}=await import(name));break;}catch{/* next */}
}
if(!chromium)throw new Error('Install Playwright or set PLAYWRIGHT');
const root=fileURLToPath(new URL('../',import.meta.url));
const spk=fs.readFileSync(path.join(root,'tests/fixtures/de440-native.bsp')),eop=fs.readFileSync(path.join(root,'tests/fixtures/iers-native.txt'));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const staticMode=process.env.STATIC_TEST==='1';
const staged=staticMode?process.env.STATIC_STAGED:process.env.R2_STAGED;
const objects=new Map();
const staticDescriptor=(id,bytes)=>{
 const prefix=`${id==='iers'?'iers':'kernels'}/${id}-${digest(bytes)}`,index=Buffer.from(digest(bytes),'hex');
 objects.set('/'+prefix+'/000000.bin',bytes);objects.set('/'+prefix+'/index.bin',index);
 return {path:prefix,bytes:bytes.length,sha256:digest(bytes),indexSha256:digest(index),indexBytes:index.length};
};
const manifest=process.env.STATIC_URL?await (await fetch(new URL('manifest.json',process.env.STATIC_URL))).json():staged?JSON.parse(fs.readFileSync(path.join(staged,'manifest.json'))):{version:1,kernels:{de440:{path:`kernels/de440-${digest(spk)}.bsp`,bytes:spk.length,sha256:digest(spk)}},earthOrientation:{path:`iers/finals-${digest(eop)}.all`,bytes:eop.length,sha256:digest(eop)}};
if(staticMode&&!staged&&!process.env.STATIC_URL){manifest.version=2;manifest.chunkBytes=262144;manifest.kernels.de440=staticDescriptor('de440',spk);manifest.earthOrientation=staticDescriptor('iers',eop);}
const descriptors=[manifest.kernels.de440,manifest.earthOrientation];
let serviceRequests=0,rangeBytes=0;
const objectServer=http.createServer((req,res)=>{
 const headers={'Access-Control-Allow-Origin':`http://localhost:${server.address().port}`,'Access-Control-Allow-Methods':'GET,HEAD,OPTIONS','Access-Control-Allow-Headers':'Range,If-Range','Access-Control-Expose-Headers':'Content-Range,ETag,Content-Length'};
 if(req.method==='OPTIONS'){res.writeHead(204,headers).end();return;}
 serviceRequests++;
 if(req.url==='/manifest.json'){res.writeHead(200,{...headers,'Content-Type':'application/json'}).end(JSON.stringify(manifest));return;}
 if(staticMode){
  assert.equal(req.headers.range,undefined);assert.equal(req.headers['if-range'],undefined);
  const safe=descriptors.some(d=>req.url.startsWith('/'+d.path+'/'))&&/^\/(kernels|iers)\/[a-z0-9-]+\/(index|[0-9]{6})\.bin$/.test(req.url);
  if(!safe){res.writeHead(404,headers).end();return;}
  const bytes=staged?fs.readFileSync(path.join(staged,req.url)):objects.get(req.url);
  assert.ok(bytes.length<=262144);rangeBytes+=bytes.length;
  res.writeHead(200,{...headers,'Content-Length':String(bytes.length)}).end(bytes);return;
 }
 const d=descriptors.find(d=>'/'+d.path===req.url),m=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');
 if(!d||!m){res.writeHead(400,headers).end();return;}
 const a=+m[1],z=+m[2];assert.ok(z-a<16384);assert.ok(z<d.bytes);rangeBytes+=z-a+1;
 res.writeHead(206,{...headers,'Content-Range':`bytes ${a}-${z}/${d.bytes}`,'Content-Length':String(z-a+1),'ETag':`"${d.sha256}"`});
 if(staged)fs.createReadStream(path.join(staged,d.path),{start:a,end:z}).pipe(res);else res.end((d===descriptors[0]?spk:eop).subarray(a,z+1));
});
await new Promise(resolve=>objectServer.listen(0,'127.0.0.1',resolve));
const endpoint=process.env.STATIC_URL||`http://localhost:${objectServer.address().port}/`;
const server=http.createServer(async(req,res)=>{
 const origin=`http://${req.headers.host}`,url=new URL(req.url,origin);
 if(url.pathname==='/js/precisionconfig.js'){
   res.writeHead(200,{'Content-Type':'text/javascript'}).end(`export const STATIC_DATA_URL=${JSON.stringify(staticMode?endpoint:'')}; export const EPHEMERIS_SERVICE=''; export const R2_DATA_URL=${JSON.stringify(staticMode?'':endpoint)}; export const EPHEMERIS_YEARS=[1550,2650];`);return;
 }
 const file=path.join(root,url.pathname.replace(/\/$/,'/index.html'));
 if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 const safari=process.env.ENGINE==='webkit';
 browser=await (safari?webkit:chromium).launch(safari?(process.env.WEBKIT?{executablePath:process.env.WEBKIT}:{}):(process.env.CHROME?{executablePath:process.env.CHROME}:{}));
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route('https://celestrak.org/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));
 await context.addInitScript(()=>{
  const Native=Worker;window.workers=0;window.Worker=class extends Native{
   constructor(...args){super(...args);this.alive=true;workers++;}
   terminate(){if(this.alive){this.alive=false;workers--;}super.terminate();}
  };
 });
 const page=await context.newPage(),errors=[],annual=[];page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(process.env.STATIC_URL&&r.url().startsWith(endpoint))serviceRequests++;if(/\/data\/precision\//.test(r.url()))annual.push(r.url());});
 page.on('response',r=>{if(process.env.STATIC_URL&&r.url().startsWith(endpoint))rangeBytes+=Number(r.headers()['content-length'])||0;});
 await page.goto(`http://localhost:${server.address().port}/coelum/`);await page.waitForSelector('.coelum-full');
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));assert.equal(serviceRequests,0);assert.equal(await page.evaluate(()=>workers),0);
 if(!safari){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});}
 const play=page.locator('[data-action="play"]');if(await play.getAttribute('aria-pressed')!=='true')await play.click();
 const report=await page.evaluate(async()=>{
  const sample=(untilDone=false)=>new Promise(resolve=>{const gaps=[];let last=performance.now(),begin=last;const frame=now=>{gaps.push(now-last);last=now;if(untilDone?!window.nativeStopFrames:now-begin<1500)requestAnimationFrame(frame);else{gaps.sort((a,b)=>a-b);resolve({frames:gaps.length,p95GapMs:gaps[Math.floor(gaps.length*.95)],maxGapMs:Math.max(...gaps)});}};requestAnimationFrame(frame);});
  const before=await sample(),root=document.createElement('div');root.id='native-result';root.style.cssText='position:fixed;inset:10px 10px auto;max-height:80vh;overflow:auto;background:white;color:black;padding:10px;z-index:9999';document.body.append(root);
  const {mountPrecision}=await import('/js/precisionui.js');
  window.nativeJob={kind:'solar',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]};
  const controls=document.createElement('div'),field=document.createElement('p');field.dataset.nativeContact='';field.textContent='Approximate contact';root.append(controls,field);window.nativeView=mountPrecision(controls,nativeJob,r=>{field.textContent=r?new Date(Math.round(r.event.C2)*1000).toISOString():'Approximate contact';});window.nativeStopFrames=false;window.nativeFrames=sample(true);return {before};
 });
 await page.locator('#native-result [data-precision-run]').click();
 await page.waitForFunction(()=>document.querySelector('#native-result [data-precision-run]').getAttribute('aria-pressed')==='true');
 report.during=await page.evaluate(()=>{nativeStopFrames=true;return nativeFrames;});
 assert.match(await page.locator('#native-result [data-precision-status]').textContent(),/DE440/);
 assert.match(await page.locator('[data-native-contact]').textContent(),/18:40:41/);
 assert.equal(await page.evaluate(()=>workers),0);assert.ok(serviceRequests>1);assert.deepEqual(annual,[],'No yearly ephemeris files are used');
 assert.ok(report.during.p95GapMs<=Math.max(100,report.before.p95GapMs*1.5));
 const coldRequests=serviceRequests;if(!safari)await context.setOffline(true);await page.evaluate(()=>document.querySelector('#native-result [data-precision-run]').click());
 assert.equal(await page.locator('#native-result [data-precision-run]').getAttribute('aria-pressed'),'false');await page.locator('#native-result [data-precision-run]').click();assert.equal(await page.locator('#native-result [data-precision-run]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.evaluate(()=>workers),0);assert.equal(serviceRequests,coldRequests);
 await context.setOffline(false);
 report.coldRequests=coldRequests;
 // Wait until an actual native-data request is pending before cancelling.
 await page.evaluate(async()=>{await (await import('/js/precisionui.js')).clearPrecisionData();});
 // WebKit routing misses fetches forwarded by a service worker. Hold the
 // page's Fetch API instead and verify its AbortSignal, in both engines.
 await page.evaluate(()=>{
  window.savedNativeFetch=window.fetch;window.heldNativeRequests=0;window.abortedNativeRequests=0;
  window.fetch=(url,options={})=>{
   if(!String(url).includes('/kernels/'))return savedNativeFetch(url,options);
   heldNativeRequests++;
   return new Promise((resolve,reject)=>{
    const stop=()=>{abortedNativeRequests++;reject(new DOMException('Cancelled','AbortError'));};
    if(options.signal?.aborted)stop();else options.signal.addEventListener('abort',stop,{once:true});
   });
  };
 });
 await page.evaluate(async()=>{
  nativeView.destroy();const {mountPrecision}=await import('/js/precisionui.js');
  // A different year guarantees uncached coefficient chunks.
  nativeView=mountPrecision(document.querySelector('#native-result'),{...nativeJob,t:Date.parse('2000-01-21T04:00:00Z')/1000});document.querySelector('#native-result [data-precision-run]').click();
 });
 await page.waitForFunction(()=>workers===1);
 await page.waitForFunction(()=>heldNativeRequests>0);
 await page.evaluate(()=>document.querySelector('#native-result [data-precision-run]').click());
 assert.equal(await page.evaluate(()=>workers),0);
 assert.ok(await page.evaluate(()=>abortedNativeRequests>0),'Cancel aborts pending data I/O');
 await page.evaluate(()=>document.querySelector('#native-result [data-precision-run]').click());
 await page.waitForFunction(()=>heldNativeRequests>1);
 await page.evaluate(()=>document.querySelector('#native-result').hidden=true);
 await page.waitForFunction(()=>workers===0&&abortedNativeRequests>1);
 await page.evaluate(()=>{window.fetch=savedNativeFetch;});
 report.transport=staticMode?'static':'range';report.source=process.env.STATIC_URL||'local cross-origin server';report.downloadedBytes=rangeBytes;report.fullKernelBytes=manifest.kernels.de440.bytes;report.cpuThrottleRate=safari?1:6;report.reuse=safari?'Cache only; WebKit offline emulator prevents module workers':'Offline';report.serviceRequests=serviceRequests;report.annualRequests=annual.length;report.errors=errors;
 assert.deepEqual(errors,[]);console.log(JSON.stringify(report,null,2));
 if(process.env.REPORT)fs.writeFileSync(process.env.REPORT,JSON.stringify(report,null,2)+'\n');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>objectServer.close(resolve));}
