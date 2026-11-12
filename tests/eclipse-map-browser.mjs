// Solar eclipse rendering, resizing and gestures in Coelum.
// node tests/eclipse-map-browser.mjs; PLAYWRIGHT/CHROME as browser.mjs.
// BROWSER=webkit BROWSER_EXECUTABLE=/path/to/pw_run.sh checks WebKit.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { chromium = (await import(name))[process.env.BROWSER || 'chromium']; break; } catch { /* try next */ }
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
  const executablePath = process.env.BROWSER_EXECUTABLE || (process.env.BROWSER !== 'webkit' && process.env.CHROME);
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await context.clock.setFixedTime(new Date(process.env.ECLIPSE_DATE || '2026-11-12T12:00:00Z'));
  await context.route('https://celestrak.org/**', route => route.fulfill({ contentType: 'application/json', body: '[]', headers: { 'access-control-allow-origin': '*' } }));
  await context.addInitScript(() => {
    localStorage.setItem('imks.coelumPlace', JSON.stringify({lat:45.46,lon:9.19,h:120,name:'Milan'}));
    localStorage.setItem('imks.solarView', JSON.stringify('sim'));
    localStorage.setItem('imks.coelumTimeZone', JSON.stringify('location'));
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.click('[data-action="events"]');
  await page.click('[data-scope="anywhere"]');
  await page.click('.coelum-event[data-event="solar"]');
  const globe = page.locator('.map-full');
  await globe.locator('.map-coast').waitFor();
  // Dismissal of Events must not interfere with subsequent map gestures.
  await page.click('[data-map-mode="sim"]');
  await page.click('[data-map-mode="map"]');
  const geometry = () => globe.evaluate(el => {
    const [, , w, h] = el.getAttribute('viewBox').split(' ').map(Number);
    return { radius: Number(el.querySelector('.map-sea').getAttribute('r')), base: Math.min(w,h)/2-8, w, width: el.clientWidth };
  });
  const fitted = async () => {
    await page.waitForTimeout(150);
    const g = await geometry();
    assert.ok(Math.abs(g.radius-g.base)<0.2, `Globe fits its viewport: ${JSON.stringify(g)}`);
    assert.ok(Math.abs(g.w-g.width)<1, 'Projection uses the displayed width');
  };
  await fitted();
  const coast = () => globe.locator('.map-coast').getAttribute('d');
  const original = await coast(), box = await globe.boundingBox();
  if (process.env.BROWSER !== 'webkit') {
    // Real touchscreen input exercises pointer capture and scroll prevention.
    const cdp = await context.newCDPSession(page);
    const point = { x: box.x+box.width*.4, y: box.y+box.height*.5 };
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[point]});
    for (let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:point.x+i*8,y:point.y}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  } else {
    await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);
    await page.mouse.down();
    await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5,{steps:8});
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  assert.notEqual(await coast(),original,'Dragging turns the globe');
  for (const mode of ['sim','map','sim']) {
    await page.click(`[data-map-mode="${mode}"]`);
    await fitted();
    assert.ok((await coast()).length>1000,'Coastlines remain rendered');
    assert.equal(await page.locator('.map-sim').isVisible(),mode==='sim');
    if (mode==='sim') {
      assert.equal(await globe.locator('.map-shade').count(),5);
      await page.click('[data-map-t]:text-is("max")');
      assert.match(await page.locator('.map-when').textContent(),/umbra/);
      await page.locator('[data-map="play"]').click();
      const before = await page.locator('.map-slider').inputValue();
      await page.waitForTimeout(250);
      assert.notEqual(await page.locator('.map-slider').inputValue(),before,'Simulation advances');
      await page.locator('[data-map="play"]').click();
    }
  }
  await page.setViewportSize({width:844,height:390});
  await fitted();
  await page.setViewportSize({width:390,height:844});
  await fitted();
  if (process.env.ECLIPSE_SCREENSHOT) await page.screenshot({path:process.env.ECLIPSE_SCREENSHOT});
  assert.deepEqual(errors,[]);
  console.log('Eclipse globe checks passed');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
