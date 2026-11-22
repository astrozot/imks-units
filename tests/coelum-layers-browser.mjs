// Layer shortcut behavior and responsive alignment. Same PLAYWRIGHT/CHROME as browser.mjs.
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
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('https://celestrak.org/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await context.addInitScript(() => {
    localStorage.setItem('imks-coelum-mode', 'sky');
    localStorage.setItem('imks.coelumPlace', JSON.stringify({ lat: 45.89, lon: 10.84, h: 90, name: 'Riva' }));
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.waitForSelector('.coelum-full');
  const bar = page.locator('.coelum-layerbar'), rail = page.locator('[data-action="layers"]');
  const configure = page.locator('[data-action="configure-layers"]');
  const ground = page.locator('[data-toggle-layer="ground"]');
  const open = () => rail.click();
  await open();
  assert.ok(await bar.isVisible());
  assert.equal(await page.locator('.coelum-toolbar').isVisible(), false);
  assert.equal(await rail.getAttribute('aria-expanded'), 'true');
  assert.equal(await bar.locator('[data-toggle-layer]:visible').count(), 13);
  const geometry = () => page.evaluate(() => {
    const bar = document.querySelector('.coelum-layerbar').getBoundingClientRect();
    const anchor = document.querySelector('[data-action="layers"]').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('[data-toggle-layer]')].filter(b => b.getClientRects().length);
    return { left: bar.left, right: bar.right, anchorLeft: anchor.left, delta: Math.abs(bar.y + bar.height / 2 - anchor.y - anchor.height / 2), rows: new Set(buttons.map(b => Math.round(b.getBoundingClientRect().y))).size,
      scroll: document.querySelector('.coelum-layer-toggles').scrollWidth > document.querySelector('.coelum-layer-toggles').clientWidth };
  });
  let g = await geometry();
  assert.ok(g.left >= 8 && g.right < g.anchorLeft && g.delta < 1 && g.rows === 1 && !g.scroll, JSON.stringify(g));
  for (const key of ['milkyway', 'constellations', 'boundaries', 'ecliptic', 'horizontal', 'equatorial', 'galactic', 'deep', 'minor', 'satellites', 'labels', 'atmosphere']) {
    const button = page.locator(`[data-toggle-layer="${key}"]`), checkbox = page.locator(`[data-layer="${key}"]`);
    const before = await checkbox.isChecked();
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), String(!before), key);
    assert.equal(await checkbox.isChecked(), !before, key);
    assert.ok(await bar.isVisible(), 'Toggling leaves the bar open');
    await button.click();
  }
  // Flat -> off -> terrain; click again while downloading to cancel into flat.
  assert.match(await ground.getAttribute('aria-label'), /Ground: Flat/);
  await ground.click();
  assert.equal(await ground.getAttribute('aria-pressed'), 'false');
  const flatIcon = await ground.innerHTML();
  await context.route('https://tiles.mapterhorn.com/**', () => {});
  await ground.click();
  assert.match(await ground.getAttribute('aria-label'), /Ground: Local terrain/);
  assert.equal(await ground.getAttribute('aria-busy'), 'true');
  assert.notEqual(await ground.innerHTML(), flatIcon);
  await ground.click();
  assert.match(await ground.getAttribute('aria-label'), /Ground: Flat/);
  assert.equal(await ground.getAttribute('aria-busy'), 'false');
  assert.equal(await ground.getAttribute('aria-pressed'), 'true');
  await ground.click();
  await configure.click();
  assert.equal(await bar.isVisible(), false);
  assert.ok(await page.locator('.coelum-toolbar').isVisible());
  assert.equal(await page.locator('[data-layer="ground"]').isChecked(), false);
  await page.locator('[data-layer="ground"]').check();
  await page.locator('[data-layer="constellations"]').uncheck();
  await page.keyboard.press('Escape');
  await open();
  assert.equal(await ground.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-toggle-layer="constellations"]').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  assert.ok(await rail.evaluate(b => b === document.activeElement));
  await page.locator('[data-view="chart"]').click();
  await open();
  assert.equal(await bar.locator('[data-toggle-layer="atmosphere"]').isVisible(), false);
  assert.equal(await ground.getAttribute('aria-pressed'), 'true', 'Ground is shared across views');
  await rail.click();
  assert.equal(await bar.isVisible(), false);
  await page.locator('[data-view="sky"]').click();
  await open();
  for (const width of [390, 320, 900]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(100);
    g = await geometry();
    assert.ok(g.left >= 7 && g.right < g.anchorLeft && g.delta < 1 && g.rows === 1, JSON.stringify(g));
    assert.equal(g.scroll, width < 900);
    assert.ok(await configure.isVisible());
    await configure.click();
    await page.keyboard.press('Escape');
    await open();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: '/tmp/coelum-layerbar-desktop.png' });
  await bar.screenshot({ path: '/tmp/coelum-layerbar.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: '/tmp/coelum-layerbar-phone.png' });
  // An outside gesture dismisses without selecting the sky behind it.
  await page.locator('.coelum-full').click({ position: { x: 100, y: 100 } });
  assert.equal(await bar.isVisible(), false);
  await open();
  const strip = page.locator('.coelum-layer-toggles');
  await strip.evaluate(el => { el.scrollLeft = 0; });
  const stripBox = await strip.boundingBox();
  const cdp = await context.newCDPSession(page), y = stripBox.y + stripBox.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stripBox.x + stripBox.width - 20, y }] });
  for (let dx = 30; dx < 180; dx += 15) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stripBox.x + stripBox.width - 20 - dx, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.querySelector('.coelum-layer-toggles').scrollLeft > 0);
  assert.ok(await configure.isVisible(), 'Configure stays available after swiping');
  assert.deepEqual(errors, []);
  await context.close();
  // The same shortcut also fits an embedded calculator chart.
  const embedded = await browser.newPage({ viewport: { width: 800, height: 900 }, serviceWorkers: 'block' });
  await embedded.route('https://celestrak.org/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await embedded.goto(url.replace(/coelum\/$/, ''));
  await embedded.locator('#expr').click();
  await embedded.keyboard.type('coelum(2026.11.06 21:00 Z, "Rome")');
  await embedded.locator('#expr').press('Enter');
  await embedded.locator('.coelum-preview').click();
  await embedded.locator('[data-action="layers"]').click();
  const embeddedBox = await embedded.locator('.coelum-layerbar').boundingBox();
  assert.ok(embeddedBox.x >= 0 && embeddedBox.x + embeddedBox.width <= 800);
  assert.equal(await embedded.locator('.coelum-rail').evaluate(el => getComputedStyle(el).flexDirection), 'row');
  const checkCover = async () => {
    const barBox = await embedded.locator('.coelum-layerbar').boundingBox();
    const clip = { x: barBox.x + 8, y: barBox.y + 8, width: barBox.width - 16, height: barBox.height - 16 };
    const normal = await embedded.screenshot({ clip, animations: 'disabled' });
    const underneath = embedded.locator('.coelum-rail button:not([data-action="layers"])');
    await underneath.evaluateAll(buttons => buttons.forEach(button => { button.style.visibility = 'hidden'; }));
    const hidden = await embedded.screenshot({ clip, animations: 'disabled' });
    assert.deepEqual(normal, hidden, 'The layer bar completely conceals the horizontal rail underneath');
    await underneath.evaluateAll(buttons => buttons.forEach(button => { button.style.visibility = ''; }));
  };
  for (const width of [800, 640, 390]) {
    await embedded.setViewportSize({ width, height: 900 });
    await embedded.waitForTimeout(100);
    await checkCover();
  }
  await embedded.screenshot({ path: '/tmp/coelum-layerbar-horizontal.png' });
  await embedded.close();
  console.log('Layer shortcuts passed: toggles, configure sync, ground cycle and cancellation, view changes, keyboard dismissal, desktop/phone alignment, embedded chart.');
} finally { await browser?.close(); server.close(); }
