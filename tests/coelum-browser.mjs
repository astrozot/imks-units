// Browser interaction/offline checks. Same PLAYWRIGHT/CHROME options as browser.mjs.
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
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Europe/Rome' });
  // no satellites from CelesTrak while testing (satellites.js)
  await context.route('https://celestrak.org/**', (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await context.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => { window.coelumShared = files.map((f) => ({ name: f.name, size: f.size, type: f.type })); };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector('#expr') && document.querySelectorAll('.key').length);
  await page.keyboard.type('coelum(2026.11.06 21:00 Z, "Rome")');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.coelum-preview');
  assert.ok(await page.locator('.coelum-svg circle').count() > 2000);
  await page.locator('.coelum-preview').click();
  await page.waitForSelector('.coelum-full');
  const status = () => page.locator('.coelum-status').textContent();
  const original = await status();
  assert.match(original, /Rome.*Night/);
  // Full-window mode uses the entire portrait viewport and keeps view state
  // when Escape returns to the sheet instead of closing it.
  await page.locator('[data-action="fullscreen"]').click();
  await page.waitForFunction(() => document.querySelector('.coelum-full').viewBox.baseVal.height > 800);
  const fullBox = await page.locator('.coelum-full').boundingBox();
  assert.ok(fullBox.width >= 389 && fullBox.height >= 843);
  assert.equal(await page.locator('.coelum-toolbar').isVisible(), false);
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-layer="ground"]').uncheck();
  await page.locator('[data-layer="ground"]').check();
  await page.locator('[data-action="layers"]').click();
  await page.locator('.coelum-full').focus(); await page.keyboard.press('ArrowRight');
  const fullRotation = await page.locator('.coelum-full').getAttribute('data-rotation');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.coelum-immersive').count(), 0);
  assert.equal(await page.locator('.coelum-full').count(), 1, 'Escape first exits full screen');
  assert.equal(await page.locator('.coelum-full').getAttribute('data-rotation'), fullRotation);
  await page.locator('.coelum-full').press('Home');
  const baseline = await page.locator('.coelum-full').innerHTML();
  const layersPanel = () => page.locator('[data-action="layers"]').click();
  await layersPanel();
  for (const layer of ['constellations', 'horizontal', 'equatorial', 'deep']) await page.locator(`[data-layer="${layer}"]`).check();
  assert.notEqual(await page.locator('.coelum-full').innerHTML(), baseline);
  assert.ok(!/NaN|Infinity|undefined/.test(await page.locator('.coelum-full').innerHTML()));
  const fullCount = await page.locator('.coelum-full circle').count();
  await page.locator('[data-limit]').selectOption('3');
  assert.ok(await page.locator('.coelum-full circle').count() < fullCount / 2);
  await page.locator('[data-limit]').selectOption('6');
  await layersPanel();
  assert.equal(await page.locator('.coelum-toolbar').isVisible(), false, 'The layers panel closes');
  // Select Saturn using the same model/projection, then check its details.
  const saturn = await page.evaluate(async () => {
    const { skyFrame, skyChart } = await import('./js/coelum.js');
    const f = skyFrame(Date.parse('2026-11-06T21:00:00Z') / 1000, [41.892, 12.511, 20]);
    const size = document.querySelector('.coelum-full').viewBox.baseVal.width;
    const p = skyChart(f, size, document.querySelector('.coelum-full').viewBox.baseVal.height).objects.find((o) => o.body === 'saturn');
    const svg = document.querySelector('.coelum-full'), v = svg.createSVGPoint(); v.x = p.x; v.y = p.y;
    const q = v.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y };
  });
  await page.touchscreen.tap(saturn.x, saturn.y);
  const detailText = await page.locator('.coelum-detail').textContent();
  for (const label of ['Saturn', 'planet', 'Altitude', 'Azimuth', 'Right ascension', 'Declination', 'Visual magnitude', 'Distance']) assert.ok(detailText.includes(label), label);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), 'Saturn');
  await page.locator('[data-action="deselect"]').click();
  await page.locator('.coelum-explorer').evaluate((el) => el.classList.add('coelum-idle'));
  await page.touchscreen.tap(saturn.x, saturn.y);
  assert.equal(await page.locator('.coelum-explorer.coelum-idle').count(), 0, 'A touch wakes the controls');
  assert.equal(await page.locator('.coelum-detail h3').count(), 0, 'The wake touch does not select');
  await page.touchscreen.tap(saturn.x, saturn.y);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), 'Saturn', 'The next touch can select');
  // Labels are selection targets too, including star and deep-sky labels.
  for (const kind of ['star', 'deep']) {
    await page.locator('.coelum-full').scrollIntoViewIfNeeded();
    const target = await page.evaluate(async (kind) => {
      const { skyFrame, skyChart } = await import('./js/coelum.js');
      const f = skyFrame(Date.parse('2026-11-06T21:00:00Z') / 1000, [41.892, 12.511, 20]);
      const svg = document.querySelector('.coelum-full'), size = svg.viewBox.baseVal.width;
      const c = skyChart(f, size, svg.viewBox.baseVal.height, { constellations: true, horizontal: true, equatorial: true, deep: true });
      const names = new Set((kind === 'star' ? f.stars : f.deep).map((o) => o.name));
      // a label with no symbol under its center (a symbol under the finger wins)
      const clear = (l) => c.objects.every((o) => Math.hypot(o.x - (l.box[0] + l.box[2]) / 2, o.y - (l.box[1] + l.box[3]) / 2) > o.radius + 2);
      const label = c.hitLabels.find((l) => names.has(l.name) && l.box[1] > 20 && l.box[3] < svg.viewBox.baseVal.height - 20 && clear(l));
      const v = svg.createSVGPoint(); v.x = (label.box[0] + label.box[2]) / 2; v.y = (label.box[1] + label.box[3]) / 2;
      const q = v.matrixTransform(svg.getScreenCTM()); return { name: label.name, x: q.x, y: q.y };
    }, kind);
    await page.touchscreen.tap(target.x, target.y);
    assert.equal(await page.locator('.coelum-detail h3').textContent(), target.name, `${kind} label selects its object`);
  }
  const normalFont = Number(await page.locator('.coelum-full text').first().getAttribute('font-size'));
  await layersPanel();
  await page.locator('[data-label-size]').selectOption('20');
  assert.ok(await page.locator('.coelum-full text[font-size="20"]').count() > 0);
  assert.ok(normalFont >= 11);
  await page.locator('[data-label-size]').selectOption('14');
  await layersPanel();
  await page.locator('[data-action="in"]').click();
  const oldRotation = await page.locator('.coelum-full').getAttribute('data-rotation');
  const zoomed = await page.locator('.coelum-full').innerHTML();
  const box = await page.locator('.coelum-full').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  assert.notEqual(await page.locator('.coelum-full').innerHTML(), zoomed, 'Drag rotates the sky');
  assert.notEqual(await page.locator('.coelum-full').getAttribute('data-rotation'), oldRotation, 'Drag changes camera orientation');
  await page.locator('.coelum-full').press('Home');
  const beforePinch = await page.locator('.coelum-full').innerHTML();
  // Pinch with two simultaneous pointers, then cancel both: no object tap.
  await page.locator('.coelum-full').evaluate((svg) => {
    const b = svg.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    // Synthetic events cannot capture native pointers; dispatch directly with
    // capture stubbed, retaining all gesture calculations and drawing.
    svg.setPointerCapture = () => {};
    for (const [type, id, dx] of [['pointerdown', 10, -25], ['pointerdown', 11, 25], ['pointermove', 11, 70], ['pointercancel', 10, -25], ['pointercancel', 11, 70]]) svg.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x + dx, clientY: y, bubbles: true }));
  });
  assert.notEqual(await page.locator('.coelum-full').innerHTML(), beforePinch, 'Pinch changes scale');
  await page.locator('.coelum-full').press('Home');
  await page.locator('[data-action="forward"]').click(); assert.notEqual(await status(), original);
  await page.locator('[data-action="back"]').click(); assert.equal(await status(), original);
  assert.equal(await page.locator('[data-speed]').getAttribute('data-rate'), '60', 'Gentler default speed');
  await page.locator('[data-action="faster"]').click();
  assert.equal(await page.locator('[data-speed]').getAttribute('data-rate'), '120');
  await page.locator('[data-action="slower"]').click();
  assert.equal(await page.locator('[data-speed]').getAttribute('data-rate'), '60');
  await page.locator('[data-action="reverse"]').click();
  assert.equal(await page.locator('[data-speed]').getAttribute('data-rate'), '-60');
  await page.locator('[data-action="faster"]').click();
  assert.equal(await page.locator('[data-speed]').getAttribute('data-rate'), '-120');
  await page.locator('[data-action="slower"]').click();
  await page.locator('[data-action="reverse"]').click();
  // Exercise the complete rounded ladder through the actual controls.
  const speedSteps = await page.evaluate(async () => {
    const { PLAYBACK_SPEEDS, skyFrame, lookAt } = await import('./js/coelum.js');
    const { skyScene } = await import('./js/coelumsky.js');
    const click = (action) => document.querySelector(`[data-action="${action}"]`).click();
    const rate = () => Number(document.querySelector('[data-speed]').dataset.rate);
    const down = [], up = [];
    while (rate() > 0.01) { click('slower'); down.push(rate()); }
    for (let i = 1; i < PLAYBACK_SPEEDS.length; i++) { click('faster'); up.push(rate()); }
    const label = document.querySelector('[data-speed]').textContent;
    // The realistic sky can render without a Moon or any planets.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 360;
    const f = skyFrame(Date.parse('2026-11-06T21:00:00Z') / 1000, [41.892, 12.511, 20], rate());
    const sun = f.bodies[0], view = { rotation: lookAt(sun.az, sun.alt), scale: 1, selected: 'Sun' };
    const fast = skyScene(f, 360, 360, { ground: false, atmosphere: false }, view, canvas.getContext('2d'));
    if (fast.objects.some((o) => o.body === 'sun') || fast.hitLabels.some((o) => o.name === 'Sun')) throw new Error('Sun drawn at extreme speed');
    const paused = skyScene(skyFrame(f.t, f.place), 360, 360, { ground: false, atmosphere: false }, view, canvas.getContext('2d'));
    if (!paused.objects.some((o) => o.body === 'sun')) throw new Error('Sun not restored when paused');
    while (rate() > 60) click('slower');
    return { down, up, label, expected: PLAYBACK_SPEEDS.slice(1) };
  });
  assert.deepEqual(speedSteps.down, [30, 15, 8, 4, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.025, 0.01]);
  assert.deepEqual(speedSteps.up, speedSteps.expected);
  assert.equal(speedSteps.label, '100G×');
  const typography = await page.evaluate(async () => {
    const { skyFrame, skyChart } = await import('./js/coelum.js');
    const f = skyFrame(Date.parse('2026-11-11T02:32:00+01:00') / 1000, [41.892, 12.511, 20]);
    const options = { constellations: true, horizontal: true, equatorial: true, deep: true };
    const paused = skyChart(f, 360, 360, options);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 360;
    const ctx = canvas.getContext('2d'), records = [], fill = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y) => { records.push({ text, x, y, width: ctx.measureText(text).width }); fill(text, x, y); };
    const moving = skyChart(f, 360, 360, options, {}, ctx);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 360 360'); svg.style.cssText = 'position:fixed;left:-10000px;width:360px;height:360px';
    svg.innerHTML = paused.svg; document.body.appendChild(svg);
    const differences = [...svg.querySelectorAll('text')].map((node, i) => ({
      text: node.textContent, canvasText: records[i]?.text,
      width: Math.abs(node.getComputedTextLength() - records[i].width),
      position: Math.hypot(Number(node.getAttribute('x')) - records[i].x, Number(node.getAttribute('y')) - records[i].y),
    }));
    svg.remove();
    return { differences, identicalLayout: JSON.stringify(paused.hitLabels) === JSON.stringify(moving.hitLabels), planets: moving.hitLabels.filter((l) => ['Jupiter', 'Mars'].includes(l.name)).map((l) => l.name) };
  });
  assert.equal(typography.identicalLayout, true, 'Starting animation preserves label positions');
  assert.deepEqual(typography.planets.sort(), ['Jupiter', 'Mars']);
  for (const d of typography.differences) {
    assert.equal(d.text, d.canvasText);
    assert.ok(d.width < 0.5 && d.position < 0.02, `Consistent paused/playing label metrics: ${JSON.stringify(d)}`);
  }
  // Observe actual rendered frames with all layers on, not just timer ticks.
  await page.evaluate(() => {
    window.skyFrameTimes = [];
    window.skyFrameObserver = new MutationObserver(() => window.skyFrameTimes.push(performance.now()));
    window.skyFrameObserver.observe(document.querySelector('.coelum-canvas'), { attributes: true, attributeFilter: ['data-frame'] });
  });
  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(1400);
  assert.equal(await page.locator('.coelum-canvas').getAttribute('data-content'), 'scene');
  if (process.env.COELUM_SCREENSHOT) await page.screenshot({ path: process.env.COELUM_SCREENSHOT.replace('.png', '-playing.png'), fullPage: true });
  const playback = await page.evaluate(() => {
    window.skyFrameObserver.disconnect();
    const times = window.skyFrameTimes;
    const intervals = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    return { frames: times.length, medianMs: intervals[Math.floor(intervals.length / 2)], time: Number(document.querySelector('.coelum-full').dataset.time) };
  });
  assert.ok(playback.frames >= 20, `Playback must beat the previous 4 fps: ${JSON.stringify(playback)}`);
  assert.ok(playback.time > Date.parse('2026-11-06T21:00:00Z') / 1000 + 20);
  console.log('All-layer playback measurement:', JSON.stringify(playback));
  // Current-frame hit testing and sharing remain usable while moving.
  await page.locator('.coelum-full').scrollIntoViewIfNeeded();
  const liveTarget = await page.evaluate(async () => {
    const { skyFrame, skyChart } = await import('./js/coelum.js');
    const svg = document.querySelector('.coelum-full'), size = svg.viewBox.baseVal.width;
    const f = skyFrame(Number(svg.dataset.time), [41.892, 12.511, 20]);
    const c = skyChart(f, size, svg.viewBox.baseVal.height, { constellations: true, horizontal: true, equatorial: true, deep: true });
    const p = c.objects.find((o) => o.body === 'saturn');
    const q = svg.createSVGPoint(); q.x = p.x; q.y = p.y;
    const v = q.matrixTransform(svg.getScreenCTM()); return { x: v.x, y: v.y };
  });
  await page.touchscreen.tap(liveTarget.x, liveTarget.y);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), 'Saturn', 'Selection during animation');
  await page.locator('#sheet-share').click();
  await page.waitForFunction(() => window.coelumShared?.length);
  assert.equal(await page.evaluate(() => window.coelumShared[0].name), 'coelum.png');

  await page.locator('[data-action="play"]').click();
  assert.equal(await page.locator('.coelum-canvas').getAttribute('data-content'), 'backdrop');
  const stopped = await page.locator('.coelum-full').getAttribute('data-time');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.coelum-full').getAttribute('data-time'), stopped, 'Paused playback stops its clock');
  assert.notEqual(await status(), original);
  await page.locator('[data-action="reset"]').click(); assert.equal(await status(), original);
  await page.locator('[data-action="reverse"]').click();
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(500); await page.locator('[data-action="play"]').click();
  assert.notEqual(await status(), original);
  await page.locator('[data-action="reset"]').click();
  await page.locator('#sheet-share').click();
  await page.waitForFunction(() => window.coelumShared?.length);
  const shared = await page.evaluate(() => window.coelumShared[0]);
  assert.equal(shared.name, 'coelum.png'); assert.equal(shared.type, 'image/png'); assert.ok(shared.size > 10000);
  if (process.env.COELUM_SCREENSHOT) await page.screenshot({ path: process.env.COELUM_SCREENSHOT, fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.coelum-full').count(), 0);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForSelector('.coelum-preview');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload(); await page.waitForSelector('.coelum-preview');
  await page.locator('.coelum-preview').click(); await page.waitForSelector('.coelum-full');
  assert.equal(await status(), original, 'Saved chart opens offline at its original time');
  await layersPanel();
  await page.locator('[data-layer="constellations"]').check();
  await page.locator('[data-layer="deep"]').check();
  await layersPanel();
  await page.locator('[data-action="forward"]').click(); assert.notEqual(await status(), original);
  await context.setOffline(false);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.locator('[data-action="in"]').click();
  await page.locator('.coelum-full').focus(); await page.keyboard.press('Home');
  assert.ok(await page.locator('.coelum-full circle').count() > 2000);
  // Roll through the horizon, turn off ground, and select an object that
  // was hidden underneath it. Recompute only the hit coordinate in the test.
  await page.locator('.coelum-full').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.coelum-full .coelum-ground').count(), 1);
  if (process.env.COELUM_SCREENSHOT) {
    await page.locator('.coelum-full').scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.COELUM_SCREENSHOT.replace('.png', '-rolled.png'), fullPage: true });
  }
  await layersPanel();
  await page.locator('[data-layer="ground"]').uncheck();
  await layersPanel();
  assert.equal(await page.locator('.coelum-full .coelum-ground').count(), 0);
  await page.locator('.coelum-full').scrollIntoViewIfNeeded();
  const below = await page.evaluate(async () => {
    const { skyFrame, skyChart } = await import('./js/coelum.js');
    const svg = document.querySelector('.coelum-full'), size = svg.viewBox.baseVal.width;
    const rotation = svg.dataset.rotation.split(',').map(Number);
    const f = skyFrame(Date.parse('2026-11-06T22:00:00Z') / 1000, [41.892, 12.511, 20]);
    const c = skyChart(f, size, svg.viewBox.baseVal.height, { ground: false, constellations: true, deep: true }, { rotation, scale: Number(svg.dataset.scale) });
    const p = c.objects.find((o) => o.alt < -10 && o.mag < 2 && o.x > 30 && o.x < size - 30 && o.y > 30 && o.y < size - 30);
    const v = svg.createSVGPoint(); v.x = p.x; v.y = p.y;
    const q = v.matrixTransform(svg.getScreenCTM()); return { name: p.name, x: q.x, y: q.y };
  });
  await page.mouse.click(below.x, below.y);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), below.name);
  assert.match(await page.locator('.coelum-detail').textContent(), /below the horizon/);
  await layersPanel();
  await page.locator('[data-layer="ground"]').check();
  await layersPanel();
  assert.equal(await page.locator('.coelum-full .coelum-ground').count(), 1);
  await page.locator('[data-action="fullscreen"]').click();
  await page.waitForFunction(() => document.querySelector('.coelum-full').viewBox.baseVal.width >= 1199);
  const desktopBox = await page.locator('.coelum-full').boundingBox();
  assert.ok(desktopBox.width >= 1199 && desktopBox.height >= 899);
  await page.locator('.coelum-full').press('Home');
  const fullscreenTarget = await page.evaluate(async () => {
    const { skyFrame, skyChart } = await import('./js/coelum.js');
    const svg = document.querySelector('.coelum-full');
    const f = skyFrame(Date.parse('2026-11-06T22:00:00Z') / 1000, [41.892, 12.511, 20]);
    const c = skyChart(f, svg.viewBox.baseVal.width, svg.viewBox.baseVal.height, { deep: true, constellations: true });
    const p = c.objects.find((o) => o.body === 'saturn');
    const q = svg.createSVGPoint(); q.x = p.x; q.y = p.y;
    const v = q.matrixTransform(svg.getScreenCTM()); return { x: v.x, y: v.y };
  });
  await page.mouse.click(fullscreenTarget.x, fullscreenTarget.y);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), 'Saturn', 'Rectangular full-screen hit testing');
  if (process.env.COELUM_SCREENSHOT) await page.screenshot({ path: process.env.COELUM_SCREENSHOT.replace('.png', '-fullscreen.png'), fullPage: true });
  // Measure the rectangular full-screen canvas too, at the faster 1 h/s.
  for (let i = 0; i < 6; i++) await page.locator('[data-action="faster"]').click();
  assert.equal(await page.locator('[data-speed]').getAttribute('data-rate'), '3600');
  await page.evaluate(() => {
    window.fullSkyTimes = [];
    window.fullSkyObserver = new MutationObserver(() => window.fullSkyTimes.push(performance.now()));
    window.fullSkyObserver.observe(document.querySelector('.coelum-canvas'), { attributes: true, attributeFilter: ['data-frame'] });
  });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1200);
  const fullPerformance = await page.evaluate(() => {
    window.fullSkyObserver.disconnect();
    const times = window.fullSkyTimes, intervals = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    return { frames: times.length, medianMs: intervals[Math.floor(intervals.length / 2)] };
  });
  assert.ok(fullPerformance.frames >= 20, `Full-screen playback: ${JSON.stringify(fullPerformance)}`);
  console.log('Full-screen playback measurement:', JSON.stringify(fullPerformance));
  await page.locator('[data-action="play"]').click();
  await page.locator('[data-action="fullscreen"]').click();
  assert.equal(await page.locator('.coelum-immersive').count(), 0);
  await page.locator('[data-action="play"]').click();
  await page.evaluate(() => { window.closedSkyCanvas = document.querySelector('.coelum-canvas'); });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const closedFrame = await page.evaluate(() => window.closedSkyCanvas.dataset.frame);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.closedSkyCanvas.dataset.frame), closedFrame, 'Closing the sheet cancels animation');

  // Legend (chart only), then the realistic view: drawn on the canvas, with
  // search, selection, playback and the controls fading in full screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.coelum-preview').first().click(); await page.waitForSelector('.coelum-full');
  await page.locator('[data-action="legend"]').click();
  assert.match(await page.locator('.coelum-legend').textContent(), /Double star.*Variable star.*Planet.*Galaxy.*Open cluster.*Nebula.*Ecliptic/s);
  await page.locator('[data-action="legend"]').click();
  await page.locator('[data-view="sky"]').click();
  assert.equal(await page.locator('[data-view="sky"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-action="legend"]').isVisible(), false, 'No legend in the realistic view');
  assert.equal(await page.locator('.coelum-canvas').getAttribute('data-content'), 'scene');
  assert.equal(await page.locator('.coelum-full > *').count(), 0, 'The realistic view is drawn on the canvas');
  assert.equal(await page.locator('[data-layer="atmosphere"]').isChecked(), true);
  assert.equal(await page.locator('[data-layer="constellations"]').isChecked(), false, 'Each view keeps its own layers');
  const input = page.locator('.coelum-search input');
  await input.fill('andromeda');
  assert.match(await page.locator('.coelum-results').textContent(), /M31.*Andromeda/);
  await input.fill('');
  await input.pressSequentially('satu');
  assert.equal(await page.locator('.coelum-results [aria-selected="true"] .coelum-result-name').textContent(), 'Saturn');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), 'Saturn', 'Search selects');
  const centred = await page.evaluate(async () => {
    const { skyFrame, refraction } = await import('./js/coelum.js');
    const svg = document.querySelector('.coelum-full'), s = skyFrame(Number(svg.dataset.time), [41.892, 12.511, 20]).bodies.find((b) => b.body === 'saturn');
    // The atmosphere is on: the view centers Saturn where it is seen.
    return { daz: Math.abs(((Number(svg.dataset.az) - s.az + 540) % 360) - 180), dalt: Math.abs(Number(svg.dataset.alt) - s.alt - refraction(s.alt, 20)), refraction: refraction(s.alt, 20) };
  });
  assert.ok(centred.daz < 0.01 && centred.dalt < 0.001 && centred.refraction > 0.005, `Search flies to the object: ${JSON.stringify(centred)}`);
  await page.locator('[data-action="deselect"]').click();
  assert.equal(await page.locator('.coelum-explorer.coelum-has-selection').count(), 0);
  const middle = await page.locator('.coelum-full').boundingBox();
  await page.touchscreen.tap(middle.x + middle.width / 2, middle.y + middle.height / 2);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), 'Saturn', 'Tapping in the realistic view selects');
  // Dragging pans with a level horizon (only azimuth and altitude change).
  const before = await page.locator('.coelum-full').evaluate((svg) => ({ az: Number(svg.dataset.az), alt: Number(svg.dataset.alt) }));
  await page.mouse.move(middle.x + 100, middle.y + 200); await page.mouse.down(); await page.mouse.move(middle.x + 160, middle.y + 240, { steps: 4 }); await page.mouse.up();
  const after = await page.locator('.coelum-full').evaluate((svg) => ({ az: Number(svg.dataset.az), alt: Number(svg.dataset.alt) }));
  assert.ok(after.az < before.az && after.alt > before.alt, `Drag right/down turns left and up: ${JSON.stringify({ before, after })}`);
  await page.locator('[data-action="forward"]').click();
  await page.locator('[data-action="fullscreen"]').click();
  await page.evaluate(() => {
    window.realTimes = [];
    window.realObserver = new MutationObserver(() => window.realTimes.push(performance.now()));
    window.realObserver.observe(document.querySelector('.coelum-canvas'), { attributes: true, attributeFilter: ['data-frame'] });
  });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1200);
  const realFrames = await page.evaluate(() => { window.realObserver.disconnect(); return window.realTimes.length; });
  assert.ok(realFrames >= 20, `Realistic playback: ${realFrames} frames in 1.2 s`);
  console.log('Realistic full-screen playback frames in 1.2 s:', realFrames);
  await page.locator('[data-action="play"]').click();
  if (process.env.COELUM_SCREENSHOT) await page.screenshot({ path: process.env.COELUM_SCREENSHOT.replace('.png', '-sky.png') });
  // Left alone, the full-screen controls fade (not while the mouse is over
  // them); moving brings them back.
  await page.mouse.move(200, 420);
  await page.waitForFunction(() => document.querySelector('.coelum-explorer').classList.contains('coelum-idle'), null, { timeout: 6000 });
  assert.equal(await page.locator('.coelum-timebar').evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
  await page.mouse.move(200, 300); await page.mouse.move(210, 310);
  assert.equal(await page.locator('.coelum-explorer.coelum-idle').count(), 0);
  await page.locator('[data-action="layers"]').click();
  await page.waitForTimeout(3900);
  assert.equal(await page.locator('.coelum-explorer.coelum-idle').count(), 0, 'An open panel keeps the controls');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.coelum-toolbar').isVisible(), false, 'Escape closes the panel first');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.coelum-immersive').count(), 0);
  await page.locator('#sheet-share').click();
  await page.waitForFunction(() => window.coelumShared?.length);
  assert.equal(await page.evaluate(() => window.coelumShared[0].type), 'image/png');
  await page.keyboard.press('Escape');
  // The view chosen last opens next time.
  await page.locator('.coelum-preview').first().click(); await page.waitForSelector('.coelum-full');
  assert.equal(await page.locator('[data-view="sky"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-view="chart"]').click();
  await page.keyboard.press('Escape');
  // An eclipse seen from a place opens the sky at its maximum, on the Sun.
  await page.locator('#expr').click();
  await page.keyboard.type('solareclipse(2026.08.01, "Madrid")'); await page.keyboard.press('Enter');
  await page.locator('.map-svg').last().click();
  await page.locator('[data-map="sky"]').click();
  await page.waitForSelector('.coelum-full');
  assert.equal(await page.locator('.coelum-detail h3').textContent(), 'Sun');
  assert.match(await page.locator('.coelum-status').textContent(), /2026\.08\.12/);
  // Chart drags move on the canvas and settle as SVG over the same canvas,
  // which keeps the sky and the Milky Way (no image to decode, no flicker).
  await page.locator('.coelum-full').press('Home');
  assert.equal(await page.locator('.coelum-full image').count(), 0);
  assert.equal(await page.locator('.coelum-canvas').getAttribute('data-content'), 'backdrop');
  assert.ok(await page.locator('.coelum-canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, colours = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) colours.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return colours.size > 3;
  }), 'Milky Way on the backdrop');
  const vb = await page.locator('.coelum-full').boundingBox(), svgBefore = await page.locator('.coelum-full').innerHTML();
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2); await page.mouse.down();
  await page.mouse.move(vb.x + vb.width / 2 + 40, vb.y + vb.height / 2 + 20, { steps: 4 });
  await page.waitForFunction(() => document.querySelector('.coelum-canvas').dataset.content === 'scene');
  assert.equal(await page.locator('.coelum-full > *').count(), 0, 'A chart drag moves on the canvas');
  await page.mouse.up();
  assert.equal(await page.locator('.coelum-canvas').getAttribute('data-content'), 'backdrop', 'Settles as SVG');
  assert.notEqual(await page.locator('.coelum-full').innerHTML(), svgBefore);
  // The two views stay in step: the chart's center becomes the sky's.
  const chartCenter = await page.locator('.coelum-full').evaluate(async (svg) => {
    const { unprojectSky } = await import('./js/coelum.js');
    const d = unprojectSky(0, 0, svg.dataset.rotation.split(',').map(Number));
    return { az: (Math.atan2(d[0], d[1]) * 180 / Math.PI + 360) % 360, alt: Math.asin(d[2]) * 180 / Math.PI };
  });
  await page.locator('[data-view="sky"]').click();
  const skyCenter = await page.locator('.coelum-full').evaluate((svg) => ({ az: Number(svg.dataset.az), alt: Number(svg.dataset.alt) }));
  assert.ok(Math.abs(((skyCenter.az - chartCenter.az + 540) % 360) - 180) < 0.01 && Math.abs(skyCenter.alt - chartCenter.alt) < 0.01, `Chart → sky: ${JSON.stringify({ chartCenter, skyCenter })}`);
  // Near the zenith the grabbed point follows the pointer (no spin or zoom).
  await page.locator('.coelum-full').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  const near = await page.locator('.coelum-full').evaluate((svg) => ({ az: Number(svg.dataset.az), alt: Number(svg.dataset.alt), scale: Number(svg.dataset.scale) }));
  assert.ok(near.alt > 80, `Looking up: ${near.alt}`);
  const from = { x: vb.width / 2 + 60, y: vb.height / 2 + 70 }, to = { x: vb.width / 2 - 50, y: vb.height / 2 - 40 };
  await page.mouse.move(vb.x + from.x, vb.y + from.y); await page.mouse.down();
  await page.mouse.move(vb.x + to.x, vb.y + to.y, { steps: 8 }); await page.mouse.up();
  const follow = await page.locator('.coelum-full').evaluate(async (svg, { near, from, to }) => {
    const { unprojectSky, projectVector, lookAt } = await import('./js/coelum.js'), { skyRadius } = await import('./js/coelumsky.js');
    const W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height, r = skyRadius(W, H, near.scale);
    const d = unprojectSky((from.x - W / 2) / r, (from.y - H / 2) / r, lookAt(near.az, near.alt), true);
    const p = projectVector(d, lookAt(Number(svg.dataset.az), Number(svg.dataset.alt)), true);
    return { dx: W / 2 + p.x * r - to.x, dy: H / 2 + p.y * r - to.y, scale: Number(svg.dataset.scale) };
  }, { near, from, to });
  assert.ok(Math.hypot(follow.dx, follow.dy) < 1.5 && follow.scale === near.scale, `The grabbed point follows near the zenith: ${JSON.stringify(follow)}`);
  // Two fingers zoom the sky view (fingers landing together).
  const cdp = await page.context().newCDPSession(page), centre = { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 };
  const fingers = (d) => [{ x: centre.x - d, y: centre.y, id: 1 }, { x: centre.x + d, y: centre.y, id: 2 }];
  const pinchFrom = Number(await page.locator('.coelum-full').getAttribute('data-scale'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(30) });
  for (let d = 36; d <= 90; d += 6) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const pinchTo = Number(await page.locator('.coelum-full').getAttribute('data-scale'));
  assert.ok(Math.abs(pinchTo / pinchFrom - 3) < 0.01, `Sky pinch: ${pinchFrom} → ${pinchTo}`);
  // Sky → chart: the same center again.
  const back = await page.locator('.coelum-full').evaluate((svg) => ({ az: Number(svg.dataset.az), alt: Number(svg.dataset.alt) }));
  await page.locator('[data-view="chart"]').click();
  const chartAgain = await page.locator('.coelum-full').evaluate(async (svg) => {
    const { unprojectSky } = await import('./js/coelum.js');
    const d = unprojectSky(0, 0, svg.dataset.rotation.split(',').map(Number));
    return { az: (Math.atan2(d[0], d[1]) * 180 / Math.PI + 360) % 360, alt: Math.asin(d[2]) * 180 / Math.PI };
  });
  assert.ok(Math.abs(chartAgain.alt - back.alt) < 0.01 && (back.alt > 89.9 || Math.abs(((chartAgain.az - back.az + 540) % 360) - 180) < 0.01), `Sky → chart: ${JSON.stringify({ back, chartAgain })}`);
  // Dragging the chart from the zenith toward the horizon levels it, with
  // the zenith up (or down, past it): no tilted or vertical horizon.
  await page.locator('.coelum-full').press('Home');
  await page.mouse.move(centre.x + 30, centre.y - 20); await page.mouse.down();
  await page.mouse.move(centre.x + 90, centre.y - 170, { steps: 10 }); await page.mouse.up();
  const level = await page.locator('.coelum-full').evaluate((svg) => {
    const r = svg.dataset.rotation.split(',').map(Number);
    return { tilt: Math.atan2(r[2], r[5]) * 180 / Math.PI, alt: Math.asin(r[8]) * 180 / Math.PI };
  });
  assert.ok(level.alt < 50 && Math.min(Math.abs(level.tilt), 180 - Math.abs(level.tilt)) < 0.1, `Level chart horizon: ${JSON.stringify(level)}`);
  // Fainter stars (the app's file to magnitude 8): kept in Cache Storage,
  // found by search, drawn when zoomed in (a star high in the sky), then
  // removed.
  await page.locator('[data-action="layers"]').click();
  assert.match(await page.locator('.coelum-faint-note').textContent(), /Only stars to magnitude 6/);
  assert.equal(await page.locator('[data-limit] option[value="8"]').evaluate((o) => o.disabled), true, 'Magnitudes past 6 need a download');
  await page.locator('[data-download="8"]').click();
  await page.waitForFunction(() => /40,244 more stars/.test(document.querySelector('.coelum-faint-note').textContent), null, { timeout: 30000 });
  assert.equal(await page.locator('[data-limit] option[value="8"]').evaluate((o) => o.disabled), false);
  assert.equal(await page.locator('[data-limit] option[value="9"]').evaluate((o) => o.disabled), true);
  await page.locator('[data-limit]').selectOption('8');
  await page.locator('[data-action="layers"]').click();
  const overhead = await page.locator('.coelum-full').evaluate(async (svg) => {
    const { skyFrame, eachFaint, FaintHit } = await import('./js/coelum.js');
    let best = null;
    eachFaint(skyFrame(Number(svg.dataset.time), [40.4, -3.7, 650]), 8, (j, v, mag) => { if (v[2] > Math.sin(70 * Math.PI / 180) && mag > 7 && (!best || mag < best.mag)) best = { j, mag }; });
    return new FaintHit(best.j).name;
  });
  await input.fill(overhead); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), overhead);
  assert.match(await page.locator('.coelum-detail').textContent(), /Parallax/);
  await page.locator('[data-action="deselect"]').click();
  const mid = await page.locator('.coelum-full').boundingBox();
  await page.mouse.click(mid.x + mid.width / 2, mid.y + mid.height / 2);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), overhead, 'Drawn and selectable when zoomed in');
  // Local horizon from (mocked) terrain tiles: flat ground with 2000 m
  // from 40 km; seen from Madrid (about 650 m), about 1.7° all around, with
  // the Earth's curvature and terrestrial refraction.
  const tile = async (h) => Buffer.from((await page.evaluate((h) => {
    const c = document.createElement('canvas'), v = h + 32768; c.width = c.height = 256;
    const g = c.getContext('2d'); g.fillStyle = `rgb(${Math.floor(v / 256)},${v % 256},0)`; g.fillRect(0, 0, 256, 256);
    return c.toDataURL('image/png');
  }, h)).split(',')[1], 'base64');
  const high = await tile(2000), low = await tile(0);
  let tiles = 0;
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/**', (route) => {
    tiles++;
    route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: /terrarium\/8\//.test(route.request().url()) ? high : low });
  });
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-horizon]').selectOption('terrain');
  await page.waitForFunction(() => /terrain around this place, from/.test(document.querySelector('.coelum-terrain-note').textContent), null, { timeout: 30000 });
  const stored = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('imks-coelum-horizons'))));
  assert.equal(stored.length, 1);
  assert.ok(stored[0].alt.length === 720 && stored[0].alt.every((x) => Math.abs(x - stored[0].alt[0]) < 0.02 && x > 1.4 && x < 2.1), `Terrain profile ${Math.min(...stored[0].alt)}…${Math.max(...stored[0].alt)}`);
  assert.ok(tiles > 10 && tiles < 80, `${tiles} tiles`);
  assert.ok((await page.locator('.coelum-full').innerHTML()).includes('#9fd58c'), 'The local horizon on the chart');
  await page.locator('[data-terrain="forget"]').click();
  assert.equal(await page.locator('[data-horizon]').inputValue(), 'landscape');
  await page.unrouteAll();
  // To magnitude 10: found by HIP, HD or TYC number, with its parallax and
  // proper motion; drawn from the tiles in view only, with what the whole
  // set would give there.
  await page.locator('[data-download="10"]').click();
  await page.waitForFunction(() => /349,351 more stars/.test(document.querySelector('.coelum-faint-note').textContent), null, { timeout: 30000 });
  assert.deepEqual(await page.locator('[data-limit] option').evaluateAll((os) => os.filter((o) => !o.disabled).map((o) => o.value)), ['3', '4', '5', '6', '7', '8', '9', '10']);
  assert.equal(await page.evaluate(async () => (await (await caches.open('imks-data-stars')).keys()).length), 1);
  await page.locator('[data-action="layers"]').click();
  await input.fill('HD 225213'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  assert.equal(await page.locator('.coelum-detail h3').textContent(), 'HIP 439');
  assert.match(await page.locator('.coelum-detail').textContent(), /HD 225213 · TYC 6995-1264-1.*230\.10 mas.*6\.10″ a year/s);
  await input.fill('TYC 1-13-1'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  assert.match(await page.locator('.coelum-detail').textContent(), /TYC 1-13-1/);
  const inView = await page.evaluate(async () => {
    const { skyFrame, skyChart, findObject, lookAt, eachFaint } = await import('./js/coelum.js');
    const f = skyFrame(Date.parse('2026-06-01T00:00:00Z') / 1000, [45, 9, 0]), o = findObject(f, 'HIP 439');
    const view = { scale: 16, rotation: lookAt(o.az, o.alt) }, chart = skyChart(f, 390, 520, { magnitude: 10, ground: false }, view);
    const names = chart.objects.map((x) => x.name), drawn = names.filter((n) => /^(TYC|HIP|HD) /.test(n)).length;
    // every star of the set within 6.3° of the center (inside the frame)
    let all = 0;
    eachFaint(f, 10, (i, v) => { const c = view.rotation, z = c[6] * v[0] + c[7] * v[1] + c[8] * v[2]; if (z > Math.cos(0.11)) all++; });
    return { found: names.includes('HIP 439'), drawn, all };
  });
  assert.ok(inView.found && inView.drawn > 100 && inView.drawn >= inView.all, `Stored stars in view: ${JSON.stringify(inView)}`);
  await page.locator('[data-action="deselect"]').click();
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-download="remove"]').click();
  await page.waitForFunction(() => /Only stars to magnitude 6/.test(document.querySelector('.coelum-faint-note').textContent));
  // Gestures: no page scrolling over the sky; a finger that never sent
  // pointerup is forgotten at the next first touch, so a tap still selects;
  // a chart dragged toward its edge at the smallest zoom turns smoothly.
  await page.locator('[data-view="chart"]').click();
  await page.locator('.coelum-full').press('Home');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.coelum-viewport')).touchAction), 'none');
  assert.ok(await page.evaluate(async () => {
    const svg = document.querySelector('.coelum-full'), b = svg.getBoundingClientRect();
    const ev = (type, id, x, y) => svg.dispatchEvent(new PointerEvent(type, { pointerId: id, isPrimary: true, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    document.querySelector('[data-action="deselect"]').click();
    ev('pointerdown', 41, b.left + 30, b.top + 30);
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    ev('pointerdown', 42, x, y); ev('pointerup', 42, x, y);
    await new Promise((r) => setTimeout(r, 50));
    return document.querySelector('.coelum-explorer').classList.contains('coelum-has-selection');
  }), 'A stale pointer does not block taps');
  {
    const box = await page.locator('.coelum-full').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    let last = null, worst = 0;
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(cx + (box.width / 2 - 2) * i / 40, cy + (box.height / 2 - 2) * i / 40);
      const r = (await page.locator('.coelum-full').getAttribute('data-rotation')).split(',').map(Number).slice(6, 9);
      if (last) worst = Math.max(worst, Math.acos(Math.min(1, r[0] * last[0] + r[1] * last[1] + r[2] * last[2])) / Math.PI * 180);
      last = r;
    }
    await page.mouse.up();
    assert.ok(worst < 15, `Chart drag toward the edge jumps ${worst.toFixed(1)}°`);
  }
  // Both views zoom to the same magnification.
  const most = async () => { for (let i = 0; i < 48; i++) await page.locator('[data-action="in"]').click(); return Number(await page.locator('.coelum-full').getAttribute('data-scale')); };
  const chartMost = await most();
  await page.locator('[data-view="sky"]').click();
  const skyMost = await most();
  const ratio = await page.evaluate(async ([c, k]) => {
    const { chartRadius } = await import('./js/coelum.js'); const { skyRadius } = await import('./js/coelumsky.js');
    const svg = document.querySelector('.coelum-full'), w = svg.viewBox.baseVal.width, h = svg.viewBox.baseVal.height;
    return (chartRadius(w, h, c) / 90) / (skyRadius(w, h, k) / 2 * Math.PI / 180);
  }, [chartMost, skyMost]);
  assert.ok(skyMost === 40000 && Math.abs(ratio - 1) < 0.01, `Largest zooms ${chartMost} / ${skyMost}: ${ratio}`);
  await page.locator('.coelum-full').press('Home');
  // Date and time panel: the day's events; the place panel: coordinates.
  await page.locator('[data-action="time"]').click();
  await page.waitForSelector('[data-time-event]');
  assert.match(await page.locator('.coelum-events').textContent(), /Sunrise.*Sunset/s);
  await page.locator('[data-time-event]').filter({ hasText: 'Sunset' }).click();
  assert.match(await page.locator('.coelum-condition').textContent(), /Sun −?-?0\.\d|Sun -0|Sun 0\./);
  await page.locator('[data-action="place"]').click();
  await page.locator('.coelum-place-form input').fill('Milan');
  assert.match(await page.locator('.coelum-place').first().textContent(), /Milan/);
  await page.locator('.coelum-place').first().click();
  await page.waitForFunction(() => /Milan/.test(document.querySelector('.coelum-status').textContent));
  await page.locator('[data-action="reset"]').click();
  await page.waitForFunction(() => !/Milan/.test(document.querySelector('.coelum-status').textContent));
  // Minor planets (a layer, and in search) and the planets' moons.
  await page.locator('.coelum-search input').fill('Vesta'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /minor planet/.test(document.querySelector('.coelum-detail').textContent));
  await page.locator('.coelum-search input').fill('Io'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /moon of Jupiter/i.test(document.querySelector('.coelum-detail').textContent));
  // The moons from the card, over the whole view in full screen: they
  // follow the chart's time; Escape closes them as the view was; a moon
  // tapped is found in the sky.
  const wasFull = await page.locator('.coelum-explorer').evaluate((e) => e.classList.contains('coelum-immersive'));
  await page.locator('.coelum-moons-button').click();
  assert.equal(await page.locator('.coelum-moons-title').textContent(), 'Moons of Jupiter');
  assert.equal(await page.locator('.coelum-moons-stage .sky-moon').count(), 4);
  // its data; its scale in the ruler (arcseconds), not over the drawing;
  // no sky drawn under it
  assert.match(await page.locator('.coelum-moons-data').textContent(), /^\d+ % lit · \d+\.\d″ · mag −\d\.\d · \d\.\d\d au$/);
  assert.match(await page.locator('.coelum-ruler b').textContent(), /^[\d.]+[″′]$/);
  assert.equal(await page.locator('.coelum-moons-stage .sky-scale').count(), 1, 'only the directions');
  const frameUnder = await page.locator('.coelum-canvas').getAttribute('data-frame');
  const cover = await page.evaluate(() => [document.querySelector('.coelum-moons-stage').getBoundingClientRect().width, document.querySelector('.coelum-viewport').getBoundingClientRect().width, document.querySelector('.coelum-explorer').classList.contains('coelum-immersive')]);
  assert.ok(cover[0] === cover[1] && cover[2], `Moons over the whole view in full screen: ${cover}`);
  const moonsBefore = await page.locator('.coelum-moons-stage svg').innerHTML();
  await page.locator('[data-action="forward"]').click();
  await page.waitForFunction((before) => document.querySelector('.coelum-moons-stage svg').innerHTML !== before, moonsBefore);
  assert.equal(await page.locator('.coelum-canvas').getAttribute('data-frame'), frameUnder, 'The sky is not drawn under the close-up');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.coelum-moonsview').isVisible(), false);
  assert.equal(await page.locator('.coelum-explorer').evaluate((e) => e.classList.contains('coelum-immersive')), wasFull);
  // Wake the controls before requesting another close-up.
  await page.locator('.coelum-explorer').dispatchEvent('pointermove', { pointerType: 'mouse' });
  await page.locator('.coelum-moons-button').click();
  await page.waitForFunction(() => !document.querySelector('.coelum-moonsview').hidden);
  // Once textures load, the GPU draws the moons and removes their SVG
  // circles. The adjacent label remains a stable point within tap range.
  const ioLabel = page.locator('.coelum-moons-stage .sky-label').filter({ hasText: /^Io$/ });
  await ioLabel.waitFor({ state: 'visible' });
  await ioLabel.click({ force: true }); // reacquire after a texture-triggered redraw
  await page.waitForFunction(() => /^(Io|Europa|Ganymede|Callisto)$/.test(document.querySelector('.coelum-object-head h3')?.textContent));
  assert.equal(await page.locator('.coelum-moonsview').isVisible(), false);
  // Backward, the play button points left.
  await page.locator('[data-action="reverse"]').click();
  assert.equal(await page.locator('[data-action="play"]').getAttribute('aria-label'), 'Play backward');
  assert.ok(await page.locator('[data-action="play"]').evaluate((b) => getComputedStyle(b.querySelector('svg')).transform !== 'none'));
  await page.locator('[data-action="reverse"]').click();
  assert.equal(await page.locator('[data-action="play"]').getAttribute('aria-label'), 'Play');
  // The ruler: a round angle, smaller as the view zooms in. Start wide
  // so the preceding moon selection cannot leave us at the zoom limit.
  await page.waitForTimeout(700); // finish the flight from the moon selection
  await page.locator('.coelum-full').press('Home');
  const rulerText = () => page.locator('.coelum-ruler b').textContent();
  const degrees = (r) => (r.endsWith('°') ? 60 : 1) * parseFloat(r);
  const ruler0 = await rulerText();
  assert.match(ruler0, /^\d+[′°]$/);
  for (let i = 0; i < 3; i++) await page.locator('[data-action="in"]').click();
  assert.ok(degrees(await rulerText()) < degrees(ruler0), `Ruler ${ruler0} → ${await rulerText()}`);
  // The mount: equatorial, a star keeps its place as an hour passes;
  // alt-az, it moves.
  await page.locator('[data-action="deselect"]').click();
  await page.locator('[data-view="chart"]').click();
  await page.locator('.coelum-full').press('Home');
  const starPlace = () => page.evaluate(() => {
    const names = ['Vega', 'Deneb', 'Altair', 'Capella', 'Aldebaran', 'Sirius', 'Betelgeuse', 'Rigel', 'Arcturus', 'Polaris'];
    const text = [...document.querySelectorAll('.coelum-full text')].find((e) => names.includes(e.textContent));
    return text && { name: text.textContent, x: Number(text.getAttribute('x')), y: Number(text.getAttribute('y')) };
  });
  const hourMoves = async () => {
    const a = await starPlace();
    await page.locator('[data-action="forward"]').click();
    const b = await page.waitForFunction((name) => { const e = [...document.querySelectorAll('.coelum-full text')].find((x) => x.textContent === name); return e && { x: Number(e.getAttribute('x')), y: Number(e.getAttribute('y')) }; }, a.name).then((h) => h.jsonValue());
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  await page.locator('[data-action="mount"]').click();
  assert.equal(await page.locator('[data-action="mount"]').textContent(), 'EQ');
  assert.ok(await hourMoves() < 1.5, 'Equatorial: the stars stay');
  await page.locator('[data-action="mount"]').click();
  assert.equal(await page.locator('[data-action="mount"]').textContent(), 'AZ');
  assert.ok(await hourMoves() > 10, 'Alt-az: the stars turn');
  // The lock: a star stays where it is as the hours pass (it turns in
  // alt-az); without a selection, a hint.
  await page.locator('[data-action="lock"]').click();
  assert.match(await page.locator('.coelum-toast').textContent(), /Select an object/);
  await page.locator('.coelum-search input').fill('Vega'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  await page.locator('[data-action="lock"]').click();
  assert.equal(await page.locator('[data-action="lock"]').getAttribute('aria-pressed'), 'true');
  const jupiterPlace = () => page.evaluate(() => { const e = [...document.querySelectorAll('.coelum-full text')].find((x) => x.textContent === 'Vega'); return e && [Number(e.getAttribute('x')), Number(e.getAttribute('y'))]; });
  const j0 = await jupiterPlace();
  for (let i = 0; i < 2; i++) await page.locator('[data-action="forward"]').click();
  const j1 = await jupiterPlace();
  assert.ok(j0 && j1 && Math.hypot(j1[0] - j0[0], j1[1] - j0[1]) < 1.5, `Locked Vega ${j0} → ${j1}`);
  // a zoom (here the wheel) while time runs fast keeps it in place too
  const mid0 = await page.locator('.coelum-full').boundingBox();
  for (let i = 0; i < 6; i++) await page.locator('[data-action="faster"]').click();
  await page.locator('[data-action="play"]').click();
  await page.mouse.move(mid0.x + mid0.width / 2, mid0.y + mid0.height / 2);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(120); }
  await page.waitForTimeout(400);
  await page.locator('[data-action="play"]').click();
  for (let i = 0; i < 6; i++) await page.locator('[data-action="slower"]').click();
  const j2 = await jupiterPlace();
  assert.ok(j2 && Math.hypot(j2[0] - j1[0], j2[1] - j1[1]) < 2, `Locked Vega after a zoom while playing ${j1} → ${j2}`);
  // a drag moves it by as much, and it stays there as time runs
  await page.mouse.move(mid0.x + mid0.width / 2, mid0.y + mid0.height / 2); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(mid0.x + mid0.width / 2 + 5 * i, mid0.y + mid0.height / 2 - 3 * i);
  await page.mouse.up(); await page.waitForTimeout(300);
  await page.locator('[data-action="forward"]').click();
  const j3 = await jupiterPlace(), scaleX = mid0.width / (await page.locator('.coelum-full').evaluate((e) => e.viewBox.baseVal.width));
  assert.ok(j3 && Math.hypot(j3[0] - j2[0] - 40 / scaleX, j3[1] - j2[1] + 24 / scaleX) < 2, `Locked Vega dragged by (40, −24) ${j2} → ${j3}`);
  await page.locator('[data-action="lock"]').click();
  assert.equal(await page.locator('[data-action="lock"]').getAttribute('aria-pressed'), 'false');
  await page.locator('[data-action="deselect"]').click();
  // The close-up of Venus (no moons): its phase, its data.
  await page.locator('.coelum-search input').fill('Venus'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  assert.equal(await page.locator('.coelum-moons-button').textContent(), 'Close-up of Venus');
  assert.match(await page.locator('.coelum-detail').textContent(), /Apparent diameter\d+\.\d″/);
  await page.locator('.coelum-moons-button').click();
  assert.equal(await page.locator('.coelum-moons-title').textContent(), 'Venus');
  assert.match(await page.locator('.coelum-moons-data').textContent(), /% lit/);
  assert.ok(await page.locator('.coelum-moons-stage .sky-canvas').evaluate((c) => { const d = document.createElement('canvas'); d.width = c.width; d.height = c.height; const g = d.getContext('2d'); g.drawImage(c, 0, 0); return g.getImageData(0, 0, c.width, c.height).data.some((x, i) => i % 4 === 3 && x > 0); }), 'Venus drawn');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="deselect"]').click();
  // Without the ground, no horizon line and no cardinal points.
  const groundless = await page.evaluate(async () => {
    const { skyFrame, skyChart } = await import('./js/coelum.js');
    const f = skyFrame(Date.parse('2026-11-06T21:00:00Z') / 1000, [41.9, 12.5, 20]);
    const texts = (layers) => [...skyChart(f, 400, 400, layers).svg.matchAll(/>([NSEW]{1,2})<\/text>/g)].length;
    return [texts({ ground: true }), texts({ ground: false })];
  });
  assert.ok(groundless[0] >= 4 && groundless[1] === 0, `Cardinal points with and without ground: ${groundless}`);
  // No page zoom by pinching the controls.
  for (const s of ['.coelum-topbar', '.coelum-timebar', '.coelum-toolbar']) assert.equal(await page.locator(s).evaluate((e) => getComputedStyle(e).touchAction), 'pan-y');
  await page.locator('.coelum-search input').fill('Vega'); await page.keyboard.press('Enter');
  // the catalog's spectral type, so the spectrum gives no estimated one
  await page.waitForFunction(() => /Spectral typeA0V/.test(document.querySelector('.coelum-detail').textContent) && /K$/.test(document.querySelector('.coelum-spectrum figcaption span:nth-child(2)')?.textContent || ''));
  await page.locator('[data-action="reset"]').click();
  // The WebGL sky matches the JavaScript one (but for sharper edges), with
  // a terrain horizon, at night and by day, and for the chart's Milky Way.
  const shader = await page.evaluate(async () => {
    const { skyFrame, skyChart } = await import('./js/coelum.js');
    const { skyScene } = await import('./js/coelumsky.js');
    const { rasterOptions } = await import('./js/skyraster.js');
    if (!document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true })) return null;
    const W = 390, H = 520, terrain = (az) => 4 + 3 * Math.sin(3 * az * Math.PI / 180), out = [];
    for (const [t, az, alt] of [['2026-11-06T19:00:00Z', 290, 45], ['2026-11-06T11:00:00Z', 180, 20], ['2026-11-06T21:00:00Z']]) {
      const f = skyFrame(Date.parse(t) / 1000, [41.892, 12.511, 20]), px = [];
      for (const gl of [true, false]) {
        rasterOptions.gl = gl;
        const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
        const ctx = c.getContext('2d'); ctx.setTransform(2, 0, 0, 2, 0, 0);
        if (az === undefined) skyChart(f, W, H, {}, { scale: 1, rotation: [1, 0, 0, 0, 0, 1, 0, -1, 0] }, ctx);
        else skyScene(f, W, H, { horizon: 'terrain', terrain }, { az, alt, scale: 1 }, ctx);
        px.push(ctx.getImageData(0, 0, c.width, c.height).data);
      }
      let sum = 0, big = 0;
      for (let i = 0; i < px[0].length; i++) if (i % 4 < 3) { const d = Math.abs(px[0][i] - px[1][i]); sum += d; if (d > 24) big++; }
      out.push({ mean: sum / (px[0].length * 0.75), big: big / (px[0].length * 0.75) });
    }
    rasterOptions.gl = true;
    return out;
  });
  if (shader) for (const s of shader) assert.ok(s.mean < 1 && s.big < 0.01, `WebGL sky differs: ${JSON.stringify(s)}`);
  else console.log('WebGL2 unavailable: the shader was not compared');
  // The planets traced on the GPU (skyview.js) as in JavaScript: the same
  // but at the edges, smoothed by four rays a pixel (compared at half the
  // resolution, as they show on the black sky: Saturn's ringlets are edges
  // everywhere, and its faint rings nearly transparent)
  const traced = await page.evaluate(async () => {
    const { skyView } = await import('./js/sky.js');
    const { drawPlanet, planetMap } = await import('./js/skyview.js');
    const out = [];
    // Jupiter's, Saturn's (and its rings') and Mars's maps first (fetched,
    // then kept)
    if (!(await planetMap('jupiter').ready) || !(await planetMap('saturn').ready)?.rings || !(await planetMap('mars').ready)) return [{ planet: 'maps not loaded', mean: 99 }];
    for (const [planet, t] of [['saturn', '2026-11-06T21:00:00Z'], ['jupiter', '2026-11-06T21:00:00Z'], ['saturn', '2032-03-01T00:00:00Z'], ['mars', '2026-11-06T21:00:00Z']]) {
      const sky = skyView(planet, Date.parse(t) / 1000), W = 360, H = 240, s = planet === 'saturn' ? 70 : 100;
      const gpu = document.createElement('canvas'), cpu = document.createElement('canvas');
      cpu.getContext('2d');
      if (!drawPlanet(gpu, sky, W, H, 0, 0, s, 1)) return null;
      drawPlanet(cpu, sky, W, H, 0, 0, s, 1);
      const px = [gpu, cpu].map((c) => { const d = document.createElement('canvas'); d.width = W / 2; d.height = H / 2; const g = d.getContext('2d'); g.fillRect(0, 0, W / 2, H / 2); g.drawImage(c, 0, 0, W / 2, H / 2); return g.getImageData(0, 0, W / 2, H / 2).data; });
      let sum = 0, big = 0, lit = 0;
      for (let i = 0; i < px[0].length; i++) { if (i % 4 === 3) { if (px[0][i - 3] + px[0][i - 2] + px[0][i - 1] > 0) lit++; continue; } const d = Math.abs(px[0][i] - px[1][i]); sum += d; if (d > 24) big++; }
      out.push({ planet, mean: sum / (px[0].length * 0.75), big: big / (px[0].length * 0.75), drawn: lit / (W * H / 4) });
    }
    return out;
  });
  if (traced) for (const x of traced) assert.ok(x.mean < 2.5 && x.big < 0.03 && x.drawn > 0.1, `The planet on the GPU differs: ${JSON.stringify(x)}`);
  else console.log('WebGL unavailable: the planets were not compared');

  // iMKS's chart has Coelum's Events panel: an occultation tapped is
  // computed, with its map
  {
    const p2 = await context.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(`http://localhost:${server.address().port}/`);
    await p2.waitForFunction(() => document.querySelector('#expr') && document.querySelectorAll('.key').length);
    await p2.keyboard.type('coelum(2026.11.06 21:00 Z, "Rome")');
    await p2.keyboard.press('Enter');
    await p2.locator('.coelum-preview').last().click();
    await p2.locator('[data-action="events"]').click();
    await p2.waitForSelector('[data-event="occultations"]', { timeout: 60000 });
    assert.match(await p2.locator('[data-panel="events"] .coelum-panel-note').first().textContent(), /Seen from .*its calculation, with its map or drawing/);
    assert.match(await p2.locator('[data-event="occultations"]').first().innerText(), /^52 Sgr behind the Moon/);
    await p2.locator('[data-event="occultations"]').first().click();
    await p2.waitForFunction(() => /52 Sgr occulted by the Moon/.test(document.querySelector('.entry:last-child')?.textContent || ''), null, { timeout: 30000 });
    const entry = (await p2.locator('.entry').last().innerText()).replace(/\s+/g, ' ');
    assert.match(entry, /occultation ⁡ \( “ Moon ” , “ 52 Sgr ” , 2026\.11\.14 [\d:]+ UTC , \( 41\.892 ⁢ ° , 12\.511 ⁢ ° , 20 ⁢ m \) \)/);
    assert.match(entry, /limits .*disappears \(dark limb\)/, 'With its map');
    await p2.close();
  }
  const resetHold = await page.evaluate(async () => {
    const { mountCoelum } = await import('./js/coelumui.js');
    const host = document.createElement('div'); document.body.appendChild(host);
    let updates = 0;
    const explorer = mountCoelum(host, { t: 1793998800, place: [41.892, 12.511, 20], label: 'Rome' }, String, { updateApp: async () => { updates++; } });
    const button = host.querySelector('[data-action="reset"]');
    const pointer = (type) => button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 20, isPrimary: true, button: 0, clientX: 10, clientY: 10 }));
    explorer.setTime(1794002400);
    pointer('pointerdown'); await new Promise((r) => setTimeout(r, 900)); pointer('pointerup'); button.click();
    const heldTime = explorer.time;
    pointer('pointerdown'); pointer('pointerup'); button.click();
    const shortTime = explorer.time;
    pointer('pointerdown'); pointer('pointercancel');
    await new Promise((r) => setTimeout(r, 900));
    host.remove();
    return { updates, heldTime, shortTime };
  });
  assert.deepEqual(resetHold, { updates: 1, heldTime: 1794002400, shortTime: 1793998800 });
  const appRefresh = await page.evaluate(async () => {
    const { forceAppUpdate } = await import('./js/coelumui.js');
    const reg = await navigator.serviceWorker.ready;
    const data = await caches.open('imks-data-update-test');
    await data.put(new Request(new URL('saved-catalog', location.href)), new Response('keep me'));
    let reloads = 0;
    const reports = [];
    await forceAppUpdate(() => reloads++, (message) => reports.push(message));
    const saved = await (await data.match(new URL('saved-catalog', location.href))).text();
    await caches.delete('imks-data-update-test');
    return { reloads, upToDate: /Current version: imks-v\d+.*no update required/.test(reports.at(-1)), saved };
  });
  assert.deepEqual(appRefresh, { reloads: 0, upToDate: true, saved: 'keep me' });
  // Atmosphere suppression respects both directions, the exact day/s
  // boundary, pausing, slowing down and the user's disabled preference.
  const atmosphere = await page.evaluate(async () => {
    const { mountCoelum } = await import('./js/coelumui.js');
    const host = document.createElement('div'); document.body.appendChild(host);
    const explorer = mountCoelum(host, { t: Date.parse('2026-11-06T21:00:00Z') / 1000, place: [41.892, 12.511, 20], label: 'Rome' }, String);
    const click = (action) => host.querySelector(`[data-action="${action}"]`).click();
    const drawn = () => host.querySelector('.coelum-canvas').dataset.atmosphere;
    const states = [];
    host.querySelector('[data-view="sky"]').click();
    for (const rate of [86399, 86400, -86400]) {
      explorer.setSpeed(rate); click('play'); states.push(drawn());
      click('play'); states.push(drawn());
    }
    explorer.setSpeed(86400); click('play');
    explorer.setSpeed(60);
    await new Promise(requestAnimationFrame); states.push(drawn());
    click('play');
    const toggle = host.querySelector('[data-layer="atmosphere"]');
    const preferred = toggle.checked;
    toggle.click(); explorer.setSpeed(86400); click('play'); states.push(drawn());
    click('play'); states.push(drawn());
    host.remove();
    return { states, preferred };
  });
  assert.deepEqual(atmosphere, { states: ['true', 'true', 'false', 'true', 'false', 'true', 'true', 'false', 'false'], preferred: true });
  assert.deepEqual(errors, []);
  console.log('Coelum browser checks passed: full-screen portrait/landscape, rolling, ground, label sizes, object/label selection, zoom, pinch, time, export, history and offline reuse, legend, realistic view, search, fading controls and the eclipse link, smooth chart drags, grab-dragging at the zenith, sky pinch, level chart horizon, view sync, fainter stars with parallaxes and proper motions, the local horizon, the WebGL sky, stale touches, edge drags, equal zooms, time and place panels, minor planets, moons, the moons view, the backward play button, the ruler, the mounts, the lock and spectra, the planets traced on the GPU, the Events panel in iMKS');
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
