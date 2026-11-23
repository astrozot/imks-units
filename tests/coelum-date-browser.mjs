import { setTimeMode, setLocalTimezone } from './timezone-controls.mjs';
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
    const touchSession = browserType.name() === 'chromium' ? await context.newCDPSession(page) : null;
    await page.goto(url); await page.waitForSelector('.coelum-full');
    await page.click('[data-action="time"]');
    const input = page.locator('[data-time-input]'), picker = page.locator('[data-time-wheels]'), toggle = page.locator('[data-time-date-mode]');
    const wheel = name => page.locator(`[data-date-wheel="${name}"]`);
    const selected = name => wheel(name).locator('[aria-selected="true"]').textContent();
    const scrollTo = async (name, value, min = 0) => {
      await wheel(name).evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')); }, (value - min) * 32);
    };
    await setTimeMode(page, 'utc');
    assert.equal(await input.inputValue(), '2026-11-22 12:34:56');
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.locator('[data-set-time="original"]').count(), 0);
      assert.doesNotMatch(await page.locator('.coelum-events').innerText(), /Not on this day/);
      const eventTime = await page.locator('[data-time-event] time').first().innerText();
      assert.match(eventTime, width === 320 ? /^\d{2}:\d{2}$/ : /^\d{2}:\d{2}:\d{2}$/);
      const heading = page.locator('.coelum-events-head');
      assert.equal(await heading.textContent(), 'Events of the day');
      await page.click('[data-time-step="86400"]');
      assert.equal(await heading.textContent(), 'Events of 2026-11-23');
      await page.click('[data-time-step="-86400"]');
      assert.equal(await heading.textContent(), 'Events of 2026-11-22');
      const swipe = async (dx, dy = 0) => {
        const box = await page.locator('.coelum-events').boundingBox();
        const x = box.x + box.width / 2, y = box.y + 16;
        if (touchSession) {
          await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let i = 1; i <= 8; i++) await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] });
          await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(x, y); await page.mouse.down();
          await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
        }
      };
      await swipe(-70);
      assert.equal(await heading.textContent(), 'Events of 2026-11-23');
      assert.equal(await input.inputValue(), '2026-11-23 12:34:56', 'Swipe does not also select an event');
      await swipe(70);
      assert.equal(await input.inputValue(), '2026-11-22 12:34:56');
      await swipe(5, 45);
      assert.equal(await input.inputValue(), '2026-11-22 12:34:56', 'Vertical gestures do not change the day');
      const layout = await heading.evaluate(el => {
        const text = el.getBoundingClientRect(), panel = el.closest('.coelum-timepanel').getBoundingClientRect();
        const arrows = [...el.parentElement.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        return { centered: Math.abs(text.x + text.width / 2 - panel.x - panel.width / 2) < 1, fits: el.scrollWidth <= el.clientWidth, compact: arrows.every(box => box.height <= parseFloat(getComputedStyle(el).lineHeight) && box.width <= box.height) };
      });
      assert.ok(layout.centered && layout.fits && layout.compact, JSON.stringify({ width, ...layout }));
      if (locale === 'en-US' && width === 390) await page.screenshot({ path: '/private/tmp/coelum-events-heading.png' });
      await page.click('[data-set-time="now"]');
      assert.equal(await heading.textContent(), 'Events of the day');
      const before = await input.boundingBox(), button = await toggle.boundingBox(), now = await page.locator('[data-set-time="now"]').boundingBox();
      assert.ok(now.x >= before.x + before.width && Math.abs(now.y + now.height / 2 - before.y - before.height / 2) < 1, 'Now stays beside the input at ' + width);
      assert.ok(button.x > before.x && button.x + button.width <= before.x + before.width);
      assert.equal(button.width, button.height);
      const instant = await page.locator('.coelum-full').getAttribute('data-time');
      const icon = await toggle.innerHTML();
      await toggle.click();
      assert.equal(await input.evaluate(el => el === document.activeElement), true);
      assert.equal(await input.evaluate(el => el.readOnly), false);
      assert.equal(await toggle.innerHTML(), icon);
      await toggle.click();
      assert.equal(await input.evaluate(el => el.readOnly), false, 'Keyboard button always enters editing');
      assert.deepEqual(await input.boundingBox(), before);
      await input.fill('-1000-11-22 12:34:56');
      assert.ok(await input.evaluate(el => el.scrollWidth <= el.clientWidth), 'Signed date fits beside Now at ' + width);
      await input.press('Escape');
      await toggle.click();
      await input.press('Enter');
      assert.equal(await input.evaluate(el => el.readOnly), true);
      await input.click();
      assert.equal(await picker.isVisible(), true);
      assert.equal(await picker.evaluate(el => el.matches('dialog:modal')), true);
      assert.equal(await picker.evaluate(el => !!el.closest('.coelum-timepanel')), false);
      assert.deepEqual(await input.boundingBox(), before);
      assert.equal(await selected('year'), '2026');
      assert.equal(await page.locator('[data-wheel-close]').getAttribute('aria-label'), 'Close');
      assert.equal(await page.locator('[data-wheel-done]').count(), 0);
      const titleBox = await picker.locator('h3').boundingBox(), closeBox = await page.locator('[data-wheel-close]').boundingBox();
      assert.ok(closeBox.x > titleBox.x + titleBox.width && Math.abs(closeBox.y + closeBox.height / 2 - titleBox.y - titleBox.height / 2) < 1, 'Close sits beside the title');
      assert.equal(await wheel('year').evaluate(el => el.clientHeight), 7 * 32);
      assert.equal(await page.locator('[data-wheel-close] svg').count(), 1);
      await page.click('[data-wheel-close]');
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
      await page.click('[data-wheel-close]'); await input.click();
    }
    await page.click('[data-wheel-tab="time"]');
    const minuteLabel = picker.locator('.coelum-wheel-label', { hasText: 'Minute' });
    const labelBox = await minuteLabel.boundingBox();
    await page.mouse.move(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2 - 32, { steps: 8 });
    await page.mouse.up();
    assert.equal(await selected('minute'), '35', 'Dragging the heading advances the wheel');
    assert.match(await input.inputValue(), /12:34:56$/, 'The underlying field waits until close');
    if (browserType.name() === 'chromium') {
      const session = await context.newCDPSession(page);
      const x = labelBox.x + labelBox.width / 2, y = labelBox.y + labelBox.height / 2;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 8; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 4 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => document.querySelector('[data-date-wheel="minute"] [aria-selected="true"]').textContent === '36');
      await session.detach();
    }
    await scrollTo('minute', 34);
    await page.click('[data-wheel-tab="date"]');
    const monthBox = await wheel('month').boundingBox();
    await page.mouse.move(monthBox.x + monthBox.width / 2, monthBox.y + 96);
    await page.mouse.down(); await page.mouse.move(monthBox.x + monthBox.width / 2, monthBox.y + 64, { steps: 8 }); await page.mouse.up();
    assert.equal(await selected('month'), '12', 'Mouse drag advances the wheel');
    await page.click('[data-wheel-close]'); await input.click();
    const underlyingTime = await input.inputValue(), underlyingSkyTime = await page.locator('.coelum-full').getAttribute('data-time');
    await page.evaluate(() => {
      window.dateWheelEventMutations = 0;
      window.dateWheelEventObserver = new MutationObserver(records => { window.dateWheelEventMutations += records.length; });
      window.dateWheelEventObserver.observe(document.querySelector('.coelum-events'), { childList: true, subtree: true, characterData: true });
    });
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
    assert.equal(await input.inputValue(), underlyingTime, 'Wheel edits defer the underlying field update');
    assert.equal(await page.locator('.coelum-full').getAttribute('data-time'), underlyingSkyTime, 'Wheel edits defer the sky update');
    assert.equal(await page.evaluate(() => {
      const count = window.dateWheelEventMutations + window.dateWheelEventObserver.takeRecords().length;
      return count;
    }), 0, 'Daily events are not rebuilt while scrolling');
    assert.equal(await picker.isVisible(), true, 'Editing keeps the picker open');
    await page.click('[data-wheel-close]');
    assert.equal(await input.inputValue(), '0000-02-29 12:34:57');
    assert.equal(await picker.isVisible(), false);
    assert.notEqual(await page.locator('.coelum-full').getAttribute('data-time'), underlyingSkyTime, 'Closing updates the sky');
    assert.ok(await page.evaluate(() => {
      const count = window.dateWheelEventMutations + window.dateWheelEventObserver.takeRecords().length;
      window.dateWheelEventObserver.disconnect();
      return count > 0;
    }), 'Closing rebuilds daily events for the selected date');
    await input.click();
    assert.equal(await selected('year'), '0000', 'Reopening preserves signed years');
    await wheel('year').press('ArrowUp');
    await page.keyboard.press('Escape');
    assert.equal(await input.inputValue(), '-0001-02-28 12:34:57', 'Escape retains changes');
    assert.equal(await picker.isVisible(), false);
    assert.equal(await page.locator('.coelum-timepanel').isVisible(), true);
    await toggle.click();
    await input.fill('2026-03-08 06:30:45'); await input.dispatchEvent('change');
    await setTimeMode(page, 'location');
    await setLocalTimezone(page, 'America/New_York');
    await input.click();
    await page.click('[data-wheel-tab="time"]');
    await wheel('hour').press('ArrowDown');
    assert.equal(await picker.isVisible(), true, 'DST gap rejected');
    assert.equal(await input.inputValue(), '2026-03-08 01:30:45', 'Invalid DST edits leave the applied time unchanged');
    assert.match(await page.locator('.coelum-wheel-error').textContent(), /Daylight-saving/);
    await page.click('[data-wheel-close]');
    assert.equal(await input.inputValue(), '2026-03-08 01:30:45', 'Closing an invalid selection keeps the last valid time');
    await setTimeMode(page, 'utc');
    await input.click();
    await wheel('year').press('Home');
    assert.equal(await selected('year'), '−1000');
    await page.screenshot({ path: `/private/tmp/coelum-date-wheels-${locale}.png` });
    await page.click('[data-wheel-close]');
    assert.match(await input.inputValue(), /^-1000-/);
    await toggle.click();
    await input.fill('2026-02-30 12:34:59'); await input.dispatchEvent('change');
    assert.equal(await input.evaluate(el => el.checkValidity()), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Date wheels passed: fixed field size, signed/leap years, deferred updates/close, keyboard, seconds, DST, and locales');
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
