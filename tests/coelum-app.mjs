// Checks of Coelum as an app of its own (coelum/index.html) in a browser:
// node tests/coelum-app.mjs. Same PLAYWRIGHT/CHROME options as browser.mjs.
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
    await context.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, storage);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('.coelum-full');
    return { context, page, errors };
  };
  const rows = (page) => page.$$eval('.coelum-event', (b) => b.map((x) => [x.dataset.event, x.innerText.replace(/\n/g, ' | ')]));

  // Without a place: Greenwich, and the place panel open to choose one
  {
    const { context, page, errors } = await open({});
    assert.match(await page.locator('.coelum-status').textContent(), /Greenwich/);
    assert.equal(await page.locator('.coelum-placepanel').isVisible(), true, 'The place panel opens without a place');
    assert.deepEqual(errors, []);
    await context.close();
  }

  // iMKS's location, in full screen from the start, without a way out
  const { context, page, errors } = await open({ 'imks.settings': { location: { lat: 45.4642, lon: 9.19, h: 120, name: 'Milan' } } });
  const status = () => page.locator('.coelum-status').textContent();
  assert.match(await status(), /Nov 8, 2026, 01:00 PM · Milan/);
  assert.equal(await page.locator('.coelum-explorer.coelum-immersive').count(), 1);
  assert.equal(await page.locator('[data-action="fullscreen"]').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.coelum-explorer.coelum-immersive').count(), 1, 'Escape keeps the app in full screen');

  // The eclipses seen from Milan, with More
  await page.click('[data-action="events"]');
  await page.waitForSelector('.coelum-event');
  let list = await rows(page);
  assert.equal(list.filter(([k]) => k === 'solar').length, 4);
  assert.equal(list.filter(([k]) => k === 'lunar').length, 4);
  assert.match(list.find(([k]) => k === 'solar')[1], /^Partial solar eclipse \(total\) \| Aug 2, 2027, 11:08 AM \| 62% of the Sun covered · Sun 50° high$/);
  assert.match(list.find(([k]) => k === 'lunar')[1], /^Penumbral lunar eclipse \| Feb 21, 2027/);
  await page.click('[data-more="solar"]');
  assert.equal((await rows(page)).filter(([k]) => k === 'solar').length, 8, 'More finds four more');

  // Scope filters conjunctions only; phases and oppositions retain events
  // below the horizon, and seasonal events are the same worldwide.
  await page.waitForSelector('[data-more="conjunctions"]');
  const localConjunctions = await page.locator('[data-event="conjunctions"]').allTextContents();
  assert.match(await page.locator('[data-event="conjunctions"] small').first().textContent(), /^5\.66° apart \(geocentric\) · 19° high · Moon 1% lit$/);
  for (const text of localConjunctions) assert.doesNotMatch(text, /below the horizon|Moon \d+° high|Mercury \d+° high/);
  const globalLists = {};
  for (const kind of ['phases', 'oppositions', 'seasons']) {
    globalLists[kind] = await page.locator(`[data-event="${kind}"]`).evaluateAll((rows) => rows.map((r) => r.querySelector('b').textContent + r.querySelector('span').textContent));
    assert.equal(globalLists[kind].length, 4);
    if (kind !== 'seasons') assert.match(await page.locator(`[data-list="${kind}"]`).textContent(), /below the horizon/);
  }
  assert.match(globalLists.seasons[0], /^December solstice/);
  await page.click('[data-scope="anywhere"]');
  await page.waitForSelector('[data-more="conjunctions"]');
  assert.ok(await page.locator('[data-event="conjunctions"]').count() > localConjunctions.length);
  assert.doesNotMatch(await page.locator('[data-list="conjunctions"]').textContent(), /\d+° high/);
  assert.match(await page.locator('[data-event="conjunctions"] small').first().textContent(), /Moon 1% lit/);
  for (const kind of Object.keys(globalLists)) assert.deepEqual(await page.locator(`[data-event="${kind}"]`).evaluateAll((rows) => rows.map((r) => r.querySelector('b').textContent + r.querySelector('span').textContent)), globalLists[kind]);
  await page.click('[data-scope="here"]');
  await page.waitForSelector('[data-more="conjunctions"]');

  // New events open at their time, centered on a body or a whole pair,
  // in both views, even after the previous event left a tight zoom.
  for (const mode of ['chart', 'sky']) {
    for (const event of ['phases', 'oppositions', 'conjunctions', 'planet-pair', 'seasons']) {
      const kind = event === 'planet-pair' ? 'conjunctions' : event;
      await page.click('[data-action="time"]');
      await page.click('[data-set-time="now"]');
      await page.click(`[data-view="${mode}"]`);
      await page.click('[data-action="events"]');
      await page.waitForSelector(`[data-event="${kind}"]`);
      const candidates = page.locator(`[data-event="${kind}"]`);
      const row = (event === 'planet-pair' ? candidates.filter({ hasText: 'Mars–Jupiter' }) : candidates).first();
      const title = await row.locator('b').textContent();
      const names = kind === 'phases' ? ['Moon'] : kind === 'seasons' ? ['Sun'] : kind === 'oppositions' ? [title.split(' ')[0]] : title.replace(' conjunction', '').split('–');
      if (kind !== 'conjunctions') {
        const count = await page.locator(`[data-event="${kind}"]`).count();
        assert.ok(count >= 4);
        await page.click(`[data-more="${kind}"]`);
        assert.equal(await page.locator(`[data-event="${kind}"]`).count(), count + 4);
      }
      await row.click();
      await page.waitForTimeout(900);
      const framing = await page.evaluate(async ({ names, mode }) => {
        const { skyFrame, findObject, pointVector, refractVector, unit3, dot3, lookAt, projectVector, chartRadius } = await import('/js/coelum.js');
        const { skyRadius } = await import('/js/coelumsky.js');
        const svg = document.querySelector('.coelum-full'), d = svg.dataset;
        const frame = skyFrame(Number(d.time), [45.4642, 9.19, 120]);
        const apparent = mode === 'sky' && document.querySelector('.coelum-canvas').dataset.atmosphere === 'true';
        const vectors = names.map((name) => {
          const v = pointVector(findObject(frame, name));
          return apparent ? refractVector(v, 120) : v;
        });
        const midpoint = vectors.length === 1 ? vectors[0] : unit3(vectors[0].map((x, i) => x + vectors[1][i]));
        const rotation = mode === 'sky' ? lookAt(Number(d.az), Number(d.alt)) : d.rotation.split(',').map(Number);
        const centerError = Math.acos(Math.min(1, dot3(midpoint, rotation.slice(6)))) * 180 / Math.PI;
        const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
        const radius = (mode === 'sky' ? skyRadius : chartRadius)(w, h, Number(d.scale));
        const visible = vectors.every((v) => {
          const p = projectVector(v, rotation, mode === 'sky');
          return p.z > 0 && Math.abs(p.x * radius) < w * 0.45 && Math.abs(p.y * radius) < h * 0.45;
        });
        return { centerError, visible };
      }, { names, mode });
      assert.ok(framing.centerError < 0.002, `${kind} ${mode}: centered (${framing.centerError}°)`);
      assert.ok(framing.visible, `${kind} ${mode}: bodies fit in the viewport`);
    }
  }
  await page.click('[data-action="time"]');
  await page.click('[data-set-time="now"]');
  await page.click('[data-action="events"]');

  // A solar eclipse: its map from the place, then the sky then, at the Sun
  await page.click('.coelum-event[data-event="solar"]');
  await page.waitForSelector('.map-svg.map-full path');
  assert.match(await page.locator('.map-local').textContent(), /partial eclipse, magnitude 0\.687, 62% of the Sun covered/);
  assert.equal(await page.locator('[data-map="calc"]').count(), 0, 'No Calculate here without the calculator');
  await page.click('[data-map="sky"]');
  await page.waitForFunction(() => document.querySelector('#sheet').hidden);
  assert.match(await status(), /Aug 2, 2027, 11:08 AM · Milan/);
  await page.waitForFunction(() => /^Sun/.test(document.querySelector('.coelum-detail-body').textContent), null, { timeout: 5000 });
  assert.equal(await page.locator('.coelum-extra').isVisible(), false, 'The panel closes for the sky');

  // A lunar eclipse, after the new time; anywhere on the Earth
  await page.click('[data-action="events"]');
  await page.click('[data-scope="anywhere"]');
  await page.waitForSelector('.coelum-event[data-event="lunar"]');
  list = await rows(page);
  assert.match(list.find(([k]) => k === 'solar')[1], /^Total solar eclipse \| Aug 2, 2027, 12:06 PM \| magnitude 1\.080$/, 'From the time of the sky');
  await page.click('.coelum-event[data-event="lunar"]');
  await page.waitForSelector('.lunar-sim .lunar-full .lunar-body');
  assert.equal(await page.locator('[data-lunar-sky]').count(), 0, 'Anywhere: no place to see it from');
  assert.match(await page.locator('.lunar-when').textContent(), /UTC \(\d\d:\d\d local\): /);
  await page.click('.sheet-head [data-close]');
  await page.click('[data-scope="here"]');

  // Satellites: the groups of the fixture, fetched once; visible passes
  // tonight from Milan, the first in the sky at its start
  await page.click('[data-action="time"]');
  await page.click('[data-set-time="now"]');
  await page.click('[data-action="events"]');
  await page.waitForSelector('[data-more="passes"]', { timeout: 60000 });
  const passes = (await rows(page)).filter(([k]) => k === 'passes').map(([, text]) => text);
  assert.ok(passes.length >= 3 && passes.length <= 10, `Ten passes at a time (${passes.length})`);
  for (const text of passes) assert.match(text, /^.+ \| Nov [89], 2026, \d\d:\d\d [AP]M – \d\d:\d\d [AP]M \| [NESW]+ → [NESW]+( into the shadow)? · highest \d+° · magnitude −?\d\.\d$/);
  assert.deepEqual([...new Set(celestrak)].sort(), ['stations', 'visual'], 'The groups chosen by default');
  assert.equal(celestrak.length, 2, 'Each group fetched once');
  const first = passes[0].split(' | ');
  await page.click('[data-event="passes"]');
  await page.waitForFunction((name) => document.querySelector('.coelum-detail-body h3')?.textContent === name, first[0], { timeout: 5000 });
  assert.equal((await status()).split(' · ')[0], first[1].split(' – ')[0], 'The sky at the start of the pass');
  assert.equal(await page.locator('[data-speed]').textContent(), '1×');
  assert.match(await page.locator('.coelum-detail-body').textContent(), /NORAD number\d+/);
  await page.click('[data-action="layers"]');
  assert.match(await page.locator('.coelum-satellite-note').textContent(), /^\d+ satellites, from CelesTrak under an hour ago; updated once a day/);
  await page.click('[data-action="layers"]');
  await page.fill('.coelum-search input', 'ISS');
  await page.waitForSelector('.coelum-results li');
  assert.match(await page.locator('.coelum-results').textContent(), /ISS \(ZARYA\)/);
  await page.fill('.coelum-search input', '');

  // Occultations by the Moon from Milan in the month: the first on its map,
  // then in the sky
  await page.click('[data-action="events"]');
  await page.waitForSelector('[data-more="occultations"]', { timeout: 60000 });
  const occultations = (await rows(page)).filter(([k]) => k === 'occultations').map(([, text]) => text);
  assert.match(occultations[0], /^52 Sgr behind the Moon \| Nov 14, 2026, 07:19 PM – 08:26 PM \| magnitude 4\.6 · in at the dark limb, out at the bright · 9° high · Moon 25% lit$/);
  await page.click('[data-event="occultations"]');
  await page.waitForSelector('.map-local p', { timeout: 30000 });
  assert.match(await page.locator('.map-local').textContent(), /52 Sgr occulted/);
  await page.click('[data-map="sky"]');
  await page.waitForFunction(() => document.querySelector('.coelum-detail-body h3')?.textContent === '52 Sgr', null, { timeout: 5000 });
  assert.match(await status(), /^Nov 14, 2026, 07:\d\d PM/);

  // Planetary moon events belong to the open planet's telescope page.
  assert.equal(await page.locator('[data-action="moon-events"]').isVisible(), false);
  await page.click('[data-action="time"]');
  await page.click('[data-set-time="now"]');
  await page.click('[data-action="time"]');
  const telescope = async (name) => {
    await page.fill('.coelum-search input', name);
    await page.keyboard.press('Enter');
    await page.waitForFunction((name) => document.querySelector('.coelum-detail-body h3')?.textContent === name, name);
    await page.locator('.coelum-moons-button').click();
  };
  await telescope('Jupiter');
  assert.equal(await page.locator('[data-action="moon-events"]').isVisible(), true);
  const headBox = await page.locator('.coelum-moons-head').boundingBox();
  assert.ok(headBox.x >= 0 && headBox.x + headBox.width <= 390, 'Moons header fits on a phone');
  await page.click('[data-action="moon-events"]');
  await page.waitForSelector('[data-moon-events-more]');
  assert.match(await page.locator('.coelum-moon-events h3').textContent(), /Jupiter/);
  const expectedMoons = await page.evaluate(async () => {
    const { planetMoonEvents } = await import('/js/mooneventspanel.js');
    return planetMoonEvents('jupiter', Number(document.querySelector('.coelum-full').dataset.time));
  });
  assert.equal(await page.locator('[data-moon-event]').count(), expectedMoons.length);
  assert.match(await page.locator('[data-moon-event] b').first().textContent(), /Io eclipse/);
  await page.click('[data-moon-events-more]');
  await page.waitForSelector('[data-moon-events-more]');
  const moonRows = await page.locator('[data-moon-event]').allTextContents();
  assert.ok(moonRows.length > expectedMoons.length);
  assert.equal(new Set(moonRows).size, moonRows.length, 'Daily pagination does not duplicate ongoing events');
  await page.locator('[data-moon-event]').first().click();
  assert.equal(await page.locator('.coelum-moon-events').isVisible(), false);
  assert.equal(await page.locator('.coelum-moonsview').isVisible(), true, 'Event stays in the planet telescope view');
  assert.ok(Math.abs(Number(await page.locator('.coelum-full').getAttribute('data-time')) - expectedMoons[0].t) < 1, 'Show the event at its midpoint');
  await page.click('[data-action="moon-events"]');
  await page.waitForSelector('[data-moon-events-more]');
  assert.match(await page.locator('[data-moon-event] small').first().textContent(), /Already in progress/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.coelum-moon-events').isVisible(), false);
  assert.equal(await page.locator('.coelum-moonsview').isVisible(), true, 'Escape closes events first');
  await page.click('[data-action="close-moons"]');
  assert.equal(await page.locator('[data-action="moon-events"]').isVisible(), false);
  await telescope('Saturn');
  await page.click('[data-action="moon-events"]');
  await page.waitForSelector('[data-moon-events-more]');
  assert.match(await page.locator('.coelum-moon-events h3').textContent(), /Saturn/);
  assert.doesNotMatch(await page.locator('.coelum-moon-events').textContent(), /Io |Europa |Ganymede |Callisto /);
  await page.click('[data-action="close-moons"]');
  assert.equal(await page.locator('.coelum-moon-events').isVisible(), false);
  await telescope('Mercury');
  assert.equal(await page.locator('[data-action="moon-events"]').isVisible(), false, 'No moon events for planets without moons');
  await page.click('[data-action="close-moons"]');

  // The place chosen is kept for the next opening
  await page.evaluate(() => localStorage.setItem('imks.coelumPlace', JSON.stringify({ lat: 41.9, lon: 12.5, h: 20, name: 'Rome' })));
  await page.reload();
  await page.waitForSelector('.coelum-full');
  assert.match(await status(), /Rome/);
  assert.equal(celestrak.length, 2, 'The satellites kept, not fetched again within a day');

  // Offline: the worker of iMKS, registered for this folder with a cache
  // of its own
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  assert.match(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), /\/sw\.js$/);
  assert.ok((await page.evaluate(() => caches.keys())).some((k) => /^coelum-v\d+$/.test(k)));
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.coelum-full');
  assert.match(await status(), /Rome/);
  await page.click('[data-action="events"]');
  await page.waitForSelector('.coelum-event');
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  console.log('Coelum app checks passed: local conjunction filtering and details, phases, oppositions and seasons in both scopes, event centering in both views, More, eclipses and occultations with their maps, satellite passes, places and offline');
} finally {
  await browser?.close();
  server.close();
}
