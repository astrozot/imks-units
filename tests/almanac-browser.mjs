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
  const status = await page.locator('.coelum-status').textContent();
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
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({path: '/private/tmp/coelum-almanac.png'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-panel="almanac"]').isVisible(), false);
  assert.equal(await page.locator('[data-action="almanac"]').evaluate((e) => e === document.activeElement), true);
  await page.click('[data-action="almanac"]');
  await page.locator('[data-almanac-date]').fill('2026-08-12');
  await page.locator('[data-almanac-date]').press('Enter');
  await page.locator('[data-almanac-date]').blur();
  await page.waitForSelector('[data-almanac-time]');
  assert.match(await page.locator('[data-almanac-highlights]').textContent(), /solar eclipse/);
  await page.locator('[data-almanac-time]').first().click();
  assert.equal(await page.locator('[data-panel="almanac"]').isVisible(), false);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Almanac browser: navigation, today, independent sky time, highlights, responsive layout and event links passed');
} finally {
  await browser?.close();
  server.close();
}
