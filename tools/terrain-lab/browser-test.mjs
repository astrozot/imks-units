import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* next */ }
}
if (!chromium) throw new Error('Playwright is required for browser verification');
const filename = path.resolve(process.argv[2]), browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } }), errors = [], requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://**', (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(pathToFileURL(filename).href); await page.waitForFunction(() => window.terrainLab?.getResult());
  assert.ok(await page.locator('#metrics tr').count() >= 3);
  assert.match(await page.locator('#status').textContent(), /Saved comparison/);
  assert.equal(await page.evaluate(() => { const c = document.querySelector('#plot'); return [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].some((x, i) => i % 4 === 3 && x !== 0); }), true);
  const box = await page.locator('#plot').boundingBox(); await page.mouse.move(box.x + box.width * 0.55, box.y + 90);
  assert.match(await page.locator('#inspect').textContent(), /Current algorithm.*Mapterhorn/);
  assert.ok(!/NaN|undefined/.test(await page.locator('#viewpoint').textContent()));
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8')); assert.equal(exported.version, 1);
  await page.locator('#import').setInputFiles(await download.path()); await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved comparison loaded'));
  await page.locator('#site').selectOption('riva'); assert.equal(await page.locator('#lat').inputValue(), '45.89615');
  await page.screenshot({ path: filename.replace(/\.html$/, '-verified.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: filename.replace(/\.html$/, '-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('Terrain lab browser checks passed: standalone offline rendering, charts, inspection, JSON export/import, mobile layout.');
  // An optional explicit check of provider CORS using just one public tile each.
  if (process.argv.includes('--cors')) {
    await page.unroute('https://**');
    const checks = await page.evaluate(async () => Promise.all([
      'https://tiles.mapterhorn.com/14/8685/5835.webp',
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2171/1459.png',
    ].map(async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); return { url, ok: r.ok, bytes: (await r.blob()).size }; } catch (e) { return { url, ok: false, error: e.message }; } })));
    console.log(JSON.stringify({ corsChecks: checks }));
  }
} finally { await browser.close(); }
