// Real app + standalone service contract, with native JPL fixture kernels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import service from '../workers/ephemeris/index.js';
let chromium;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)){
 try{({chromium}=await import(name));break;}catch{/* next */}
}
if(!chromium)throw new Error('Install Playwright or set PLAYWRIGHT');
const root=fileURLToPath(new URL('../',import.meta.url));
const spk=fs.readFileSync(path.join(root,'tests/fixtures/de440-native.bsp')),eop=fs.readFileSync(path.join(root,'tests/fixtures/iers-native.txt'));
let serviceRequests=0;
const fetcher=async(url,{headers})=>{
 const file=url.endsWith('finals2000A.all')?eop:spk,m=/bytes=(\d+)-(\d+)/.exec(headers.Range),a=+m[1],end=Math.min(+m[2],file.length-1);
 return new Response(file.subarray(a,end+1),{status:206,headers:{'Content-Range':`bytes ${a}-${end}/${file.length}`,'Content-Length':String(end-a+1),'Last-Modified':'Mon, 01 Jan 2024 00:00:00 GMT'}});
};
const server=http.createServer(async(req,res)=>{
 const origin=`http://${req.headers.host}`,url=new URL(req.url,origin);
 if(url.pathname==='/js/precisionconfig.js'){
   res.writeHead(200,{'Content-Type':'text/javascript'}).end(`export const STATIC_DATA_URL=''; export const EPHEMERIS_SERVICE=${JSON.stringify(origin)}; export const R2_DATA_URL=''; export const EPHEMERIS_YEARS=[1550,2650];`);return;
 }
 if(url.pathname==='/v1/pack'){
   serviceRequests++;const response=await service.fetch(new Request(url,{headers:req.headers}),{ALLOWED_ORIGINS:origin,fetcher});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 const file=path.join(root,url.pathname.replace(/\/$/,'/index.html'));
 if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route('https://celestrak.org/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));
 await context.addInitScript(()=>{
  const Native=Worker;window.workers=0;window.Worker=class extends Native{
   constructor(...args){super(...args);this.alive=true;workers++;}
   terminate(){if(this.alive){this.alive=false;workers--;}super.terminate();}
  };
 });
 const page=await context.newPage(),errors=[],annual=[];page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/data\/precision\//.test(r.url()))annual.push(r.url());});
 await page.goto(`http://localhost:${server.address().port}/coelum/`);await page.waitForSelector('.coelum-full');
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));assert.equal(serviceRequests,0);assert.equal(await page.evaluate(()=>workers),0);
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
 const play=page.locator('[data-action="play"]');if(await play.getAttribute('aria-pressed')!=='true')await play.click();
 const report=await page.evaluate(async()=>{
  const sample=()=>new Promise(resolve=>{const gaps=[];let last=performance.now(),begin=last;const frame=now=>{gaps.push(now-last);last=now;if(now-begin<1500)requestAnimationFrame(frame);else{gaps.sort((a,b)=>a-b);resolve({frames:gaps.length,p95GapMs:gaps[Math.floor(gaps.length*.95)],maxGapMs:Math.max(...gaps)});}};requestAnimationFrame(frame);});
  const before=await sample(),root=document.createElement('div');root.id='native-result';root.style.cssText='position:fixed;inset:10px 10px auto;max-height:80vh;overflow:auto;background:white;color:black;padding:10px;z-index:9999';document.body.append(root);
  const {mountPrecision}=await import('/js/precisionui.js');
  window.nativeJob={kind:'solar',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]};
  window.nativeView=mountPrecision(root,nativeJob);window.nativeFrames=sample();return {before};
 });
 await page.locator('[data-precision-run]').click();
 await page.waitForFunction(()=>document.querySelector('[data-precision-status]').textContent.includes('Calculation complete'));
 report.during=await page.evaluate(()=>nativeFrames);
 assert.match(await page.locator('[data-precision-status]').textContent(),/Downloaded event data/);
 assert.match(await page.locator('[data-precision-result]').textContent(),/18:40:41/);
 assert.equal(await page.evaluate(()=>workers),0);assert.equal(serviceRequests,1);assert.deepEqual(annual,[],'No yearly ephemeris files are used');
 assert.ok(report.during.p95GapMs<=Math.max(100,report.before.p95GapMs*1.5));
 await context.setOffline(true);await page.evaluate(()=>document.querySelector('[data-precision-run]').click());
 await page.waitForFunction(()=>document.querySelector('[data-precision-status]').textContent.startsWith('Used downloaded event'));
 assert.equal(await page.evaluate(()=>workers),0);assert.equal(serviceRequests,1);
 await context.setOffline(false);
 // Changing dates cancels the old view and requests another native window.
 await context.route('**/v1/pack?**',r=>new Promise(resolve=>setTimeout(()=>r.abort().then(resolve).catch(resolve),500)));
 await page.evaluate(async()=>{
  nativeView.destroy();const {mountPrecision}=await import('/js/precisionui.js');
  nativeView=mountPrecision(document.querySelector('#native-result'),{...nativeJob,t:nativeJob.t+86400});document.querySelector('[data-precision-run]').click();
 });
 await page.waitForFunction(()=>workers===1);await page.evaluate(()=>document.querySelector('[data-precision-run]').click());
 assert.equal(await page.evaluate(()=>workers),0);
 report.cpuThrottleRate=6;report.serviceRequests=serviceRequests;report.annualRequests=annual.length;report.errors=errors;
 assert.deepEqual(errors,[]);console.log(JSON.stringify(report,null,2));
 if(process.env.REPORT)fs.writeFileSync(process.env.REPORT,JSON.stringify(report,null,2)+'\n');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
