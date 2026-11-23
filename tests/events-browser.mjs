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
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.clock.setFixedTime(new Date('2026-11-22T12:00:00Z'));
  await context.route('https://celestrak.org/**', route => route.fulfill({ json: [] }));
  // Count actual searches, including those that could finish without drawing rows.
  await context.route('**/js/eventspanel.js', async route => {
    let source = fs.readFileSync(path.join(root, 'js/eventspanel.js'), 'utf8');
    for (const name of ['solarEclipses', 'lunarEclipses', 'moonPhases', 'planetOppositions', 'planetElongations', 'equinoxesSolstices', 'planetConjunctions', 'satellitePassesSeen']) {
      source = source.replace(new RegExp(`(function ${name}\\([^)]*\\) \\{)`), `$1 globalThis.eventSearches ??= {}; globalThis.eventSearches.${name} = (globalThis.eventSearches.${name} || 0) + 1;`);
    }
    await route.fulfill({ contentType: 'text/javascript', body: source });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForSelector('.coelum-full');
  const panel = page.locator('[data-panel="events"]');
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.click('[data-action="time"]');
    const timeWidth = (await page.locator('.coelum-timepanel').boundingBox()).width;
    await page.click('.coelum-timepanel [data-action="close-panel"]');
    await page.click('[data-action="events"]');
    assert.ok(Math.abs((await panel.boundingBox()).width - timeWidth) < 1, 'Events matches Date and Time width');
    assert.equal(await panel.locator('details[open]').count(), 0);
    assert.equal(await panel.locator('[data-open-all]').textContent(), 'Open all');
    assert.deepEqual(await panel.locator('[data-category]').evaluateAll(els => els.map(el => el.dataset.category)),
      ['seasons', 'phases', 'conjunctions', 'oppositions', 'elongations', 'solar', 'lunar', 'occultations', 'passes']);
    await panel.locator('[data-action="close-panel"]').click();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('[data-action="events"]');
  assert.equal(await page.evaluate(() => Object.values(globalThis.eventSearches || {}).reduce((a, b) => a + b, 0)), 0, 'Collapsed sections perform no searches');
  const phases = panel.locator('[data-category="phases"]');
  await phases.locator('summary').focus(); await page.keyboard.press('Enter');
  await phases.locator('[data-more]').waitFor();
  assert.equal(await phases.locator('[data-event]').count(), 4);
  assert.deepEqual(await page.evaluate(() => globalThis.eventSearches), { moonPhases: 1 });
  await phases.locator('[data-more]').click();
  assert.equal(await phases.locator('[data-event]').count(), 8);
  await phases.locator('summary').click(); await phases.locator('summary').click();
  await phases.locator('[data-more]').waitFor();
  assert.equal(await page.evaluate(() => globalThis.eventSearches.moonPhases), 2, 'Reopening retains cached results');
  const conjunctions = panel.locator('[data-category="conjunctions"]');
  await conjunctions.locator('summary').click();
  await page.waitForFunction(() => globalThis.eventSearches.planetConjunctions > 0);
  await conjunctions.locator('summary').click();
  const stopped = await conjunctions.innerHTML();
  await page.waitForTimeout(150);
  assert.equal(await conjunctions.innerHTML(), stopped, 'Closed section stops updating');
  await conjunctions.locator('summary').click();
  await conjunctions.locator('[data-more]').waitFor({ timeout: 60000 });
  await panel.locator('[data-scope="anywhere"]').click();
  await phases.locator('[data-more]').waitFor();
  assert.equal(await phases.locator('[data-event]').count(), 4, 'Scope changes refresh expanded categories');
  await panel.locator('[data-open-all]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-category]')].every(el => el.open));
  for (const kind of ['solar', 'lunar', 'phases', 'oppositions', 'elongations', 'seasons', 'conjunctions', 'occultations']) {
    await panel.locator(`[data-category="${kind}"] [data-more]`).waitFor({ timeout: 60000 });
  }
  assert.equal(await panel.locator('[data-category="passes"]').count(), 0, 'Anywhere omits local satellite passes');
  const toggleAll = panel.locator('[data-open-all]');
  assert.equal(await toggleAll.textContent(), 'Close all');
  await phases.locator('summary').click();
  await page.waitForFunction(() => document.querySelector('[data-open-all]').textContent === 'Open all');
  await phases.locator('summary').click();
  await page.waitForFunction(() => document.querySelector('[data-open-all]').textContent === 'Close all');
  await toggleAll.click();
  assert.equal(await panel.locator('details[open]').count(), 0, 'Close all collapses every category');
  assert.equal(await toggleAll.textContent(), 'Open all');
  await toggleAll.click();
  await page.waitForFunction(() => document.querySelector('[data-open-all]').textContent === 'Close all');
  await panel.locator('[data-scope="here"]').click();
  assert.equal(await toggleAll.textContent(), 'Open all', 'The newly available satellite category is collapsed');
  await panel.locator('[data-category="passes"] summary').click();
  await page.waitForFunction(() => document.querySelector('[data-open-all]').textContent === 'Close all');
  await panel.locator('[data-action="close-panel"]').click();
  await page.click('[data-action="events"]');
  assert.equal(await panel.locator('details[open]').count(), 0, 'A fresh panel starts collapsed');
  assert.deepEqual(errors, []);
  console.log('Events browser passed: matching widths, lazy searches, keyboard accordion, caching, pagination, cancellation, scope, category order and Open all/Close all');
} finally {
  await browser?.close(); server.close();
}
