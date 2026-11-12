// High-magnification rendering regressions; PLAYWRIGHT/CHROME as in browser.mjs.
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
    const { skyFrame, lookAt } = await import('/js/coelum.js');
    const { skyScene, skyRadius, moonTexture } = await import('/js/coelumsky.js');
    const { planetMap, tracePlanet, lunarShadowLight, lunarEclipseColor, lunarShadowMean } = await import('/js/skyview.js');
    const { moonDisk } = await import('/js/astro.js');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    await planetMap('moon').ready; await moonTexture;
    const t = Date.parse('2029-12-20T22:42:00Z') / 1000;
    const frame = skyFrame(t, [45.46, 9.19, 120]), moon = frame.bodies.find((o) => o.body === 'moon');
    const base = { ...moonDisk(t, moon), sun: [0, 0, 1], earthshine: 0 };
    const n = 240, canvas = document.createElement('canvas');
    const read = (disk, x0 = -1, y0 = 1, w = n, h = n) => {
      check(tracePlanet(canvas, disk, x0, y0, w, h, n / 2), 'GPU lunar surface draws');
      const gl = canvas.getContext('webgl'), data = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      check(gl.getError() === gl.NO_ERROR, 'No GL errors');
      // Return rows top down, like the Canvas2D fallback.
      return Uint8Array.from({ length: data.length }, (_, i) => data[((h - 1 - Math.floor(i / (4 * w))) * w * 4) + i % (4 * w)]);
    };
    const normal = read(base);
    let meanError = 0, count = 0;
    for (const [x, y] of [[2.6, 0], [0, 2.6], [1.4, -0.9]]) {
      const eclipse = { x, y, umbra: 2.6, penumbra: 4.6, exposure: 3 };
      const pixels = read({ ...base, eclipse });
      for (let j = 30; j < n - 30; j += 3) for (let i = 30; i < n - 30; i += 3) {
        const at = 4 * (j * n + i), dx = 2 * (i + 0.5) / n - 1, dy = 1 - 2 * (j + 0.5) / n;
        if (Math.hypot(dx, dy) > 0.8) continue;
        const rgb = lunarEclipseColor(Array.from(normal.slice(at, at + 3), (v) => v / 255),
          lunarShadowLight(eclipse, Math.hypot(dx - x, dy - y)), eclipse.exposure);
        for (let k = 0; k < 3; k++) { meanError += Math.abs(pixels[at + k] - 255 * rgb[k]); count++; }
      }
      const cropped = read({ ...base, eclipse }, -0.5, 0.5, n / 2, n / 2);
      let cropError = 0;
      for (let j = 0; j < n / 2; j++) for (let i = 0; i < n / 2; i++) for (let k = 0; k < 3; k++) {
        cropError = Math.max(cropError, Math.abs(cropped[4 * (j * n / 2 + i) + k] - pixels[4 * ((j + n / 4) * n + i + n / 4) + k]));
      }
      check(cropError <= 1, 'Eclipse position independent of crop/zoom');
    }
    meanError /= count;
    check(meanError < 1.5, `GPU matches linear-light CPU model: ${meanError}`);
    // Actual sky path, including camera roll and no-WebGL fallback. Use a
    // near-side photograph in the latter.
    const proto = HTMLCanvasElement.prototype, original = proto.getContext;
    const layers = { ground: false, atmosphere: false, milkyway: false, labels: false };
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#10141b;color:#cbd5e1;font:15px system-ui;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:15px';
    const draw = (time, fallback = false, roll = 0) => {
      const f = skyFrame(Date.parse(time) / 1000, [45.46, 9.19, 120]), m = f.bodies.find((o) => o.body === 'moon');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 360;
      const ctx = canvas.getContext('2d'), rotation = lookAt(m.az, m.alt), c = Math.cos(roll), s = Math.sin(roll);
      const rotated = [...rotation.slice(0, 3).map((v, k) => c * v + s * rotation[k + 3]),
        ...rotation.slice(3, 6).map((v, k) => -s * rotation[k] + c * v), ...rotation.slice(6)];
      if (fallback) proto.getContext = function(kind, ...args) { return kind === 'webgl' ? null : original.call(this, kind, ...args); };
      try { skyScene({ ...f, stars: [], bodies: [f.bodies[0], m] }, 360, 360, layers,
        { rotation: rotated, scale: 130 / (skyRadius(360, 360, 1) / 2 * Math.asin(1737.4 / m.dist)) }, ctx); }
      finally { proto.getContext = original; }
      const card = document.createElement('div');
      card.textContent = `${time.slice(11, 16)} UTC · ${fallback ? 'fallback' : 'GPU'}${roll ? ' · rolled' : ''}`;
      card.appendChild(canvas); document.body.appendChild(card);
      return { pixels: ctx.getImageData(0, 0, 360, 360).data, canvas, shadow: m.shadow };
    };
    const phases = ['2029-12-20T20:20:00Z', '2029-12-20T21:20:00Z', '2029-12-20T22:42:00Z'];
    const gpu = phases.map((t) => draw(t));
    const rolled = draw(phases[1], false, Math.PI / 2);
    let rollError = 0, samples = 0;
    for (let j = 70; j < 290; j++) for (let i = 70; i < 290; i++) {
      if (Math.hypot(i - 179.5, j - 179.5) > 105) continue;
      for (let k = 0; k < 3; k++) { rollError += Math.abs(gpu[1].pixels[4 * (j * 360 + i) + k] - rolled.pixels[4 * ((359 - i) * 360 + j) + k]); samples++; }
    }
    rollError /= samples;
    check(rollError < 2, `Eclipse follows camera roll: ${rollError}`);
    // Force the already cached WebGL renderer to report context loss.
    // The prototype intercept also handles a new renderer if allocated.
    const lost = WebGLRenderingContext.prototype.isContextLost;
    WebGLRenderingContext.prototype.isContextLost = () => true;
    let fallback;
    try { fallback = [draw(phases[1], true), draw(phases[2], true)]; }
    finally { WebGLRenderingContext.prototype.isContextLost = lost; }
    for (const surface of [gpu[2], fallback[1]]) {
      let red = 0, green = 0, max = 0;
      for (let j = 80; j < 280; j++) for (let i = 80; i < 280; i++) {
        if (Math.hypot(i - 180, j - 180) > 95) continue;
        const at = 4 * (j * 360 + i); red += surface.pixels[at]; green += surface.pixels[at + 1]; max = Math.max(max, surface.pixels[at]);
      }
      check(red > green * 2 && max > 20 && max < 190, 'Totality is dim, red and textured in both renderers');
      check(surface.pixels[4 * (20 * 360 + 20)] === 0, 'Eclipse leaves surrounding sky alone');
    }
    return { meanError, rollError, totality: lunarShadowMean(moon.shadow) };
  });
  assert.deepEqual(errors, []);
  if (process.env.ECLIPSE_SCREENSHOT) await page.screenshot({ path: process.env.ECLIPSE_SCREENSHOT, fullPage: true });
  console.log('Lunar eclipse browser checks passed:', JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
