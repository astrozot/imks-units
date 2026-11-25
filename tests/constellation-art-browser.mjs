// Historical artwork rendering, registration, UI and ground occlusion.
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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
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
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const context = await browser.newContext({ viewport: { width: 1000, height: 850 }, serviceWorkers: 'block' });
  await context.route('https://celestrak.org/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForSelector('.coelum-full');
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-action="configure-layers"]').click();
  const artwork = page.locator('[data-layer="artwork"]');
  assert.equal(await artwork.isChecked(), false);
  await artwork.check();
  await page.locator('[data-artwork-opacity]').selectOption('0.5');
  await page.locator('[data-action="close-panel"]').filter({ visible: true }).first().click();
  await page.locator('[data-view="sky"]').click();
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-action="configure-layers"]').click();
  assert.equal(await artwork.isChecked(), false, 'Artwork visibility is independent per view');
  assert.equal(await page.locator('[data-artwork-opacity]').inputValue(), '0.3');
  await artwork.check();
  await page.locator('[data-artwork-opacity]').selectOption('0.75');
  await page.locator('[data-action="close-panel"]').filter({ visible: true }).first().click();
  await page.locator('[data-view="chart"]').click();
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-action="configure-layers"]').click();
  assert.equal(await artwork.isChecked(), true);
  assert.equal(await page.locator('[data-artwork-opacity]').inputValue(), '0.5');

  const result = await page.evaluate(async () => {
    const { CONSTELLATION_ART, artworkDirection, drawConstellationArt } = await import('/js/constellationart.js');
    const { CHART_STARS } = await import('/js/stardata.js');
    const { skyFrame, skyChart, horizonToJ2000, projectVector, lookAt } = await import('/js/coelum.js');
    const { skyScene } = await import('/js/coelumsky.js');
    const R = Math.PI/180, W = 900, H = 700;
    const frame = skyFrame(Date.parse('2027-01-12T22:00:00Z')/1000, [41.9,12.5,0]);
    const h = horizonToJ2000(frame);
    const horizontal = v => [0,1,2].map(i => v.reduce((s,x,j) => s+h[j*3+i]*x,0));
    const anchorErrors = [];
    for (const art of CONSTELLATION_ART) {
      const direction = artworkDirection(art);
      for (const [x,y,hip] of art.anchors) {
        const [,ra,dec] = CHART_STARS.find(s => s[0] === hip);
        const v = [Math.cos(dec*R)*Math.cos(ra*R),Math.cos(dec*R)*Math.sin(ra*R),Math.sin(dec*R)];
        anchorErrors.push(Math.hypot(...direction(x,y).map((q,i) => q-v[i])));
      }
    }
    // Point at Orion irrespective of the test machine's date or location.
    const ori = frame.apparentCatalog(83.8,-1), rotation = lookAt(ori.az,ori.alt);
    const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
    const ctx = canvas.getContext('2d');
    const project = v => { const q=projectVector(v,rotation); return {x:W/2+q.x*600,y:H/2+q.y*600,z:q.z}; };
    // Resolve lazy textures using the same redraw callback as the app.
    await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(new Error('Artwork did not load')),10000);
      const poll = () => {
        ctx.clearRect(0,0,W,H);
        if (drawConstellationArt(ctx,{W,H,radius:600,project,toHorizontal:horizontal,onRedraw:poll}) > 0) { clearTimeout(timeout); resolve(); }
      };
      poll();
    });
    const countPixels = () => { const p=ctx.getImageData(0,0,W,H).data; let n=0; for(let i=3;i<p.length;i+=4) if(p[i]) n++; return n; };
    const painted = countPixels();
    ctx.clearRect(0,0,W,H);
    drawConstellationArt(ctx,{W,H,radius:600,project,toHorizontal:horizontal,opacity:0});
    const zeroPixels = countPixels();
    const layers = {artwork:true,artworkOpacity:0.5,milkyway:false,ground:false,constellations:false,labels:false,ecliptic:false};
    skyChart(frame,W,H,layers,{rotation,scale:2},ctx);
    canvas.id='artwork-test'; document.body.replaceChildren(canvas);
    const chartImage = canvas.toDataURL();
    // SVG export must embed the same artwork, not an externally fetched image.
    const exported = skyChart(frame,W,H,layers,{rotation,scale:2}).svg;
    const hasEmbeddedImage = exported.includes('data:image/png;base64,');
    // Artwork behind a flat ground must never leak through it.
    const below = lookAt(ori.az,-60);
    const belowFrame = {...frame, place:frame.place};
    const groundLayers = {...layers,ground:true};
    skyChart(belowFrame,W,H,groundLayers,{rotation:below,scale:2},ctx);
    const withArt = ctx.getImageData(0,0,W,H).data.slice();
    skyChart(belowFrame,W,H,{...groundLayers,artwork:false},{rotation:below,scale:2},ctx);
    const withoutArt = ctx.getImageData(0,0,W,H).data;
    let groundLeaks=0;
    // The exact central ray is below the horizon; inspect a central patch.
    {
      for(let y=H/2-10;y<H/2+10;y++) for(let x=W/2-10;x<W/2+10;x++) {
        const i=4*(y*W+x); if(withArt[i]!==withoutArt[i] || withArt[i+1]!==withoutArt[i+1]) groundLeaks++;
      }
    }
    const sceneLayers = {...layers,atmosphere:false,satellites:false};
    skyScene(frame,W,H,sceneLayers,{rotation,scale:2},ctx);
    const withSky = ctx.getImageData(0,0,W,H).data.slice();
    skyScene(frame,W,H,{...sceneLayers,artwork:false},{rotation,scale:2},ctx);
    const withoutSky=ctx.getImageData(0,0,W,H).data;
    let skyDifference=0; for(let i=0;i<withSky.length;i+=4) if(withSky[i]!==withoutSky[i]) skyDifference++;
    // Restore the chart for visual QA.
    const image=new Image(); image.src=chartImage; await image.decode(); ctx.drawImage(image,0,0);
    return {anchorErrors,painted,zeroPixels,hasEmbeddedImage,groundLeaks,skyDifference};
  });
  assert.ok(result.anchorErrors.every(e => e<1e-12), 'All measured stars register exactly on the sphere');
  assert.ok(result.painted>1000, 'Historical ink is visible');
  assert.equal(result.zeroPixels,0);
  assert.equal(result.hasEmbeddedImage,true);
  assert.equal(result.groundLeaks,0);
  assert.ok(result.skyDifference>1000, 'Artwork renders in the realistic sky too');
  await page.locator('#artwork-test').screenshot({path:'/tmp/coelum-historical-chart.png'});
  await page.evaluate(async () => {
    const { skyFrame, skyChart, lookAt } = await import('/js/coelum.js');
    const frame = skyFrame(Date.parse('2027-01-12T22:00:00Z')/1000,[41.9,12.5,0]);
    const center = frame.apparentCatalog(164,17);
    const canvas = document.querySelector('#artwork-test');
    skyChart(frame,900,700,{artwork:true,artworkOpacity:0.5,ground:false,milkyway:false,constellations:false,labels:false,ecliptic:false},
      {rotation:lookAt(center.az,center.alt),scale:3},canvas.getContext('2d'));
  });
  await page.locator('#artwork-test').screenshot({path:'/tmp/coelum-historical-leo.png'});
  assert.deepEqual(errors,[]);
  console.log('Historical constellation artwork:',result);
} finally {
  await browser?.close(); await new Promise(r => server.close(r));
}
