// Timezone controls, offline map selection, and embedded explorer:
// node tests/all-globes-browser.mjs. PLAYWRIGHT/CHROME as browser.mjs;
// BROWSER=webkit and BROWSER_EXECUTABLE select another engine.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let browserType;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { browserType = (await import(name))[process.env.BROWSER || 'chromium']; break; } catch { /* try next */ }
}
if (!browserType) { console.log('Skipped: Playwright is not installed'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  if(req.url==='/globe-test'){res.writeHead(200,{'content-type':'text/html'});res.end('<link rel="stylesheet" href="/styles.css"><style>body{margin:0;background:#101b30;color:#ddd;--text:#ddd;--muted:#8c9bb0}#event{padding:12px;max-width:680px;margin:auto}.map-globe-view{border-radius:10px;overflow:hidden}button{color:inherit}</style><main id="event"></main><div id="preview"></div>');return;}
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}/coelum/`;
let browser;
try {
 const executable=process.env.BROWSER_EXECUTABLE||process.env.CHROME;
 browser=await browserType.launch(executable?{executablePath:executable}:{});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 if(process.env.NO_WEBGL)await context.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'?null:get.call(this,type,...args);};});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url.replace('/coelum/','/globe-test'));
 const mount=async(kind,stamp='2026-08-12T17:45:00Z')=>{
  await page.evaluate(async({kind,stamp})=>{
   window.view?.destroy();const {mountMap,mapHTML}=await import('/js/eventview.js');const {eclipseTrack,occultationTrack}=await import('/js/astro.js');const t=Date.parse(stamp)/1000;
   const map=kind==='place'?{place:[45.46,9.19],penN:[],penS:[],center:[],band:[]}:kind==='occultation'?{...occultationTrack('saturn','moon',t),place:[48.85,2.35],occ:{target:'saturn',front:'moon',names:['Saturn','Moon'],covers:true}}:{...eclipseTrack(t),place:[45.46,9.19]};
   const prefs=new Map([['solarView','map']]);const host={store:{get:(key,value)=>prefs.get(key)??value,set:(key,value)=>prefs.set(key,value)},utc:true,toast:()=>{}};
   window.view=mountMap(document.querySelector('#event'),map,host,kind==='place'?{onSelectPlace:p=>window.chosenPlace=p}:{});
   document.querySelector('#preview').innerHTML=mapHTML(map);
  },{kind,stamp});
  await page.waitForFunction(()=>document.querySelector('.map-full')?.dataset.renderer==='webgl'||document.querySelector('.map-full .map-coast'));
 };
 let blockLeaflet;
 await page.route('https://cdnjs.cloudflare.com/**',route=>route.abort());
 await page.route('**/leaflet.min.js',route=>new Promise(resolve=>{blockLeaflet=()=>route.abort().then(resolve);}));
 const scenes=[['solar','2026-08-12T17:45:00Z'],['annular','2023-10-14T17:59:00Z'],['occultation','2025-01-04T17:00:00Z'],['place','2026-11-22T12:00:00Z']];
 for(const [kind,stamp]of scenes){
  await mount(kind,stamp);const svg=page.locator('#event .map-full'),gpu=await svg.getAttribute('data-renderer')==='webgl';
  if(process.env.NO_WEBGL)assert.equal(gpu,false);else assert.equal(gpu,true,await svg.getAttribute('data-gpu-fallback'));
  assert.ok((await page.locator('#preview .map-countries').getAttribute('d')).length>1000,'Countries in static previews');
  const inspect=async()=>{const g=await svg.evaluate(el=>({width:el.clientWidth,view:el.viewBox.baseVal.width,radius:Number(el.querySelector('.map-sea').getAttribute('r')),height:el.viewBox.baseVal.height}));assert.ok(Math.abs(g.width-g.view)<1);assert.ok(Math.abs(g.radius-(Math.min(g.view,g.height)/2-8))<.2,JSON.stringify(g));};
  await inspect();const box=await svg.boundingBox();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.55,{steps:6});await page.mouse.up();
  await svg.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true})));
  if(kind!=='place'&&kind!=='occultation'){
   await page.click('[data-map-mode="sim"]');await page.locator('.map-sim').waitFor();await page.click('[data-map-t]:text-is("max")');
   assert.match(await page.locator('.map-when').textContent(),/umbra/);
   await page.screenshot({path:`/private/tmp/globe-${kind}-${process.env.BROWSER||'chromium'}-sim.png`});
   await page.click('[data-map="play"]');const before=await page.locator('.map-slider').inputValue();await page.waitForFunction(old=>document.querySelector('.map-slider').value!==old,before);await page.click('[data-map="play"]');await page.click('[data-map-mode="map"]');
  }
  if(kind==='solar'){
   await page.selectOption('.map-select','osm');await page.waitForFunction(()=>document.querySelector('.map-globe-view').hidden);
   if(gpu)assert.equal(await page.locator('.map-webgl').isVisible(),false,'GPU layer does not cover tile maps');
   await page.waitForFunction(()=>document.querySelector('.osm-map').hidden===false);
   while(!blockLeaflet)await new Promise(r=>setTimeout(r,10));await blockLeaflet();
   await page.waitForFunction(()=>!document.querySelector('.map-globe-view').hidden);
   assert.equal(await page.locator('.map-select').inputValue(),'globe','Offline tile error returns to the globe');
  }
  if(kind==='place'){
   const b=await svg.boundingBox();await svg.click({position:{x:b.width/2,y:b.height/2}});await page.click('[data-map="choose-place"]');assert.ok(await page.evaluate(()=>Array.isArray(window.chosenPlace)));
  }
  const exportInfo=await page.evaluate(async()=>{const {snapshot}=await import('/js/snapshot.js');const share=view.share();const blob=await snapshot(share.root,share);return {size:blob.size,type:blob.type,name:share.name};});assert.ok(exportInfo.size>5000,JSON.stringify(exportInfo));assert.equal(exportInfo.type,'image/png');
  await page.screenshot({path:`/private/tmp/globe-${kind}-${process.env.BROWSER||'chromium'}-map.png`});
  for(const viewport of [{width:844,height:390},{width:390,height:844}]){await page.setViewportSize(viewport);await page.waitForTimeout(80);const g=await svg.evaluate(el=>({view:el.viewBox.baseVal.width,width:el.clientWidth}));assert.ok(Math.abs(g.view-g.width)<1);}
 }
 assert.deepEqual(errors,[]);console.log('All globe views passed: GPU paths/shadows, country boundaries, static previews, gestures, resize, place picking, and PNG export');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
