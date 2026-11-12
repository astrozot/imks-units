// Optional lunar maps, deep-zoom quality and rendering cost; PLAYWRIGHT/CHROME as in browser.mjs.
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
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, serviceWorkers: 'block' });
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const result = await page.evaluate(async () => {
    const { planetMap, tracePlanet, downloadMoonDetail } = await import('/js/skyview.js');
    const { moonDisk } = await import('/js/astro.js');
    const { skyFrame } = await import('/js/coelum.js');
    const map = planetMap('moon'); await map.ready;
    const t = Date.parse('2026-11-24T21:00:00Z') / 1000;
    const moon = skyFrame(t, [45.46, 9.19, 120]).bodies.find((o) => o.body === 'moon');
    const disk = { ...moonDisk(t, moon), earthshine: 0, sun: [1, 0, 0] };
    const canvas = document.createElement('canvas'), n = 512, scale = 6000;
    const checks = [];
    for (const high of [false, true]) {
      if (high) await downloadMoonDetail();
      if (Boolean(map.highResolution) !== high) throw Error('Map selection did not change');
      if (high && (map.img.width !== 8192 || map.heights.width !== 5760)) throw Error('Wrong map dimensions');
      if (!tracePlanet(canvas, disk, 0.02, n / (2 * scale), n, n, scale, { lunarCache: false })) throw Error('WebGL unavailable');
      const gl = canvas.getContext('webgl'), prog = gl.getParameter(gl.CURRENT_PROGRAM);
      const single = gl.getUniformLocation(prog, 'lunarSingleRay');
      if (!gl.getUniform(prog, single)) throw Error('Deep zoom must use one interior ray');
      if (Boolean(gl.getUniform(prog, gl.getUniformLocation(prog, 'fineHeights'))) !== high) throw Error('Wrong height decoding');
      const pixels = new Uint8Array(n * n * 4), reference = new Uint8Array(pixels.length);
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const time = (one) => {
        gl.uniform1i(single, one ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, reference);
        const t = performance.now();
        for (let i = 0; i < 12; i++) { gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, reference); }
        return (performance.now() - t) / 12;
      };
      const fourMs = time(false), oneMs = time(true);
      gl.uniform1i(single, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, reference);
      let sum = 0, nonzero = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        sum += (pixels[i] - reference[i]) ** 2;
        if (pixels[i] > 0) nonzero++;
      }
      const rms = Math.sqrt(sum / (n * n));
      if (rms > 3) throw Error(`Single-ray magnification differs excessively: ${rms}`);
      if (high && gl.getError() !== gl.NO_ERROR) throw Error('High-resolution upload failed');
      if (!nonzero) throw Error('Moon was not rendered');
      // Deep zoom on the limb must retain the same fractional coverage.
      tracePlanet(canvas, disk, 0.98, n / (2 * scale), n, n, scale, { lunarCache: false });
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.uniform1i(single, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, reference);
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== reference[i]) throw Error('Silhouette smoothing changed');
      tracePlanet(canvas, disk, 0.02, n / (2 * scale), n, n, scale, { lunarCache: false });
      checks.push({ high, fourMs, oneMs, speedup: fourMs / oneMs, rms });
      // Preserve visual comparisons for optional screenshot inspection.
      gl.uniform1i(single, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const copy = document.createElement('canvas'); copy.width = copy.height = n;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      const label = document.createElement('div'); label.textContent = high ? '16-bit / 16 pixels per degree' : '8-bit / 4 pixels per degree';
      document.body.append(label, copy);
    }
    return checks;
  });
  assert.deepEqual(errors, []);
  // A fresh module/page must restore both maps entirely from persistent cache.
  await page.reload();
  await page.route('**/img/planets/moon-8k.jpg', (route) => route.abort());
  await page.route('**/img/planets/moon-heights-16.png', (route) => route.abort());
  const restored = await page.evaluate(async () => {
    const { planetMap, removeMoonDetail, downloadMoonDetail } = await import('/js/skyview.js');
    const map = planetMap('moon'); await map.ready;
    const stored = Boolean(map.highResolution);
    await removeMoonDetail();
    const removed = !map.highResolution && map.heights.width === 1440;
    let failed = false;
    try { await downloadMoonDetail(); } catch { failed = true; }
    return { stored, removed, failed, retainedDefault: !map.highResolution && map.heights.width === 1440 };
  });
  assert.deepEqual(restored, { stored: true, removed: true, failed: true, retainedDefault: true });
  await page.unroute('**/img/planets/moon-8k.jpg');
  await page.unroute('**/img/planets/moon-heights-16.png');
  await page.reload();
  await page.locator('[data-action="layers"]').click();
  await page.locator('[data-moon-detail="download"]').click();
  await page.locator('[data-moon-detail="remove"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-moon-detail-note]').textContent(), /stored for offline/);
  if (process.env.LUNAR_DETAIL_SCREENSHOT) await page.screenshot({ path: process.env.LUNAR_DETAIL_SCREENSHOT });
  await page.locator('[data-moon-detail="remove"]').click();
  await page.locator('[data-moon-detail="download"]').waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  console.log('Lunar detail browser checks passed:', JSON.stringify({ result, restored }));

} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
