// Shared-app terrain: worker downloads, cancellation, offline reuse, settings,
// and the June 21 twilight regression. Synthetic DEMs avoid provider traffic.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)){try{({[process.env.TERRAIN_BROWSER || 'chromium']:chromium}=await import(name));break;}catch{}}
if(!chromium)throw new Error('Playwright required for terrain browser checks');
const root=fileURLToPath(new URL('../',import.meta.url)),server=http.createServer((req,res)=>{
 const name=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!name.startsWith(root)||!fs.existsSync(name)){res.writeHead(404);res.end();return;}
 const ext=path.extname(name),type={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp'}[ext];
 res.writeHead(200,{'content-type':type||'application/octet-stream'});fs.createReadStream(name).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://localhost:${server.address().port}`,browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:process.env.TERRAIN_BROWSER!=='webkit'});
 await context.clock.setFixedTime(new Date('2026-06-21T12:00Z'));
 await context.route('https://celestrak.org/**',r=>r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'[]'}));
 await context.addInitScript(()=>{if(!localStorage.getItem('terrain-test-initialised')){localStorage.setItem('terrain-test-initialised','yes');localStorage.setItem('imks.coelumPlace',JSON.stringify({lat:45.89617,lon:10.84333,h:90,name:'Riva'}));localStorage.setItem('imks-coelum-mode','sky');localStorage.setItem('imks.settings',JSON.stringify({location:{lat:45.89617,lon:10.84333,h:90,name:'Riva'}}));}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/coelum/');await page.waitForSelector('.coelum-full');
 const tile=async height=>Buffer.from((await page.evaluate(h=>{const c=document.createElement('canvas');c.width=c.height=512;const v=h+32768,g=c.getContext('2d');g.fillStyle=`rgb(${Math.floor(v/256)},${v%256},0)`;g.fillRect(0,0,512,512);return c.toDataURL('image/png');},height)).split(',')[1],'base64');
 const low=await tile(0),high=await tile(2000);let requests=0;
 const respond=r=>{requests++;return r.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:/mapterhorn\.com\/10\//.test(r.request().url())?high:low});};
 await page.route('https://tiles.mapterhorn.com/**',respond);
 // Land cover: synthetic grassland tiles, never the real service.
 const grass=Buffer.from((await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');g.fillStyle='rgb(30,30,30)';g.fillRect(0,0,256,256);return c.toDataURL('image/png');})).split(',')[1],'base64');
 let coverRequests=0;await context.route('https://planetarycomputer.microsoft.com/**',r=>{coverRequests++;return r.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:grass});});
 await page.click('[data-action="layers"]');await page.selectOption('[data-horizon]','terrain');
 await page.waitForFunction(()=>document.querySelector('.coelum-canvas').dataset.terrainSurface==='true',null,{timeout:120000});
 assert.match(await page.locator('.coelum-terrain-note').textContent(),/Saved for offline/);assert.ok(requests>100&&requests<700);
 const downloaded=requests;
 const stored=await page.evaluate(async()=>{const{restoreTerrain}=await import('/js/skyterrain.js');const s=await restoreTerrain([45.89617,10.84333,90]);return {profile:s.profile.length,eye:s.eye,cover:s.meshes.every(m=>m.cover?.classes.every(c=>c===3)),landCover:s.metrics.landCover};});assert.equal(stored.profile,3600);
 assert.ok(coverRequests>20&&stored.cover,`Land cover stored with the terrain: ${JSON.stringify(stored.landCover)}`);
 assert.equal(stored.eye,92,'The eye is 2 m above the place’s ground elevation');
 await page.click('[data-action="terrain"]');assert.equal(await page.locator('[data-terrain-setting="style"]').inputValue(),'natural');assert.equal(await page.locator('[data-terrain-setting="outlines"]').isChecked(),false);assert.equal(await page.locator('[data-terrain-setting="shadows"]').isChecked(),true);assert.equal(await page.locator('[data-terrain-setting="nightExposure"]').inputValue(),'0');
 await page.uncheck('[data-terrain-setting="shadows"]');await page.check('[data-terrain-setting="shadows"]');await page.locator('.coelum-terrain-panel [data-action="close-panel"]').click();assert.equal(requests,downloaded);
 assert.equal(await page.evaluate(async()=>{const{restoreTerrain}=await import('/js/skyterrain.js');return await restoreTerrain([45.89617,10.84333,92]);}),null,'Eye height changes must not reuse the surface');
 // A cancelled refresh keeps the existing surface and cannot apply stale results.
 await page.unroute('https://tiles.mapterhorn.com/**',respond);const held=[];await page.route('https://tiles.mapterhorn.com/**',r=>held.push(r));
 await page.click('[data-action="layers"]');await page.click('[data-terrain="refresh"]');await page.click('[data-terrain="cancel"]');for(const r of held)await r.abort().catch(()=>{});
 assert.equal(await page.locator('[data-horizon]').inputValue(),'terrain');assert.match(await page.locator('.coelum-terrain-note').textContent(),/Saved for offline/);
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>navigator.serviceWorker.controller);await page.reload();await page.waitForFunction(()=>document.querySelector('.coelum-canvas')?.dataset.terrainSurface==='true');await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('.coelum-canvas')?.dataset.terrainSurface==='true',null,{timeout:30000});assert.equal(requests,downloaded,'Offline reload uses stored geometry');
 await context.setOffline(false);await page.goto(origin+'/');await page.waitForSelector('#expr');await page.waitForFunction(()=>document.querySelectorAll('.key').length>0);await page.keyboard.type('coelum(now)');await page.keyboard.press('Enter');await page.waitForSelector('.coelum-preview');await page.click('.coelum-preview');
 await page.waitForFunction(()=>document.querySelector('.coelum-explorer .coelum-canvas')?.dataset.terrainSurface==='true',null,{timeout:30000});assert.equal(requests,downloaded,'iMKS shares Coelum terrain storage');
 // Render a known slope directly: the regression made twilight terrain white.
 const lighting=await page.evaluate(async()=>{
  const{createTerrainRenderer}=await import('/js/terrainrender.js'),{makeRing,moonFlux}=await import('/js/terrainmesh.js'),{horizontal,aspect}=await import('/js/astro.js'),{lookAt}=await import('/js/coelum.js');
  const c=document.createElement('canvas'),renderer=createTerrainRenderer(c);
  renderer.setMeshes([makeRing({place:[45.89617,10.84333,90],sample:(lat,lon)=>600+Math.sin(lon*1000)*150,extent:4000,divisions:64,zoom:14,gridSize:256})]);
  const readings=[];
  for(const time of ['2026-06-21T12:00Z','2026-06-21T20:00Z','2026-06-21T20:35Z','2026-06-21T21:00Z']){
   const t=Date.parse(time)/1000,place=[45.89617,10.84333,90],sun=horizontal('sun',t,place),moon={...horizontal('moon',t,place),phase:aspect('moon',t).phase};
   renderer.draw({W:700,H:400,radius:550,rotation:lookAt(204,15),sun,moon,flux:moonFlux(moon.phase,moon.dist),shadows:true,paper:false,outlines:false,exposure:4});
   const g=c.getContext('webgl2'),p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);let total=0,count=0,white=0;
   for(let i=0;i<p.length;i+=4)if(p[i+3]){total+=p[i]+p[i+1]+p[i+2];count++;if(p[i]>230&&p[i+1]>230&&p[i+2]>230)white++;}
   readings.push({time,mean:total/count/3,white,count,error:g.getError()});
  }renderer.destroy();return readings;
 });
 for(const value of lighting){assert.ok(value.count>1000);assert.equal(value.error,0);if(value.time.includes('20:')||value.time.includes('21:')){assert.equal(value.white,0);assert.ok(value.mean<45,JSON.stringify(value));}}
 // Playback draws once per display frame, also while shadows update over
 // several frames (their redraw request once doubled every frame).
 await page.goto(origin+'/coelum/');await page.waitForFunction(()=>document.querySelector('.coelum-canvas')?.dataset.terrainSurface==='true',null,{timeout:30000});
 const perFrame=await page.evaluate(async()=>{const c=document.querySelector('.coelum-canvas'),steps=[];let prev=+c.dataset.frame;
  document.querySelector('[data-action="play"]').click();
  await new Promise(res=>{let n=0;const f=()=>{const v=+c.dataset.frame;steps.push(v-prev);prev=v;if(++n<120)requestAnimationFrame(f);else res();};requestAnimationFrame(f);});
  document.querySelector('[data-action="play"]').click();return steps;});
 assert.ok(perFrame.filter(d=>d>1).length<=2,`Doubled frames during playback: ${perFrame.filter(d=>d>1).length}/120`);
 // The Place panel shows the ground elevation and accepts a new one.
 await page.goto(origin+'/coelum/');await page.waitForSelector('.coelum-full');
 await page.click('[data-action="place"]');
 assert.equal(await page.locator('[data-place-elevation]').inputValue(),'90');
 await page.fill('[data-place-elevation]','123.5');await page.press('[data-place-elevation]','Enter');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('imks.coelumPlace')).h===123.5);
 assert.ok(await page.locator('[data-place-elevation]').isVisible(),'The panel stays open after an elevation change');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',tiles:downloaded,offline:true,sharedWithIMKS:true,lighting}));
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
