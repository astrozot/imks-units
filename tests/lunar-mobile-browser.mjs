// Phone Moon memory budgets, old-download migration and cleanup; PLAYWRIGHT/CHROME as in browser.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { const engine = await import(name); chromium = process.env.BROWSER_ENGINE === 'webkit' ? engine.webkit : engine.chromium; break; } catch { /* try next */ }
}
if (!chromium) { console.log('Skipped: Playwright is not installed'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser, context, profileDir;
try {
  const executablePath = process.env.BROWSER_ENGINE === 'webkit' ? process.env.WEBKIT : process.env.CHROME;
  const launch = executablePath ? { executablePath } : {};
  const options = {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  };
  if (process.env.BROWSER_ENGINE === 'webkit') {
    // Use an isolated persistent profile to test ordinary offline storage,
    // rather than WebKit's ephemeral private-browsing storage.
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imks-moon-webkit-'));
    context = await chromium.launchPersistentContext(profileDir, { ...launch, ...options });
  } else {
    browser = await chromium.launch(launch); context = await browser.newContext(options);
  }
  const page = await context.newPage(), errors = [], largeRequests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/NORAD/elements/gp.php*', (route) => route.fulfill({ status: 200, body: '[]', headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } }));
  await page.route(/moon-(8k\.jpg|heights-16\.png)/, (route) => { largeRequests.push(route.request().url()); return route.abort(); });
  let compactOffline = false;
  await page.route(/moon-(4k\.jpg|heights-mobile-16\.png)/, (route) => compactOffline ? route.abort() : route.continue());
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  // Seed the old filenames with deliberately undecodable bodies. Migration
  // must fetch pre-sized assets, never decode or resize the old 8K images.
  await page.evaluate(async () => {
    const cache = await caches.open('imks-data-moon-detail-v1');
    for (const file of ['moon-8k.jpg', 'moon-heights-16.png']) await cache.put(new URL(`/img/planets/${file}`, location.href), new Response('old desktop image'));
  });
  const result = await page.evaluate(async () => {
    const { planetMap, moonDetailProfile, planetPixelRatio, drawPlanet, tracePlanet, downloadMoonDetail } = await import('/js/skyview.js');
    const { moonDisk } = await import('/js/astro.js');
    const { skyFrame } = await import('/js/coelum.js');
    const map = planetMap('moon'); await map.ready;
    if (!map.highResolution || map.img.width !== 4096 || map.heights.width !== 2880) throw Error('Phone must load only pre-sized maps');
    const cache = await caches.open('imks-data-moon-detail-v1');
    if (await cache.match('/img/planets/moon-8k.jpg') || await cache.match('/img/planets/moon-heights-16.png')) throw Error('Migration must discard old files after the compact pair is stored');
    const decodedBytes = 4 * (map.img.width * map.img.height + map.heights.width * map.heights.height);
    const t = Date.parse('2026-11-17T21:00:00Z') / 1000;
    const moon = skyFrame(t, [45.46, 9.19, 120]).bodies.find((o) => o.body === 'moon');
    const disk = { ...moonDisk(t, moon), sun: [1, 0, 0] };
    const canvas = document.createElement('canvas');
    tracePlanet(canvas, disk, .02, .05, 256, 256, 6000);
    const gl = canvas.getContext('webgl'), live = new Map(), bound = new Map();
    let unit = gl.TEXTURE0;
    const bind = gl.bindTexture.bind(gl), active = gl.activeTexture.bind(gl), upload = gl.texImage2D.bind(gl), remove = gl.deleteTexture.bind(gl);
    gl.activeTexture = (next) => { unit = next; return active(next); };
    gl.bindTexture = (target, texture) => { bound.set(unit, texture); return bind(target, texture); };
    gl.texImage2D = (...args) => {
      const [w, h] = args.length === 6 ? [args[5].width, args[5].height] : [args[3], args[4]];
      live.set(bound.get(unit), { w, h });
      if (w > 4096 || h > 2048) throw Error('Phone uploaded an oversized texture');
      return upload(...args);
    };
    gl.deleteTexture = (texture) => { live.delete(texture); return remove(texture); };
    // Go through all useful levels repeatedly. The old implementation kept
    // every texture; returning to the same zoom must now have bounded storage.
    for (let round = 0; round < 3; round++) for (const scale of [10, 30, 100, 300, 1000, 6000]) {
      tracePlanet(canvas, disk, .02, .05, 256, 256, scale);
      if (live.size > 3) throw Error(`Moon levels accumulated: ${live.size}`);
    }
    for (const [w, h] of [[390, 844], [844, 390], [1300, 1300]]) {
      if (!drawPlanet(canvas, disk, w, h, 0, 0, 6000, 3)) throw Error('Phone renderer failed');
      if (canvas.width * canvas.height > 1010000 || Math.max(canvas.width, canvas.height) > 2048) throw Error('Retina drawing buffer exceeded its budget');
    }
    if (gl.getError() !== gl.NO_ERROR) throw Error('Phone rendering produced a WebGL error');
    // A failure in the second decode must close the first new bitmap and
    // preserve the current pair, rather than leak another colour image.
    const bitmap = window.createImageBitmap, previous = map.img;
    let decoded = 0, closed = 0;
    window.createImageBitmap = async (...args) => {
      if (++decoded === 2) throw Error('simulated elevation decode failure');
      const img = await bitmap(...args), close = img.close.bind(img);
      img.close = () => { closed++; close(); };
      return img;
    };
    let failed = false;
    try { await downloadMoonDetail(); } catch { failed = true; }
    finally { window.createImageBitmap = bitmap; }
    if (!failed || closed !== 1 || map.img !== previous) throw Error('Partial decode was not cleaned up safely');
    return { decodedBytes, profile: moonDetailProfile, liveTextures: live.size, ratio: planetPixelRatio(390, 844, 3), savedFiles: (await cache.keys()).map((r) => new URL(r.url).pathname).sort() };
  });
  assert.equal(result.decodedBytes, 50143232);
  assert.equal(result.savedFiles.length, 2, `Compact files must still be saved: ${JSON.stringify(result)}`);
  assert.deepEqual(largeRequests, []);
  assert.deepEqual(errors, []);
  // Restore the compact pair offline in a fresh module/renderer.
  compactOffline = true;
  await page.reload();
  const restored = await page.evaluate(async () => {
    const { planetMap } = await import('/js/skyview.js');
    const map = planetMap('moon'); await map.ready;
    return { high: Boolean(map.highResolution), color: map.img?.width, heights: map.heights?.width, files: (await (await caches.open('imks-data-moon-detail-v1')).keys()).map((r) => new URL(r.url).pathname).sort() };
  });
  assert.deepEqual(restored, { high: true, color: 4096, heights: 2880, files: ['/img/planets/moon-4k.jpg', '/img/planets/moon-heights-mobile-16.png'] });
  // An old pack opened offline must use the standard maps safely, rather
  // than decode the oversized images as a fallback.
  await page.evaluate(async () => {
    const cache = await caches.open('imks-data-moon-detail-v1');
    for (const file of ['moon-4k.jpg', 'moon-heights-mobile-16.png']) await cache.delete(`/img/planets/${file}`);
    for (const file of ['moon-8k.jpg', 'moon-heights-16.png']) await cache.put(`/img/planets/${file}`, new Response('old desktop image'));
  });
  await page.reload();
  const offlineFallback = await page.evaluate(async () => {
    const { planetMap } = await import('/js/skyview.js');
    const map = planetMap('moon'); await map.ready;
    return { high: Boolean(map.highResolution), color: map.img?.width, heights: map.heights?.width };
  });
  assert.deepEqual(offlineFallback, { high: false, color: 2048, heights: 1440 });
  assert.deepEqual(largeRequests, []);
  assert.deepEqual(errors, []);
  console.log('Phone Moon memory checks passed:', JSON.stringify({ ...result, restored, offlineFallback, largeRequests }));

} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
  await new Promise((r) => server.close(r));
}
