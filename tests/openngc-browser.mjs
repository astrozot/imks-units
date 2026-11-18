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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://**', (route) => route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = `http://localhost:${server.address().port}/coelum/`;
  await page.goto(url);
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-openngc="download"]').click();
  await page.waitForFunction(() => document.querySelector('[data-openngc-note]')?.textContent.includes('13,366'));
  const result = await page.evaluate(async () => {
    const { skyFrame, searchSky, skyChart } = await import('/js/coelum.js');
    const frame = skyFrame(Date.now() / 1000, [45, 9, 0]);
    const samples = [];
    for (let i = 0; i < 5; i++) { const start = performance.now(); skyChart(frame); samples.push(performance.now() - start); }
    return { count: frame.deep.length, found: searchSky(frame, 'NGC 7814')[0].name, samples };
  });
  assert.equal(result.count, 13366); assert.equal(result.found, 'NGC 7814');
  console.log('Expanded SVG renders (ms):', result.samples.map(Math.round));
  // Wait for the service worker's full offline shell before losing the network.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-openngc-note]')?.textContent.includes('13,366'));
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-openngc="remove"]').click();
  await page.waitForFunction(() => document.querySelector('[data-openngc-note]')?.textContent.includes('232 Messier'));
  assert.equal(await page.evaluate(async () => (await import('/js/deepcatalog.js')).DEEP.length), 232);
  assert.deepEqual(errors, []);
  console.log('OpenNGC phone download, offline reload and removal passed');
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
