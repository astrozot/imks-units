// Playback must respond to pointer release while object details update.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let engine;
const engineName = process.env.BROWSER || 'chromium';
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { engine = (await import(name))[engineName]; break; } catch { /* try next */ }
}
if (!engine) throw new Error('Playwright is required');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await engine.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://celestrak.org/**', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  await page.waitForSelector('.coelum-full');
  await page.evaluate(async () => {
    document.querySelector('#coelum').remove();
    const root = document.createElement('main');
    root.id = 'coelum'; root.className = 'coelum-explorer'; document.body.append(root);
    const { mountCoelum } = await import('/js/coelumui.js');
    window.explorer = mountCoelum(root, {
      t: Date.parse('2026-11-06T21:00:00Z') / 1000, place: [45, 9, 120], label: 'Milan',
    }, (t) => new Date(t * 1000).toISOString(), { standalone: true });
  });
  const play = page.locator('[data-action="play"]');
  const pressed = () => play.getAttribute('aria-pressed');
  for (const body of ['Jupiter', 'Saturn', 'Moon', 'Vega']) {
    await page.evaluate((body) => explorer.select(body, { details: true }), body);
    await play.evaluate((el) => el.click());
    const box = await play.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(250);
    // Observe release before the browser dispatches its subsequent click.
    await play.evaluate((el) => el.addEventListener('pointerup', () => {
      window.pausedOnRelease = el.getAttribute('aria-pressed') === 'false';
    }, { once: true }));
    await page.mouse.up();
    assert.equal(await page.evaluate(() => pausedOnRelease), true, `${body}: Pause runs on release`);
    assert.equal(await pressed(), 'false', `${body}: synthesized click does not restart playback`);
    const stopped = await page.locator('.coelum-full').getAttribute('data-time');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.coelum-full').getAttribute('data-time'), stopped);
    // Touch and keyboard activation still toggle exactly once.
    await page.touchscreen.tap(x, y); assert.equal(await pressed(), 'true');
    await page.touchscreen.tap(x, y); assert.equal(await pressed(), 'false');
    await play.press('Space'); assert.equal(await pressed(), 'true');
    await play.press('Enter'); assert.equal(await pressed(), 'false');
    // A cancelled gesture must never toggle playback.
    await play.dispatchEvent('pointerdown', { pointerId: 9, isPrimary: true, button: 0, clientX: x, clientY: y });
    await play.dispatchEvent('pointercancel', { pointerId: 9 });
    await play.dispatchEvent('pointerup', { pointerId: 9 }); assert.equal(await pressed(), 'false');
  }
  // Holding Play while running still enters real time and consumes the click.
  await play.evaluate((el) => el.click());
  await play.evaluate(async (el) => {
    const pointer = (type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 10, isPrimary: true, button: 0 }));
    pointer('pointerdown'); await new Promise((r) => setTimeout(r, 900)); pointer('pointerup'); el.click();
  });
  assert.equal(await pressed(), 'true');
  assert.equal(await play.getAttribute('aria-label'), 'Pause real-time playback');
  await play.evaluate((el) => el.click()); assert.equal(await pressed(), 'false');
  const time = page.locator('.coelum-status-main [data-action="time"]');
  const location = page.locator('.coelum-status-main [data-action="place"]');
  const hold = async button => {
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
  };
  await page.evaluate(() => explorer.setTime(Date.parse('2020-01-01T00:00:00Z') / 1000));
  await hold(time);
  assert.equal(await pressed(), 'false', 'Holding the clock keeps paused playback paused');
  assert.ok(await page.evaluate(() => Math.abs(explorer.time - Date.now() / 1000) < 3));
  assert.equal(await page.locator('.coelum-timepanel').isVisible(), false, 'A hold does not also open Date and Time');
  await play.click(); await page.evaluate(() => explorer.setSpeed(600));
  await hold(time);
  assert.equal(await pressed(), 'true');
  assert.equal(await play.getAttribute('aria-label'), 'Pause real-time playback');
  assert.equal(await page.locator('[data-speed]').textContent(), '1×');
  assert.equal(await page.locator('.coelum-timepanel').isVisible(), false);
  await play.click();
  await time.click(); assert.equal(await page.locator('.coelum-timepanel').isVisible(), true);
  await page.locator('[aria-label="Close date and time"]').click();
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 40.123, longitude: 12.456 });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { elevation: [125] } }));
  await hold(location);
  await page.waitForFunction(() => explorer.place[0] === 40.123);
  assert.deepEqual(await page.evaluate(() => explorer.place), [40.123, 12.456, 125]);
  assert.equal(await page.locator('.coelum-placepanel').isVisible(), false, 'A location hold does not also open Place');
  await location.click(); assert.equal(await page.locator('.coelum-placepanel').isVisible(), true);
  await page.locator('[aria-label="Close place"]').click();
  // Cancellation must clear a pending bottom-bar hold.
  const before = await page.evaluate(() => explorer.time);
  await time.dispatchEvent('pointerdown', { pointerId: 12, isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  await time.dispatchEvent('pointercancel', { pointerId: 12 });
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => explorer.time), before);
  assert.deepEqual(errors, []);
  console.log(`${engineName}: Pause release, clock stop, synthesized click, touch, keyboard, cancellation and hold checks passed`);
} finally { await browser?.close(); server.close(); }
