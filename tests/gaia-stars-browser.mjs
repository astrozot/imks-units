// Download/offline/search checks and phone-viewport rendering measurements.
// Same PLAYWRIGHT/CHROME settings as tests/coelum-browser.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* next */ }
}
if (!chromium) throw new Error('Playwright required for this check');
const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'data/stars-12.json')));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream', 'content-length': fs.statSync(filename).size });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.route('https://celestrak.org/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await context.addInitScript(() => localStorage.setItem('imks.settings', JSON.stringify({ location: { lat: 45, lon: 9, h: 0, name: 'Milan' } })));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Slow the desktop CPU for an additional responsiveness check. This is
  // an approximation, not a substitute for a physical iPhone/Android test.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const origin = `http://localhost:${server.address().port}`;
  await page.goto(`${origin}/coelum/`);
  await page.waitForSelector('.coelum-full');
  await page.locator('[data-action="layers"]').click();
  assert.equal(await page.locator('[data-limit] option[value="12"]').evaluate((o) => o.disabled), true);
  const radios = page.locator('.coelum-catalog-choices input[type="radio"]');
  assert.equal(await radios.count(), 4);
  assert.equal(await page.locator('.coelum-catalog-choices input:checked').count(), 0);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.locator('.coelum-catalog-choices').evaluate((row) => {
      const r = row.getBoundingClientRect();
      if (!r.width) return null;
      return [...row.children].map((label) => {
        const b = label.getBoundingClientRect(), text = label.querySelector('small').getBoundingClientRect();
        return { top: b.top, left: b.left, right: b.right, textLeft: text.left, textRight: text.right, rowLeft: r.left, rowRight: r.right, fits: b.left >= r.left && b.right <= r.right + 1 && text.left >= b.left && text.right <= b.right + 1 };
      });
    });
    if (layout) assert.ok(layout.every((item) => item.top === layout[0].top && item.fits), `Four catalog radios fit on one row at ${width}px: ${JSON.stringify(layout)}`);
    else {
      assert.equal(await page.locator('[data-catalog-select]').isVisible(), true, `Dropdown replaces cramped radios at ${width}px`);
      assert.equal(await page.locator('[data-catalog-select]').evaluate((select) => select.scrollWidth <= select.clientWidth), true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await page.locator('[data-catalog-space]').allTextContents(), ['+ 1.3 MB', '+ 8.3 MB', '+ 18.4 MB', '+ 58.9 MB']);
  await page.setViewportSize({ width: 360, height: 844 });
  await page.locator('[data-catalog-select]').selectOption('12');
  await page.waitForFunction((n) => document.querySelector('.coelum-faint-note').textContent.includes(n.toLocaleString('en')), metadata.stars, { timeout: 60000 });
  assert.equal(await page.locator('[data-download="12"]').isChecked(), true);
  assert.equal(await page.locator('[data-catalog-select]').inputValue(), '12');
  assert.deepEqual(await page.locator('[data-catalog-space]').allTextContents(), ['− 57.5 MB', '− 50.6 MB', '− 40.4 MB', '0.0 MB']);
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.CATALOG_SCREENSHOT) {
    await page.locator('.coelum-catalog-choices').scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.CATALOG_SCREENSHOT });
  }
  await page.locator('[data-limit]').selectOption('12');
  const sample = await page.evaluate(async () => {
    const { readStars } = await import('/js/coelum.js');
    const response = await (await caches.open('imks-data-stars')).match(new URL('/coelum-faint-stars.bin', location.origin));
    if (!response) throw new Error('Catalog was not cached');
    const b = await response.arrayBuffer(), s = readStars(b);
    for (let j = 0; j < s.n; j++) if (s.gaia[2 * j + 1] && s.mag[j] > 220 && !s.tyc[j]) {
      return { name: `Gaia DR3 ${(BigInt(s.gaia[2 * j + 1]) << 32n) + BigInt(s.gaia[2 * j])}`, bytes: b.byteLength };
    }
    throw new Error('No new Gaia-only star');
  });
  assert.equal(sample.bytes, metadata.bytes);
  assert.equal(await page.evaluate(async () => (await (await caches.open('imks-data-stars')).keys()).length), 1);
  await page.locator('[data-action="layers"]').click();
  const input = page.locator('.coelum-search input');
  await input.fill(sample.name); await input.press('Enter');
  await page.waitForFunction((name) => document.querySelector('.coelum-detail h3')?.textContent === name, sample.name);
  assert.match(await page.locator('.coelum-detail').textContent(), /estimated from Gaia/);
  if (process.env.GAIA_SCREENSHOT) await page.screenshot({ path: process.env.GAIA_SCREENSHOT });
  const measurements = await page.evaluate(async () => {
    const { skyFrame, skyChart, lookAt } = await import('/js/coelum.js');
    const { skyScene } = await import('/js/coelumsky.js');
    const frame = skyFrame(Date.parse('2026-11-11T00:00Z') / 1000, [45, 9, 0]);
    const canvas = document.createElement('canvas'); canvas.width = 390; canvas.height = 844;
    const ctx = canvas.getContext('2d');
    const results = [];
    // Dense Sagittarius and a high-latitude field; widths and heights of a phone.
    for (const [ra, dec] of [[270, -29], [180, 60]]) for (const scale of [1, 16, 32, 64, 256]) {
      const o = frame.hor(frame.catalog(ra, dec)), view = { scale, rotation: lookAt(o.az, o.alt) }, times = [], canvasTimes = [], skyTimes = [];
      let objects = 0;
      for (let i = 0; i < 7; i++) {
        const start = performance.now(), chart = skyChart(frame, 390, 844, { magnitude: 12, ground: false, deep: false, labels: false, constellations: false }, view);
        times.push(performance.now() - start); objects = chart.objects.length;
        const canvasStart = performance.now();
        skyChart(frame, 390, 844, { magnitude: 12, ground: false, deep: false, labels: false, constellations: false }, view, ctx);
        canvasTimes.push(performance.now() - canvasStart);
        const skyStart = performance.now();
        skyScene(frame, 390, 844, { ground: false, atmosphere: false, milkyway: false, deep: false, labels: false, constellations: false }, view, ctx);
        skyTimes.push(performance.now() - skyStart);
      }
      results.push({ ra, dec, scale, objects, chartSVGMedianMs: times.sort((a, b) => a - b)[3], chartCanvasMedianMs: canvasTimes.sort((a, b) => a - b)[3], skyMedianMs: skyTimes.sort((a, b) => a - b)[3] });
    }
    return results;
  });
  console.log(JSON.stringify({ cpuSlowdown: 4, viewport: '390x844', measurements }, null, 2));
  // Reload without permitting another star download. The optional file stays
  // in the shared data cache, outside either app's service-worker app cache.
  await page.route('**/data/stars-*.bin', (route) => route.abort());
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload(); await page.waitForSelector('.coelum-full');
  await page.locator('[data-action="layers"]').click();
  await page.waitForFunction((n) => document.querySelector('.coelum-faint-note').textContent.includes(n.toLocaleString('en')), metadata.stars);
  assert.equal(await page.locator('[data-limit] option[value="12"]').evaluate((o) => o.disabled), false);
  assert.equal(await page.locator('[data-download="12"]').isChecked(), true);
  assert.equal(await page.locator('[data-catalog-select]').inputValue(), '12');
  // iMKS uses the same stored data after navigation.
  await context.setOffline(false);
  await page.goto(`${origin}/`); await page.waitForSelector('#expr');
  await page.keyboard.type('coelum(2026.11.11 00:00 Z, "Milan")'); await page.keyboard.press('Enter');
  await page.locator('.coelum-preview').last().click(); await page.waitForSelector('.coelum-full');
  await page.locator('[data-action="layers"]').click();
  await page.waitForFunction((n) => document.querySelector('.coelum-faint-note').textContent.includes(n.toLocaleString('en')), metadata.stars);
  await page.locator('[data-download="remove"]').click();
  await page.waitForFunction(() => /Only stars to magnitude 6/.test(document.querySelector('.coelum-faint-note').textContent));
  assert.equal(await page.locator('[data-limit] option[value="12"]').evaluate((o) => o.disabled), true);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Gaia phone-viewport, cache, search and shared-app checks passed');
} finally {
  await browser?.close(); await new Promise((r) => server.close(r));
}
