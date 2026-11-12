// Focused checks of Layers, galactic coordinates and signed date entry:
// node tests/coelum-improvements-browser.mjs. PLAYWRIGHT/CHROME as browser.mjs;
// BROWSER=webkit and BROWSER_EXECUTABLE select another engine.
// SKIP_OFFLINE_RELOAD=1 excludes the service-worker offline navigation check.
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
// CelesTrak's groups (satellites.js): the stations and some of the
// brightest, of 2026-11-07/08, from tests/fixtures; the others empty
const CELESTRAK = JSON.parse(fs.readFileSync(new URL('fixtures/celestrak.json', import.meta.url)));
const celestrak = [];
let browser;
try {
  const executable = process.env.BROWSER_EXECUTABLE || (process.env.BROWSER !== 'webkit' && process.env.CHROME);
  browser = await browserType.launch(executable ? { executablePath: executable } : {});
  const open = async (storage) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Europe/Rome' });
    await context.clock.setFixedTime(new Date('2026-11-08T12:00:00Z'));
    celestrak.length = 0;
    await context.route('https://celestrak.org/**', (route) => {
      const group = new URL(route.request().url()).searchParams.get('GROUP');
      celestrak.push(group);
      route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(CELESTRAK[group] || []) });
    });
    await context.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, storage);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('.coelum-full');
    return { context, page, errors };
  };
  const rows = (page) => page.$$eval('.coelum-event', (b) => b.map((x) => [x.dataset.event, x.innerText.replace(/\n/g, ' | ')]));

  const { context, page, errors } = await open({ 'imks.coelumTimeZone': 'device', 'imks.settings': { location: { lat: 45.4642, lon: 9.19, h: 120, name: 'Milan' } } });
  const status = () => page.locator('.coelum-status').textContent();
  // Timezone details must not make the bottom bar grow.
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const bar = await page.locator('.coelum-timebar').boundingBox();
    assert.ok(bar.height <= 106, `Original bottom-bar height at ${width}px: ${bar.height}`);
    assert.doesNotMatch(await status(), /Europe\/Rome|UTC/);
    assert.match(await page.locator('[data-action="time"]').getAttribute('aria-label'), /Europe\/Rome/);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Status information always starts on its own line, even on a phone.
  assert.equal(await page.locator('.coelum-condition').evaluate((el) => getComputedStyle(el).display), 'block');
  const line = await page.locator('.coelum-condition').boundingBox();
  const when = await page.locator('[data-action="time"]').boundingBox();
  assert.ok(line.y >= when.y + when.height);
  await page.click('[data-action="time"]');
  assert.equal(await page.locator('.coelum-time-zone').first().innerText().then((s) => s.split('\n')[0]), 'Time');
  assert.deepEqual(await page.locator('[data-time-zone] option').allTextContents(), ['UTC', 'device', 'selected location']);
  assert.equal(await page.locator('[data-set-time="original"]').count(), 0);
  // Two events per row at phone widths; touching a chip does not leave hover paint.
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const boxes = await page.locator('.coelum-events [data-time-event]').evaluateAll((buttons) => buttons.slice(0, 4).map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; }));
    assert.ok(boxes.length >= 4);
    assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 1 && boxes[1].x > boxes[0].x, `Two events share a row at ${width}px`);
    assert.ok(boxes[2].y > boxes[0].y);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/coelum-day-events-two-columns.png' });
  const chip = page.locator('[data-time-event]').first();
  const normalPaint = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
  await chip.tap();
  await page.waitForTimeout(200);
  assert.equal(await chip.evaluate((el) => getComputedStyle(el).backgroundColor), normalPaint, 'No sticky hover after a touch');
  const toolbarButton = page.locator('[data-action="forward"]');
  const toolbarPaint = await toolbarButton.evaluate((el) => getComputedStyle(el).backgroundColor);
  await toolbarButton.tap(); await page.waitForTimeout(200);
  assert.equal(await toolbarButton.evaluate((el) => getComputedStyle(el).backgroundColor), toolbarPaint);
  await page.click('[data-set-time="now"]');

  assert.doesNotMatch(await page.locator('.coelum-events').textContent(), /Astronomical|Nautical/);
  await page.click('[data-action="time"]');
  await page.click('[data-action="events"]');
  await page.click('[data-action="time"]');
  assert.equal(await page.locator('[data-panel="events"]').isVisible(), false, 'An outside click dismisses Events');
  assert.equal(await page.locator('.coelum-timepanel').isVisible(), false, 'The dismissal click does not activate the control underneath');
  await page.click('[data-action="place"]');
  assert.equal(await page.locator('[data-place="original"]').count(), 0, 'Standalone Coelum has no Original place');
  await page.click('[data-place="map"]');
  await page.waitForSelector('.coelum-map-panel .map-coast');
  const largeMap = await page.locator('.coelum-map-panel').boundingBox();
  assert.ok(largeMap.width > 390 * 0.95 && largeMap.height > 844 * 0.95, 'The location map uses the full phone window');
  assert.equal(await page.locator('.coelum-map-panel').evaluate((el) => el.matches(':modal')), true);
  const initialMarker = await page.locator('.coelum-map-panel .map-place').getAttribute('cx');
  const globe = page.locator('.coelum-map-panel .map-svg');
  const globeBox = await globe.boundingBox();
  await page.touchscreen.tap(globeBox.x + globeBox.width * 0.6, globeBox.y + globeBox.height * 0.5);
  await page.waitForTimeout(450);
  assert.notEqual(await page.locator('.coelum-map-panel .map-place').getAttribute('cx'), initialMarker, 'A tap moves the chosen location');
  await page.screenshot({ path: '/private/tmp/coelum-place-map.png' });
  const chosen = await page.locator('.coelum-map-panel .map-local').textContent();
  assert.match(chosen, /Use this place/);
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '{"elevation":[0]}' }));
  await page.click('[data-map="choose-place"]');
  await page.waitForFunction(() => document.querySelector('.coelum-map-panel').hidden);
  assert.doesNotMatch(await status(), /Milan/);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('imks.coelumPlace')).lon !== 9.19));
  // The offline globe remains usable without network access.
  await context.setOffline(true);
  await page.click('[data-action="place"]'); await page.click('[data-place="map"]');
  await page.waitForSelector('.coelum-map-panel .map-coast');
  await page.click('[aria-label="Close map"]');
  await context.setOffline(false);
  // Hidden-layer symbols explain M42 without changing the layer setting.
  await page.fill('.coelum-search input', 'M42');
  await page.waitForSelector('.coelum-results li');
  assert.match(await page.locator('.coelum-results li').first().getAttribute('aria-label'), /Not displayed: Deep sky layer is off/);
  await page.locator('.coelum-results li [data-search-hint*="Deep sky"]').first().click();
  assert.match(await page.locator('.coelum-search-hint').textContent(), /Deep sky layer is off/);
  await page.fill('.coelum-search input', '');
  await page.click('[data-action="layers"]'); await page.check('[data-layer="deep"]'); await page.click('[data-action="layers"]');
  await page.fill('.coelum-search input', 'M42');
  assert.equal(await page.locator('.coelum-results li [data-search-hint*="Deep sky"]').count(), 0);
  await page.fill('.coelum-search input', '');
  // Native zoom events are canceled everywhere, including event sheets.
  const canceled = await page.evaluate(() => {
    const targets = [document.querySelector('.coelum-detail'), document.querySelector('#sheet-body')];
    return targets.map((el) => {
      const gesture = new Event('gesturestart', { bubbles: true, cancelable: true });
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -10 });
      const touch = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(touch, 'touches', { value: [{}, {}] });
      el.dispatchEvent(gesture); el.dispatchEvent(wheel); el.dispatchEvent(touch);
      return [gesture.defaultPrevented, wheel.defaultPrevented, touch.defaultPrevented];
    });
  });
  assert.deepEqual(canceled, [[true, true, true], [true, true, true]]);
  for (const mode of ['chart', 'sky']) {
    await page.click(`[data-view="${mode}"]`);
    await page.click('[data-action="layers"]');
    assert.equal(await page.locator('[data-layer="galactic"]').isChecked(), false);
    await page.check('[data-layer="galactic"]');
    assert.equal(await page.locator('.coelum-toolbar').isVisible(), true, 'Inside taps leave Layers open');
    await page.click('[data-action="layers"]');
    if (mode === 'chart') assert.match(await page.locator('.coelum-full').innerHTML(), /[lb] [−\d]+°/);
  }
  // Center the Sun, then open Layers. Choose a visible sky point outside it.
  await page.fill('.coelum-search input', 'Sun');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1100);
  const selected = await page.locator('.coelum-detail h3').textContent();
  await page.click('[data-action="layers"]');
  const outside = await page.evaluate(() => {
    for (let y = 180; y < innerHeight - 110; y += 20) for (let x = 10; x < innerWidth - 60; x += 20)
      if (document.elementFromPoint(x, y)?.closest('.coelum-full')) return { x, y };
    throw new Error('No exposed sky');
  });
  await page.touchscreen.tap(outside.x, outside.y);
  assert.equal(await page.locator('.coelum-toolbar').isVisible(), false);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), selected);
  // A tap on the centered object opens its details after dismissal.
  const box = await page.locator('.coelum-full').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await page.locator('.coelum-detail').isVisible(), true);
  assert.match(await page.locator('.coelum-detail').textContent(), /Galactic longitude.*Galactic latitude/s);
  // Clicking another control dismisses Layers without activating the control.
  await page.click('[data-action="layers"]');
  await page.click('[data-action="time"]');
  assert.equal(await page.locator('.coelum-toolbar').isVisible(), false);
  assert.equal(await page.locator('.coelum-timepanel').isVisible(), false);
  // Signed years can be entered, displayed, and reopened on the local clock.
  await page.click('[data-action="time"]');
  const dateInput = page.locator('[data-time-input]');
  assert.equal(await dateInput.getAttribute('type'), 'datetime-local');
  await page.click('[data-time-date-mode]');
  assert.equal(await dateInput.getAttribute('type'), 'text');
  for (const year of ['-1000', '-0001', '0000', '0001', '0099', '3000']) {
    await dateInput.fill(`${year}-06-01 12:34`);
    await dateInput.dispatchEvent('change');
    const time = Number(await page.locator('.coelum-full').getAttribute('data-time'));
    const actualYear = await page.evaluate((time) => new Date(time * 1000).getFullYear(), time);
    assert.equal(actualYear, Number(year), `Set year ${year} without a 1900 offset`);
    if (Number(year) <= 0) assert.ok((await status()).includes(year.replace('-', '−')), 'The local status preserves the astronomical year');
    await page.click('[data-action="time"]');
    assert.equal(await dateInput.isVisible(), false, `Close the time panel in year ${year}`);
    await page.click('[data-action="time"]');
    assert.equal(await dateInput.isVisible(), true, `Reopen the time panel in year ${year}`);
    assert.equal(await dateInput.inputValue(), `${year}-06-01 12:34`);
  }
  const unchanged = await page.locator('.coelum-full').getAttribute('data-time');
  for (const invalid of ['-1001-06-01 12:34', '3001-01-01 12:34', '2026-02-30 12:34']) {
    await dateInput.fill(invalid); await dateInput.dispatchEvent('change');
    assert.equal(await dateInput.evaluate((el) => el.checkValidity()), false);
    assert.equal(await page.locator('.coelum-full').getAttribute('data-time'), unchanged);
  }
  await page.click('[data-set-time="now"]');
  await page.click('[data-action="time"]');

  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/private/tmp/coelum-ui-improvements.png' });
  // UTC formatting uses the same signed year convention.
  await context.close();
  const second = await open({ 'imks.settings': { location: { lat: 45.4642, lon: 9.19, h: 120, name: 'Milan' } } });
  assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /UTC/);
  await second.page.click('[data-action="time"]');
  assert.equal(await second.page.locator('[data-time-zone]').inputValue(), 'device', 'Device time is the default');
  const instant = await second.page.locator('.coelum-full').getAttribute('data-time');
  const barHeight = (await second.page.locator('.coelum-timebar').boundingBox()).height;
  await second.page.selectOption('[data-time-zone]', 'device');
  assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /Europe\/Rome \(UTC[+−]\d\d:\d\d\)/);
  assert.equal(await second.page.locator('.coelum-full').getAttribute('data-time'), instant, 'Changing timezone preserves the instant');
  await second.page.selectOption('[data-time-zone]', 'location');
  assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /Europe\/Rome/);
  await second.page.click('[data-action="time"]');
  await second.page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '{"elevation":[0]}' }));
  await second.page.click('[data-action="place"]');
  await second.page.fill('.coelum-place-form input', '35.6762, 139.6503');
  await second.page.locator('.coelum-place').first().click();
  await second.page.waitForFunction(() => document.querySelector('[data-action="time"]').getAttribute('aria-label').includes('Asia/Tokyo'));
  assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /Asia\/Tokyo \(UTC\+09:00\)/);
  assert.equal(await second.page.locator('.coelum-full').getAttribute('data-time'), instant, 'Moving the observer preserves the instant');
  await second.page.click('[data-action="time"]');
  assert.equal(await second.page.locator('[data-place-zone]').inputValue(), 'Asia/Tokyo');
  await second.page.fill('[data-place-zone]', 'America/New_York');
  await second.page.locator('[data-place-zone]').dispatchEvent('change');
  for (const [date, offset] of [['2026-01-01 12:00', '−05:00'], ['2026-07-01 12:00', '−04:00']]) {
    await second.page.fill('[data-time-input]', date.replace(' ', 'T')); await second.page.locator('[data-time-input]').dispatchEvent('change');
    assert.ok((await second.page.locator('[data-action="time"]').getAttribute('aria-label')).includes('UTC' + offset));
    assert.equal((await second.page.locator('.coelum-timebar').boundingBox()).height, barHeight);
  }
  await second.page.fill('[data-place-zone]', 'UTC+03:00');
  await second.page.locator('[data-place-zone]').dispatchEvent('change');
  assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /UTC\+03:00/);
  await second.page.screenshot({ path: '/private/tmp/coelum-timezone-options.png' });
  await second.page.reload(); await second.page.waitForSelector('.coelum-full');
  assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /UTC\+03:00/, 'Manual override survives reload');
  await second.page.click('[data-action="time"]');
  assert.equal(await second.page.locator('[data-time-zone]').inputValue(), 'location');
  await second.page.click('[data-reset-place-zone]');
  assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /Asia\/Tokyo/);
  await second.page.selectOption('[data-time-zone]', 'utc');
  await second.page.click('[data-time-date-mode]');
  await second.page.fill('[data-time-input]', '-0100-06-01 12:34');
  await second.page.locator('[data-time-input]').dispatchEvent('change');
  assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /−0100-06-01 .*UTC/);
  if (!process.env.SKIP_OFFLINE_RELOAD) {
    await second.page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await second.context.setOffline(true);
    await second.page.reload(); await second.page.waitForSelector('.coelum-full');
    await second.page.click('[data-action="time"]');
    await second.page.selectOption('[data-time-zone]', 'location');
    assert.match(await second.page.locator('[data-action="time"]').getAttribute('aria-label'), /Asia\/Tokyo/, 'The timezone map works offline');
    await second.context.setOffline(false);
  } else console.log('Skipped offline reload check by SKIP_OFFLINE_RELOAD');
  assert.deepEqual(second.errors, []);
  await second.context.close();
  const third = await open({ 'imks.settings': { location: { lat: 45.4642, lon: 9.19, h: 120, name: 'Milan' } } });
  const mount = third.page.locator('[data-action="mount"]');
  assert.equal(await mount.textContent(), 'AZ');
  await mount.click(); assert.equal(await mount.textContent(), 'EQ');
  await mount.click(); assert.equal(await mount.textContent(), 'GA');
  await third.page.waitForTimeout(1100);
  await mount.click(); assert.equal(await mount.textContent(), 'AZ');
  await third.page.waitForTimeout(1100);
  await mount.click(); assert.equal(await mount.textContent(), 'GA');
  // GA -> AZ -> EQ is a new burst: slow clicks must now use GA/EQ.
  await third.page.waitForTimeout(1100);
  await mount.click(); assert.equal(await mount.textContent(), 'AZ');
  await mount.click(); assert.equal(await mount.textContent(), 'EQ');
  await third.page.waitForTimeout(1100);
  await mount.click(); assert.equal(await mount.textContent(), 'GA');
  await third.page.waitForTimeout(1100);
  await mount.click(); assert.equal(await mount.textContent(), 'EQ');
  await third.page.waitForTimeout(1100);
  await mount.click(); await mount.click(); await mount.click();
  assert.equal(await mount.textContent(), 'EQ', 'Three fast clicks preserve the mode');
  const pair = await third.page.evaluate(() => JSON.parse(localStorage.getItem('imks-coelum-mount-pair')));
  assert.deepEqual(new Set(pair), new Set(['equatorial', 'galactic']), 'A full cycle preserves the pair');
  await third.page.reload(); await third.page.waitForSelector('.coelum-full');
  assert.equal(await mount.textContent(), 'EQ', 'The mount is saved');
  await mount.click(); assert.equal(await mount.textContent(), 'GA', 'The pair is saved');
  await third.page.click('[data-action="layers"]');
  await third.page.uncheck('[data-layer="ground"]'); await third.page.click('[data-action="layers"]');
  // Actual chart labels stay still over an hour in the Galactic mount.
  const star = await third.page.evaluate(() => {
    const names = ['Vega', 'Deneb', 'Altair', 'Capella', 'Aldebaran', 'Sirius', 'Betelgeuse', 'Rigel', 'Arcturus', 'Polaris'];
    const e = [...document.querySelectorAll('.coelum-full text')].find((el) => names.includes(el.textContent));
    return { name: e.textContent, x: Number(e.getAttribute('x')), y: Number(e.getAttribute('y')) };
  });
  await third.page.click('[data-action="forward"]');
  const after = await third.page.evaluate((name) => {
    const e = [...document.querySelectorAll('.coelum-full text')].find((el) => el.textContent === name);
    return { x: Number(e.getAttribute('x')), y: Number(e.getAttribute('y')) };
  }, star.name);
  assert.ok(Math.hypot(after.x - star.x, after.y - star.y) < 0.2, 'Galactic mount keeps star positions fixed');
  // Holds choose the paired destination, with no second action on release.
  await third.page.evaluate(() => {
    localStorage.setItem('imks-coelum-mount', 'galactic');
    localStorage.setItem('imks-coelum-mount-pair', JSON.stringify(['galactic', 'altaz']));
  });
  await third.page.reload(); await third.page.waitForSelector('.coelum-full');
  await mount.hover(); await third.page.mouse.down(); await third.page.waitForTimeout(900); await third.page.mouse.up();
  assert.equal(await mount.textContent(), 'AZ');
  assert.equal(await third.page.locator('[data-layer="ground"]').isChecked(), true);
  await third.page.click('[data-view="sky"]');
  assert.equal(await third.page.locator('[data-layer="atmosphere"]').isChecked(), true);
  // With GA/EQ as the pair, a slow hold of GA must choose EQ without ground.
  await third.page.evaluate(() => {
    localStorage.setItem('imks-coelum-mount', 'galactic');
    localStorage.setItem('imks-coelum-mount-pair', JSON.stringify(['galactic', 'equatorial']));
  });
  await third.page.reload(); await third.page.waitForSelector('.coelum-full');
  assert.equal(await mount.textContent(), 'GA');
  await mount.hover(); await third.page.mouse.down(); await third.page.waitForTimeout(900); await third.page.mouse.up();
  assert.equal(await mount.textContent(), 'EQ');
  assert.equal(await third.page.locator('[data-layer="ground"]').isChecked(), false);
  await third.page.click('[data-view="sky"]');
  assert.equal(await third.page.locator('[data-layer="atmosphere"]').isChecked(), false);
  // AZ's partner may be GA: a hold must honor that pair too.
  await third.page.evaluate(() => {
    localStorage.setItem('imks-coelum-mount', 'altaz');
    localStorage.setItem('imks-coelum-mount-pair', JSON.stringify(['altaz', 'galactic']));
  });
  await third.page.reload(); await third.page.waitForSelector('.coelum-full');
  await mount.hover(); await third.page.mouse.down(); await third.page.waitForTimeout(900); await third.page.mouse.up();
  assert.equal(await mount.textContent(), 'GA');
  assert.equal(await third.page.locator('[data-layer="ground"]').isChecked(), false);
  await third.page.click('[data-view="sky"]');
  assert.equal(await third.page.locator('[data-layer="atmosphere"]').isChecked(), false);
  assert.deepEqual(third.errors, []);
  await third.context.close();
  console.log('Coelum UI and timezone improvements passed: galactic grids and details, Layers dismissal, signed local/UTC years and date validation');
} finally {
  await browser?.close();
  server.close();
}
