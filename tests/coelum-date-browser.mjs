// Date panel formatting, mode switching, and second precision:
// node tests/coelum-date-browser.mjs. PLAYWRIGHT/CHROME as browser.mjs;
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
  const executable = process.env.BROWSER_EXECUTABLE || (process.env.BROWSER !== 'webkit' && process.env.CHROME);
  browser = await browserType.launch(executable ? { executablePath: executable } : {});
  for (const locale of ['en-US', 'de-DE']) {
    const context = await browser.newContext({ locale, timezoneId: 'Europe/Rome', serviceWorkers: 'block', hasTouch: true, isMobile: true });
    await context.clock.setFixedTime(new Date('2026-11-22T12:34:56Z'));
    await context.route('https://celestrak.org/**', route => route.fulfill({ json: [] }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await page.waitForSelector('.coelum-full');
    await page.click('[data-action="time"]');
    const input = page.locator('[data-time-input]'), picker = page.locator('[data-time-wheels]'), toggle = page.locator('[data-time-date-mode]');
    const wheel = name => page.locator(`[data-date-wheel="${name}"]`);
    const selected = name => wheel(name).locator('[aria-selected="true"]').textContent();
    const scrollTo = async (name, value, min = 0) => {
      await wheel(name).evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')); }, (value - min) * 32);
    };
    await page.selectOption('[data-time-zone]', 'utc');
    assert.equal(await input.inputValue(), '2026-11-22 12:34:56');
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const before = await input.boundingBox(), button = await toggle.boundingBox();
      assert.ok(button.x > before.x && button.x + button.width <= before.x + before.width);
      assert.equal(button.width, button.height);
      const instant = await page.locator('.coelum-full').getAttribute('data-time');
      await toggle.click();
      assert.equal(await input.evaluate(el => el.readOnly), false);
      assert.deepEqual(await input.boundingBox(), before);
      await toggle.click();
      assert.equal(await input.evaluate(el => el.readOnly), true);
      assert.equal(await picker.isVisible(), true);
      assert.deepEqual(await input.boundingBox(), before);
      assert.equal(await selected('year'), '2026');
      await page.click('[data-wheel-cancel]');
      assert.equal(await page.locator('.coelum-full').getAttribute('data-time'), instant);
      assert.ok(await input.evaluate(el => el.scrollWidth <= el.clientWidth), 'Full date fits at ' + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await input.click();
    if (browserType.name() === 'chromium') {
      const session = await context.newCDPSession(page), box = await wheel('year').boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2 + 32;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 8; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 8 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => document.querySelector('[data-date-wheel="year"] [aria-selected="true"]').textContent !== '2026');
      await session.detach();
      await page.click('[data-wheel-cancel]'); await input.click();
    }
    const monthBox = await wheel('month').boundingBox();
    await page.mouse.move(monthBox.x + monthBox.width / 2, monthBox.y + 96);
    await page.mouse.down(); await page.mouse.move(monthBox.x + monthBox.width / 2, monthBox.y + 64, { steps: 8 }); await page.mouse.up();
    assert.equal(await selected('month'), '12', 'Mouse drag advances the wheel');
    await page.click('[data-wheel-cancel]'); await input.click();
    await scrollTo('year', 0, -1000);
    await scrollTo('month', 2, 1);
    await scrollTo('day', 29, 1);
    assert.equal(await selected('year'), '0000');
    assert.equal(await selected('day'), '29', 'Astronomical year zero is a leap year');
    await wheel('year').press('ArrowUp');
    assert.equal(await selected('year'), '−0001');
    assert.equal(await selected('day'), '28', 'Changing the year clamps leap day');
    await wheel('year').press('ArrowDown');
    await scrollTo('day', 29, 1);
    await page.click('[data-wheel-tab="time"]');
    await wheel('second').press('ArrowDown');
    assert.equal(await selected('second'), '57');
    assert.equal(await input.inputValue(), '2026-11-22 12:34:56', 'Wheel edits remain a draft');
    await page.click('[data-wheel-done]');
    assert.equal(await input.inputValue(), '0000-02-29 12:34:57');
    assert.equal(await picker.isVisible(), false);
    await input.click();
    assert.equal(await selected('year'), '0000', 'Reopening preserves signed years');
    await wheel('year').press('ArrowUp');
    await page.keyboard.press('Escape');
    assert.equal(await input.inputValue(), '0000-02-29 12:34:57');
    assert.equal(await picker.isVisible(), false);
    assert.equal(await page.locator('.coelum-timepanel').isVisible(), true);
    await toggle.click();
    await input.fill('2026-03-08 06:30:45'); await input.dispatchEvent('change');
    await page.selectOption('[data-time-zone]', 'location');
    await page.fill('[data-place-zone]', 'America/New_York'); await page.locator('[data-place-zone]').dispatchEvent('change');
    await toggle.click();
    await page.click('[data-wheel-tab="time"]');
    await wheel('hour').press('ArrowDown');
    await page.click('[data-wheel-done]');
    assert.equal(await picker.isVisible(), true, 'DST gap rejected');
    assert.match(await page.locator('.coelum-wheel-error').textContent(), /Daylight-saving/);
    await page.click('[data-wheel-cancel]');
    await page.selectOption('[data-time-zone]', 'utc');
    await input.click();
    await wheel('year').press('Home');
    assert.equal(await selected('year'), '−1000');
    await page.screenshot({ path: `/private/tmp/coelum-date-wheels-${locale}.png` });
    await page.click('[data-wheel-done]');
    assert.match(await input.inputValue(), /^-1000-/);
    await toggle.click();
    await input.fill('2026-02-30 12:34:59'); await input.dispatchEvent('change');
    assert.equal(await input.evaluate(el => el.checkValidity()), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Date wheels passed: fixed field size, signed/leap years, draft/apply/cancel, keyboard, seconds, DST, and locales');
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
