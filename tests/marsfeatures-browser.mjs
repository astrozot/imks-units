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
  await page.evaluate(async () => {
    const { skyFrame, lookAt } = await import('/js/coelum.js');
    const { skyScene } = await import('/js/coelumsky.js');
    const { planetMap } = await import('/js/skyview.js');
    const { mountCoelum } = await import('/js/coelumui.js');
    const t = Date.parse('2026-11-25T07:00:00Z') / 1000, place = [41.892, 12.511, 20];
    await planetMap('mars').ready;
    const frame = skyFrame(t, place), mars = frame.bodies.find((o) => o.body === 'mars');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 900;
    const scene = skyScene(frame, 900, 900, { ground: false, atmosphere: false, labels: true },
      { rotation: lookAt(mars.az, mars.alt), scale: 20000 }, canvas.getContext('2d'));
    if (!scene.marsFeatures?.length || !scene.hitLabels.some((l) => l.name.startsWith('mars:'))) throw new Error('Mars features missing from the textured sky');
    window.marsScene = scene;
    localStorage.setItem('imks-coelum-mode', 'sky');
    localStorage.setItem('imks-coelum-mount', 'altaz');
    const host = document.createElement('div'); host.className = 'coelum-explorer'; host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    const explorer = mountCoelum(host, { t, place, label: 'Rome' }, String, { standalone: true });
    window.marsTest = { t, explorer };
    for (const layer of ['ground', 'atmosphere']) {
      const toggle = host.querySelector(`[data-layer="${layer}"]`); if (toggle.checked) toggle.click();
    }
    explorer.focus('Mars');
  });
  await page.waitForTimeout(900);
  await page.locator('.coelum-detail [data-action="moons"]').click();
  const view = page.locator('.coelum-moonsview');
  await page.waitForFunction(() => !document.querySelector('.coelum-moonsview').hidden);
  assert.equal(await page.locator('.coelum-moons-title').innerText(), 'Moons of Mars');
  // Zoom the telescope view until the surface becomes readable.
  await page.mouse.move(450, 450);
  for (let i = 0; i < 8 && await page.locator('.coelum-mars-label').count() < 2; i++) {
    await page.mouse.wheel(0, -250); await page.waitForTimeout(120);
  }
  assert.ok(await page.locator('.coelum-mars-label').count() >= 2, 'Surface labels appear in the telescope view');
  const label = await page.locator('.coelum-mars-label').evaluateAll((labels) => labels.map((el) => {
    const b = el.getBoundingClientRect(); return { name: el.textContent, x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }).find((p) => p.x > 20 && p.x < 880 && p.y > 200 && p.y < 650));
  assert.ok(label, 'An unobstructed feature can be tapped');
  await page.mouse.click(label.x, label.y);
  await page.waitForFunction((name) => document.querySelector('.coelum-mars-detail h3')?.textContent === name && !document.querySelector('.coelum-mars-detail').hidden, label.name);
  assert.ok(await view.isVisible(), 'A surface tap stays in the telescope view');
  await page.locator('[data-action="close-mars-feature"]').click();
  assert.ok(await page.locator('.coelum-mars-detail').isHidden());
  const search = page.locator('.coelum-search input');
  const choose = async (name) => {
    await search.fill(`Mars ${name}`);
    await page.locator('.coelum-results [role="option"]').first().click();
  };
  await choose('Sinus Meridiani');
  const selected = async (name) => {
    await page.waitForFunction((name) => document.querySelector('.coelum-detail h3')?.textContent === name, name);
    assert.ok(await view.isHidden(), 'Search stays in the Sky view');
    assert.equal(await page.locator('.coelum-explorer').getAttribute('data-mode'), 'sky');
  };
  await selected('Sinus Meridiani');
  if (process.env.MARS_SCREENSHOT) await page.screenshot({ path: process.env.MARS_SCREENSHOT });
  // Rotation retires a feature that leaves the visible, illuminated face.
  await page.evaluate(() => window.marsTest.explorer.setTime(window.marsTest.t + 12 * 3600));
  await page.waitForFunction(() => document.querySelector('.coelum-detail h3')?.textContent !== 'Sinus Meridiani');
  await choose('Sinus Meridiani');
  await selected('Mars');
  await page.evaluate(() => window.marsTest.explorer.setTime(window.marsTest.t));
  await page.locator('[data-view="chart"]').click();
  await choose('Sinus Meridiani');
  await selected('Sinus Meridiani');
  // Sky labels and physical footprints both accept taps.
  const pick = await page.evaluate(async () => {
    const { skyFrame, lookAt } = await import('/js/coelum.js');
    const { skyScene } = await import('/js/coelumsky.js');
    const { marsFeatureTarget, findMarsFeature } = await import('/js/marsfeatures.js');
    const svg = document.querySelector('.coelum-full'), b = svg.getBoundingClientRect();
    const frame = skyFrame(window.marsTest.t, [41.892, 12.511, 20]);
    const canvas = document.createElement('canvas'); canvas.width = b.width; canvas.height = b.height;
    const scene = skyScene(frame, b.width, b.height, { ground: false, atmosphere: false, labels: true },
      { rotation: lookAt(+svg.dataset.az, +svg.dataset.alt), scale: +svg.dataset.scale }, canvas.getContext('2d'));
    const feature = scene.marsFeatures.find((f) => f.name === 'Sinus Meridiani');
    if (!feature?.outline?.some((p) => p.visible)) throw new Error('Selected contour missing');
    const label = scene.hitLabels.find((l) => l.name === feature.key);
    return { x: b.x + feature.x, y: b.y + feature.y, label: label && { x: b.x + (label.box[0]+label.box[2])/2, y: b.y + (label.box[1]+label.box[3])/2 } };
  });
  assert.ok(pick.label, 'Surface label is laid out');
  await page.mouse.click(pick.x, pick.y);
  await selected('Sinus Meridiani');
  await page.waitForTimeout(350);
  await page.mouse.click(pick.label.x, pick.label.y);
  await selected('Sinus Meridiani');
  // Phone search frames an ellipse without opening a planet overlay.
  await page.setViewportSize({ width: 360, height: 760 });
  await page.evaluate(() => window.marsTest.explorer.setTime(Date.parse('2026-11-24T21:00:00Z') / 1000));
  await choose('Olympus Mons');
  await selected('Olympus Mons');
  assert.match(await page.locator('.coelum-detail').innerText(), /Diameter \/ extent.*610/s);
  if (process.env.MARS_SIZE_SCREENSHOT) await page.screenshot({ path: process.env.MARS_SIZE_SCREENSHOT });
  await page.setViewportSize({ width: 900, height: 900 });
  await page.evaluate(() => window.marsTest.explorer.setTime(window.marsTest.t));
  await choose('Huygens');
  await selected('Huygens');
  assert.match(await page.locator('.coelum-detail').innerText(), /484[.,]5.*450[.,]2.*Measured crater ellipse/s);
  if (process.env.MARS_ELLIPSE_SCREENSHOT) await page.screenshot({ path: process.env.MARS_ELLIPSE_SCREENSHOT });
  await page.evaluate(() => window.marsTest.explorer.setTime(window.marsTest.t + 4 * 3600));
  await choose('Valles Marineris');
  await selected('Valles Marineris');
  assert.match(await page.locator('.coelum-detail').innerText(), /Mapped nomenclature footprint/);
  if (process.env.MARS_POLYGON_SCREENSHOT) await page.screenshot({ path: process.env.MARS_POLYGON_SCREENSHOT });
  await page.evaluate(() => window.marsTest.explorer.setTime(window.marsTest.t));
  await choose('Syrtis Major');
  await selected('Syrtis Major');
  assert.match(await page.locator('.coelum-detail').innerText(), /Approximate identification contour.*2022–23/s);
  if (process.env.MARS_ALBEDO_SCREENSHOT) await page.screenshot({ path: process.env.MARS_ALBEDO_SCREENSHOT });
  await choose('Jezero');
  await selected('Jezero');
  await page.evaluate(() => window.marsTest.explorer.setTime(Date.parse('2026-11-24T21:00:00Z') / 1000));
  // Other planet systems retain their existing view.
  await search.fill('Jupiter');
  await page.locator('.coelum-results [role="option"]').first().click();
  await page.waitForTimeout(900);
  await page.locator('.coelum-detail [data-action="moons"]').click();
  assert.equal(await page.locator('.coelum-moons-title').innerText(), 'Moons of Jupiter');
  assert.equal(await page.locator('.coelum-mars-label').count(), 0);
  assert.ok(await page.locator('.coelum-mars-detail').isHidden());
  const io = await page.evaluate(async () => {
    const { skyView } = await import('/js/sky.js');
    const { fitView } = await import('/js/skyview.js');
    const stage = document.querySelector('.coelum-moons-stage'), b = stage.getBoundingClientRect();
    const sky = skyView('jupiter', Date.parse('2026-11-24T21:00:00Z') / 1000), v = fitView(sky, b.width, b.height);
    const m = sky.moons.find((m) => m.name === 'Io');
    return { x: b.x + b.width / 2 + (m.x - v.cx) * v.s, y: b.y + b.height / 2 - (m.y - v.cy) * v.s };
  });
  await page.mouse.click(io.x, io.y);
  await page.waitForFunction(() => document.querySelector('.coelum-moonsview').hidden);
  await page.waitForFunction(() => document.querySelector('.coelum-detail h3')?.textContent === 'Io');
  assert.deepEqual(errors, []);
  console.log('Mars telescope checks passed: Sky features, telescope button, zoom, surface/label taps, Sky/Chart searches, rotation, contours, mobile and Jupiter regression');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
