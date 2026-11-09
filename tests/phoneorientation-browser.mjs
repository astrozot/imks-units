// Synthetic phone sensors through both real app entry points. Uses the same
// PLAYWRIGHT / CHROME options as coelum-browser.mjs; no physical sensors needed.
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
 for(const app of ['coelum/','']) {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await context.route('https://**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  await context.addInitScript(()=>{
   localStorage.setItem('imks.settings',JSON.stringify({location:{lat:45,lon:9,h:0,name:'Milan'}}));
   localStorage.setItem('imks-coelum-mode','sky');
   window.permissionCalls=[];
   DeviceOrientationEvent.requestPermission=()=>{permissionCalls.push('orientation');return Promise.resolve('granted');};
   DeviceMotionEvent.requestPermission=()=>{permissionCalls.push('motion');return Promise.resolve('granted');};
   window.sensor={alpha:0,beta:110,gamma:0,heading:0,accuracy:2};
   window.emitSensor=()=>{
    const e=new DeviceOrientationEvent('deviceorientation',{alpha:sensor.alpha,beta:sensor.beta,gamma:sensor.gamma,absolute:false});
    Object.defineProperties(e,{webkitCompassHeading:{value:sensor.heading},webkitCompassAccuracy:{value:sensor.accuracy}});
    dispatchEvent(e);
   };
  });
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://localhost:${server.address().port}/${app}`);
  if(!app){
   await page.waitForFunction(()=>document.querySelector('#expr')&&document.querySelectorAll('.key').length);
   await page.keyboard.type('coelum(2026.11.06 21:00 Z, "Rome")');await page.keyboard.press('Enter');
   await page.locator('.coelum-preview').click();
  }
  await page.waitForSelector('.coelum-full');
  await page.locator('[data-action="orient"]').click();
  await page.evaluate(()=>{emitSensor();window.sensorTimer=setInterval(emitSensor,16);});
  await page.waitForFunction(()=>document.querySelector('.coelum-canvas').dataset.content==='scene');
  const rotation=()=>page.locator('.coelum-full').getAttribute('data-rotation');
  const before=await rotation();
  const canvas=page.locator('.coelum-full'),box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.mouse.move(box.x+box.width/2+45,box.y+box.height/2+15,{steps:5});await page.mouse.up();
  assert.equal(await page.locator('[data-action="orient"]').getAttribute('aria-pressed'),'true','Pan keeps following enabled');
  const panned=await rotation();assert.notEqual(panned,before,'Pan calibrates camera');
  await page.waitForTimeout(250);assert.equal(await rotation(),panned,'Calibration survives incoming sensor events');
  // Zoom buttons, wheel and a two-finger pinch all retain calibration/following.
  const oldScale=Number(await canvas.getAttribute('data-scale'));
  await page.locator('[data-action="in"]').click();
  assert.ok(Number(await canvas.getAttribute('data-scale'))>oldScale);
  await canvas.dispatchEvent('wheel',{deltaY:-50,ctrlKey:true});
  await canvas.dispatchEvent('pointerdown',{pointerId:11,isPrimary:true,pointerType:'touch',clientX:box.x+130,clientY:box.y+150});
  await canvas.dispatchEvent('pointerdown',{pointerId:12,isPrimary:false,pointerType:'touch',clientX:box.x+230,clientY:box.y+150});
  const pinchScale=Number(await canvas.getAttribute('data-scale'));
  await canvas.dispatchEvent('pointermove',{pointerId:12,pointerType:'touch',clientX:box.x+270,clientY:box.y+150});
  await canvas.dispatchEvent('pointerup',{pointerId:12,pointerType:'touch',clientX:box.x+270,clientY:box.y+150});
  await canvas.dispatchEvent('pointerup',{pointerId:11,pointerType:'touch',clientX:box.x+130,clientY:box.y+150});
  await page.waitForTimeout(60);
  assert.ok(Number(await canvas.getAttribute('data-scale'))>pinchScale,'Pinch changes scale');
  assert.equal(await rotation(),panned,'Zoom preserves calibration');
  // A stale/unreliable compass cannot undo either movement or manual alignment.
  await page.evaluate(()=>{sensor.alpha=350;sensor.heading=70;sensor.accuracy=-1;});
  await page.waitForTimeout(250);const moved=await rotation();assert.notEqual(moved,panned,'Phone still moves after a pan');
  await page.waitForTimeout(300);assert.equal(await rotation(),moved,'No compass pull-back');
  await page.locator('[data-action="layers"]').click();
  assert.match(await page.locator('[data-orient-quality]').textContent(),/Aligned|unreliable/);
  await page.locator('[data-orient-level]').check();
  assert.equal(await page.locator('[data-action="orient"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-action="layers"]').click();
  // Both views keep following through mode and mount changes.
  await page.locator('[data-view="chart"]').click();
  assert.equal(await page.locator('[data-action="orient"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-action="mount"]').click();
  await page.locator('[data-view="sky"]').click();
  assert.equal(await page.locator('[data-action="orient"]').getAttribute('aria-pressed'),'true');
  // Search selects a known object; explicitly enable following again before
  // aligning, so the flight and the sensors never fight for the camera.
  await page.locator('.coelum-search input').fill('Vega');await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-action="orient"]').getAttribute('aria-pressed'),'false');
  await page.locator('[data-action="orient"]').click();
  await page.waitForTimeout(100);
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-orient-level]').uncheck();
  assert.equal(await page.locator('[data-action="orient-align"]').isEnabled(),true);
  await page.locator('[data-action="orient-align"]').click();
  assert.match(await page.locator('[data-orient-quality]').textContent(),/Aligned with the sky/);
  if(app) await page.screenshot({path:'/private/tmp/phoneorientation-options.png'});
  const aligned=await rotation();await page.waitForTimeout(100);assert.equal(await rotation(),aligned);
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-view="chart"]').click();
  const chartBefore=await rotation(),chartBox=await canvas.boundingBox();
  await page.mouse.move(chartBox.x+chartBox.width/2,chartBox.y+chartBox.height/2);
  await page.mouse.down();await page.mouse.move(chartBox.x+chartBox.width/2-30,chartBox.y+chartBox.height/2,{steps:4});await page.mouse.up();
  assert.notEqual(await rotation(),chartBefore,'Chart pan calibrates while following');
  assert.equal(await page.locator('[data-action="orient"]').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>clearInterval(sensorTimer));
  await page.waitForTimeout(3100);
  assert.equal(await page.locator('[data-action="orient"]').getAttribute('aria-pressed'),'true','A quiet sensor does not disable following');
  await page.locator('[data-action="orient"]').click();
  assert.equal(await page.locator('[data-action="orient"]').getAttribute('aria-pressed'),'false');
  assert.deepEqual(await page.evaluate(()=>permissionCalls),['orientation','motion','orientation','motion']);
  assert.deepEqual(errors,[]);
  console.log(`${app||'iMKS'}: pan calibration, zoom, stale compass, roll, modes and permissions passed`);
  await context.close();
 }
} finally {await browser?.close();await new Promise(r=>server.close(r));}
