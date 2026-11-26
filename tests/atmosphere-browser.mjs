// Atmospheric rendering and controls. Same PLAYWRIGHT/CHROME as browser.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* try next */ }
}
if (!chromium) { console.log('Skipped: Playwright is not installed'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}/coelum/`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME });
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: 'block' });
  await context.route('https://**', route => route.abort());
  await context.addInitScript(() => localStorage.setItem('imks-coelum-mode','sky'));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForSelector('.coelum-full');
  const rendered = await page.evaluate(async () => {
    const { skyRaster, rasterOptions } = await import('/js/skyraster.js');
    const { lookAt } = await import('/js/coelum.js');
    const { createTerrainRenderer } = await import('/js/terrainrender.js');
    const { makeRing } = await import('/js/terrainmesh.js');
    const { skyColours } = await import('/js/skyraster.js');
    const W=500,H=320, radius=850, key={};
    const moonVector=[0,Math.cos(Math.PI/6),0.5];
    const opts={ W,H,radius,camera:{rotation:lookAt(0,30),stereographic:true},toJ2000:[1,0,0,0,1,0,0,0,1],kind:'sky',milkyWay:false,ground:false,atmosphere:true,sun:{alt:-25,vector:[0,0,-1]},moon:{alt:30,illum:1,vector:moonVector}};
    const pixel=(humidity, gl, illum=1, atmosphere=true) => {
      rasterOptions.gl=gl;
      const bg=skyRaster(key,{...opts,atmosphere,moon:{...opts.moon,illum},atmosphereSettings:{humidity}});
      if(gl&&rasterOptions.lastBackend!=='gpu')throw Error('GPU scattering shader fell back to CPU');
      const canvas=document.createElement('canvas'); canvas.width=W;canvas.height=H;
      const ctx=canvas.getContext('2d');ctx.drawImage(bg.sky,0,0,bg.w,bg.h,0,0,bg.width,bg.height);
      // Several degrees outside the disk: diffuse halo, not the disk sprite.
      return Array.from(ctx.getImageData(350,160,1,1).data).slice(0,3);
    };
    const halos=[false,true].map(gl=>({gl,dry:pixel(10,gl),wet:pixel(90,gl),crescent:pixel(90,gl,0.1),offDry:pixel(10,gl,1,false),offWet:pixel(90,gl,1,false)}));
    const canvas=document.createElement('canvas'),renderer=createTerrainRenderer(canvas);
    renderer.setMeshes([makeRing({place:[0,0,0],sample:(lat,lon)=>1500*Math.exp(-(((lat-.18)/.04)**2+(lon/.08)**2)),extent:50000,divisions:128,gridSize:128})]);
    const terrain=[];
    for(const sunAlt of [-1,1,25]) {
      const images=[];
      for(const humidity of [10,90]) {
        const atmosphereSettings={humidity};
        renderer.draw({W,H,radius,rotation:lookAt(0,3),sun:{az:180,alt:sunAlt},moon:{az:0,alt:-90},flux:0,shadows:false,eyeElevation:0,atmosphereSettings,sky:skyColours({sun:{alt:sunAlt},atmosphere:true,atmosphereSettings})});
        const gl=canvas.getContext('webgl2'),bytes=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
        if(gl.getError())throw Error('Terrain GL error');images.push(bytes);
      }
      let changed=0,opaque=0;
      for(let i=0;i<images[0].length;i+=4)if(images[0][i+3]===255){opaque++;if(Math.abs(images[0][i]-images[1][i])+Math.abs(images[0][i+1]-images[1][i+1])+Math.abs(images[0][i+2]-images[1][i+2])>5)changed++;}
      terrain.push({sunAlt,changed,opaque});
    }
    renderer.destroy();rasterOptions.gl=true;
    return {halos,terrain};
  });
  for(const h of rendered.halos) {
    assert.ok(h.wet[0] > h.dry[0]+5, JSON.stringify(h));
    assert.ok(h.wet[0] > h.crescent[0]+5, JSON.stringify(h));
    assert.deepEqual(h.offDry,h.offWet);
  }
  // Below-horizon Sun leaves many facets physically dark; humidity need not
  // change those black pixels. The illuminated/hazy portion must respond.
  for(const t of rendered.terrain)assert.ok(t.opaque>100 && t.changed>t.opaque*(t.sunAlt<0?0.1:0.5),JSON.stringify(t));
  await page.evaluate(()=>document.querySelector('[data-action="configure-layers"]').click());
  await page.evaluate(()=>document.querySelector('[data-settings-section="atmosphere"]').open=true);
  await page.evaluate(()=>document.querySelector('[data-layer="atmosphere"]').checked=true);
  const humidity=page.locator('[data-atmosphere-setting="humidity"]');
  await humidity.evaluate(el=>{el.value='90';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.locator('[data-atmosphere-output="humidity"]').textContent(),'90%');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('imks-coelum-atmosphere')).humidity),90);
  await page.reload();await page.waitForSelector('.coelum-full');assert.equal(await humidity.inputValue(),'90');
  await page.evaluate(()=>document.querySelector('[data-action="configure-layers"]').click());
  await page.evaluate(()=>document.querySelector('[data-action="reset-configuration"]').click());
  assert.equal(await humidity.inputValue(),'40');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.querySelector('[data-settings-section="atmosphere"]').open=true);
  for (const field of ['pressure','temperature','humidity','aerosol','lightPollution']) {
    const box=await page.locator(`[data-atmosphere-setting="${field}"]`).boundingBox();
    assert.ok(box && box.x>=0 && box.x+box.width<=390,field);
  }
  if(process.env.ATMOSPHERE_SCREENSHOT)await page.screenshot({path:process.env.ATMOSPHERE_SCREENSHOT});
  assert.deepEqual(errors,[]);
  console.log('Atmosphere CPU/GPU lunar halos, phase response, terrain at dawn/dusk/day, controls, persistence and reset passed',JSON.stringify(rendered));
} finally { await browser?.close(); await new Promise(r=>server.close(r)); }
