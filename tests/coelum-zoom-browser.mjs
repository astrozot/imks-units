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
    // Synthetic alignments exercise both catalog orders, full and partial
    // occultations, dark hemispheres, and foreground sources nearer than Moon.
    const { skyRadius } = await import('/js/coelumsky.js');
    const occultScale = 5000, px = skyRadius(W, H, occultScale) / 2;
    const occultView = { rotation: lookAt(moon.az, moon.alt), scale: occultScale };
    const occultLayers = { ...layers, labels: false, minor: true };
    const occultations = [];
    for (const foregroundBody of ['moon', 'jupiter']) {
      const original = frame.bodies.find((o) => o.body === foregroundBody);
      const foreground = { ...original, ra: moon.ra, dec: moon.dec, az: moon.az, alt: moon.alt,
        dist: (foregroundBody === 'moon' ? 1737.4 : 71492) / Math.sin(80 / px) };
      const baseFrame = { ...frame, bodies: [frame.bodies[0], foreground], stars: [], deep: [] };
      skyScene(baseFrame, W, H, occultLayers, occultView, ctx);
      const baseline = ctx.getImageData(0, 0, W, H).data;
      for (const body of ['jupiter', 'saturn', 'minor', 'comet', 'satellite', 'star']) {
        if (body === foregroundBody) continue;
        for (const offset of [0, 82]) {
          const originalTarget = frame.bodies.find((o) => o.body === body) || {};
          const target = { ...originalTarget, name: `Occulted ${body}`, body, mag: -5, bv: 0,
            ra: moon.ra, dec: moon.dec, alt: moon.alt,
            az: moon.az + offset / px / R / Math.cos(moon.alt * R),
            dist: Math.max(originalTarget.dist || 1e10, foreground.dist * 2),
            lit: true, satellite: { group: 'stations' } };
          const sources = body === 'star' ? { stars: [target] } : { bodies: [frame.bodies[0], target, foreground] };
          const scene = skyScene({ ...baseFrame, ...sources }, W, H, occultLayers, occultView, ctx);
          const pixels = ctx.getImageData(0, 0, W, H).data;
          let changesOutside = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const radius = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2), i = 4 * (y * W + x);
            const difference = Math.max(...[0, 1, 2].map((c) => Math.abs(pixels[i + c] - baseline[i + c])));
            if (radius < 77) check(difference === 0, `${foregroundBody} hides ${body} at offset ${offset}`);
            if (radius > 83 && difference > 2) changesOutside++;
          }
          if (offset && body !== 'star') check(changesOutside > 0, `${body} remains visible beyond foreground limb`);
          if (!offset && ['minor', 'comet', 'satellite', 'star'].includes(body)) {
            check(!scene.objects.some((o) => o.name === target.name), `Fully occulted ${body} is not selectable`);
          }
          if (!offset && ['minor', 'comet', 'satellite'].includes(body)) {
            const nearer = { ...target, name: 'Nearer source', dist: foreground.dist / 2 };
            const nearScene = skyScene({ ...baseFrame, bodies: [frame.bodies[0], nearer, foreground] }, W, H, occultLayers, occultView, ctx);
            check(nearScene.objects.some((o) => o.name === nearer.name), `Nearer ${body} remains visible`);
            const center = ctx.getImageData(W / 2, H / 2, 1, 1).data, i = 4 * ((H / 2) * W + W / 2);
            check(center.some((v, c) => c < 3 && v !== baseline[i + c]), `Nearer ${body} is drawn over foreground disk`);
          }
          occultations.push(`${foregroundBody}/${body}/${offset}`);
        }
      }
    }
    // Fully hiding the Sun must preserve its corona outside the lunar limb.
    const eclipseMoon = { ...moon, dist: 1737.4 / Math.sin(80 / px) };
    const eclipseSun = { ...frame.bodies[0], ra: moon.ra, dec: moon.dec, az: moon.az, alt: moon.alt,
      dist: 695700 / Math.sin(50 / px) };
    const eclipseFrame = { ...frame, stars: [], bodies: [{ ...eclipseSun, hidden: true }, eclipseMoon] };
    skyScene(eclipseFrame, W, H, occultLayers, occultView, ctx);
    const noCorona = ctx.getImageData(0, 0, W, H).data;
    skyScene({ ...eclipseFrame, bodies: [eclipseSun, eclipseMoon] }, W, H, occultLayers, occultView, ctx);
    const corona = ctx.getImageData(0, 0, W, H).data;
    let coronaPixels = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Math.hypot(x - W / 2, y - H / 2) < 83) continue;
      const i = 4 * (y * W + x);
      if (corona[i] > noCorona[i] + 5) coronaPixels++;
    }
    check(coronaPixels > 100, 'Totality retains the solar corona');
    // A large Jupiter must not darken the surrounding sky at its limb.
    const jupiter = frame.bodies.find((o) => o.body === 'jupiter');
    const planetFrame = { ...frame, bodies: [frame.bodies[0], jupiter], stars: [] };
    const view = { rotation: lookAt(jupiter.az, jupiter.alt), scale: 3000 };
    skyScene({ ...planetFrame, bodies: [frame.bodies[0]] }, W, H, layers, view, ctx);
    const background = ctx.getImageData(0, 0, W, H).data;
    skyScene(planetFrame, W, H, layers, view, ctx);
    const foreground = ctx.getImageData(0, 0, W, H).data;
    check(foreground.every((v, i) => i % 4 === 3 || v >= background[i]), 'Planet limb blends with the sky');
    // The ordinary sky must use the same textured geometry as the optional
    // planet view, including its rotation on the screen and Saturn's rings.
    const surfaces = [];
    for (const body of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      check(await planetMap(body).ready, `${body} map loaded`);
      const o = frame.bodies.find((o) => o.body === body);
      const { skyRadius } = await import('/js/coelumsky.js');
      const { diskRadius } = await import('/js/coelum.js');
      const scale = 55 / (diskRadius(o) * R * skyRadius(W, H, 1) / 2);
      const isolated = { ...frame, bodies: [frame.bodies[0], o], stars: [], deep: [], constellations: [] };
      const scene = skyScene(isolated, W, H, { ...layers, labels: false }, { rotation: lookAt(o.az, o.alt), scale }, ctx);
      check(scene.surfaceBodies.includes(body), `${body} requests its detailed surface`);
      const actual = ctx.getImageData(0, 0, W, H).data;
      const model = skyView(body, frame.t), reference = document.createElement('canvas');
      check(tracePlanet(reference, model, -W / 2 / 55, H / 2 / 55, W, H, 55), `${body} uses GPU`);
      const copy = document.createElement('canvas'); copy.width = W; copy.height = H;
      const g = copy.getContext('2d');
      const n = { ra: o.ra, dec: o.dec + 0.001 };
      const { projectVector, pointVector } = await import('/js/coelum.js');
      const north = projectVector(pointVector({ ...n, ...frame.hor(n) }), lookAt(o.az, o.alt), true);
      const angle = Math.atan2(north.y, north.x) + Math.PI / 2;
      g.translate(W / 2, H / 2); g.rotate(angle); g.drawImage(reference, -W / 2, -H / 2);
      const expected = g.getImageData(0, 0, W, H).data;
      let difference = 0, count = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = 4 * (y * W + x);
        // Stay off the resampled edge and faint night side; the sky's
        // point glow contributes slightly beneath the resolved surface.
        if (expected[i + 3] < 250 || Math.max(...expected.slice(i, i + 3)) < 80) continue;
        for (let c = 0; c < 3; c++) { difference += Math.abs(actual[i + c] - expected[i + c]); count++; }
      }
      check(count > 100, `${body} has visible detailed pixels`);
      const mean = difference / count;
      check(mean < 18, `${body} sky matches planet renderer: ${mean}`);
      surfaces.push({ body, scale, mean });
    }
    // Texture begins as soon as the physical disk resolves the point source,
    // before the former ten-pixel cutoff.
    const jupiterScale = 7 / (skyView('jupiter', frame.t).radius / 3600 * R * skyRadius(W, H, 1) / 2);
    const small = skyScene(planetFrame, W, H, { ...layers, labels: false }, { rotation: lookAt(jupiter.az, jupiter.alt), scale: jupiterScale }, ctx);
    check(small.surfaceBodies.includes('jupiter'), 'Seven-pixel Jupiter is already textured');
    // Every mapped Galilean moon survives with the planet outside the view,
    // both as a point and as a resolved texture. Compare to the same GPU
    // tracer used in the optional planet view, recentered on the moon.
    const { planetMoons, projectVector, pointVector } = await import('/js/coelum.js');
    const moonSurfaces = [];
    for (const name of ['Io', 'Europa', 'Ganymede', 'Callisto']) {
      for (const dt of [0, 3600]) {
        const f = skyFrame(frame.t + dt, frame.place), parent = f.bodies.find((o) => o.body === 'jupiter');
        const moon = planetMoons(f, parent).find((o) => o.name === name);
        check(!moon.hidden, `${name} test is outside the planetary disk`);
        const model = skyView('jupiter', f.t), satellite = model.moons.find((o) => o.name === name);
        const scale = 40 / (moon.diameter / 2 * R * skyRadius(W, H, 1) / 2);
        check(scale < 4000000, `${name} resolves within the zoom limit`);
        for (const magnification of [7 * satellite.r / 40, 0.03, 1]) {
          const view = { rotation: lookAt(moon.az, moon.alt), scale: scale * magnification, selected: name };
          const scene = skyScene(f, W, H, { ...layers, labels: false }, view, ctx);
          const visible = scene.objects.find((o) => o.name === name);
          check(visible && Math.hypot(visible.x - W / 2, visible.y - H / 2) < 0.01, `${name} remains centered`);
          if (magnification === 0.03) continue;
          if (magnification === 1) check(!scene.objects.some((o) => o.body === 'jupiter'), `${name} is visible with Jupiter off screen`);
          else check(moon.diameter / 2 * R * skyRadius(W, H, view.scale) / 2 < 1, `${name} gets a texture before resolving its own disk`);
          check(scene.surfaceBodies.includes('jupiter'), `${name} requests its atlas independently`);
          const actual = ctx.getImageData(0, 0, W, H).data;
          const reference = document.createElement('canvas');
          const s = visible.radius / satellite.r;
          check(tracePlanet(reference, { ...model, moonsOnly: true }, satellite.x - W / 2 / s, satellite.y + H / 2 / s, W, H, s), `${name} GPU texture`);
          const copy = document.createElement('canvas'); copy.width = W; copy.height = H;
          const g = copy.getContext('2d'), n = { ra: moon.ra, dec: moon.dec + 0.001 };
          const north = projectVector(pointVector({ ...n, ...f.hor(n) }), view.rotation, true);
          const angle = Math.atan2(north.y, north.x) + Math.PI / 2;
          g.translate(W / 2, H / 2); g.rotate(angle); g.drawImage(reference, -W / 2, -H / 2);
          const expected = g.getImageData(0, 0, W, H).data;
          let difference = 0, count = 0;
          const sample = Math.min(28, Math.floor(visible.radius * 0.65));
          for (let y = H / 2 - sample; y <= H / 2 + sample; y++) for (let x = W / 2 - sample; x <= W / 2 + sample; x++) {
            if (Math.hypot(x - W / 2, y - H / 2) > sample) continue;
            const i = 4 * (y * W + x);
            for (let c = 0; c < 3; c++) { difference += Math.abs(actual[i + c] - expected[i + c]); count++; }
          }
          check(difference / count < 4, `${name} matches mapped texture: ${difference / count}`);
          moonSurfaces.push({ name, dt, scale: view.scale, mean: difference / count });
        }
      }
    }
    let transit;
    {
      // In transit, a moon overlay must contain only the moon, and replace
      // the planet beneath it rather than screening a second rectangular crop.
      const { moons } = await import('/js/astro.js');
      let transitTime;
      for (let dt = 0; dt < 3 * 86400; dt += 600) {
        const io = moons('jupiter', frame.t + dt).moons.find((m) => m.name === 'Io');
        if (io.view.z > 0 && Math.hypot(io.view.x, io.view.y) < 0.6) { transitTime = frame.t + dt; break; }
      }
      check(transitTime, 'Found an Io transit');
      const tf = skyFrame(transitTime, frame.place), j = tf.bodies.find((o) => o.body === 'jupiter');
      const io = planetMoons(tf, j).find((o) => o.name === 'Io'), model = skyView('jupiter', transitTime);
      const m = model.moons.find((o) => o.name === 'Io'), s = 25 / m.r;
      const scale = 25 / (io.diameter / 2 * R * skyRadius(W, H, 1) / 2);
      const view = { rotation: lookAt(io.az, io.alt), scale };
      skyScene(tf, W, H, { ...layers, labels: false }, view, ctx);
      const actual = ctx.getImageData(0, 0, W, H).data;
      const ref = document.createElement('canvas'), copy = document.createElement('canvas'); copy.width = W; copy.height = H;
      check(tracePlanet(ref, model, m.x - W / 2 / s, m.y + H / 2 / s, W, H, s), 'Full Io/Jupiter reference');
      const g = copy.getContext('2d'), n = { ra: io.ra, dec: io.dec + 0.001 };
      const north = projectVector(pointVector({ ...n, ...tf.hor(n) }), view.rotation, true);
      g.translate(W / 2, H / 2); g.rotate(Math.atan2(north.y, north.x) + Math.PI / 2); g.drawImage(ref, -W / 2, -H / 2);
      const expected = g.getImageData(0, 0, W, H).data;
      let moonDifference = 0, outsideDifference = 0, moonCount = 0, outsideCount = 0;
      for (let y = H / 2 - 35; y < H / 2 + 35; y++) for (let x = W / 2 - 35; x < W / 2 + 35; x++) {
        const radius = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2), i = 4 * (y * W + x);
        for (let c = 0; c < 3; c++) {
          const delta = Math.abs(actual[i + c] - expected[i + c]);
          if (radius < 22) { moonDifference += delta; moonCount++; }
          if (radius > 29) { outsideDifference += delta; outsideCount++; }
        }
      }
      transit = { t: transitTime, moonMean: moonDifference / moonCount, outsideMean: outsideDifference / outsideCount };
      check(transit.moonMean < 4, `Transit moon replaces Jupiter: ${transit.moonMean}`);
      check(transit.outsideMean < 4, `No rectangular transit highlight: ${transit.outsideMean}`);
      // A direct overlay has transparent corners even over the bright disk.
      check(tracePlanet(ref, { ...model, moonsOnly: true }, m.x - 1.1 * m.r, m.y + 1.1 * m.r, 56, 56, s), 'Io overlay');
      const gl = ref.getContext('webgl'), corner = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, corner);
      check(corner[3] === 0, 'Moon crop corner is transparent over Jupiter');
    }
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
    return { edges, earthlight, occultations, surfaces, moonSurfaces, transit, saturnPenumbra: { lo, hi, mean, ringMean } };
  });
  assert.equal(result.edges.length, 4);
  // Lock a mapped moon through UI zooms and time changes, with its parent
  // outside the frame. The canvas must keep a resolved, detailed surface.
  const locked = await page.evaluate(async () => {
    const { mountCoelum } = await import('/js/coelumui.js');
    const { skyFrame, planetMoons, projectVector, pointVector, lookAt, R } = await import('/js/coelum.js');
    const { skyRadius } = await import('/js/coelumsky.js');
    const host = document.createElement('div'); host.className = 'coelum-explorer';
    document.body.replaceChildren(host);
    localStorage.setItem('imks-coelum-mode', 'sky');
    const t = Date.parse('2026-11-24T21:00:00Z') / 1000, place = [41.892, 12.511, 20];
    const explorer = mountCoelum(host, { t, place, label: 'Rome' }, String, { standalone: true });
    for (const key of ['ground', 'atmosphere', 'labels', 'milkyway']) {
      const box = host.querySelector(`[data-layer="${key}"]`); box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    explorer.focus('Ganymede', { fit: true, field: 0.005 });
    await new Promise((r) => setTimeout(r, 750));
    host.querySelector('[data-action="lock"]').click();
    const svg = host.querySelector('.coelum-full');
    while (Number(svg.dataset.scale) < 120000) host.querySelector('[data-action="in"]').click();
    const samples = [];
    for (const dt of [0, 3600]) {
      explorer.setTime(t + dt);
      const f = skyFrame(t + dt, place), planet = f.bodies.find((o) => o.body === 'jupiter');
      const moon = planetMoons(f, planet).find((o) => o.name === 'Ganymede');
      const rotation = lookAt(Number(svg.dataset.az), Number(svg.dataset.alt));
      const W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height, scale = Number(svg.dataset.scale), radius = skyRadius(W, H, scale);
      const q = projectVector(pointVector(moon), rotation, true);
      const canvas = host.querySelector('.coelum-canvas'), ctx = canvas.getContext('2d'), k = canvas.width / W;
      const pixels = ctx.getImageData(Math.round((W / 2 - 20) * k), Math.round((H / 2 - 20) * k), Math.round(40 * k), Math.round(40 * k)).data;
      const values = new Set();
      for (let i = 0; i < pixels.length; i += 4) values.add(pixels[i]);
      if (Math.hypot(q.x * radius, q.y * radius) > 1) throw new Error('Locked Ganymede drifted');
      if (values.size < 15) throw new Error('Locked Ganymede lost its texture');
      samples.push({ dt, scale, surfaceValues: values.size, radius: moon.diameter / 2 * R * radius / 2 });
    }
    if (host.querySelector('[data-action="lock"]').getAttribute('aria-pressed') !== 'true') throw new Error('Moon lock was lost');
    host.remove();
    return samples;
  });
  assert.equal(locked.length, 2);
  // A device without WebGL retains the shaded sky disks and rings.
  const fallback = await browser.newPage();
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /webgl/.test(type) ? null : getContext.call(this, type, ...args);
    };
  });
  await fallback.goto(`http://localhost:${server.address().port}/coelum/`);
  const fallbackBodies = await fallback.evaluate(async () => {
    const { skyFrame, lookAt } = await import('/js/coelum.js');
    const { skyScene } = await import('/js/coelumsky.js');
    const { planetMap } = await import('/js/skyview.js');
    const f = skyFrame(Date.parse('2026-11-24T21:00:00Z') / 1000, [41.892, 12.511, 20]);
    const c = document.createElement('canvas'); c.width = 360; c.height = 240;
    const ctx = c.getContext('2d');
    const bodies = [];
    for (const body of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      await planetMap(body).ready;
      const o = f.bodies.find((o) => o.body === body);
      const scene = skyScene({ ...f, bodies: [f.bodies[0], o], stars: [] }, 360, 240,
        { ground: false, atmosphere: false, labels: false, milkyway: false },
        { rotation: lookAt(o.az, o.alt), scale: 40000 }, ctx);
      if (!scene.objects.some((o) => o.body === body)) throw new Error(`${body} missing without WebGL`);
      if (!ctx.getImageData(180, 120, 1, 1).data.slice(0, 3).some((v) => v > 0)) throw new Error(`${body} fallback is blank`);
      bodies.push(body);
    }
    const moon = f.bodies.find((o) => o.body === 'moon');
    const view = { rotation: lookAt(moon.az, moon.alt), scale: 5000 };
    const layers = { ground: false, atmosphere: false, labels: false, milkyway: false, minor: true };
    const base = { ...f, bodies: [f.bodies[0], moon], stars: [] };
    skyScene(base, 360, 240, layers, view, ctx);
    const baseline = ctx.getImageData(0, 0, 360, 240).data;
    for (const body of ['jupiter', 'minor', 'comet']) {
      const original = f.bodies.find((o) => o.body === body) || {};
      const target = { ...original, name: `Hidden ${body}`, body, mag: -5, dist: 1e10,
        ra: moon.ra, dec: moon.dec, az: moon.az, alt: moon.alt };
      const scene = skyScene({ ...base, bodies: [f.bodies[0], moon, target] }, 360, 240, layers, view, ctx);
      const pixels = ctx.getImageData(0, 0, 360, 240).data;
      if (!pixels.every((v, i) => v === baseline[i])) throw new Error(`${body} leaks through fallback Moon`);
      if (scene.objects.some((o) => o.name === target.name)) throw new Error(`${body} selectable behind fallback Moon`);
    }
    return bodies;
  });
  assert.equal(fallbackBodies.length, 7);
  await fallback.close();
  console.log('Coelum high-zoom checks passed:', JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
