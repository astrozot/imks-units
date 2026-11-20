// Special coordinate origins in the standalone app and embedded explorer.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)) {
  try { ({ chromium }=await import(name)); break; } catch { /* next */ }
}
if (!chromium) throw new Error('Install Playwright or set PLAYWRIGHT to its package directory');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=http.createServer((req,res)=>{
 const file=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 const ext=path.extname(file);res.setHeader('content-type',ext==='.js'?'text/javascript':ext==='.html'?'text/html':ext==='.css'?'text/css':'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
 const page=await browser.newPage({viewport:{width:900,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',route=>route.abort());
 await page.goto(`http://localhost:${server.address().port}/coelum/`);
 await page.waitForSelector('[data-action="mount"]');
 for (const origin of ['geocentric','barycentric']) {
  if (!await page.locator('.coelum-placepanel').isVisible()) await page.locator('[data-action="place"]').click();
  await page.locator(`[data-place="${origin}"]`).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-action="mount"]').textContent(),'EQ');
  for(let i=0;i<4;i++) {
   await page.locator('[data-action="mount"]').click();
   assert.ok(['EQ','GA'].includes(await page.locator('[data-action="mount"]').textContent()));
  }
  assert.equal(await page.locator('canvas').first().getAttribute('data-atmosphere'),'false');
  await page.locator('[data-action="time"]').click();
  assert.match(await page.locator('.coelum-events').textContent(),/require a location/);
  await page.locator('[data-action="time"]').click();
  await page.reload();await page.waitForSelector('[data-action="mount"]');
  assert.equal(await page.locator('[data-action="mount"]').textContent(),'EQ');
 }
 const result=await page.evaluate(async()=>{
  const {mountCoelum}=await import('/js/coelumui.js');
  const host=document.createElement('div');host.className='coelum-explorer';document.body.replaceChildren(host);
  const app=mountCoelum(host,{t:Date.parse('2026-11-19T21:00:00Z')/1000,place:[41.9,12.5,20],label:'Rome'},String,{standalone:true});
  const out=[];
  for(const mode of ['sky','chart'])for(const origin of ['geocentric','barycentric']) {
   host.querySelector(`[data-view="${mode}"]`).click();
   await app.setPlace({lat:41.9,lon:12.5,h:0,origin,name:origin});app.select('Jupiter');
   const card=host.querySelector('[data-object-basic]').textContent;
   out.push({mode,origin,place:app.place,mount:host.querySelector('[data-action="mount"]').textContent,card});
   host.querySelector('[data-action="play"]').click();app.setTime(app.time+86400);
   await new Promise(r=>setTimeout(r,250));host.querySelector('[data-action="play"]').click();
  }
  await app.setPlace({lat:41.9,lon:12.5,h:20,name:'Rome'});
  const mounts=[];for(let i=0;i<3;i++){host.querySelector('[data-action="mount"]').click();mounts.push(host.querySelector('[data-action="mount"]').textContent);}
  const {skyFrame}=await import('/js/coelum.js'),{skyScene}=await import('/js/coelumsky.js');
  const groundChecks=[];
  for(const origin of ['geocentric','barycentric']){
   const frame=skyFrame(Date.parse('2020-01-01T00:00:00Z')/1000,[41.9,12.5,0,origin]);
   const canvas=document.createElement('canvas');canvas.width=canvas.height=240;
   const context=canvas.getContext('2d'),view={scale:1,az:0,alt:-30,selected:'Sun'};
   const render=ground=>{const scene=skyScene(frame,240,240,{ground,atmosphere:false,milkyway:false},view,context);return {pixels:canvas.toDataURL(),sun:scene.objects.some(o=>o.body==='sun')};};
   const withGround=render(true),withoutGround=render(false);
   groundChecks.push({origin,same:withGround.pixels===withoutGround.pixels,sun:withGround.sun});
  }
  return {out,mounts,groundChecks};
 });
 for(const r of result.out) {assert.equal(r.place[3],r.origin);assert.ok(!r.card.includes('Altitude (Alt)')&&!r.card.includes('Azimuth (Az)'));assert.notEqual(r.mount,'AZ');assert.ok(!r.card.includes('NaN'));}
 for(const r of result.groundChecks){assert.equal(r.same,true,`${r.origin}: ground always hidden`);if(r.origin==='barycentric')assert.equal(r.sun,false);}
 assert.ok(result.mounts.includes('AZ'),'AZ available again at surface');
 assert.deepEqual(errors,[]);
 console.log('Special location selection, EQ/GA restriction, reload persistence, chart/sky playback and surface return passed');
} finally { await browser?.close();await new Promise(r=>server.close(r)); }
