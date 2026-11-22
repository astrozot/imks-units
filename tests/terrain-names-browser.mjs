// Browser integration of explicit gzip assets, worker visibility, projection,
// picking keys and independent label/ground switches. No external traffic.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
let browserType;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean))
  try { browserType = (await import(name))[process.env.TERRAIN_BROWSER || 'chromium']; break; } catch {}
if (!browserType) throw new Error('Playwright required');
const root = fileURLToPath(new URL('../', import.meta.url));
const rows = [[1, 'Near summit', .018, 0, 400, 'PK', 'G'], [2, 'Hidden summit', .045, 0, null, 'MT', 'G']];
const body = JSON.stringify(rows), sha256 = createHash('sha256').update(body).digest('hex');
const manifest = { version: 2, tileDegrees: 10, tiles: { '9-18': { count: rows.length, sha256 } } };
let requests = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/data/terrain-names/')) {
    requests++;
    // Deliberately omit Content-Encoding, as on ordinary static hosting.
    res.end(url.pathname.endsWith('index.json') ? JSON.stringify(manifest) : gzipSync(body)); return;
  }
  if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><body style="margin:0;background:#15202a">'); return; }
  const name = path.resolve(root, '.' + url.pathname.replace(/\/$/, '/index.html'));
  if (!name.startsWith(root) || !fs.existsSync(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
  fs.createReadStream(name).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await browserType.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await context.route('https://**', route => route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { makeRing, meshHorizon } = await import('/js/terrainmesh.js');
    const { prepareTerrainNames } = await import('/js/terrainnames.js');
    let workers = 0;
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker { constructor(...args) { super(...args); workers++; } };
    const { skyFrame } = await import('/js/coelum.js'), { skyScene } = await import('/js/coelumsky.js');
    const sample = (lat, lon) => Math.max(0, 400 - Math.abs(lat * 111195 - 2000) * .4 - Math.abs(lon * 111195) * .1);
    const place = [0, 0, sample(0, 0)], eye = place[2] + 2;
    const mesh = makeRing({ place: [0, 0, eye], sample, extent: 10000, divisions: 128, zoom: 14, gridSize: 128 });
    const surface = { place, eye, meshes: [mesh], metrics: { nearField: 2 }, profile: meshHorizon([mesh]) };
    const started = performance.now(), names = await prepareTerrainNames(surface), ms = performance.now() - started;
    await prepareTerrainNames(surface);
    const reusedWorkers = workers;
    const first = mesh.positions[0]; mesh.positions[0] += 1;
    await prepareTerrainNames(surface);
    const changedWorkers = workers;
    mesh.positions[0] = first;
    globalThis.Worker = NativeWorker;
    const frame = skyFrame(Date.parse('2026-06-21T12:00Z') / 1000, place);
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600; document.body.append(canvas);
    const layers = { ground: true, horizon: 'terrain', terrainSurface: surface, terrain: () => 80,
      terrainFeatures: names.features, terrainAppearance: { peakNames: true, style: 'natural', shadows: false }, milkyway: false, satellites: false, labels: true };
    const view = { az: 0, alt: 10, scale: 1.5, labelHistory: new Map() }, ctx = canvas.getContext('2d');
    const shown = skyScene(frame, 900, 600, layers, view, ctx);
    const refracted = skyScene(frame, 900, 600, { ...layers, atmosphere: true }, view, ctx);
    const hidden = ['peakNames', 'ground'].map(key => {
      const opts = key === 'peakNames' ? { ...layers, terrainAppearance: { ...layers.terrainAppearance, peakNames: false } } : { ...layers, [key]: false };
      return skyScene(frame, 900, 600, opts, view, ctx).terrainFeatures.length;
    });
    // Camera movement uses existing geometry/visibility, never the provider.
    for (const az of [-10, 10, 0]) skyScene(frame, 900, 600, layers, { ...view, az }, ctx);
    window.peakTest = { surface, layers, view, frame, canvas, skyScene };
    return { names: names.features.map(f => f.name), persisted: names.persisted, total: names.total, ms, reusedWorkers, changedWorkers,
      labels: shown.hitLabels.filter(f => f.name.startsWith('terrain:')), visible: shown.terrainFeatures.length, hidden,
      position: shown.terrainFeatures.map(f => [f.x, f.y]), refracted: refracted.terrainFeatures.map(f => [f.x, f.y]), bufferLength: mesh.positions.length };
  });
  assert.deepEqual(result.names, ['Near summit']);
  assert.equal(result.total, 2);
  assert.equal(result.persisted, true);
  assert.equal(result.reusedWorkers, 1, 'The same surface reuses saved visibility without a new worker');
  assert.equal(result.changedWorkers, 2, 'Changing actual mesh content invalidates cached visibility');
  assert.equal(result.visible, 1, 'A visible surface point can be below the sky horizon');
  assert.equal(result.labels[0]?.name, 'terrain:geonames:1', 'Labels retain a pickable terrain key');
  assert.deepEqual(result.position, result.refracted, 'Astronomical refraction does not move the terrestrial anchor');
  assert.deepEqual(result.hidden, [0, 0]);
  assert.ok(result.bufferLength > 1000, 'Worker calculation does not detach the renderer buffers');
  assert.equal(requests, 2, 'Only the index and nearby tile were downloaded, with no requests during camera movement');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  const offline = await page.evaluate(async () => {
    const { prepareTerrainNames } = await import('/js/terrainnames.js');
    try { return (await prepareTerrainNames(window.peakTest.surface)).features.map(f => f.name); }
    catch (e) {
      const cache = await caches.open('imks-data-terrain-names-v2'), entries = [];
      for (const request of await cache.keys()) {
        try { entries.push([request.url, (await (await cache.match(request)).arrayBuffer()).byteLength]); }
        catch (e) { entries.push([request.url, e.message]); }
      }
      return { error: String(e), entries };
    }
  });
  assert.deepEqual(offline, ['Near summit']);
  assert.equal(requests, 2);
  await page.screenshot({ path: process.env.TERRAIN_NAMES_SCREENSHOT || '/tmp/coelum-peak-names.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', browser: browser.version(), ...result, offline: true }));
  await context.close();
} finally { await browser.close(); await new Promise(r => server.close(r)); }
