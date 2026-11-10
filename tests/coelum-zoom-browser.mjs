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
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  const result = await page.evaluate(async () => {
    const { skyFrame, lookAt, R } = await import('/js/coelum.js');
    const { skyScene } = await import('/js/coelumsky.js');
    const { planetMap, moonsView, skySVG, tracePlanet, drawPlanet } = await import('/js/skyview.js');
    const { moonDisk, equatorial, nextPhase } = await import('/js/astro.js');
    const { skyView } = await import('/js/sky.js');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const frame = skyFrame(Date.parse('2026-11-24T21:00:00Z') / 1000, [41.892, 12.511, 20]);
    const moon = frame.bodies.find((o) => o.body === 'moon');
    const W = 360, H = 240, canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const layers = { ground: false, atmosphere: false, milkyway: false };
    const lunarFrame = { ...frame, bodies: [frame.bodies[0], moon], stars: [] };
    check(await planetMap('moon').ready, 'Moon texture loaded');
    // Compare real shader pixels with identical geometry and different
    // Earth phases/light directions, so sunlight and texture cancel out.
    const earthCanvas = document.createElement('canvas'), side = 160;
    const start = Date.UTC(2026, 10, 1) / 1000;
    const phaseDisk = (phase) => {
      const t = nextPhase(start, phase);
      return moonDisk(t, equatorial('moon', t));
    };
    const fullEarth = phaseDisk(0), quarterEarth = phaseDisk(90), newEarth = phaseDisk(180);
    const base = { ...fullEarth, sun: [1, 0, 0], earth: [0, 0, 1] };
    const pixelsFor = (earthshine, earth = base.earth) => {
      check(tracePlanet(earthCanvas, { ...base, earthshine, earth }, -1, 1, side, side, side / 2), 'Moon shader compiles and draws');
      const gl = earthCanvas.getContext('webgl'), pixels = new Uint8Array(side * side * 4);
      gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      check(gl.getError() === gl.NO_ERROR, 'Moon shader has no WebGL errors');
      let sum = 0;
      for (let y = 48; y < 112; y++) for (let x = 48; x < 112; x++) {
        const i = (y * side + x) * 4;
        sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      }
      return sum;
    };
    const dark = pixelsFor(0), bright = pixelsFor(fullEarth.earthshine), quarter = pixelsFor(quarterEarth.earthshine), faint = pixelsFor(newEarth.earthshine);
    check(bright > quarter && quarter > faint && faint >= dark, 'Earthshine pixels follow Earth phase');
    check(bright - dark > 1000, 'Earthshine is visibly rendered');
    check(pixelsFor(fullEarth.earthshine, [0, 0, -1]) === dark, 'Slopes facing away from Earth receive no earthlight');
    const earthlight = { dark, bright, quarter, faint };
    let scene = skyScene(lunarFrame, W, H, layers, { rotation: lookAt(moon.az, moon.alt), scale: 20 }, ctx);
    check(scene.hitLabels.some((l) => l.name === 'Moon'), 'Small Moon retains its label');
    scene = skyScene(lunarFrame, W, H, layers, { rotation: lookAt(moon.az, moon.alt), scale: 100, selected: 'Moon' }, ctx);
    check(!scene.hitLabels.some((l) => l.name === 'Moon'), 'Large Moon hides its label even when selected');
    const edges = [];
    for (const [daz, dalt] of [[0.2 / Math.cos(moon.alt * R), 0], [-0.2 / Math.cos(moon.alt * R), 0], [0, 0.2], [0, -0.2]]) {
      const az = moon.az + daz, alt = moon.alt + dalt;
      const star = { name: 'Occluded star', az, alt, mag: -5, bv: 0 };
      scene = skyScene({ ...lunarFrame, stars: [star] }, W, H, layers, { rotation: lookAt(az, alt), scale: 600 }, ctx);
      const disk = scene.objects.find((o) => o.body === 'moon');
      check(disk, 'Moon survives with its center beyond the viewport margin');
      check(disk.x < -60 || disk.x > W + 60 || disk.y < -60 || disk.y > H + 60, 'Test actually puts the center off screen');
      check(!scene.objects.some((o) => o.name === star.name), 'Offscreen Moon still hides background stars');
      const pixels = ctx.getImageData(0, 0, W, H).data;
      check(pixels.some((v, i) => i % 4 !== 3 && v > 50), 'Lunar surface remains visible');
      edges.push([disk.x, disk.y]);
    }
    // A large Jupiter must not darken the surrounding sky at its limb.
    const jupiter = frame.bodies.find((o) => o.body === 'jupiter');
    const planetFrame = { ...frame, bodies: [frame.bodies[0], jupiter], stars: [] };
    const view = { rotation: lookAt(jupiter.az, jupiter.alt), scale: 3000 };
    skyScene({ ...planetFrame, bodies: [frame.bodies[0]] }, W, H, layers, view, ctx);
    const background = ctx.getImageData(0, 0, W, H).data;
    skyScene(planetFrame, W, H, layers, view, ctx);
    const foreground = ctx.getImageData(0, 0, W, H).data;
    check(foreground.every((v, i) => i % 4 === 3 || v >= background[i]), 'Planet limb blends with the sky');
    // Check the close-up canvas and exported SVG paths too.
    const sky = skyView('jupiter', frame.t), stage = document.createElement('div');
    stage.className = 'sky-stage'; stage.style.cssText = 'width:360px;height:240px';
    stage.innerHTML = '<canvas class="sky-canvas"></canvas><svg class="sky-svg sky-full"></svg>';
    document.body.replaceChildren(stage);
    const control = moonsView(stage, sky);
    control.size(W, H);
    check(getComputedStyle(stage.querySelector('.sky-canvas')).mixBlendMode === 'screen', 'Close-up canvas blends with its background');
    check(skySVG(sky, W, H, 0, 0, 100).includes('mix-blend-mode:screen'), 'SVG export blends with its background');
    for (const planet of ['venus', 'mercury']) {
      const inner = skyView(planet, frame.t);
      control.set(inner);
      check(getComputedStyle(stage.querySelector('.sky-canvas')).mixBlendMode === 'normal', `${planet} keeps its silhouette`);
      check(skySVG(inner, W, H, 0, 0, 100).includes('mix-blend-mode:normal'), `${planet} SVG keeps its silhouette`);
    }
    // Resolve the globe's shadow across the B ring: its physical penumbra
    // is only a few pixels even at 12,000 pixels per planetary radius.
    check((await planetMap('saturn').ready)?.rings, 'Saturn ring profiles loaded');
    const saturn = { planet: 'saturn', pole: [0, Math.sqrt(0.84), 0.4], sun: [-1, 0, 0], moons: [], t: frame.t };
    const crop = (cpu) => {
      const c = document.createElement('canvas');
      if (cpu) c.getContext('2d');
      const gpu = drawPlanet(c, saturn, 100, 100, 1.4, -0.4, 12000, 1);
      check(cpu || gpu, 'Saturn shader compiles');
      const copy = document.createElement('canvas'); copy.width = 100; copy.height = 100;
      const g = copy.getContext('2d'); g.drawImage(c, 0, 0);
      return g.getImageData(0, 0, 100, 100).data;
    };
    const gpu = crop(false), cpu = crop(true);
    const rows = Array.from({ length: 100 }, (_, y) => gpu[(100 * y + 50) * 4]);
    const lo = Math.min(...rows), hi = Math.max(...rows);
    check(hi > lo + 10, 'Resolved Saturn shadow has dark and lit sides');
    check(rows.filter((v) => v > lo + (hi - lo) * 0.15 && v < lo + (hi - lo) * 0.85).length >= 3, 'Saturn shadow resolves a penumbra');
    const mean = gpu.reduce((sum, v, i) => sum + Math.abs(v - cpu[i]), 0) / gpu.length;
    check(mean < 2, `Saturn GPU/fallback penumbra agrees: ${mean}`);
    // Exercise transmission through the ring texture onto the globe,
    // including a close crop of its B-ring shadow edge.
    const ringShadow = { ...saturn, pole: [0, 0, 1], sun: [Math.sqrt(0.84), 0, -0.4] };
    const ringPixels = [];
    for (const fallback of [false, true]) {
      const c = document.createElement('canvas');
      if (fallback) c.getContext('2d');
      check(!drawPlanet(c, ringShadow, 100, 100, 0.962, 0, 12000, 1) === fallback, 'Saturn ring-shadow renderer selected');
      const copy = document.createElement('canvas'); copy.width = 100; copy.height = 100;
      const g = copy.getContext('2d'); g.drawImage(c, 0, 0);
      ringPixels.push(g.getImageData(0, 0, 100, 100).data);
    }
    const ringMean = ringPixels[0].reduce((sum, v, i) => sum + Math.abs(v - ringPixels[1][i]), 0) / ringPixels[0].length;
    check(ringMean < 2, `Saturn GPU/fallback ring shadow agrees: ${ringMean}`);
    return { edges, earthlight, saturnPenumbra: { lo, hi, mean, ringMean } };
  });
  assert.equal(result.edges.length, 4);
  console.log('Coelum high-zoom checks passed:', JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
