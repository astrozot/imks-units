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
    const { skyScene } = await import('/js/coelumsky.js');
    const { planetMap } = await import('/js/skyview.js');
    const { pickLunarFeature } = await import('/js/lunarfeatures.js');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    await planetMap('moon').ready;
    const t = Date.parse('2026-11-24T21:00:00Z') / 1000, place = [41.892, 12.511, 20];
    const frame = skyFrame(t, place), moon = frame.bodies.find((o) => o.body === 'moon');
    const W = 900, H = 900, canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const layers = { ground: false, atmosphere: false, labels: true, milkyway: false };
    const view = { rotation: lookAt(moon.az, moon.alt), scale: 140 };
    const small = skyScene(frame, W, H, layers, { ...view, scale: 20 }, ctx);
    check(!small.lunarFeatures.length, 'No features at low zoom');
    const scene = skyScene(frame, W, H, layers, view, ctx);
    check(scene.lunarFeatures.length > 100, 'Features project at high zoom');
    const featureLabels = scene.hitLabels.filter((l) => l.name.startsWith('lunar:'));
    check(featureLabels.length > 5, 'Major feature labels placed over the lunar disk');
    for (const label of featureLabels) check(scene.lunarFeatures.some((f) => f.key === label.name && f.sunlight > 0), 'No unilluminated feature label');
    const noLabels = skyScene(frame, W, H, { ...layers, labels: false }, view, ctx);
    check(noLabels.hitLabels.length === 0, 'Labels toggle hides automatic feature labels');
    const minor = noLabels.lunarFeatures.find((f) => !f.major && f.size > 8 && pickLunarFeature(noLabels.lunarFeatures, f.x, f.y) === f);
    check(minor, 'Unlabelled minor feature can be picked');
    const highlighted = skyScene(frame, W, H, { ...layers, labels: false }, { ...view, selected: minor.key }, ctx);
    check(highlighted.hitLabels.some((l) => l.name === minor.key), 'Selected minor feature named with Labels off');
    // Save a real full-Moon labelled view for visual inspection.
    skyScene(frame, W, H, layers, view, ctx);
    document.body.replaceChildren(canvas);
    window.lunarPreview = canvas.toDataURL('image/png');
    window.lunarTest = { t, place, pickLunarFeature, skyFrame, skyScene };
    return { features: scene.lunarFeatures.length, labels: featureLabels.length };
  });
  if (process.env.LUNAR_SCREENSHOT) await page.screenshot({ path: process.env.LUNAR_SCREENSHOT });
  await page.evaluate(async () => {
    const { mountCoelum } = await import('/js/coelumui.js');
    localStorage.setItem('imks-coelum-mode', 'sky');
    localStorage.setItem('imks-coelum-mount', 'altaz');
    const host = document.createElement('div'); host.className = 'coelum-explorer'; host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    const { t, place } = window.lunarTest;
    const explorer = mountCoelum(host, { t, place, label: 'Rome' }, String, { standalone: true });
    window.lunarTest.explorer = explorer;
    for (const layer of ['atmosphere', 'ground', 'labels']) {
      const toggle = host.querySelector(`[data-layer="${layer}"]`);
      if (toggle.checked) toggle.click();
    }
    explorer.focus('Moon');
  });
  await page.waitForTimeout(900);
  const tap = await page.evaluate(() => {
    for (let n = 0; n < 11; n++) document.querySelector('[data-action="in"]').click();
    const { t, place, skyFrame, skyScene, pickLunarFeature } = window.lunarTest;
    const svg = document.querySelector('.coelum-full'), box = svg.getBoundingClientRect();
    const frame = skyFrame(t, place), canvas = document.createElement('canvas');
    canvas.width = box.width; canvas.height = box.height;
    const scene = skyScene(frame, box.width, box.height, { atmosphere: false, ground: false, labels: false },
      { az: Number(svg.dataset.az), alt: Number(svg.dataset.alt), scale: Number(svg.dataset.scale) }, canvas.getContext('2d'));
    const feature = scene.lunarFeatures.find((f) => !f.major && f.size > 8 && f.x > 100 && f.x < 750 && f.y > 150 && f.y < 550 && pickLunarFeature(scene.lunarFeatures, f.x, f.y) === f);
    if (!feature) throw new Error('No suitable minor feature for a real tap');
    return { x: box.x + feature.x, y: box.y + feature.y, name: feature.name, key: feature.key };
  });
  await page.mouse.click(tap.x, tap.y);
  await page.waitForFunction((name) => document.querySelector('.coelum-detail h3')?.textContent === name, tap.name);
  assert.match(await page.locator('.coelum-detail').innerText(), /Moon.*(?:Crater|crater|Rille|Mountain|feature|Ridge|Valley|Lake|Bay|Scarp)/s);
  assert.ok(await page.locator('.coelum-detail a[href*="planetarynames"]').count());
  // The feature cannot stay highlighted when it moves to the night side.
  await page.evaluate(() => window.lunarTest.explorer.setTime(Date.parse('2026-11-09T21:00:00Z') / 1000));
  await page.waitForFunction(() => !document.querySelector('.coelum-explorer').classList.contains('coelum-has-selection'));
  // Restore and select, then zoom out: the feature layer switches off.
  await page.evaluate(() => { window.lunarTest.explorer.setTime(window.lunarTest.t); window.lunarTest.explorer.focus('Moon'); });
  await page.waitForTimeout(800);
  await page.evaluate((key) => window.lunarTest.explorer.select(key), tap.key);
  await page.waitForFunction(() => document.querySelector('.coelum-explorer').classList.contains('coelum-has-selection'));
  await page.evaluate(() => { for (let n = 0; n < 15; n++) document.querySelector('[data-action="out"]').click(); });
  await page.waitForFunction(() => !document.querySelector('.coelum-explorer').classList.contains('coelum-has-selection'));
  assert.deepEqual(errors, []);
  console.log('Lunar feature browser checks passed:', JSON.stringify({ ...summary, tapped: tap.name }));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
