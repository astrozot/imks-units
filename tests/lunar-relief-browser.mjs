// Lunar terrain shadow hiding near opposition; PLAYWRIGHT/CHROME as in browser.mjs.
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
    const { planetMap, tracePlanet } = await import('/js/skyview.js');
    const { moonDisk } = await import('/js/astro.js');
    const map = planetMap('moon'); await map.ready;
    if (!map.img || !map.heights) throw Error('Lunar albedo and elevation maps must load');
    const { skyFrame } = await import('/js/coelum.js');
    const t = Date.parse('2026-11-24T21:00:00Z') / 1000;
    const moon = skyFrame(t, [45.46, 9.19, 120]).bodies.find((o) => o.body === 'moon');
    const base = { ...moonDisk(t, moon), earthshine: 0 };
    const n = 640, canvas = document.createElement('canvas');
    document.body.replaceChildren(); document.body.style.cssText = 'margin:0;background:#111;color:white;display:flex;flex-wrap:wrap';
    const results = [];
    // Both sides of opposition, plus lighting along the polar limb and a
    // quarter Moon to guard against removing genuine terminator shadows.
    for (const [angle, bearing] of [[0, 0], [0.1, 0], [-0.1, 0], [5, 0], [-5, 0], [5, 90], [-5, 90], [15, 0], [90, 0]]) {
      const a = angle * Math.PI / 180, b = bearing * Math.PI / 180;
      const disk = { ...base, sun: [Math.sin(a) * Math.cos(b), Math.sin(a) * Math.sin(b), Math.cos(a)] };
      if (!tracePlanet(canvas, disk, -1, 1, n, n, n / 2)) throw Error('WebGL unavailable');
      const gl = canvas.getContext('webgl'), pixels = new Uint8Array(n * n * 4), smooth = new Uint8Array(pixels.length);
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // Reuse the very same albedo, projection and exposure without relief.
      // At opposition the scattering ratio cancels the terrain normal, so
      // these images must agree even at crater rims near the limb.
      const prog = gl.getParameter(gl.CURRENT_PROGRAM);
      gl.uniform1i(gl.getUniformLocation(prog, 'relief'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, smooth);
      let dark = 0, worst = 1, sunwardDark = 0, terminatorDark = 0, maxError = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const r = Math.hypot((x + 0.5) * 2 / n - 1, (y + 0.5) * 2 / n - 1), i = 4 * (y * n + x);
        if (r > 0.94 && r < 0.995 && smooth[i] > 40) { const ratio = pixels[i] / smooth[i]; if (ratio < 0.5) dark++; worst = Math.min(worst, ratio); }
        if (r < 0.995) maxError = Math.max(maxError, Math.abs(pixels[i] - smooth[i]));
        if (r > 0.94 && r < 0.995 && ((x + 0.5 - n / 2) * Math.cos(b) + (y + 0.5 - n / 2) * Math.sin(b)) * Math.sign(angle) > n * 0.2 && smooth[i] > 40 && pixels[i] < smooth[i] * 0.5) sunwardDark++;
        if (r < 0.85 && smooth[i] > 60 && pixels[i] < smooth[i] * 0.25) terminatorDark++;
      }
      results.push({ angle, bearing, dark, worst, sunwardDark, terminatorDark, maxError });
      tracePlanet(canvas, disk, -1, 1, n, n, n / 2);
      const copy = document.createElement('canvas'); copy.width = copy.height = n; copy.getContext('2d').drawImage(canvas, 0, 0);
      const card = document.createElement('div'); card.append(`${angle}° phase · ${bearing}° bearing`, copy); document.body.append(card);
    }
    return results;
  });
  assert.deepEqual(errors, []);
  for (const r of result) {
    if (r.angle === 0) assert.ok(r.maxError <= 2, `Full Moon has no false relief shadows: ${JSON.stringify(r)}`);
    if (Math.abs(r.angle) === 0.1) assert.ok(r.worst > 0.8, `Shadows disappear continuously near opposition: ${JSON.stringify(r)}`);
    if (Math.abs(r.angle) === 5) assert.equal(r.sunwardDark, 0, `No dark artifacts on the sunward limb: ${JSON.stringify(r)}`);
    if (r.angle === 90) assert.ok(r.terminatorDark > 500, 'Quarter Moon retains deep terrain shadows near the terminator');
  }
  console.log('Lunar relief browser checks passed:', JSON.stringify(result));
  if (process.env.LUNAR_RELIEF_SCREENSHOT) await page.screenshot({ path: process.env.LUNAR_RELIEF_SCREENSHOT, fullPage: true });
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
