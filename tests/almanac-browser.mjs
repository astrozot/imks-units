// Daily almanac interactions. Same PLAYWRIGHT/CHROME options as browser.mjs.
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
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const open = async (storage) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Europe/Rome' });
    await context.clock.setFixedTime(new Date('2026-11-08T12:00:00Z'));
    celestrak.length = 0;
    await context.route('https://celestrak.org/**', (route) => {
      const group = new URL(route.request().url()).searchParams.get('GROUP');
      celestrak.push(group);
      route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(CELESTRAK[group] || []) });
    });
    await context.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, { 'imks.coelumTimeZone': 'device', ...storage });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('.coelum-full');
    return { context, page, errors };
  };
  const rows = (page) => page.$$eval('.coelum-event', (b) => b.map((x) => [x.dataset.event, x.innerText.replace(/\n/g, ' | ')]));

  const { context, page, errors } = await open({ 'imks.settings': { location: { lat: 45.4642, lon: 9.19, h: 120, name: 'Milan' } } });
  await page.click('[data-action="almanac"]');
  await page.waitForSelector('[data-almanac-highlights] .coelum-panel-note');
  assert.equal(await page.locator('[data-almanac-date]').inputValue(), '2026-11-08');
  assert.equal(await page.locator('[data-almanac-date]').getAttribute('type'), 'text');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BUTTON', 'Opening never focuses a date/text input');
  await page.waitForSelector('.almanac-planet');
  assert.equal(await page.locator('.almanac-planet').count(), 8);
  assert.match(await page.locator('.almanac-sun').textContent(), /\d{2}:\d{2}:\d{2}/);
  assert.match(await page.locator('.almanac-sun').textContent(), /Twilight/);
  assert.equal(await page.locator('[data-almanac-terrain]').count(), 1);
  await page.locator('.almanac-planet').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-almanac-dialog]').evaluate(e => e.open), true);
  assert.equal(await page.locator('[data-almanac-sky-time]').first().isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-almanac-dialog]').evaluate(e => e.open), false);
  assert.equal(await page.locator('[data-panel="almanac"]').isVisible(), true);
  assert.equal(await page.locator('.almanac-planet').first().evaluate(e => e === document.activeElement), true);
  assert.equal(await page.locator('.almanac-time-legend').count(), 0);
  assert.equal(await page.locator('.almanac-track-hint').count(), 0);
  assert.equal(await page.locator('.almanac-crossing-time').count(), 0);
  assert.match(await page.locator('.almanac-sun .almanac-time-terrain').last().textContent(), /Unavailable/);
  assert.equal(await page.locator('.almanac-wrap > .coelum-panel-note').count(), 0);
  await page.waitForSelector('.almanac-moon-image[data-ready="true"]');
  assert.equal(await page.locator('.almanac-moon-image').evaluate(e => e.width >= 112 && e.height >= 112), true);
  const status = await page.locator('.coelum-status').textContent();
  assert.equal(await page.locator('[data-almanac-date]').evaluate(e => e.readOnly), true);
  await page.locator('[data-almanac-date]').click();
  const picker = page.locator('[data-almanac-wheels]');
  assert.equal(await picker.evaluate(e => e.open), true);
  assert.equal(await picker.locator('[data-date-wheel]').count(), 3);
  assert.equal(await picker.locator('[data-wheel-tab], [data-wheel-group="time"]').count(), 0);
  await page.screenshot({ path: '/private/tmp/coelum-almanac-picker.png' });
  await picker.locator('[data-date-wheel="day"]').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('[data-almanac-date]').inputValue(), '2026-11-08', 'Date changes apply when the picker closes');
  await page.keyboard.press('Escape');
  assert.equal(await picker.evaluate(e => e.open), false);
  assert.equal(await page.locator('[data-panel="almanac"]').isVisible(), true);
  assert.equal(await page.locator('[data-almanac-date]').inputValue(), '2026-11-09');
  assert.equal(await page.locator('.coelum-status').textContent(), status);
  await page.locator('[data-almanac-step="-1"]').click();
  await page.click('[data-almanac-step="1"]');
  assert.equal(await page.locator('[data-almanac-date]').inputValue(), '2026-11-09');
  await page.waitForSelector('[data-almanac-time]');
  assert.match(await page.locator('[data-almanac-highlights]').textContent(), /New Moon/);
  await page.click('[data-almanac-step="-1"]');
  assert.equal(await page.locator('[data-almanac-date]').inputValue(), '2026-11-08');
  await page.click('[data-almanac-step="-1"]');
  await page.click('[data-almanac-today]');
  assert.equal(await page.locator('[data-almanac-date]').inputValue(), '2026-11-08');
  assert.equal(await page.locator('.coelum-status').textContent(), status);
  for (const width of [320, 390, 900]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.locator('[data-panel="almanac"]').evaluate((e) => e.scrollWidth <= e.clientWidth), true);
    const dimensions = await page.locator('.almanac-nav').evaluate(nav => {
      const input = nav.querySelector('input').getBoundingClientRect();
      return [...nav.querySelectorAll('[data-almanac-step]')].every(button => { const r = button.getBoundingClientRect(); return r.width === r.height && r.height === input.height; });
    });
    assert.equal(dimensions, true, 'Day arrows are square and match the input height');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({path: '/private/tmp/coelum-almanac.png'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-panel="almanac"]').isVisible(), false);
  assert.equal(await page.locator('[data-action="almanac"]').evaluate((e) => e === document.activeElement), true);
  await page.click('[data-action="almanac"]');
  await page.locator('[data-almanac-date-mode]').click();
  await page.locator('[data-almanac-date]').fill('2026-08-12');
  await page.locator('[data-almanac-date]').dispatchEvent('change');
  await page.waitForSelector('[data-almanac-time]');
  assert.match(await page.locator('[data-almanac-highlights]').textContent(), /solar eclipse/);
  await page.locator('[data-almanac-time]').first().click();
  assert.equal(await page.locator('[data-panel="almanac"]').isVisible(), false);
  await page.click('[data-action="almanac"]');
  await page.click('[data-almanac-date-mode]');
  assert.equal(await page.locator('[data-almanac-date]').getAttribute('type'), 'text');
  await page.locator('[data-almanac-date]').fill('-0100-06-01');
  await page.locator('[data-almanac-date]').dispatchEvent('change');
  assert.equal(await page.locator('[data-almanac-date]').inputValue(), '-0100-06-01');
  await page.click('[data-almanac-date-mode]');
  assert.equal(await page.locator('[data-almanac-date]').getAttribute('type'), 'text');
  await page.locator('[data-almanac-date]').fill('2027-01-04');
  await page.locator('[data-almanac-date]').dispatchEvent('change');
  assert.match(await page.locator('.almanac-shower').textContent(), /Quadrantids · Peaks today/);
  assert.match(await page.locator('.almanac-shower').textContent(), /2027-01-04 · about 04:00/);
  await page.screenshot({ path: '/private/tmp/coelum-almanac-native.png', fullPage: true });
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForSelector('.almanac-planet');
  await page.screenshot({ path: '/private/tmp/coelum-almanac-desktop.png', fullPage: true });
  await context.close();
  const terrainProfile = { '45.4642,9.19,120': { alt: Array(3600).fill(10) } };
  const cached = await open({ 'imks.settings': { location: { lat: 45.4642, lon: 9.19, h: 120, name: 'Milan' } }, 'imks-coelum-terrain-profiles-v3': terrainProfile });
  await cached.page.click('[data-action="almanac"]');
  await cached.page.waitForSelector('.almanac-bar-terrain');
  assert.equal(await cached.page.locator('[data-almanac-terrain]').count(), 0);
  const labels = await cached.page.locator('.almanac-crossing-time').evaluateAll(elements => elements.map(e => ({ time: Number(e.dataset.crossingTime), text: e.textContent, kind: e.dataset.crossing })));
  assert.ok(labels.some(e => e.kind === 'rise') && labels.some(e => e.kind === 'set'));
  const { skyClock } = await import('../js/coelumtime.js');
  for (const label of labels) assert.equal(label.text, skyClock(Math.round(label.time / 60) * 60, 'Europe/Rome'));
  assert.equal(await cached.page.locator('.almanac-track-hint').count(), 0);
  assert.match(await cached.page.locator('.almanac-sun .almanac-time-terrain').last().textContent(), /\d{2}:\d{2}:\d{2}/);
  await cached.page.locator('.almanac-visibility').scrollIntoViewIfNeeded();
  await cached.page.screenshot({ path: '/private/tmp/coelum-almanac-labels.png' });
  const rowTop = await cached.page.locator('.almanac-planet').nth(5).evaluate(e => e.offsetTop);
  await cached.page.locator('.almanac-planet').nth(4).click();
  assert.equal(await cached.page.locator('.almanac-planet').nth(5).evaluate(e => e.offsetTop), rowTop);
  const bars = await cached.page.locator('[data-almanac-planet="jupiter"] .almanac-bar').evaluateAll(elements => elements.map(e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }));
  assert.ok(bars.length >= 2 && bars.every(center => Math.abs(center - bars[0]) < 0.1), 'Thin and thick bars share their centerline');
  assert.match(await cached.page.locator('[data-almanac-dialog] table').textContent(), /Local terrain/);
  await cached.page.locator('[data-almanac-dialog-close]').click();
  assert.equal(await cached.page.locator('[data-almanac-dialog]').evaluate(e => e.open), false);
  await cached.page.locator('.almanac-planet').nth(4).click();
  for (const width of [320, 390, 900]) {
    await cached.page.setViewportSize({ width, height: 844 });
    assert.equal(await cached.page.locator('[data-panel="almanac"]').evaluate(e => e.scrollWidth <= e.clientWidth), true);
    assert.equal(await cached.page.locator('[data-almanac-dialog]').evaluate(e => e.scrollWidth <= e.clientWidth), true);
    await cached.page.waitForFunction(() => [...document.querySelectorAll('.almanac-track')].every(track => {
      const bounds = track.getBoundingClientRect();
      const labels = [...track.querySelectorAll('.almanac-crossing-time')].map(e => e.getBoundingClientRect());
      return labels.every((a, i) => a.left >= bounds.left - 1 && a.right <= bounds.right + 1 && a.bottom <= bounds.bottom + 1 && labels.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    }));
  }
  await cached.page.setViewportSize({ width: 390, height: 844 });
  await cached.page.screenshot({ path: '/private/tmp/coelum-almanac-terrain.png', fullPage: true });
  await cached.page.locator('[data-almanac-dialog] [data-almanac-sky-time]').click();
  assert.equal(await cached.page.locator('[data-panel="almanac"]').isVisible(), false);
  assert.deepEqual(cached.errors, []);
  await cached.context.close();
  console.log('Almanac browser: navigation, today, independent sky time, highlights, responsive layout and event links passed');
} finally {
  await browser?.close();
  server.close();
}
