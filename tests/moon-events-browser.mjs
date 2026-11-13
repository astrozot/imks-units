// Phone UI and offline checks for finite-contact moon events.
// Same PLAYWRIGHT/CHROME environment options as tests/browser.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* next */ }
}
if (!chromium) throw new Error('Install playwright-core or set PLAYWRIGHT to run browser validation');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)];
  res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Rome' });
  await context.clock.setFixedTime(new Date('2026-11-08T12:00:00Z'));
  await context.route('https://celestrak.org/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await context.addInitScript(() => localStorage.setItem('imks.settings', JSON.stringify({ location: { lat: 45.4642, lon: 9.19, h: 120, name: 'Milan' } })));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  await page.waitForSelector('.coelum-full');
  const open = async () => {
    await page.fill('.coelum-search input', 'Jupiter'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.coelum-detail-body h3')?.textContent === 'Jupiter');
    // Search centers the object; an actual tap opens its detail card.
    const reticle = page.locator('.coelum-full circle[stroke="#ffcf5a"]');
    await reticle.waitFor({ state: 'visible' });
    const box = await reticle.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.coelum-moons-button').click();
    await page.click('[data-action="moon-events"]');
    await page.waitForSelector('[data-moon-events-more]');
  };
  await open();
  assert.match(await page.locator('.coelum-moon-events').textContent(), /First to last contact.*penumbra/);
  const expected = await page.evaluate(async () => {
    const { planetMoonEvents } = await import('/js/mooneventspanel.js');
    return planetMoonEvents('jupiter', Number(document.querySelector('.coelum-full').dataset.time));
  });
  assert.equal(await page.locator('[data-moon-event]').count(), expected.length);
  assert.ok(expected.some((e) => e.contacts.C2 !== null));
  assert.match(await page.locator('[data-moon-event]').allTextContents().then((s) => s.join('\n')), /Total eclipse|Fully on disk|Fully hidden|Umbra fully on disk/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'Contacts fit a phone viewport');
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  await page.locator('[data-moon-event]').first().click();
  assert.equal(await page.locator('.coelum-moonsview').isVisible(), true);
  assert.ok(Math.abs(Number(await page.locator('.coelum-full').getAttribute('data-time')) - expected[0].t) < 1);
  await page.click('[data-action="moon-events"]'); await page.waitForSelector('[data-moon-events-more]');
  assert.match(await page.locator('[data-moon-event] small').first().textContent(), /Already in progress/);
  await page.click('[data-moon-events-more]'); await page.waitForSelector('[data-moon-events-more]');
  const rows = await page.locator('[data-moon-event]').allTextContents();
  assert.equal(new Set(rows).size, rows.length, 'No duplicated events on pagination');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  assert.equal(await page.evaluate(async () => Boolean(await caches.match('/js/moongeometry.js'))), true);
  assert.equal(await page.evaluate(async () => Boolean(await caches.match('/js/moonposition.js'))), true);
  await context.setOffline(true); await page.reload(); await page.waitForSelector('.coelum-full');
  await open();
  assert.ok(await page.locator('[data-moon-event]').count() > 0, 'Contacts work offline');
  assert.deepEqual(errors, []);
  console.log('Moon events browser: phone layout, finite contacts, full phases, selection, ongoing events, pagination and offline cache passed');
} finally {
  await browser?.close(); server.close();
}
