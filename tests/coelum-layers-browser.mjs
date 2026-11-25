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
  const leftArrow = page.locator('[data-scroll-layers="-1"]'), rightArrow = page.locator('[data-scroll-layers="1"]');
  const open = () => rail.click();
  // Holding Layers opens settings directly; release must leave them open.
  const anchor = await rail.boundingBox();
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
  await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
  assert.ok(await page.locator('.coelum-toolbar').isVisible());
  assert.equal(await bar.isVisible(), false);
  await page.keyboard.press('Escape');
  // Moving away cancels a pending hold.
  await page.mouse.down(); await page.mouse.move(anchor.x - 30, anchor.y - 30);
  await page.waitForTimeout(900); await page.mouse.up();
  assert.equal(await page.locator('.coelum-toolbar').isVisible(), false);
  await open();
  assert.ok(await bar.isVisible());
  assert.equal(await page.locator('.coelum-toolbar').isVisible(), false);
  assert.equal(await rail.getAttribute('aria-expanded'), 'true');
  assert.equal(await leftArrow.isVisible(), false);
  assert.equal(await rightArrow.isVisible(), false);
  assert.ok(await configure.evaluate(el => el.parentElement.classList.contains('coelum-layer-toggles')));
  assert.equal(await bar.locator('[data-toggle-layer]:visible').count(), 14);
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
  const peaks = page.locator('[data-toggle-layer="peakNames"]'), peakChoice = page.locator('select[data-peak-display]');
  assert.equal(await peaks.getAttribute('data-peak-display'), 'labels');
  assert.ok(await peaks.locator('svg text').count(), 'Label icon uses tiny text without a box');
  const peakIcons = new Set();
  for (const state of ['positions', 'off', 'labels']) {
    await peaks.click();
    assert.equal(await peaks.getAttribute('data-peak-display'), state);
    assert.equal(await peaks.locator('svg circle').count(), state === 'off' ? 0 : 1, 'Both enabled states show the summit dot');
    assert.equal(await peaks.locator('svg text').count(), state === 'labels' ? 1 : 0, 'Only the labels state shows summit text');
    assert.equal(await peakChoice.inputValue(), state);
    assert.equal(await peaks.getAttribute('aria-pressed'), String(state !== 'off'));
    peakIcons.add(await peaks.innerHTML());
    assert.ok(await peaks.evaluate(el => el.classList.contains('coelum-peaks-muted')), 'Peaks are grey without local terrain');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imks-coelum-terrain-appearance-v3')));
    assert.equal(saved.peakNames, state !== 'off');
    assert.equal(saved.peakLabels, state === 'labels');
  }
  assert.equal(peakIcons.size, 3, 'Each peak display state has its own mountain icon');
  // Flat -> off -> terrain; click again while downloading to cancel into flat.
  assert.match(await ground.getAttribute('aria-label'), /Ground: Flat/);
  await ground.click();
  assert.equal(await ground.getAttribute('aria-pressed'), 'false');
  const flatIcon = await ground.innerHTML();
  await context.route('https://tiles.mapterhorn.com/**', () => {});
  await ground.click();
  assert.match(await ground.getAttribute('aria-label'), /Ground: Local terrain/);
  assert.equal(await ground.getAttribute('aria-busy'), 'true');
  assert.equal(await ground.getAttribute('data-terrain-phase'), 'download');
  assert.equal(await ground.locator('svg').evaluate(el => getComputedStyle(el).animationDuration), '1.8s');
  assert.notEqual(await ground.innerHTML(), flatIcon);
  await ground.click();
  assert.match(await ground.getAttribute('aria-label'), /Ground: Flat/);
  assert.equal(await ground.getAttribute('aria-busy'), 'false');
  assert.equal(await ground.getAttribute('data-terrain-phase'), '');
  assert.equal(await ground.getAttribute('aria-pressed'), 'true');
  await ground.click();
  await configure.click();
  assert.equal(await bar.isVisible(), false);
  assert.ok(await page.locator('.coelum-toolbar').isVisible());
  await page.locator('[data-settings-section="peakNames"] > summary').click();
  await peakChoice.selectOption('positions');
  assert.equal(await peaks.getAttribute('data-peak-display'), 'positions', 'Settings synchronize the shortcut');
  await peakChoice.selectOption('labels');
  assert.equal(await page.locator('[data-layer="ground"]').isChecked(), false);
  await page.locator('[data-settings-section="ground"] > summary').click();
  await page.locator('[data-settings-section="constellations"] > summary').click();
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
  // Topic holds open one modal, retain settings, and consume their release tap.
  const topicDialog = page.locator('.coelum-topic-dialog');
  for (const key of ['ground', 'atmosphere', 'milkyway', 'ecliptic', 'horizontal', 'equatorial', 'galactic', 'deep', 'satellites', 'labels', 'peakNames']) {
    const button = page.locator(`[data-toggle-layer="${key}"]`);
    const previous = await button.getAttribute('aria-pressed');
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
    assert.ok(await topicDialog.isVisible(), `${key} hold opens its topic`);
    assert.equal(await button.getAttribute('aria-pressed'), previous, 'Holding must not toggle visibility');
    assert.equal(await topicDialog.locator('.coelum-settings-content').count(), 1);
    assert.equal(await topicDialog.locator('.coelum-layer-visibility:visible').count(), 0, 'Layer visibility belongs in Configuration, not topic dialogs');
    if (key === 'ecliptic') {
      assert.equal(await topicDialog.locator('[data-layer-color]').count(), 7);
      await topicDialog.locator('[data-layer-color][aria-label="Red"]').check();
    }
    if (key === 'labels') {
      await topicDialog.locator('[data-label-kind="stars"]').uncheck();
      await topicDialog.locator('[data-label-size]').selectOption('17');
    }
    await page.keyboard.press('Escape');
    assert.equal(await topicDialog.isVisible(), false);
    assert.equal(await topicDialog.locator('.coelum-settings-content').count(), 0);
    await open();
  }
  await configure.click();
  await page.locator('[data-settings-section="ecliptic"] > summary').click();
  assert.ok(await page.locator('[data-layer-color="ecliptic"][aria-label="Red"]').isChecked());
  assert.ok(await page.locator('[data-layer="ecliptic"]').isVisible(), 'Configuration retains layer visibility controls');
  await page.locator('[data-settings-section="labels"] > summary').click();
  assert.equal(await page.locator('[data-label-kind="stars"]').isChecked(), false);
  assert.equal(await page.locator('[data-label-size]').inputValue(), '17');
  await page.keyboard.press('Escape');
  await open();
  for (const width of [390, 375, 320, 900]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(100);
    g = await geometry();
    assert.ok(g.left >= 7 && g.right < g.anchorLeft && g.delta < 1 && g.rows === 1, JSON.stringify(g));
    assert.equal(g.scroll, width < 900);
    if (g.scroll) {
      const scroller = page.locator('.coelum-layer-toggles');
      await scroller.evaluate(el => { el.scrollLeft = 0; });
      await page.waitForFunction(() => !document.querySelector('[data-scroll-layers="1"]').disabled && document.querySelector('[data-scroll-layers="-1"]').disabled);
      assert.ok(await rightArrow.isVisible());
      assert.equal(await leftArrow.isVisible(), false);
      const groundBox = await ground.boundingBox(), rowBox = await bar.boundingBox();
      assert.ok(Math.abs(groundBox.x - rowBox.x - 6) < 1, 'Ground starts at the left padding with no arrow gap');
      const gearBefore = await configure.boundingBox(), viewport = await scroller.boundingBox();
      assert.ok(gearBefore.x >= viewport.x + viewport.width, 'Configure scrolls offscreen with the other buttons');
      let lastOpacity = 0;
      for (const distance of [9, 18, 36]) {
        await scroller.evaluate((el, left) => el.scrollTo({ left, behavior: 'instant' }), distance);
        await page.waitForTimeout(220);
        const currentGround = await ground.boundingBox(), currentStrip = await scroller.boundingBox();
        assert.ok(Math.abs(currentGround.x + distance - groundBox.x) < 1, 'An appearing arrow never pushes the icons');
        assert.equal(currentStrip.width, viewport.width, 'Arrows never change the scrolling viewport');
        const opacity = await leftArrow.evaluate(el => Number(getComputedStyle(el).opacity));
        assert.ok(opacity > lastOpacity, 'The left hint progressively fades in with scrolling');
        lastOpacity = opacity;
      }
      assert.equal(lastOpacity, 1, 'The overlay becomes fully opaque after one button width');
      for (const [arrow, edge] of [[leftArrow, 'left'], [rightArrow, 'right']]) {
        const bounds = await arrow.boundingBox(), container = await bar.boundingBox();
        const style = await arrow.evaluate(el => {
          const s = getComputedStyle(el);
          return { background: s.backgroundImage, border: s.borderTopWidth, shadow: s.boxShadow, radius: s.borderTopLeftRadius, width: s.width };
        });
        assert.deepEqual(style, { background: 'none', border: '0px', shadow: 'none', radius: '0px', width: '26px' }, 'Uniform backgrounds without button outlines');
        assert.ok(Math.abs(edge === 'left' ? bounds.x - container.x : bounds.x + bounds.width - container.x - container.width) <= 1, 'The overlay reaches the extreme edge');
        assert.ok(Math.abs(bounds.y - container.y) <= 1 && Math.abs(bounds.height - container.height) <= 2, 'The overlay covers the entire bar height');
      }
      if (width === 390) await bar.screenshot({ path: '/tmp/coelum-layerbar-overlay-middle.png' });
      let rightOpacity = 1;
      for (const distance of [24, 9]) {
        await scroller.evaluate((el, d) => el.scrollTo({ left: el.scrollWidth - el.clientWidth - d, behavior: 'instant' }), distance);
        await page.waitForTimeout(220);
        const opacity = await rightArrow.evaluate(el => Number(getComputedStyle(el).opacity));
        assert.ok(opacity < rightOpacity && opacity > 0, 'The right hint progressively fades out approaching the end');
        rightOpacity = opacity;
      }
      if (width === 375) {
        // Safari can bounce when an arrow requests a position past either end.
        // Check the requested destinations as well as where scrolling settles.
        await scroller.evaluate(el => {
          el.arrowDestinations = [];
          const to = el.scrollTo.bind(el), by = el.scrollBy.bind(el);
          el.scrollTo = options => { el.arrowDestinations.push(options.left); to(options); };
          el.scrollBy = options => { el.arrowDestinations.push(el.scrollLeft + options.left); by(options); };
        });
        await rightArrow.click();
        await page.waitForFunction(() => document.querySelector('[data-scroll-layers="1"]').disabled);
        const end = await scroller.evaluate(el => el.scrollWidth - el.clientWidth);
        assert.deepEqual(await scroller.evaluate(el => el.arrowDestinations), [end], 'The right arrow stops at the last icon');
        await scroller.evaluate(el => { delete el.scrollTo; delete el.scrollBy; el.scrollTo({ left: 9, behavior: 'instant' }); });
        await page.waitForFunction(() => !document.querySelector('[data-scroll-layers="-1"]').disabled);
        await scroller.evaluate(el => {
          el.arrowDestinations = [];
          const to = el.scrollTo.bind(el), by = el.scrollBy.bind(el);
          el.scrollTo = options => { el.arrowDestinations.push(options.left); to(options); };
          el.scrollBy = options => { el.arrowDestinations.push(el.scrollLeft + options.left); by(options); };
        });
        await leftArrow.click();
        await page.waitForFunction(() => document.querySelector('[data-scroll-layers="-1"]').disabled);
        assert.deepEqual(await scroller.evaluate(el => el.arrowDestinations), [0], 'The left arrow stops at the first icon');
        await scroller.evaluate(el => { delete el.scrollTo; delete el.scrollBy; delete el.arrowDestinations; });
      }
      await scroller.evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' }));
      await page.waitForTimeout(220);
      await rightArrow.click();
      await page.waitForFunction(() => document.querySelector('.coelum-layer-toggles').scrollLeft > 1);
      await scroller.evaluate(el => { el.scrollTo({ left: (el.scrollWidth - el.clientWidth) / 2, behavior: 'instant' }); });
      await page.waitForFunction(() => !document.querySelector('[data-scroll-layers="1"]').disabled && !document.querySelector('[data-scroll-layers="-1"]').disabled);
      assert.ok(await leftArrow.isVisible() && await rightArrow.isVisible());
      await scroller.evaluate(el => { el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }); });
      await page.waitForFunction(() => document.querySelector('[data-scroll-layers="1"]').disabled && !document.querySelector('[data-scroll-layers="-1"]').disabled);
      assert.ok(await leftArrow.isVisible());
      assert.equal(await rightArrow.isVisible(), false);
      const gearAfter = await configure.boundingBox(), endBox = await bar.boundingBox();
      assert.ok(Math.abs(gearAfter.x + gearAfter.width - endBox.x - endBox.width + 6) < 1, 'Configure ends at the right padding with no arrow gap');
      assert.ok(gearAfter.x < gearBefore.x, 'Configure moves as the row scrolls');
    } else {
      assert.equal(await leftArrow.isVisible(), false);
      assert.equal(await rightArrow.isVisible(), false);
    }
    await configure.click();
    const layout = await page.locator('.coelum-toolbar').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth,
      sections: [...el.querySelectorAll('details')].filter(section => section.getClientRects().length).length }));
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.ok(layout.sections >= 14);
    const colors = await page.locator('[data-settings-section="ecliptic"] .coelum-colors').evaluate(el => {
      const rect = el.getBoundingClientRect(), choices = [...el.querySelectorAll('label')].map(label => label.getBoundingClientRect());
      return { rows: new Set(choices.map(choice => choice.top)).size, fits: choices.every(choice => choice.left >= rect.left && choice.right <= rect.right) };
    });
    assert.equal(colors.rows, 1, `All seven colours fit on one row at ${width}px`);
    assert.ok(colors.fits, `Colour choices stay inside the settings panel at ${width}px`);
    if (width === 390) await page.locator('.coelum-toolbar').screenshot({ path: '/tmp/coelum-layers-settings-phone.png' });
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
  const cdp = await context.newCDPSession(page);
  const touchAnchor = await rail.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchAnchor.x + touchAnchor.width / 2, y: touchAnchor.y + touchAnchor.height / 2, id: 1 }] });
  await page.waitForTimeout(900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await page.locator('.coelum-toolbar').isVisible(), 'Touch hold opens settings and leaves them open after release');
  await page.keyboard.press('Escape');
  await open();
  // Sky gestures manipulate the view without dismissing the shortcut bar.
  const skyBefore = await page.locator('.coelum-full').getAttribute('data-az');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 250, id: 1 }] });
  for (let dx = 15; dx <= 90; dx += 15) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120 + dx, y: 250, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await bar.isVisible(), 'Swiping the sky keeps the bar open');
  assert.notEqual(await page.locator('.coelum-full').getAttribute('data-az'), skyBefore, 'The sky actually pans');
  const scaleBefore = await page.locator('.coelum-full').getAttribute('data-scale');
  const fingers = d => [{ x: 195 - d, y: 300, id: 1 }, { x: 195 + d, y: 300, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(30) });
  for (let d = 36; d <= 72; d += 6) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await bar.isVisible(), 'Pinching the sky keeps the bar open');
  assert.notEqual(await page.locator('.coelum-full').getAttribute('data-scale'), scaleBefore, 'The sky actually zooms');
  const strip = page.locator('.coelum-layer-toggles');
  await strip.evaluate(el => { el.scrollLeft = 0; });
  const stripBox = await strip.boundingBox();
  const y = stripBox.y + stripBox.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stripBox.x + stripBox.width - 20, y }] });
  for (let dx = 30; dx < 180; dx += 15) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stripBox.x + stripBox.width - 20 - dx, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.querySelector('.coelum-layer-toggles').scrollLeft > 0);
  assert.ok(await leftArrow.isVisible(), 'The left arrow appears after swiping');
  await configure.scrollIntoViewIfNeeded();
  await configure.click();
  assert.ok(await page.locator('.coelum-toolbar').isVisible(), 'Configure is reachable by scrolling');
  await page.keyboard.press('Escape');
  await open();
  // Real touch holds on a scrolling strip open a usable phone-sized modal.
  const touchLabels = page.locator('[data-toggle-layer="labels"]');
  await touchLabels.scrollIntoViewIfNeeded();
  const touchBox = await touchLabels.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 }] });
  await page.waitForTimeout(900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await topicDialog.isVisible());
  const modalLayout = await topicDialog.evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth, rect: el.getBoundingClientRect().toJSON(),
    clipped: [...el.querySelectorAll('label > span')].some(span => span.scrollWidth > span.clientWidth) }));
  assert.equal(modalLayout.overflow, false);
  assert.equal(modalLayout.clipped, false);
  assert.ok(modalLayout.rect.x >= 0 && modalLayout.rect.right <= 390);
  assert.ok(await topicDialog.locator('[data-label-kind="solar"]').isChecked(), 'The touch release does not change a setting inside the modal');
  await topicDialog.screenshot({ path: '/tmp/coelum-label-settings-phone.png' });
  await topicDialog.locator('[data-action="close-panel"]').click();
  await open();
  const phoneEcliptic = page.locator('[data-toggle-layer="ecliptic"]');
  await phoneEcliptic.scrollIntoViewIfNeeded();
  const colorButton = await phoneEcliptic.boundingBox();
  await page.mouse.move(colorButton.x + colorButton.width / 2, colorButton.y + colorButton.height / 2);
  await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
  await page.setViewportSize({ width: 375, height: 667 });
  const phoneColors = await topicDialog.locator('.coelum-colors label').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().toJSON()));
  assert.equal(new Set(phoneColors.map(rect => rect.top)).size, 1);
  assert.ok(phoneColors.every(rect => rect.left >= 0 && rect.right <= 375));
  await topicDialog.screenshot({ path: '/tmp/coelum-colour-settings-iphone.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  // Preferences survive a reload and remain available in the shared accordions.
  await page.reload();
  await rail.click(); await configure.click();
  await page.locator('[data-settings-section="labels"] > summary').click();
  assert.equal(await page.locator('[data-label-kind="stars"]').isChecked(), false);
  assert.equal(await page.locator('[data-label-size]').inputValue(), '17');
  await page.locator('[data-settings-section="ecliptic"] > summary').click();
  assert.ok(await page.locator('[data-layer-color="ecliptic"][aria-label="Red"]').isChecked());
  assert.equal(await page.locator('[data-reset-color], [data-terrain="defaults"]').count(), 0);
  await page.locator('[data-action="reset-configuration"]').click();
  assert.ok(await page.locator('[data-label-kind="stars"]').isChecked());
  assert.equal(await page.locator('[data-label-size]').inputValue(), '14');
  assert.equal(await page.locator('[data-layer-color="ecliptic"]:checked').count(), 0);
  await page.keyboard.press('Escape'); await open();
  await page.locator('[data-action="almanac"]').click();
  assert.equal(await bar.isVisible(), false, 'Opening another panel closes the bar immediately');
  assert.ok(await page.locator('[data-panel="almanac"]').isVisible());
  assert.deepEqual(errors, []);
  await context.close();
  // The same shortcut also fits an embedded calculator chart.
  const embedded = await browser.newPage({ viewport: { width: 800, height: 900 }, serviceWorkers: 'block' });
  embedded.on('pageerror', error => errors.push(error.message));
  await embedded.route('https://celestrak.org/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await embedded.goto(url.replace(/coelum\/$/, ''));
  await embedded.locator('#expr').click();
  await embedded.keyboard.type('coelum(2026.11.06 21:00 Z, "Rome")');
  await embedded.locator('#expr').press('Enter');
  await embedded.locator('.coelum-preview').click();
  await embedded.locator('.coelum-full').waitFor();
  await embedded.mouse.move(40, 80);
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
  await embedded.locator('.coelum-full text').filter({ hasText: /^(Vega|Regulus|Pollux|Capella|Sirius|Aldebaran|Deneb|Altair)$/ }).first().click();
  assert.equal(await embedded.locator('.coelum-layerbar').isVisible(), false, 'Opening an object card closes the bar');
  assert.ok(await embedded.locator('.coelum-show-detail').count());
  assert.deepEqual(errors, []);
  await embedded.close();
  console.log('Layer configuration passed: topic modals, touch holds, accordion sync, saved preferences, reset all, toggles, terrain cancellation, desktop/phone layout, scrolling and embedded chart.');
} finally { await browser?.close(); server.close(); }
