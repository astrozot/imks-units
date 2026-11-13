// Phone layout, real worker lifetime, offline reuse, bounded disk cache and
// animation responsiveness. PLAYWRIGHT/CHROME match tests/browser.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let engines;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)) {
  try { engines=await import(name); break; } catch { /* next */ }
}
if(!engines) throw new Error('Install Playwright or set PLAYWRIGHT');
const root=fileURLToPath(new URL('../',import.meta.url));
const harness='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="padding:12px"><div id="event"></div></main>';
const server=http.createServer((req,res)=>{
  // This suite specifically verifies the retained yearly-pack fallback.
  if(req.url==='/js/precisionconfig.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end("export const STATIC_DATA_URL='';export const R2_DATA_URL='';export const EPHEMERIS_SERVICE='';export const EPHEMERIS_YEARS=[1900,2100];");return;}
  if(req.url==='/coelum/precision-test') {res.writeHead(200,{'Content-Type':'text/html'}).end(harness);return;}
  const file=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root)||!fs.existsSync(file)) {res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const report={};
try {
  const engine=process.env.ENGINE==='webkit'?'webkit':'chromium';
  const executablePath=engine==='chromium'?process.env.CHROME:process.env.WEBKIT;
  browser=await engines[engine].launch(executablePath?{executablePath}:{});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Rome'});
  await context.route('https://celestrak.org/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));
  await context.addInitScript(()=>{
    const NativeWorker=Worker;
    window.precisionWorkers=0;
    window.precisionMessages=[];
    window.Worker=class extends NativeWorker {
      constructor(...args){super(...args);window.precisionWorkers++;this.alive=true;this.addEventListener('message',e=>{if(e.data.progress)precisionMessages.push(e.data.progress);});}
      terminate(){if(this.alive){this.alive=false;window.precisionWorkers--;}super.terminate();}
    };
  });
  const page=await context.newPage(), errors=[], requests=[];
  page.setDefaultTimeout(20000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.text().startsWith('Discarding cached precision data:')) console.log(m.text());});
  context.on('request',r=>{if(/\/data\/precision\//.test(r.url())) requests.push(r.url());});
  const base=`http://localhost:${server.address().port}`;
  const networkDown = async (offline) => {
    // WebKit's offline emulator also prevents a trivial local worker from
    // starting. For WebKit this section checks cache-only reuse online;
    // report the unverified offline case explicitly, never as a pass.
    if(engine!=='webkit') await context.setOffline(offline);
  };
  await page.goto(base+'/coelum/');await page.waitForSelector('.coelum-full');
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  assert.equal(requests.length,0,'Sky startup downloads no optional ephemeris data');
  assert.equal(await page.evaluate(()=>window.precisionWorkers),0);
  console.log('Sky startup: no optional data or workers');
  if(engine==='chromium') {
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
  }
  // Measure the actual running sky while a refinement is requested.
  const play=page.locator('[data-action="play"]');
  if(await play.getAttribute('aria-pressed')!=='true') await play.click();
  report.sky=await page.evaluate(async()=>{
    const sample=(ms)=>new Promise(resolve=>{
      const gaps=[];let last=performance.now(),start=last;
      const frame=(now)=>{gaps.push(now-last);last=now;if(now-start<ms)requestAnimationFrame(frame);else {gaps.sort((a,b)=>a-b);resolve({frames:gaps.length,p95GapMs:gaps[Math.floor(gaps.length*.95)],maxGapMs:Math.max(...gaps)});}};
      requestAnimationFrame(frame);
    });
    const before=await sample(1500);
    const {precisionEvent}=await import('/js/precisionui.js');
    const frames=sample(1500),job=precisionEvent({kind:'solar',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]});
    const result=await job.promise;
    return {before,during:await frames,residentBytes:result.residentBytes};
  });
  assert.ok(report.sky.during.p95GapMs<Math.max(100,report.sky.before.p95GapMs*1.5),'Sky frame time remains within the throttled baseline budget');
  assert.equal(await page.evaluate(()=>window.precisionWorkers),0);
  await page.evaluate(()=>caches.delete('imks-data-precision-v1'));
  requests.length=0;
  await page.goto(base+'/coelum/precision-test');
  const mount=async(kind='solar',stamp='2024-04-08T18:42:00Z')=>{
    await page.evaluate(async({kind,stamp})=>{
      window.view?.destroy();
      const root=document.querySelector('#event');root.hidden=false;
      const {mountMap,mountLunar}=await import('/js/eventview.js');
      const {eclipseTrack,lunarEclipse,lunarDiagram}=await import('/js/astro.js');
      const host={store:{get:()=> 'map',set:()=>{}},utc:true};
      const t=Date.parse(stamp)/1000;
      window.view=kind==='lunar'?mountLunar(root,lunarDiagram(lunarEclipse(t-86400)),host):mountMap(root,{...eclipseTrack(t),place:[32.7767,-96.797,130]},host);
    },{kind,stamp});
    await page.locator('[data-precision-run]').waitFor();
  };
  await mount();
  console.log('Solar event mounted');
  assert.equal(requests.length,0,'Opening the event does not download ephemeris data');
  await page.click('[data-map-mode="sim"]');
  await page.click('[data-map="play"]');
  const clickRun=()=>page.evaluate(()=>document.querySelector('[data-precision-run]').click());
  const start=Date.now();
  await page.evaluate(()=>{
    window.gaps=[];window.lastFrame=performance.now();
    window.beat=setInterval(()=>{const now=performance.now();gaps.push(now-lastFrame);lastFrame=now;},16);
  });
  await page.click('[data-precision-run]');
  await page.waitForFunction(()=>document.querySelector('[data-precision-status]')?.textContent.includes('Calculation complete'));
  report.firstResultMs=Date.now()-start;
  report.heartbeat=await page.evaluate(()=>{clearInterval(beat);return {maxGapMs:Math.max(...gaps),ticks:gaps.length};});
  assert.ok(report.heartbeat.ticks>0,'Main thread keeps responding during worker calculation');
  assert.ok(report.heartbeat.maxGapMs<500,'No half-second main-thread stall under CPU throttling');
  assert.equal(await page.evaluate(()=>window.precisionWorkers),0,'Completed worker released');
  console.log('First DE440 result received', report);
  assert.match(await page.locator('[data-precision-result]').textContent(),/DE440: total contacts/);
  assert.match(await page.locator('[data-precision-result]').textContent(),/18:40:41/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Phone layout fits');
  if(process.argv[2]) await page.screenshot({path:process.argv[2],fullPage:true});
  // Playback can change the height of its explanatory text. Keep the
  // controls stationary during subsequent repeated cache/cancel clicks.
  await page.evaluate(()=>document.querySelector('[data-map="play"]').click());
  const cacheStats=()=>page.evaluate(async()=>{
    const c=await caches.open('imks-data-precision-v1'),keys=await c.keys();let bytes=0;
    for(const key of keys) bytes+=Number((await c.match(key)).headers.get('Content-Length'));
    return {bytes,files:keys.length};
  });
  report.cache=await cacheStats();assert.ok(report.cache.bytes<200000);
  // A corrupt stored year is discarded and fetched again.
  await page.evaluate(async()=>{const c=await caches.open('imks-data-precision-v1');await c.put('/data/precision/2024.bin',new Response('corrupt'));});
  await clickRun();await page.waitForFunction(()=>document.querySelector('[data-precision-status]').textContent.includes('Calculation complete'));
  assert.equal(await page.evaluate(()=>window.precisionWorkers),0);
  await networkDown(true);
  const requestsBeforeReuse=requests.length;
  await clickRun();
  try {await page.waitForFunction(()=>document.querySelector('[data-precision-status]')?.textContent.startsWith('Used downloaded')||document.querySelector('[data-precision-status]')?.textContent.includes('Compact calculations remain available'));}
  catch(error){console.log('Stalled refinement status:',await page.locator('[data-precision-status]').textContent(),await page.evaluate(()=>precisionMessages.slice(-15)));throw error;}
  assert.match(await page.locator('[data-precision-status]').textContent(),/^Used downloaded/,'Cached data works offline');
  assert.equal(requests.length,requestsBeforeReuse,'Cached refinement makes no data requests');
  assert.equal(await page.evaluate(()=>window.precisionWorkers),0,'Offline completion releases worker');
  await networkDown(false);
  // Simulate many prior downloads, then require eviction on the next use.
  await page.evaluate(async()=>{
    const c=await caches.open('imks-data-precision-v1'),r=await c.match('/data/precision/2024.bin');
    for(let i=0;i<80;i++) await c.put(`/data/precision/old-${i}.bin`,r.clone());
  });
  await clickRun();await page.waitForFunction(()=>document.querySelector('[data-precision-status]').textContent.includes('Calculation complete'));
  report.fullCache=await cacheStats();assert.ok(report.fullCache.bytes<=8*1024*1024,'Disk cache remains bounded');
  // A stalled download can be cancelled by the button or by closing a sheet.
  await page.click('[data-precision-clear]');
  assert.equal((await cacheStats()).bytes,0);
  await context.route('**/data/precision/2024.bin',r=>new Promise(resolve=>setTimeout(()=>r.abort().then(resolve),1000)));
  await clickRun();await page.waitForFunction(()=>window.precisionWorkers===1);
  await clickRun();
  assert.equal(await page.evaluate(()=>window.precisionWorkers),0,'Cancel terminates worker');
  await clickRun();await page.waitForFunction(()=>window.precisionWorkers===1);
  await page.evaluate(()=>document.querySelector('#event').hidden=true);
  await page.waitForFunction(()=>window.precisionWorkers===0);
  await context.unroute('**/data/precision/2024.bin');
  await mount('lunar','2025-03-14T06:59:00Z');
  await clickRun();await page.waitForFunction(()=>document.querySelector('[data-precision-status]').textContent.includes('Calculation complete'));
  assert.match(await page.locator('[data-precision-result]').textContent(),/U1.*U2.*Maximum.*U3.*U4/);
  assert.equal(await page.evaluate(()=>window.precisionWorkers),0);
  await page.click('[data-precision-clear]');
  // Cached year removed, offline refinement fails clearly without changing
  // the compact event or leaving a worker running.
  await networkDown(true);
  if(engine==='webkit') await context.setOffline(true);
  await clickRun();await page.waitForFunction(()=>document.querySelector('[data-precision-status]').textContent.includes('Compact calculations remain available'));
  assert.equal(await page.evaluate(()=>window.precisionWorkers),0);
  await networkDown(false);
  if(engine==='webkit') await context.setOffline(false);
  // The calculator has a separate service-worker scope and asset cache.
  const calculator=await context.newPage();calculator.setDefaultTimeout(20000);
  calculator.on('pageerror',e=>errors.push(e.message));
  await calculator.goto(base+'/');
  await calculator.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await calculator.evaluate(async()=>{
    const root=document.createElement('div');root.id='precision-check';document.body.append(root);
    const {mountPrecision}=await import('/js/precisionui.js');
    mountPrecision(root,{kind:'solar',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]});
    root.querySelector('[data-precision-run]').click();
  });
  await calculator.waitForFunction(()=>document.querySelector('#precision-check [data-precision-status]').textContent.includes('Calculation complete'));
  await networkDown(true);
  await calculator.evaluate(()=>document.querySelector('#precision-check [data-precision-run]').click());
  await calculator.waitForFunction(()=>document.querySelector('#precision-check [data-precision-status]').textContent.startsWith('Used downloaded'));
  assert.equal(await calculator.evaluate(()=>window.precisionWorkers),0,'Calculator offline worker released');
  await networkDown(false);
  assert.equal(await calculator.evaluate(async()=>{
    for(const name of await caches.keys()) if(/^(imks|coelum)-v/.test(name)) {
      for(const request of await (await caches.open(name)).keys()) if(/\/data\/precision\//.test(request.url)) return false;
    }
    return true;
  }),true,'Optional years never enter either app asset cache');
  await calculator.close();
  assert.deepEqual(errors,[]);
  report.engine=engine;report.errors=errors;
  report.cpuThrottleRate=engine==='chromium'?6:1;
  report.offlineMethod=engine==='webkit'?'Cache-only reuse online; actual offline reuse unverified because the offline emulator prevents local worker startup':'Browser offline emulation';
  if(process.env.REPORT) fs.writeFileSync(process.env.REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
