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
  browser = await browserType.launch(process.env.BROWSER_EXECUTABLE || process.env.CHROME ? { executablePath: process.env.BROWSER_EXECUTABLE || process.env.CHROME } : {});
  const context = await browser.newContext({ timezoneId: 'Europe/Rome', serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  if (process.env.NO_WEBGL) await context.addInitScript(() => { const original=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(type,...args){ return type==='webgl'||type==='webgl2'?null:original.call(this,type,...args); }; });
  await context.clock.setFixedTime(new Date('2026-11-22T12:34:56Z'));
  await context.route('https://celestrak.org/**', route => route.fulfill({ json: [] }));
  await context.addInitScript(() => localStorage.setItem('imks.coelumPlace', JSON.stringify({ name: 'Milan', lat: 45.4642, lon: 9.19, h: 120 })));
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.waitForSelector('.coelum-full'); await page.click('[data-action="time"]');
  assert.deepEqual((await page.locator('[data-time-zone]').allTextContents()).slice(0, 2), ['UTC', 'Device']);
  assert.match(await page.locator('[data-time-zone="location"]').textContent(), /^Local: /);
  assert.equal(await page.locator('.coelum-zone-note').count(), 0);
  assert.equal(await activeTimeMode(page), 'device');
  const input = page.locator('[data-time-input]'), dialog = page.locator('[data-timezone-dialog]');
  const instant = await page.locator('.coelum-full').getAttribute('data-time');
  const observer = await page.locator('[data-action="place"]').getAttribute('aria-label');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const row = await page.locator('.coelum-time-options').boundingBox(), field = await input.boundingBox();
    assert.ok(row.y >= field.y + field.height);
    assert.ok(row.x >= 0 && row.x + row.width <= width);
    const local = page.locator('[data-time-zone="location"]');
    const box = await local.boundingBox();
    assert.ok(box.x + box.width <= row.x + row.width + 1, 'Local button fits the time row');
    assert.equal(await local.evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis');
    assert.equal(await local.getAttribute('title'), await local.textContent());
    if (width === 320) assert.ok(await local.evaluate(el => el.scrollWidth > el.clientWidth), 'Long timezone is truncated on a narrow screen');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await setTimeMode(page, 'utc'); assert.equal(await input.inputValue(), '2026-11-22 12:34:56');
  await page.route('**/data/timezones.topo.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.click('[data-time-zone="location"]');
  await page.getByText('Unable to load timezone boundaries. Close and reopen to try again.').waitFor();
  assert.equal(await page.locator('[data-reset-place-zone]').isDisabled(), true);
  await page.click('[data-zone-cancel]');
  assert.equal(await activeTimeMode(page), 'utc');
  await page.unroute('**/data/timezones.topo.json');
  await page.click('[data-time-zone="location"]');
  assert.equal(await dialog.evaluate(el => el.matches('dialog:modal')), true);
  assert.match(await page.locator('.coelum-zone-map-selected').innerText(), /Europe\/Rome/);
  assert.equal(await page.locator('[data-zone-done], [data-place-zone], .coelum-zone-map-hint').count(), 0);
  const svg = page.locator('[data-timezone-map] .map-svg');
  await svg.waitFor();
  await page.waitForFunction(() => { const svg=document.querySelector('[data-timezone-map] .map-svg'); return svg?.dataset.renderer==='webgl'||svg?.querySelector('.map-coast'); });
  assert.match(await page.locator('.coelum-zone-map-credit').innerText(), /OpenStreetMap contributors.*ODbL/);
  const gpu=await svg.getAttribute('data-renderer')==='webgl';
  if(gpu){assert.equal(await page.locator('.map-webgl').count(),1);assert.equal(await svg.getAttribute('data-picking'),'gpu');}
  else{assert.equal(await svg.locator('.map-coast').count(),1);assert.ok((await svg.locator('.map-timezones').getAttribute('d')).length>1000);}
  if(process.env.NO_WEBGL)assert.equal(gpu,false);
  const pick = async (lat, lon, expectedZone) => {
    // Rotate from the initial observing-location view using the globe's
    // existing drag projection, then pick the point at the globe's centre.
    await svg.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const box = await svg.boundingBox(), geometry=await svg.evaluate(el=>({width:el.viewBox.baseVal.width,height:el.viewBox.baseVal.height,radius:Number(el.querySelector('.map-sea').getAttribute('r'))})), radius=geometry.radius;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const dx = -(lon - 9.19) * radius * Math.max(.2, Math.cos(lat * Math.PI / 180)) / 57.3 * box.width / geometry.width;
    const dy = (lat - 45.4642) * radius / 57.3 * box.height / geometry.height;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
    await svg.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForFunction(zone => zone ? document.querySelector('.coelum-zone-map-selected').textContent.includes(zone) : !document.querySelector('.coelum-zone-map-overlap').hidden, expectedZone);
  };
  await pick(35.68, 139.65, 'Asia/Tokyo');
  assert.match(await page.locator('.coelum-zone-map-selected').innerText(), /Asia\/Tokyo/);
  assert.equal(await activeTimeMode(page), 'location');
  assert.equal(await dialog.isVisible(), true);
  assert.match(await page.locator('.coelum-zone-map-selected').innerText(), /UTC\+09:00/);
  await page.click('[data-zone-cancel]');
  assert.equal(await activeTimeMode(page), 'location'); assert.equal(await input.inputValue(), '2026-11-22 21:34:56');
  assert.equal(await page.locator('.coelum-full').getAttribute('data-time'), instant);
  assert.equal(await page.locator('[data-action="place"]').getAttribute('aria-label'), observer);
  await page.reload(); await page.waitForSelector('.coelum-full'); await page.click('[data-action="time"]');
  assert.equal(await activeTimeMode(page), 'location');
  assert.match(await page.locator('[data-time-zone="location"]').textContent(), /Asia\/Tokyo/);
  await setLocalTimezone(page, 'UTC+05:45'); assert.match(await page.locator('[data-time-zone="location"]').textContent(), /UTC\+05:45/);
  await resetLocalTimezone(page); assert.match(await page.locator('[data-time-zone="location"]').textContent(), /Europe\/Rome/);
  await context.setOffline(true);
  await page.click('[data-time-zone="location"]'); await pick(40.71, -74.01, 'America/New_York');
  assert.match(await page.locator('.coelum-zone-map-selected').innerText(), /America\/New_York/);
  await page.click('[data-zone-reset]');
  await page.waitForFunction(() => { const globe = document.querySelector('[data-timezone-map] svg'); return Number(globe.querySelector('.map-sea').getAttribute('r')) <= globe.viewBox.baseVal.width / 2; });
  // This marine overlap is smaller than a world-view touch pixel. Zoom in
  // before targeting it, especially in WebKit which rounds pointer coordinates.
  for(let i=0;i<4;i++)await page.click('[data-zone-zoom="2"]');
  await page.waitForFunction(()=>Number(document.querySelector('[data-timezone-map] .map-sea').getAttribute('r'))>2000);
  await pick(42.4791165, 3.369903005, '');
  await page.locator('[data-zone-candidate="Europe/Madrid"]').waitFor();
  assert.match(await page.locator('[data-time-zone="location"]').textContent(), /America\/New_York/, 'An overlap preserves the applied zone until an explicit choice');
  assert.equal(await page.locator('[data-zone-candidate="Europe/Paris"]').count(), 1);
  await page.click('[data-zone-candidate="Europe/Paris"]');
  assert.match(await page.locator('.coelum-zone-map-selected').innerText(), /Europe\/Paris/);
  assert.match(await page.locator('[data-time-zone="location"]').textContent(), /Europe\/Paris/, 'Overlap choice applies immediately');
  await page.locator('.coelum-zone-map-content').evaluate(el => el.scrollTop = 0);
  for (let i=0;i<4;i++) await page.click('[data-zone-zoom="2"]');
  await page.waitForFunction(() => Number(document.querySelector('[data-timezone-map] .map-sea').getAttribute('r')) > 2000);
  if(!gpu)assert.ok((await svg.locator('.map-coast').getAttribute('d')).length>1000,'Detailed coastline remains rendered at high zoom');
  else assert.equal(await page.locator('.map-webgl').isVisible(),true);
  await page.screenshot({ path: '/private/tmp/coelum-mediterranean-detail.png' });
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    const selectedRow = page.locator('.coelum-zone-map-selected');
    const originalText = await selectedRow.textContent();
    await selectedRow.evaluate(el => el.textContent = 'America/Argentina/ComodRivadavia (UTC−03:00)');
    const label = await selectedRow.boundingBox(), auto = await page.locator('[data-reset-place-zone]').boundingBox();
    assert.ok(label.x + label.width <= auto.x && Math.abs(label.y + label.height / 2 - auto.y - auto.height / 2) < 2, 'Timezone and Auto share one row');
    assert.equal(await selectedRow.evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis');
    if (viewport.width === 320) assert.ok(await selectedRow.evaluate(el => el.scrollWidth > el.clientWidth), 'Long timezone is truncated on narrow screens');
    await selectedRow.evaluate((el, text) => el.textContent = text, originalText);
    const heading = await page.locator('.coelum-zone-map-head h3').boundingBox(), close = await page.locator('[data-zone-cancel]').boundingBox();
    assert.ok(close.x > heading.x + heading.width && close.y < heading.y + heading.height, 'Close is at the top right');
    for (const scroll of [0, 100000]) {
      await page.locator('.coelum-zone-map-content').evaluate((el, top) => el.scrollTop = top, scroll);
      for (const selector of ['[data-zone-cancel]', '[data-reset-place-zone]']) {
        const rect = await page.locator(selector).boundingBox();
        assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height, 'Close and Auto remain visible');
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('.coelum-zone-map-content').evaluate(el => el.scrollTop = 0);
  await page.click('[data-zone-zoom="2"]'); await page.click('[data-zone-reset]');
  await page.waitForFunction(() => { const globe = document.querySelector('[data-timezone-map] svg'), sea = globe.querySelector('.map-sea'); return Number(sea.getAttribute('r')) <= globe.viewBox.baseVal.width / 2; });
  await page.screenshot({ path: '/private/tmp/coelum-timezone-map.png' });
  await page.click('[data-zone-cancel]');
  assert.equal(await dialog.isVisible(), false);
  assert.match(await page.locator('[data-time-zone="location"]').textContent(), /Europe\/Paris/, 'Closing preserves the explicit overlap choice');
  await page.click('[data-time-zone="location"]');
  await svg.waitFor();
  await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.locator('.coelum-timepanel').isVisible(), true);
  await context.setOffline(false);
  await setTimeMode(page, 'device'); assert.match(await page.locator('[data-time-zone="location"]').textContent(), /Europe\/Paris/, 'Local label retains the chosen timezone in device mode');
  await page.screenshot({ path: '/private/tmp/coelum-time-options.png' });
  if(gpu){
    await page.click('[data-time-zone="location"]');
    await page.waitForFunction(()=>document.querySelector('[data-timezone-map] svg')?.dataset.renderer==='webgl');
    await page.locator('.map-webgl').evaluate(canvas=>canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext());
    await svg.locator('.map-coast').waitFor();
    assert.equal(await page.locator('.map-webgl').count(),0,'Context loss activates SVG fallback');
    await page.click('[data-zone-cancel]');
  }
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
  await embedded.locator('[data-reset-place-zone]').click();
  assert.equal(await embedded.locator('[data-time-input]').inputValue(), '2026-11-22 13:34:56');
  await embedded.locator('[data-zone-cancel]').click();
  await page.evaluate(() => document.querySelector('#embedded-test').remove());
  assert.deepEqual(errors, []); await context.close();
  console.log('Timezone map passed: three-option row, immediate map selection/close, preserved instant and observer, persistence, fixed offsets, automatic, offline, and Escape');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
