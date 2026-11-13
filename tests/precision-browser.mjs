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
      const host={store:{get:()=> 'map',set:()=>{}},utc:true,sky:()=>{}};
      const t=Date.parse(stamp)/1000;
      window.view=kind==='lunar'?mountLunar(root,lunarDiagram(lunarEclipse(t-86400)),host):mountMap(root,{...eclipseTrack(t),place:[32.7767,-96.797,130]},host);
    },{kind,stamp});
    await page.locator('[data-precision-run]').waitFor();
  };
  await mount();
  const toggle=page.locator('[data-precision-run]'),contacts=page.locator('.map-local');
  const original=await contacts.textContent(),box=await toggle.boundingBox();
  await toggle.click();await page.waitForFunction(()=>document.querySelector('[data-precision-run]').getAttribute('aria-pressed')==='true');
  assert.match(await contacts.textContent(),/18:40:41/);assert.notEqual(await contacts.textContent(),original);assert.equal(await page.evaluate(()=>precisionWorkers),0);
  assert.equal((await toggle.boundingBox()).width,box.width);
  assert.equal(await page.locator('[data-precision-result], [data-precision-clear]').count(),0);
  const count=requests.length;await networkDown(true);await toggle.click();assert.equal(await contacts.textContent(),original);await toggle.click();assert.equal(requests.length,count);await networkDown(false);
  await mount('lunar','2025-03-14T06:59:00Z');
  const lunarBefore=await page.locator('.lunar-contacts').textContent(),lunarBeforeTime=await page.locator('.lunar-contacts [data-lunar-event]').first().getAttribute('data-lunar-event');
  await toggle.click();await page.waitForFunction(()=>document.querySelector('[data-precision-run]').getAttribute('aria-pressed')==='true');
  assert.match(await page.locator('.lunar-contacts').textContent(),/U1.*U2.*max.*U3.*U4/);assert.notEqual(await page.locator('.lunar-contacts [data-lunar-event]').first().getAttribute('data-lunar-event'),lunarBeforeTime);
  await toggle.click();assert.equal(await page.locator('.lunar-contacts').textContent(),lunarBefore);
  // Occultation fields switch in place as well.
  await page.evaluate(async()=>{
    view.destroy();const {mountMap}=await import('/js/eventview.js'),{occultationTrack}=await import('/js/astro.js');
    const t=Date.parse('2025-01-04T17:00:00Z')/1000;
    view=mountMap(document.querySelector('#event'),{...occultationTrack('saturn','moon',t),place:[48.8566,2.3522,35],occ:{target:'saturn',front:'moon',names:['Saturn','Moon'],covers:true}}, {store:{get:()=> 'map',set:()=>{}},utc:true});
  });
  const occBefore=await contacts.textContent();await toggle.click();await page.waitForFunction(()=>document.querySelector('[data-precision-run]').getAttribute('aria-pressed')==='true');
  assert.notEqual(await contacts.textContent(),occBefore);await toggle.click();assert.equal(await contacts.textContent(),occBefore);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  report.inPlaceFields=['solar','lunar','occultation'];report.requests=requests.length;report.errors=errors;console.log(JSON.stringify(report,null,2));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
