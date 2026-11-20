// Binary selection/playback and legacy catalogue update in both apps.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(path.join(process.env.PLAYWRIGHT,'index.mjs'));
const root=fileURLToPath(new URL('../',import.meta.url));
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.route('https://celestrak.org/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const origin=`http://localhost:${server.address().port}`;
  await page.goto(origin+'/coelum/');await page.waitForSelector('.coelum-full');
  const checks=await page.evaluate(async()=>{
    const {skyFrame,createSkyAnimator,findObject,objectDetails}=await import('/js/coelum.js');
    const {BINARY_SYSTEMS}=await import('/js/binarydata.js');
    const t=Date.parse('2026-11-19T12:00Z')/1000,place=[45,9,120],frame=skyFrame(t,place),play=createSkyAnimator(t,place);
    for(const s of BINARY_SYSTEMS)for(const c of s.components){
      const p=findObject(frame,c.name);if(p?.binary!==c.id)throw new Error('Binary selection '+c.name);
      if(!objectDetails(p,frame).includes('Binary orbit'))throw new Error('Missing orbit card');
      for(const dt of [10,-10,50000])if(findObject(play(t+dt),c.name)?.binary!==c.id)throw new Error('Playback identity');
    }
    return {components:frame.stars.filter(s=>s.binary).length,radialVelocities:frame.stars.filter(s=>Number.isFinite(s.rv)).length};
  });
  assert.equal(checks.components,34);
  const search=page.locator('.coelum-search input');await search.fill('Sirius B');await search.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.coelum-detail h3')?.textContent==='Sirius B');
  assert.match(await page.locator('.coelum-detail').textContent(),/System radial velocity.*Binary orbit/s);
  for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});
    for(const name of ['Castor B','Procyon B','70 Ophiuchi B']){
      await search.fill(name);await search.press('Enter');
      await page.waitForFunction(name=>document.querySelector('.coelum-detail h3')?.textContent===name,name);
      assert.match(await page.locator('.coelum-detail').textContent(),/Orbit coverage/);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Binary cards fit mobile viewport');
    }
  }
  if(process.env.STARMOTION_SCREENSHOT)await page.screenshot({path:process.env.STARMOTION_SCREENSHOT});
  // A pre-upgrade catalogue stays usable offline and offers an explicit
  // update button when online. No unsolicited download during app startup.
  await page.evaluate(async()=>{
    const b=new ArrayBuffer(60),d=new DataView(b);new Uint8Array(b,0,4).set([83,84,65,82]);
    for(const [o,v]of [[4,1],[8,1],[12,1],[40,1]])d.setUint32(o,v,true);
    d.setFloat32(28,3,true);d.setFloat32(32,3,true);d.setUint8(58,160);
    await (await caches.open('imks-data-stars')).put(new URL('/coelum-faint-stars.bin',location.origin),new Response(b,{headers:{'x-variant':'8'}}));
  });
  await page.reload();await page.waitForSelector('.coelum-full');
  await page.locator('[data-action="layers"]').click();
  assert.equal(await page.locator('[data-download="refresh"]').isVisible(),true);
  await page.locator('[data-download="refresh"]').click();
  await page.waitForFunction(()=>document.querySelector('.coelum-faint-note').textContent.includes('40,244'));
  assert.equal(await page.locator('[data-download="refresh"]').isVisible(),false);
  await page.goto(origin+'/');
  const shared=await page.evaluate(async()=>{
    const {readStars}=await import('/js/coelum.js');
    const response=await(await caches.open('imks-data-stars')).match(new URL('/coelum-faint-stars.bin',location.origin));
    return Boolean(readStars(await response.arrayBuffer()).rv);
  });
  assert.equal(shared,true,'Updated download is shared by iMKS and Coelum');
  await page.goto(origin+'/coelum/');await page.waitForSelector('.coelum-full');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();await page.waitForSelector('.coelum-full');await context.setOffline(true);
  await page.reload();await page.waitForSelector('.coelum-full');
  await page.locator('.coelum-search input').fill('Sirius B');await page.locator('.coelum-search input').press('Enter');
  await page.waitForFunction(()=>document.querySelector('.coelum-detail h3')?.textContent==='Sirius B');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({...checks,legacyUpgrade:true,sharedCache:true,offlineBinarySearch:true}));
}finally{await browser?.close();server.close();}
