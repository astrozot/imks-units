// Lunar silhouette masks, GPU alignment and cache lifecycle; PLAYWRIGHT/CHROME as in browser.mjs.
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
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, serviceWorkers: 'block' });
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const result = await page.evaluate(async () => {
    const { planetMap, tracePlanet, lunarLimb } = await import('/js/skyview.js');
    const { moonDisk } = await import('/js/astro.js');
    const { skyFrame, lookAt, projectVector, pointVector } = await import('/js/coelum.js');
    const { skyScene, skyRadius } = await import('/js/coelumsky.js');
    const { limbRadius, buildLunarLimb } = await import('/js/lunarlimb.js');
    const map = planetMap('moon'); await map.ready;
    if (!map.heights) throw Error('Elevation map unavailable');
    const t = Date.parse('2026-08-12T18:30:00Z') / 1000, place = [40.4, -3.7, 600];
    const frame = skyFrame(t, place), moon = frame.bodies.find(o => o.body === 'moon');
    const disk = { ...moonDisk(t, moon), sun: [0,0,1], earthshine: 0 };
    const start = performance.now(), actual = lunarLimb(disk), ms = performance.now() - start;
    if (lunarLimb(disk) !== actual) throw Error('Repeated view must reuse profile');
    const changed = lunarLimb({ ...disk, facing: { lon: disk.facing.lon + .5 } });
    if (changed === actual) throw Error('Libration must invalidate silhouette');
    // Compare the new GPU pass with the independent CPU line-of-sight model.
    const dem=document.createElement('canvas');dem.width=map.heights.width;dem.height=map.heights.height;
    const dg=dem.getContext('2d',{willReadFrequently:true});dg.drawImage(map.heights,0,0);
    const rgba=dg.getImageData(0,0,dem.width,dem.height).data, heights=new Uint16Array(dem.width*dem.height);
    for(let i=0;i<heights.length;i++)heights[i]=Math.round(2000+40000*rgba[4*i]/255);
    const reference=buildLunarLimb(disk,{width:dem.width,height:dem.height,data:heights});
    let modelError=0;for(let i=0;i<actual.length;i++)modelError=Math.max(modelError,Math.abs(actual[i]-reference[i]));
    if(modelError>2e-6)throw Error(`GPU and CPU terrain disagree: ${modelError}`);
    let min = Infinity, max = 0; for (const r of actual) { min = Math.min(min,r); max = Math.max(max,r); }
    if (!(min < max && min > .99 && max < 1.01)) throw Error('Implausible real lunar limb');
    const canvas = document.createElement('canvas'), n = 128, scale = 12000;
    document.body.replaceChildren(); document.body.style.cssText = 'background:#222;color:white;display:flex;flex-wrap:wrap';
    // Non-circular real terrain must align in every quadrant, including
    // the angular seam, for both opaque mountains and transparent valleys.
    let compared = 0;
    for (const a of [0, Math.PI/2, Math.PI, 3*Math.PI/2, 2*Math.PI-.001]) {
      const r = limbRadius(actual,a), x0=r*Math.cos(a)-n/(2*scale), y0=r*Math.sin(a)+n/(2*scale);
      tracePlanet(canvas,disk,x0,y0,n,n,scale);
      const gl=canvas.getContext('webgl'),px=new Uint8Array(n*n*4);gl.readPixels(0,0,n,n,gl.RGBA,gl.UNSIGNED_BYTE,px);
      for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
        const xx=x0+(x+.5)/scale,yy=y0-(n-y-.5)/scale;
        const delta=Math.hypot(xx,yy)-limbRadius(actual,Math.atan2(yy,xx));
        if(Math.abs(delta)<3/scale)continue;
        const alpha=px[4*(y*n+x)+3];
        if(delta>0?alpha!==0:alpha!==255)throw Error(`Real terrain alpha mismatch at ${a}: ${delta}, ${alpha}`);
        compared++;
      }
    }
    const results = [];
    const original = map.heights;
    // A physical-height synthetic Moon makes sub-pixel edge errors measurable.
    for (const height of [-8, 8]) {
      const source = document.createElement('canvas'); source.width = 1024; source.height = 512;
      const g = source.getContext('2d'), value = (height + 10) * 2000;
      g.fillStyle = `rgb(${value >> 8},${value & 255},0)`; g.fillRect(0,0,1024,512);
      map.heights = await createImageBitmap(source, { colorSpaceConversion: 'none' }); map.highResolution = true;
      const profile = lunarLimb(disk), edge = limbRadius(profile, 0), x0 = edge - n / (2 * scale);
      const angle = disk.radius * Math.PI / 180, expected = Math.asin((1 + height / 1737.4) * Math.sin(angle)) / angle;
      if (Math.abs(edge - expected) > 2e-7) throw Error(`Physical elevations must not be exaggerated: height=${height}, edge=${edge}, expected=${expected}`);
      if (!tracePlanet(canvas, disk, x0, n/(2*scale), n,n,scale)) throw Error('WebGL unavailable');
      const gl = canvas.getContext('webgl'), px = new Uint8Array(n*n*4); gl.readPixels(0,0,n,n,gl.RGBA,gl.UNSIGNED_BYTE,px);
      if (gl.getError() !== gl.NO_ERROR) throw Error('GL error');
      let last = -1; for (let x=0;x<n;x++) if (px[4*((n/2)*n+x)+3]>127) last=x;
      if (Math.abs(last - (n/2-1))>1) throw Error(`GPU and Canvas outline disagree: ${height}, edge pixel ${last}`);
      const copy = document.createElement('canvas'); copy.width=copy.height=n; copy.getContext('2d').drawImage(canvas,0,0);
      const card=document.createElement('div');card.append(`${height} km terrain limb`,copy);document.body.append(card);
      results.push({height,last});
      map.heights.close();
    }
    // End-to-end foreground clipping: equal mean Sun/Moon disks are labelled
    // total, but a low terrain limb must still let the photosphere through.
    const source = document.createElement('canvas'); source.width=1024;source.height=512;
    source.getContext('2d').fillStyle='rgb(15,160,0)'; // -8 km
    source.getContext('2d').fillRect(0,0,1024,512);
    map.heights=await createImageBitmap(source,{colorSpaceConversion:'none'});
    const sun = frame.bodies.find(o=>o.body==='sun');
    Object.assign(moon, { ra:sun.ra,dec:sun.dec,az:sun.az,alt:sun.alt,dist:sun.dist*1737.4/695700, phase:180 });
    const W=400,H=300, angular=Math.asin(695700/sun.dist), targetRadius=10000;
    const view={az:sun.az,alt:sun.alt+angular*180/Math.PI,scale:targetRadius/(angular*skyRadius(W,H,1)/2)};
    const c=document.createElement('canvas');c.width=W;c.height=H;
    const ctx=c.getContext('2d');
    const scene=skyScene(frame,W,H,{atmosphere:false,ground:false,milkyway:false,labels:false,constellations:false},view,ctx);
    const pixel=ctx.getImageData(0,0,W,H).data;
    let bright=0;for(let i=0;i<pixel.length;i+=4)if(pixel[i]>220&&pixel[i+1]>210)bright++;
    if (bright<1000) throw Error(`A nominally total eclipse must reveal terrain valleys: ${bright}`);
    document.body.append(c);
    const solar = scene.objects.find(o=>o.body==='sun');
    const at = (x,y) => 4*(Math.round(y)*W+Math.round(x));
    const strip = at(solar.x, solar.y-solar.radius+20);
    if(pixel[strip]<240 || pixel[strip+1]<230)throw Error('Photosphere must remain visible below the mean circular limb');
    // A point star inside the mean Moon, but outside the terrain, remains
    // visible; one deeper inside the real silhouette disappears.
    sun.hidden=true;
    const star = { name:'Limb test star', az:sun.az, alt:view.alt-20*angular/targetRadius*180/Math.PI, mag:-1, bv:0 };
    frame.stars=[star];
    const options={atmosphere:false,ground:false,milkyway:false,labels:false,constellations:false};
    const visible=skyScene(frame,W,H,options,view,ctx);
    if(!visible.objects.some(o=>o.name===star.name))throw Error('Star in a lunar valley must be visible');
    star.alt=view.alt-80*angular/targetRadius*180/Math.PI;
    const hidden=skyScene(frame,W,H,options,view,ctx);
    if(hidden.objects.some(o=>o.name===star.name))throw Error('Star behind lunar terrain must be occulted');
    map.heights.close();map.heights=original;map.highResolution=false;
    return { samples:actual.length, min,max,buildMs:ms,modelError,compared,edges:results,solarValleyPixels:bright,occultation:true };
  });
  await page.clock.install();
  await page.evaluate(async () => {
    const { planetMap, downloadMoonDetail, tracePlanet }=await import('/js/skyview.js');
    const { moonDisk, equatorial }=await import('/js/astro.js');
    await downloadMoonDetail();
    window.limbEntry=planetMap('moon'); window.limbCanvas=document.createElement('canvas');
    const t=Date.parse('2026-11-17T21:00:00Z')/1000;
    window.limbDisk=moonDisk(t,equatorial('moon',t));
    const now=performance.now();
    tracePlanet(window.limbCanvas,window.limbDisk,.98,.01,128,128,8000);
    window.limbHighBuildMs=performance.now()-now;
    const gl=window.limbCanvas.getContext('webgl');gl.activeTexture(gl.TEXTURE5);
    window.limbOldTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);
  });
  await page.clock.runFor(30050);
  const released=await page.evaluate(async()=>{
    const { moonDetailStored }=await import('/js/skyview.js');
    const gl=window.limbCanvas.getContext('webgl');
    return { suspended:window.limbEntry.detailSuspended,base:window.limbEntry.heights.width===1440,gpuReleased:!gl.isTexture(window.limbOldTexture),stored:await moonDetailStored() };
  });
  assert.deepEqual(released,{suspended:true,base:true,gpuReleased:true,stored:true});
  await page.route('**/img/planets/moon-8k.jpg',route=>route.abort());
  await page.route('**/img/planets/moon-heights-16.png',route=>route.abort());
  const restored=await page.evaluate(async()=>{
    const { planetMap,tracePlanet }=await import('/js/skyview.js');
    const map=planetMap('moon');await map.ready;
    tracePlanet(window.limbCanvas,window.limbDisk,.98,.01,128,128,8000);
    const gl=window.limbCanvas.getContext('webgl');
    if(gl.getError()!==gl.NO_ERROR)throw Error('GPU restore failed');
    return { high:map.highResolution,width:map.heights.width,firstHighMs:window.limbHighBuildMs };
  });
  assert.equal(restored.high,true);assert.equal(restored.width,5760);
  assert.deepEqual(errors, []);
  console.log('Lunar silhouette browser checks passed:', JSON.stringify({result,released,restored}));
  if (process.env.LUNAR_LIMB_SCREENSHOT) await page.screenshot({ path: process.env.LUNAR_LIMB_SCREENSHOT, fullPage: true });
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
