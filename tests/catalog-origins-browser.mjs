// Detail origins must change positions without moving the chart observer.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(path.join(process.env.PLAYWRIGHT, 'index.mjs'));
const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? {executablePath: process.env.CHROME} : {});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  await context.route('https://celestrak.org/**', r => r.fulfill({contentType: 'application/json', body: '[]'}));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/coelum/`);
  await page.waitForSelector('.coelum-full');
  await page.evaluate(async () => {
    document.querySelector('#coelum').remove();
    const root = document.createElement('main'); root.id = 'coelum'; root.className = 'coelum-explorer'; document.body.append(root);
    const {mountCoelum} = await import('/js/coelumui.js');
    window.detailExplorer = mountCoelum(root, {t: Date.parse('2026-11-24T21:00Z') / 1000, place: [45, 9, 120], label: 'Milan'}, t => new Date(t * 1000).toISOString(), {standalone: true});
  });
  const basic = page.locator('[data-object-basic]'), controls = page.locator('[data-object-origin]');
  for (const name of ['Sirius', 'M31', 'α Centauri barycenter']) {
    await page.evaluate(name => detailExplorer.select(name, {details: true}), name);
    assert.ok(await controls.isVisible(), name);
    await page.locator('[data-catalog-origin="topocentric"]').click();
    await page.waitForSelector('[data-object-events] table');
    assert.match(await page.locator('[data-object-events]').textContent(), /Theoretical.*Local terrain/s);
    assert.match(await page.locator('[data-object-events]').textContent(), /Unavailable/);
    const local = await basic.textContent();
    assert.match(local, /Altitude \(Alt\)/);
    assert.match(local, /Solar light deflection/);
    await page.locator('[data-catalog-origin="geocentric"]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('[data-object-events]').isVisible(), false);
    const geo = await basic.textContent();
    assert.match(geo, /Earth’s centre/);
    assert.doesNotMatch(geo, /Altitude|Azimuth|refraction|below the horizon/);
    assert.match(geo, /Solar light deflection/);
    assert.notEqual(geo, local);
    await page.locator('[data-catalog-origin="heliocentric"]').click();
    const helio = await basic.textContent();
    assert.match(helio, /Sun’s centre/);
    assert.doesNotMatch(helio, /Altitude|Azimuth|<dt>Solar light deflection/);
    assert.equal(await basic.locator('dt').filter({hasText: 'Solar light deflection'}).count(), 0);
    const coords = text => text.match(/Right ascension \(RA\)(.*?)Galactic longitude/s)?.[1];
    assert.notEqual(coords(helio), coords(geo), 'Recomputes coordinates');
    const box = await controls.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'Fits mobile detail card');
    await page.locator('[data-catalog-origin="topocentric"]').click();
    assert.equal(await basic.textContent(), local, 'Local view restored');
  }
  await page.evaluate(() => detailExplorer.select('Moon', {details: true}));
  assert.equal(await controls.isVisible(), false);
  assert.ok(await page.locator('[data-precise-origin="geocentric"]').isVisible());
  await page.waitForSelector('[data-object-events] table');
  assert.match(await page.locator('[data-object-events]').textContent(), /Rise and set/);
  await page.locator('[data-precise-origin="geocentric"]').click();
  assert.equal(await page.locator('[data-object-events]').isVisible(), false);
  // A saved skyline supplies terrain times even when the ground layer is flat.
  await page.evaluate(() => {
    localStorage.setItem('imks-coelum-horizons', JSON.stringify({'46.000,10.000': {alt: Array(720).fill(10)}}));
    detailExplorer.setPlace({lat: 46, lon: 10, h: 120, name: 'Test ridge'});
    detailExplorer.select('Sun', {details: true});
  });
  await page.locator('[data-precise-origin="topocentric"]').click();
  await page.waitForSelector('[data-object-events] table');
  const events = page.locator('[data-object-events]');
  assert.doesNotMatch(await events.textContent(), /Unavailable/);
  const riseCells = await events.locator('tbody tr').first().locator('td').allTextContents();
  assert.notEqual(riseCells[0], riseCells[1]);
  await page.evaluate(() => detailExplorer.setTime(Date.parse('2026-11-25T12:00Z') / 1000));
  await page.waitForFunction(() => document.querySelector('[data-object-events]').textContent.includes('2026-11-25'));
  const box = await events.locator('table').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'Rise/set table fits mobile');
  assert.deepEqual(errors, []);
  console.log('Catalog detail origins, field visibility, keyboard switching and mobile layout passed');
} finally { await browser?.close(); server.close(); }
