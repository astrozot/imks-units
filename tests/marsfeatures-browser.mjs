// High-magnification rendering regressions; PLAYWRIGHT/CHROME as in browser.mjs.
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
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.route('https://celestrak.org/**', (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const summary = await page.evaluate(async () => {
    const { skyFrame, lookAt } = await import('/js/coelum.js');
    const { skyScene, skyRadius } = await import('/js/coelumsky.js');
    const { planetMap } = await import('/js/skyview.js');
    const { marsDisk, pickMarsFeature } = await import('/js/marsfeatures.js');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    await planetMap('mars').ready;
    const t = Date.parse('2026-11-25T07:00:00Z') / 1000, place = [41.892, 12.511, 20];
    const frame = skyFrame(t, place), mars = frame.bodies.find((o) => o.body === 'mars');
    const W = 900, H = 900, canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d'), layers = { ground: false, atmosphere: false, labels: true, milkyway: false };
    const scale = 310 / (marsDisk(t).radius * Math.PI / 180 * skyRadius(W, H, 1) / 2);
    const view = { rotation: lookAt(mars.az, mars.alt), scale };
    check(!skyScene(frame, W, H, layers, { ...view, scale: 20 }, ctx).marsFeatures.length, 'Low zoom hides features');
    const scene = skyScene(frame, W, H, layers, view, ctx);
    const pixel = ctx.getImageData(W / 2, H / 2, 1, 1).data;
    check(!(pixel[0] > 250 && pixel[1] > 230), 'Resolved surface has no bright point at its center');
    const labels = scene.hitLabels.filter((l) => l.name.startsWith('mars:'));
    check(scene.marsFeatures.length >= 3 && labels.length >= 3, 'Mars has surface labels');
    const noLabels = skyScene(frame, W, H, { ...layers, labels: false }, view, ctx);
    check(!noLabels.hitLabels.length, 'Labels toggle hides automatic labels');
    const feature = scene.marsFeatures.find((f) => f.name === 'Sinus Meridiani');
    check(feature && pickMarsFeature(noLabels.marsFeatures, feature.x, feature.y) === noLabels.marsFeatures.find((f) => f.key === feature.key), 'Center pick works with labels off');
    const highlighted = skyScene(frame, W, H, { ...layers, labels: false }, { ...view, selected: feature.key }, ctx);
    check(highlighted.hitLabels.some((l) => l.name === feature.key), 'Selection named with labels off');
    skyScene(frame, W, H, layers, view, ctx);
    document.body.replaceChildren(canvas);
    window.marsTest = { t, place, skyFrame, skyScene, scale, feature };
    return { features: scene.marsFeatures.length, labels: labels.length, selected: feature.name };
  });
  if (process.env.MARS_SCREENSHOT) await page.screenshot({ path: process.env.MARS_SCREENSHOT });
  await page.evaluate(async () => {
    const { mountCoelum } = await import('/js/coelumui.js');
    localStorage.setItem('imks-coelum-mode', 'sky');
    localStorage.setItem('imks-coelum-mount', 'altaz');
    const host = document.createElement('div'); host.className = 'coelum-explorer'; host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    const { t, place } = window.marsTest;
    window.marsTest.explorer = mountCoelum(host, { t, place, label: 'Rome' }, String, { standalone: true });
    for (const layer of ['atmosphere', 'ground', 'labels']) {
      const toggle = host.querySelector(`[data-layer="${layer}"]`);
      if (toggle.checked) toggle.click();
    }
  });
  const search = page.locator('.coelum-search input');
  await search.fill(`Mars ${summary.selected}`);
  assert.match(await page.locator('.coelum-results').innerText(), /Mars feature/);
  await page.locator('.coelum-results [role="option"]').first().click();
  await page.waitForFunction((name) => document.querySelector('.coelum-mars-head h3')?.textContent === name, summary.selected);
  await page.waitForTimeout(200);
  const centered = await page.evaluate(() => {
    const { t, place, skyFrame, skyScene, feature } = window.marsTest;
    const svg = document.querySelector('.coelum-full'), box = svg.getBoundingClientRect(), c = document.createElement('canvas');
    c.width = box.width; c.height = box.height;
    const scene = skyScene(skyFrame(t, place), box.width, box.height, { ground: false, atmosphere: false, labels: false },
      { az: Number(svg.dataset.az), alt: Number(svg.dataset.alt), scale: Number(svg.dataset.scale), selected: feature.key }, c.getContext('2d'));
    const f = scene.marsFeatures.find((f) => f.key === feature.key);
    const another = scene.marsFeatures.find((f) => f.key !== feature.key && f.x > 100 && f.x < box.width - 100 && f.y > 150 && f.y < 550);
    if (!another) throw new Error('No second feature for tap');
    return { distance: Math.hypot(f.x - box.width / 2, f.y - box.height / 2), scale: Number(svg.dataset.scale), tap: { x: box.x + another.x, y: box.y + another.y, name: another.name } };
  });
  assert.ok(centered.distance < 10, 'Search centers the surface point');
  assert.ok(centered.scale > 400, 'Search exceeds old planetary zoom limit');
  await page.mouse.click(centered.tap.x, centered.tap.y);
  await page.waitForFunction((name) => document.querySelector('.coelum-mars-head h3')?.textContent === name, centered.tap.name);
  assert.match(await page.locator('.coelum-detail').innerText(), /Latitude.*Longitude/s);
  if (process.env.MARS_DETAIL_SCREENSHOT) await page.screenshot({ path: process.env.MARS_DETAIL_SCREENSHOT });
  // Rotation must retire the old surface selection, even at fixed sky direction.
  await page.evaluate(() => window.marsTest.explorer.setTime(window.marsTest.t + 12 * 3600));
  await page.waitForFunction(() => !document.querySelector('.coelum-explorer').classList.contains('coelum-has-selection'));
  await search.fill(`Mars ${centered.tap.name}`);
  assert.match(await page.locator('.coelum-results').innerText(), /far side|not sunlit/);
  await page.locator('.coelum-results [role="option"]').first().click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.coelum-mars-head').count(), 0, 'Unavailable feature is not highlighted');
  await page.evaluate(() => window.marsTest.explorer.setTime(window.marsTest.t));
  await page.locator('[data-view="chart"]').click();
  await search.fill(`Mars ${summary.selected}`);
  await page.locator('.coelum-results [role="option"]').first().click();
  await page.waitForFunction((name) => document.querySelector('.coelum-mars-head h3')?.textContent === name, summary.selected);
  assert.equal(await page.locator('.coelum-explorer').getAttribute('data-mode'), 'sky');
  await page.evaluate(() => { for (let n = 0; n < 20; n++) document.querySelector('[data-action="out"]').click(); });
  await page.waitForFunction(() => !document.querySelector('.coelum-explorer').classList.contains('coelum-has-selection'));
  await page.setViewportSize({ width: 360, height: 640 });
  const distantFeature = await page.evaluate(async () => {
    const { marsDisk, projectMarsFeatures } = await import('/js/marsfeatures.js');
    const t = Date.parse('2028-01-01T00:00:00Z') / 1000;
    window.marsTest.explorer.setTime(t);
    return projectMarsFeatures(marsDisk(t), { x: 500, y: 500 }, 300, 0, 1000, 1000)[0].name;
  });
  await search.fill(`Mars ${distantFeature}`);
  await page.locator('.coelum-results [role="option"]').first().click();
  await page.waitForFunction((name) => document.querySelector('.coelum-mars-head h3')?.textContent === name, distantFeature);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.evaluate(() => window.marsTest.explorer.setTime(Date.parse('2026-11-24T21:00:00Z') / 1000));
  await search.fill('Mars Olympus Mons');
  await page.locator('.coelum-results [role="option"]').first().click();
  await page.waitForFunction(() => document.querySelector('.coelum-mars-head h3')?.textContent === 'Olympus Mons');
  assert.match(await page.locator('.coelum-detail').innerText(), /Diameter \/ extent.*610/s);
  await page.evaluate(() => {
    const { skyFrame, skyScene, place } = window.marsTest;
    const svg = document.querySelector('.coelum-full'), box = svg.getBoundingClientRect(), canvas = document.createElement('canvas');
    canvas.width = box.width; canvas.height = box.height;
    const ctx = canvas.getContext('2d');
    const scene = skyScene(skyFrame(Date.parse('2026-11-24T21:00:00Z') / 1000, place), box.width, box.height,
      { ground: false, atmosphere: false, labels: false },
      { az: Number(svg.dataset.az), alt: Number(svg.dataset.alt), scale: Number(svg.dataset.scale), selected: 'mars:4453' }, ctx);
    const feature = scene.marsFeatures.find((f) => f.key === 'mars:4453');
    const point = feature?.outline?.find((p) => p.visible && p.x > 5 && p.x < box.width - 5 && p.y > 5 && p.y < box.height - 5);
    if (!point) throw new Error('No visible Olympus extent outline');
    const pixels = ctx.getImageData(Math.floor(point.x) - 2, Math.floor(point.y) - 2, 5, 5).data;
    if (!Array.from({ length: 25 }, (_, i) => pixels[i * 4] > 220 && pixels[i * 4 + 1] > 150 && pixels[i * 4 + 2] > 80).some(Boolean)) throw new Error('Extent outline not drawn in amber');
  });
  if (process.env.MARS_SIZE_SCREENSHOT) await page.screenshot({ path: process.env.MARS_SIZE_SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log('Mars feature browser checks passed:', JSON.stringify(summary));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
