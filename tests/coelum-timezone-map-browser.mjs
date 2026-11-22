import { activeTimeMode, setTimeMode, setLocalTimezone, resetLocalTimezone } from './timezone-controls.mjs';
// Timezone controls, offline map selection, and embedded explorer:
// node tests/coelum-timezone-map-browser.mjs. PLAYWRIGHT/CHROME as browser.mjs;
// BROWSER=webkit and BROWSER_EXECUTABLE select another engine.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let browserType;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { browserType = (await import(name))[process.env.BROWSER || 'chromium']; break; } catch { /* try next */ }
}
if (!browserType) { console.log('Skipped: Playwright is not installed'); process.exit(0); }
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
  browser = await browserType.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const context = await browser.newContext({ timezoneId: 'Europe/Rome', serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.clock.setFixedTime(new Date('2026-11-22T12:34:56Z'));
  await context.route('https://celestrak.org/**', route => route.fulfill({ json: [] }));
  await context.addInitScript(() => localStorage.setItem('imks.coelumPlace', JSON.stringify({ name: 'Milan', lat: 45.4642, lon: 9.19, h: 120 })));
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.waitForSelector('.coelum-full'); await page.click('[data-action="time"]');
  assert.deepEqual(await page.locator('[data-time-zone]').allTextContents(), ['UTC', 'device', 'local']);
  assert.equal(await activeTimeMode(page), 'device');
  const input = page.locator('[data-time-input]'), dialog = page.locator('[data-timezone-dialog]');
  const instant = await page.locator('.coelum-full').getAttribute('data-time');
  const observer = await page.locator('[data-action="place"]').getAttribute('aria-label');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const row = await page.locator('.coelum-time-options').boundingBox(), field = await input.boundingBox();
    assert.ok(row.y >= field.y + field.height);
    assert.ok(row.x >= 0 && row.x + row.width <= width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await setTimeMode(page, 'utc'); assert.equal(await input.inputValue(), '2026-11-22 12:34:56');
  await page.route('**/data/timezones.topo.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.click('[data-time-zone="location"]');
  await page.getByText('Unable to load timezone boundaries. Close and reopen to try again.').waitFor();
  assert.equal(await page.locator('[data-zone-done]').isDisabled(), true);
  await page.click('[data-zone-cancel]');
  assert.equal(await activeTimeMode(page), 'utc');
  await page.unroute('**/data/timezones.topo.json');
  await page.click('[data-time-zone="location"]');
  assert.equal(await dialog.evaluate(el => el.matches('dialog:modal')), true);
  assert.equal(await page.locator('[data-place-zone]').inputValue(), 'Europe/Rome');
  const svg = page.locator('[data-timezone-map] .map-svg');
  await svg.waitFor();
  await svg.locator('.map-coast').waitFor();
  assert.match(await page.locator('.coelum-zone-map-credit').innerText(), /OpenStreetMap contributors.*ODbL/);
  assert.equal(await svg.locator('.map-coast').count(), 1, 'Reuses vector coastline globe');
  assert.ok((await svg.locator('.map-timezones').getAttribute('d')).length > 1000);
  const pick = async (lat, lon, expectedZone) => {
    // Rotate from the initial observing-location view using the globe's
    // existing drag projection, then pick the point at the globe's centre.
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox(), radius = Math.min(box.width, box.height) / 2 - 8;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const dx = -(lon - 9.19) * radius * Math.max(.2, Math.cos(lat * Math.PI / 180)) / 57.3;
    const dy = (lat - 45.4642) * radius / 57.3;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
    await svg.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForFunction(zone => document.querySelector('[data-place-zone]').value === zone, expectedZone);
  };
  await pick(35.68, 139.65, 'Asia/Tokyo');
  assert.equal(await page.locator('[data-place-zone]').inputValue(), 'Asia/Tokyo');
  assert.match(await page.locator('.coelum-zone-map-selected').innerText(), /UTC\+09:00/);
  await page.click('[data-zone-cancel]');
  assert.equal(await activeTimeMode(page), 'utc'); assert.equal(await input.inputValue(), '2026-11-22 12:34:56');
  await page.click('[data-time-zone="location"]'); await pick(35.68, 139.65, 'Asia/Tokyo'); await page.click('[data-zone-done]');
  assert.equal(await activeTimeMode(page), 'location'); assert.equal(await input.inputValue(), '2026-11-22 21:34:56');
  assert.equal(await page.locator('.coelum-full').getAttribute('data-time'), instant);
  assert.equal(await page.locator('[data-action="place"]').getAttribute('aria-label'), observer);
  await page.reload(); await page.waitForSelector('.coelum-full'); await page.click('[data-action="time"]');
  assert.equal(await activeTimeMode(page), 'location');
  assert.match(await page.locator('.coelum-zone-note').textContent(), /Asia\/Tokyo/);
  await page.click('[data-time-zone="location"]');
  await page.fill('[data-place-zone]', 'Not/AZone'); await page.click('[data-zone-done]');
  assert.equal(await dialog.isVisible(), true); assert.equal(await page.locator('[data-place-zone]').evaluate(el => el.checkValidity()), false);
  await page.click('[data-zone-cancel]');
  await setLocalTimezone(page, 'UTC+05:45'); assert.match(await page.locator('.coelum-zone-note').textContent(), /UTC\+05:45/);
  await resetLocalTimezone(page); assert.match(await page.locator('.coelum-zone-note').textContent(), /Europe\/Rome/);
  await context.setOffline(true);
  await page.click('[data-time-zone="location"]'); await pick(40.71, -74.01, 'America/New_York');
  assert.equal(await page.locator('[data-place-zone]').inputValue(), 'America/New_York');
  await page.click('[data-zone-reset]');
  await page.waitForFunction(() => { const globe = document.querySelector('[data-timezone-map] svg'); return Number(globe.querySelector('.map-sea').getAttribute('r')) <= globe.viewBox.baseVal.width / 2; });
  await pick(42.4791165, 3.369903005, '');
  await page.locator('[data-zone-candidate="Europe/Madrid"]').waitFor();
  assert.equal(await page.locator('[data-zone-done]').isDisabled(), true, 'An overlapping region requires an explicit choice');
  assert.equal(await page.locator('[data-zone-candidate="Europe/Paris"]').count(), 1);
  await page.click('[data-zone-candidate="Europe/Paris"]');
  assert.equal(await page.locator('[data-place-zone]').inputValue(), 'Europe/Paris');
  assert.equal(await page.locator('[data-zone-done]').isDisabled(), false);
  await page.locator('.coelum-zone-map-content').evaluate(el => el.scrollTop = 0);
  for (let i=0;i<4;i++) await page.click('[data-zone-zoom="2"]');
  await page.waitForFunction(() => Number(document.querySelector('[data-timezone-map] .map-sea').getAttribute('r')) > 2000);
  assert.ok((await svg.locator('.map-coast').getAttribute('d')).length > 1000, 'Detailed coastline remains rendered at high zoom');
  await page.screenshot({ path: '/private/tmp/coelum-mediterranean-detail.png' });
  for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    for (const scroll of [0, 100000]) {
      await page.locator('.coelum-zone-map-content').evaluate((el, top) => el.scrollTop = top, scroll);
      for (const selector of ['[data-zone-cancel]', '[data-zone-done]']) {
        const rect = await page.locator(selector).boundingBox();
        assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height, 'Confirmation controls remain visible');
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('.coelum-zone-map-content').evaluate(el => el.scrollTop = 0);
  await page.click('[data-zone-zoom="2"]'); await page.click('[data-zone-reset]');
  await page.waitForFunction(() => { const globe = document.querySelector('[data-timezone-map] svg'), sea = globe.querySelector('.map-sea'); return Number(sea.getAttribute('r')) <= globe.viewBox.baseVal.width / 2; });
  await page.screenshot({ path: '/private/tmp/coelum-timezone-map.png' });
  await page.click('[data-zone-done]');
  assert.equal(await dialog.isVisible(), false);
  assert.match(await page.locator('.coelum-zone-note').textContent(), /Europe\/Paris/, 'Checkmark commits the explicit overlap choice');
  await page.click('[data-time-zone="location"]');
  await svg.waitFor();
  await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.locator('.coelum-timepanel').isVisible(), true);
  await context.setOffline(false);
  await setTimeMode(page, 'device'); assert.match(await page.locator('.coelum-zone-note').textContent(), /Europe\/Rome/);
  await page.screenshot({ path: '/private/tmp/coelum-time-options.png' });
  // The calculator's embedded explorer also has working controls without app callbacks.
  await page.evaluate(async () => {
    const { mountCoelum } = await import('../js/coelumui.js');
    const { formatSkyTime } = await import('../js/coelumtime.js');
    const root = document.createElement('div'); root.id = 'embedded-test'; root.className = 'coelum-explorer';
    root.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#101b30'; document.body.append(root);
    mountCoelum(root, { t: Date.parse('2026-11-22T12:34:56Z') / 1000, place: [45.4642, 9.19, 120], label: 'Milan' }, t => formatSkyTime(t, 'UTC'), { timeZone: () => 'UTC' });
  });
  const embedded = page.locator('#embedded-test');
  await embedded.locator('[data-action="time"]').click();
  await embedded.locator('[data-time-zone="device"]').click();
  assert.equal(await embedded.locator('[data-time-input]').inputValue(), '2026-11-22 13:34:56');
  assert.match(await embedded.locator('[data-action="time"]').getAttribute('aria-label'), /Europe\/Rome/);
  await embedded.locator('[data-time-zone="location"]').click();
  await embedded.locator('[data-place-zone]').fill('Asia/Tokyo');
  await embedded.locator('[data-place-zone]').dispatchEvent('change');
  await embedded.locator('[data-zone-done]').click();
  assert.equal(await embedded.locator('[data-time-input]').inputValue(), '2026-11-22 21:34:56');
  await page.evaluate(() => document.querySelector('#embedded-test').remove());
  assert.deepEqual(errors, []); await context.close();
  console.log('Timezone map passed: three-option row, map selection/cancel, preserved instant and observer, persistence, fixed offsets, automatic, offline, and Escape');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
