// Lunar lighting cache quality, invalidation and playback performance; PLAYWRIGHT/CHROME as in browser.mjs.
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
  if (process.env.LUNAR_CACHE_DEBUG) page.on('console', (e) => console.log(e.text()));
  const result = await page.evaluate(async (screenshot) => {
    const { planetMap, tracePlanet, downloadMoonDetail, removeMoonDetail } = await import('/js/skyview.js');
    const { moonDisk } = await import('/js/astro.js');
    const { skyFrame } = await import('/js/coelum.js');
    const t = Date.parse('2026-11-17T21:00:00Z') / 1000;
    const place = [45.46, 9.19, 120];
    const diskAt = (time) => moonDisk(time, skyFrame(time, place).bodies.find((o) => o.body === 'moon'));
    const map = planetMap('moon'); await map.ready;
    const base = { ...diskAt(t), earthshine: 0, sun: [1, 0, 0] };
    const canvas = document.createElement('canvas'), n = 512, scale = 6000;
    const pixels = new Uint8Array(n * n * 4), direct = new Uint8Array(pixels.length);
    const render = (disk, x = 0.02, y = n / (2 * scale), cached = true) => {
      if (!tracePlanet(canvas, disk, x, y, n, n, scale, { lunarCache: cached })) throw Error('WebGL unavailable');
      const gl = canvas.getContext('webgl');
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw Error('WebGL error');
    };
    const quality = [], timing = [];
    if (screenshot) { document.body.replaceChildren(); document.body.style.cssText = 'margin:0;background:#111;color:white;display:flex;flex-wrap:wrap;gap:12px;font:16px sans-serif'; }
    for (const high of [false, true]) {
      console.log('cache quality', high);
      if (high) await downloadMoonDetail();
      for (const [angle, x, y] of [[0, .02, .05], [45, .02, .05], [90, .02, .05], [90, .02, .3], [90, .97, .05], [45, -.6, .3], [120, .02, .05]]) {
        const a = angle * Math.PI / 180, disk = { ...base, sun: [Math.sin(a), 0, Math.cos(a)] };
        render(disk, x, y, false); direct.set(pixels);
        if (screenshot && high && angle === 90 && y === .3) {
          const card = document.createElement('div'), copy = document.createElement('canvas');
          copy.width = copy.height = n; copy.getContext('2d').drawImage(canvas, 0, 0);
          card.append('Direct lighting', copy); document.body.append(card);
        }
        render(disk, x, y, true);
        if (screenshot && high && angle === 90 && y === .3) {
          const card = document.createElement('div'), copy = document.createElement('canvas');
          copy.width = copy.height = n; copy.getContext('2d').drawImage(canvas, 0, 0);
          card.append('Cached lighting', copy); document.body.append(card);
        }
        const gl = canvas.getContext('webgl'), prog = gl.getParameter(gl.CURRENT_PROGRAM);
        if (gl.getUniform(prog, gl.getUniformLocation(prog, 'lunarLightingMap')) !== 4) throw Error('Cache must be enabled at deep zoom');
        let square = 0, abs = 0, max = 0, alpha = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const d = Math.abs(pixels[i] - direct[i]);
          square += d * d; abs += d; max = Math.max(max, d);
          alpha = Math.max(alpha, Math.abs(pixels[i + 3] - direct[i + 3]));
        }
        quality.push({ high, angle, x, y, rms: Math.sqrt(square / (n * n)), mean: abs / (n * n), max, alpha });
      }
      console.log('cache invalidation', high);
      // Count lighting passes: camera-only changes reuse the target, while
      // every physical lighting/view change must rebuild it immediately.
      render(base);
      const gl = canvas.getContext('webgl'), draw = gl.drawArrays.bind(gl);
      let updates = 0;
      gl.drawArrays = (...args) => { if (gl.getParameter(gl.FRAMEBUFFER_BINDING)) updates++; return draw(...args); };
      render(base); render(base, .021); render(base, .02);
      if (updates !== 0) throw Error(`Repeated frame and small pan must reuse illumination: ${updates}`);
      const change = { ...base, sun: [1, 0, .001] };
      render(change);
      if (updates !== 1) throw Error('Changed sunlight must invalidate the cache');
      const beforeEclipse = pixels.slice();
      render({ ...change, earthshine: .0001, eclipse: { x: .1, y: .1, umbra: .3, penumbra: .6, exposure: 10 } });
      if (updates !== 1) throw Error('Earthlight brightness and eclipse must remain live without rebuilding terrain');
      if (!pixels.some((v, i) => v !== beforeEclipse[i])) throw Error('Eclipse illumination must change the displayed image immediately');
      render({ ...change, earth: [0, .01, 1] });
      if (updates !== 2) throw Error('Changed Earth direction must invalidate the cache');
      render({ ...base, facing: { lon: base.facing.lon + .01 } });
      if (updates !== 3) throw Error('Changed libration must invalidate the cache');
      render(base, .5);
      if (updates !== 4) throw Error('Large pan must refresh coverage');
      console.log('cache real motion', high);
      // Real ephemerides change sunlight, observer direction and libration
      // together. No rounded timestamp or geometry may freeze playback.
      for (let frame = 0; frame < 3; frame++) {
        const disk = diskAt(t + frame * 3600), before = updates;
        render(disk);
        if (updates !== before + 1) throw Error('Actual lunar motion must refresh illumination on every frame');
        const cached = pixels.slice(); render(disk, .02, n / (2 * scale), false);
        let square = 0;
        for (let i = 0; i < pixels.length; i += 4) square += (pixels[i] - cached[i]) ** 2;
        if (Math.sqrt(square / (n * n)) > 4) throw Error('Animated lighting must match the current ephemeris');
      }
      gl.drawArrays = draw;
      console.log('cache benchmark', high);
      const bench = (cache, animate) => {
        render(base, .02, .05, cache);
        const start = performance.now();
        for (let i = 0; i < 8; i++) {
          const disk = animate ? { ...base, sun: [1, 0, i * .0002] } : base;
          render(disk, .02 + i * .0001, .05, cache);
        }
        return (performance.now() - start) / 8;
      };
      timing.push({ high, directMs: bench(false, false), cachedMs: bench(true, false), animationDirectMs: bench(false, true), animationCachedMs: bench(true, true) });
    }
    console.log('cache fallback');
    // Changing maps must never reuse an old lighting target.
    await removeMoonDetail();
    render(base);
    // Allocation failures fall back to direct shading rather than losing
    // the Moon or repeatedly attempting the optional target.
    const fallback = document.createElement('canvas'), fallbackGL = fallback.getContext('webgl');
    fallbackGL.checkFramebufferStatus = () => fallbackGL.FRAMEBUFFER_UNSUPPORTED;
    if (!tracePlanet(fallback, base, .02, .05, n, n, scale)) throw Error('Direct fallback unavailable');
    const fallbackProgram = fallbackGL.getParameter(fallbackGL.CURRENT_PROGRAM);
    if (fallbackGL.getUniform(fallbackProgram, fallbackGL.getUniformLocation(fallbackProgram, 'lunarCached'))) throw Error('Failed cache target must use direct lighting');
    if (fallbackGL.getError() !== fallbackGL.NO_ERROR) throw Error('Cache fallback left an invalid WebGL state');
    console.log('cache context recovery');
    const loss = glExtension(canvas);
    async function glExtension(target) {
      const gl = target.getContext('webgl'), ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      const event = (name) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error(`${name} did not arrive`)), 5000);
        target.addEventListener(name, () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
      const lost = event('webglcontextlost');
      ext.loseContext(); await lost;
      // Restoration becomes allowed after the loss event finishes dispatch.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (tracePlanet(target, base, .02, .05, n, n, scale)) throw Error('Lost context must request fallback');
      const restored = event('webglcontextrestored');
      ext.restoreContext(); await restored;
      render(base);
      return true;
    }
    return { quality, timing, contextRestored: await loss };
  }, Boolean(process.env.LUNAR_CACHE_SCREENSHOT));
  assert.deepEqual(errors, []);
  for (const q of result.quality) {
    assert.equal(q.alpha, 0, 'Lunar coverage is unchanged');
    assert.ok(q.rms < 4 && q.mean < 1.5, `Lighting interpolation remains close to direct rendering: ${JSON.stringify(q)}`);
  }
  if (process.env.LUNAR_CACHE_SCREENSHOT) await page.screenshot({ path: process.env.LUNAR_CACHE_SCREENSHOT, fullPage: true });
  console.log('Lunar lighting cache checks:', JSON.stringify(result));

} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
