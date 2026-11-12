// Lunar eclipse sheet: shared rendering, exports and event navigation.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { chromium = (await import(name))[process.env.BROWSER || 'chromium']; break; } catch { /* try next */ }
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
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Europe/Rome' });
  await context.clock.setFixedTime(new Date('2029-12-01T12:00:00Z'));
  await context.route('https://celestrak.org/**', route => route.fulfill({ contentType: 'application/json', body: '[]', headers: { 'access-control-allow-origin': '*' } }));
  await context.addInitScript(() => {
    localStorage.setItem('imks.coelumPlace', JSON.stringify({ lat: 45.46, lon: 9.19, h: 120, name: 'Milan' }));
    localStorage.setItem('imks-coelum-mode', 'chart');
    localStorage.setItem('imks.lunarView', JSON.stringify('sim'));
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  // Mount the shared sheet directly to exercise every link without
  // repeating astronomical event searches after each departure.
  const rendered = await page.evaluate(async () => {
    const { mountLunar } = await import('/js/eventview.js');
    const { lunarEclipse, lunarDiagram } = await import('/js/astro.js');
    const { planetMap } = await import('/js/skyview.js');
    const { lunarAppearance, moonTexture } = await import('/js/coelumsky.js');
    const { snapshot } = await import('/js/snapshot.js');
    await Promise.all([planetMap('moon').ready, moonTexture]);
    const d = lunarDiagram(lunarEclipse(Date.parse('2029-12-01T00:00:00Z') / 1000));
    const root = document.createElement('div'); root.style.width = '360px'; document.body.appendChild(root);
    const calls = [], store = new Map();
    const view = mountLunar(root, d, { store: { get: (k, fallback) => store.get(k) || fallback, set: (k, v) => store.set(k, v) }, utc: true,
      sky: (...args) => calls.push(args) });
    const slider = root.querySelector('.lunar-time'), moon = root.querySelector('.lunar-close');
    const bytes = () => moon.getContext('2d').getImageData(0, 0, moon.width, moon.height).data;
    const setTime = (t) => { slider.value = t; slider.dispatchEvent(new Event('input')); };
    const levels = [];
    for (const t of [d.marks[0].t, d.marks.find(m => m.name === 'max').t, d.marks.at(-1).t]) {
      setTime(t);
      const reference = document.createElement('canvas'); reference.width = moon.width; reference.height = moon.height;
      lunarAppearance(reference, Number(slider.value));
      const actual = bytes(), expected = reference.getContext('2d').getImageData(0, 0, moon.width, moon.height).data;
      if (!actual.every((v, i) => v === expected[i])) throw new Error('Simulation differs from the Sky renderer');
      let red = 0, green = 0;
      for (let i = 0; i < actual.length; i += 4) { red += actual[i]; green += actual[i + 1]; }
      levels.push({ red, green });
    }
    if (!(levels[1].red < levels[0].red / 3 && levels[1].red > levels[1].green * 2 && levels[2].green > levels[1].green * 5)) throw new Error('Simulation follows eclipse phase');
    setTime(d.marks.find(m => m.name === 'max').t);
    const exported = await snapshot(view.share().root, view.share());
    if (exported.size < 20000) throw new Error('Simulation export is empty');
    for (const button of root.querySelectorAll('.lunar-contacts [data-lunar-event]')) button.click();
    root.querySelector('[data-lunar-view="diagram"]').click();
    for (const link of root.querySelectorAll('.lunar-diagram [data-lunar-event]')) link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    if (calls.length !== 14 || calls.some(([t, place, focus, options], i) => t !== d.marks[i % 7].t || place !== undefined || focus[0] !== 'Moon' || options.mode !== 'sky' || options.field !== 1.2)) throw new Error('Event time/target was not preserved');
    // Repaint a paused fallback too, with WebGL unavailable.
    const lost = WebGLRenderingContext.prototype.isContextLost;
    WebGLRenderingContext.prototype.isContextLost = () => true;
    try { setTime(d.marks.find(m => m.name === 'max').t); if (!bytes().some(v => v > 20)) throw new Error('No fallback surface'); }
    finally { WebGLRenderingContext.prototype.isContextLost = lost; }
    root.remove();
    return { levels, exports: exported.size, links: calls.length };
  });
  await page.click('[data-action="events"]');
  await page.click('[data-scope="anywhere"]');
  await page.click('.coelum-event[data-event="lunar"]');
  await page.locator('.lunar-close').waitFor();
  assert.match(await page.locator('#sheet-title').textContent(), /Total lunar eclipse/i);
  assert.equal(await page.locator('.lunar-contacts button').count(), 7);
  if (process.env.LUNAR_PAGE_SCREENSHOT) await page.screenshot({ path: process.env.LUNAR_PAGE_SCREENSHOT });
  await page.click('[data-lunar="play"]');
  const before = await page.locator('.lunar-time').inputValue();
  await page.waitForTimeout(150);
  assert.notEqual(await page.locator('.lunar-time').inputValue(), before);
  const event = page.locator('.lunar-contacts button').nth(3), target = Number(await event.getAttribute('data-lunar-event'));
  await event.click();
  await page.waitForFunction(() => document.querySelector('#sheet').hidden);
  await page.waitForTimeout(1500);
  const checkSky = async (expected, selector) => {
    const actual = await page.locator(selector).evaluate(async (root, t) => {
      const { skyFrame, pointVector, refractVector, R } = await import('/js/coelum.js');
      const { skyRadius } = await import('/js/coelumsky.js');
      const svg = root.querySelector('.coelum-full'), canvas = root.querySelector('canvas');
      const place = [45.46, 9.19, 120], moon = skyFrame(Number(svg.dataset.time), place).bodies.find(o => o.body === 'moon');
      const v = canvas.dataset.atmosphere === 'true' ? refractVector(pointVector(moon), 120) : pointVector(moon);
      const az = (Math.atan2(v[0], v[1]) / R + 360) % 360, alt = Math.asin(v[2]) / R;
      const W = Math.round(svg.viewBox.baseVal.width), H = Math.round(svg.viewBox.baseVal.height);
      return { mode: root.dataset.mode, time: Number(svg.dataset.time), scale: Number(svg.dataset.scale),
        azError: Math.abs(((Number(svg.dataset.az) - az + 540) % 360) - 180), altError: Math.abs(Number(svg.dataset.alt) - alt),
        expectedScale: Math.min(W, H) / (2 * skyRadius(W, H, 1) * Math.tan(1.2 * R / 4)) };
    }, expected);
    assert.equal(actual.mode, 'sky');
    assert.ok(Math.abs(actual.time - expected) < 1);
    assert.ok(actual.azError < 0.001 && actual.altError < 0.001, `Moon centered: ${JSON.stringify(actual)}`);
    assert.ok(Math.abs(actual.scale / actual.expectedScale - 1) < 0.01, `Moon close-up overrides previous zoom: ${JSON.stringify(actual)}`);
  };
  await checkSky(target, '#coelum');
  // The calculator's worldwide sheet must support the same navigation,
  // taking the saved observing place when the calculation has no place.
  await page.goto(url.replace(/coelum\/$/, ''));
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('imks.settings') || '{}');
    settings.location = { lat: 45.46, lon: 9.19, h: 120 }; localStorage.setItem('imks.settings', JSON.stringify(settings));
  });
  await page.reload();
  await page.locator('#expr').click();
  await page.keyboard.type('lunareclipse(2029.12.01)');
  await page.locator('#expr').press('Enter');
  await page.locator('.entry .lunar-svg').last().click();
  const calcEvent = page.locator('.lunar-contacts button').nth(2), calcTarget = Number(await calcEvent.getAttribute('data-lunar-event'));
  await calcEvent.focus(); await page.keyboard.press('Enter');
  await page.locator('.coelum-explorer').waitFor(); await page.waitForTimeout(1500);
  await checkSky(calcTarget, '.coelum-explorer');
  assert.deepEqual(errors, []);
  console.log('Lunar sheet checks passed:', JSON.stringify(rendered));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
