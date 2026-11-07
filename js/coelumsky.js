// The realistic view of coelum: a stereographic camera at the horizon, the
// sky's colour with the time of day, stars dimmed by twilight, moonlight and
// extinction, the Milky Way, the Sun's glare, the textured Moon with its
// phase, and a landscape in front. Always drawn on a canvas.
import { R, pen, lookAt, planetMoons, hasMoons, diskRadius, saturnRings, skyGrid, gridLabelAt, projectVector, pointVector, refractVector, eachFaint, faintObject, placeLabels, horizonToJ2000, findObject, reticle, deepColor, fontFor } from './coelum.js';
import { skyRaster, skyLight, hillAt } from './skyraster.js';

const FLAT = () => 0;
export const SKY_LAYERS = { horizon: 'landscape', ground: true, atmosphere: true, milkyway: true, constellations: false, boundaries: false, ecliptic: false, horizontal: false, equatorial: false, deep: false, minor: false, labels: true, labelSize: 14 };
// The diagonal of the view spans 140° at scale 1.
export const skyRadius = (W, H, scale) => Math.hypot(W, H) / 2 / Math.tan(35 * R) * scale;
// The default direction: toward the Sun near sunrise or sunset, otherwise
// toward the equator; tilted up so the horizon sits low in the view.
export function defaultSkyView(frame, W, H) {
  const sun = frame.bodies[0], az = sun.alt > -15 && sun.alt < 8 ? sun.az : frame.place[0] >= 0 ? 180 : 0;
  return { az, alt: 2 * Math.atan(0.24 * H / skyRadius(W, H, 1)) / R, scale: 1, auto: true };
}

// B−V to colour (after M. Charity's blackbody star colours, a little less
// saturated, as the eye sees them).
const BV = [[-0.4, [155, 178, 255]], [-0.1, [175, 196, 255]], [0.15, [212, 222, 255]], [0.4, [245, 245, 255]], [0.65, [255, 244, 228]], [0.9, [255, 228, 196]], [1.3, [255, 206, 156]], [2, [255, 180, 110]]];
const bvRGB = (bv) => {
  let i = 1;
  while (i < BV.length - 1 && bv > BV[i][0]) i++;
  const [a, ca] = BV[i - 1], [b, cb] = BV[i], u = Math.max(0, Math.min(1, (bv - a) / (b - a)));
  return ca.map((x, k) => Math.round(x + (cb[k] - x) * u));
};
const BODY_RGB = { sun: [255, 246, 228], moon: [240, 238, 230], mercury: [230, 218, 205], venus: [255, 250, 232], mars: [255, 178, 140], jupiter: [255, 238, 214], saturn: [252, 236, 190], uranus: [196, 240, 238], neptune: [176, 196, 255], minor: [225, 218, 205], comet: [190, 245, 225] };

// Soft glow sprites, one per colour.
const sprites = new Map();
function glow(rgb) {
  const key = rgb.join(',');
  if (sprites.has(key)) return sprites.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${key},0.9)`); grad.addColorStop(0.12, `rgba(${key},0.45)`); grad.addColorStop(0.4, `rgba(${key},0.1)`); grad.addColorStop(1, `rgba(${key},0)`);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

// The near side of the Moon (north up), as in the lunar eclipse sheet.
let moonImage = null;
export const moonTexture = typeof Image === 'undefined' ? Promise.resolve(null) : new Promise((resolve) => {
  const img = new Image();
  img.onload = () => { moonImage = img; resolve(img); };
  img.onerror = () => resolve(null);
  img.src = new URL('../img/moon.webp', import.meta.url).href;
});

// Extinction (mag) at an altitude (degrees), with a plain airmass.
const extinction = (alt) => { const s = Math.sin(Math.max(alt, 0) * R); return 0.22 * (1 / (s + 0.025 * Math.exp(-11 * s)) - 1); };

export function skyScene(frame, W, H, layers, view, ctx) {
  const opts = { ...SKY_LAYERS, ...layers }, radius = skyRadius(W, H, view.scale), rotation = lookAt(view.az, view.alt);
  const cx = W / 2, cy = H / 2, p = pen(ctx), f = (x) => x.toFixed(2);
  const sun = frame.bodies[0], moon = frame.bodies[1];
  const illum = (1 + Math.cos(moon.phase * R)) / 2;
  const light = skyLight(sun.alt, { alt: moon.alt, illum }, opts.atmosphere);
  const proj = (v) => { const q = projectVector(v, rotation, true); return { x: cx + q.x * radius, y: cy + q.y * radius, z: q.z }; };
  // With the atmosphere, objects are seen raised by the refraction (for the
  // pressure at the place's height); the horizontal grid is not.
  const height = frame.place[2] || 0, refract = opts.atmosphere ? (v) => refractVector(v, height) : (v) => v;
  const apparent = (v) => { const q = proj(v); q.alt = Math.asin(Math.max(-1, Math.min(1, v[2]))) / R; q.az = (Math.atan2(v[0], v[1]) / R + 360) % 360; return q; };
  const xy = (o) => apparent(refract(pointVector(o)));
  // The horizon: a generic landscape, the local terrain, or flat.
  const hill = opts.horizon === 'flat' ? FLAT : opts.horizon === 'terrain' && opts.terrain ? opts.terrain : hillAt;
  const bg = skyRaster(ctx, {
    W, H, radius, camera: { rotation, stereographic: true }, samples: view.moving ? 22000 : 45000, toJ2000: horizonToJ2000(frame), kind: 'sky',
    milkyWay: opts.milkyway, ground: opts.ground, atmosphere: opts.atmosphere, hill,
    sun: { alt: sun.alt, vector: refract(pointVector(sun)) }, moon: { alt: moon.alt, illum, vector: refract(pointVector(moon)) },
  });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bg.sky, 0, 0, bg.w, bg.h, 0, 0, bg.width, bg.height);
  const above = (q) => !opts.ground || q.alt > hill(q.az);
  const onScreen = (q, r) => q.z > -0.2 && q.x > -r && q.x < W + r && q.y > -r && q.y < H + r;
  // Lines: drawn before the ground, which hides them; segments far behind
  // the camera are dropped.
  const line = (points, st, fixed = false) => {
    let d = '', last = null;
    for (const o of points) {
      const q = fixed ? proj(pointVector(o)) : xy(o);
      if (last && q.z > -0.3 && last.z > -0.3 && Math.hypot(q.x - last.x, q.y - last.y) < Math.max(W, H)) d += `M${f(last.x)},${f(last.y)}L${f(q.x)},${f(q.y)}`;
      last = q;
    }
    p.path(d, st);
  };
  const fade = opts.atmosphere ? 1 - 0.7 * light.day : 1;
  // Grids, denser as the view zooms in; labels are drawn with the others.
  const gridLabels = [];
  for (const [kind, stroke, opacity] of [['horizontal', '#7fbf8f', 0.45], ['equatorial', '#6f95e6', 0.5]]) {
    if (!opts[kind]) continue;
    const fixed = kind === 'horizontal';
    for (const g of skyGrid(kind, frame, rotation.slice(6, 9), 2 * Math.atan(Math.hypot(W, H) / 2 / radius) / R, radius / 2 * R)) {
      line(g.points, { stroke, width: 0.7, opacity: opacity * fade }, fixed);
      const q = gridLabelAt({ parallel: g.parallel, points: g.points.map((o) => (fixed ? apparent(pointVector(o)) : xy(o))) }, W, H, (o) => o.z > 0 && above(o));
      if (q) gridLabels.push([q, g.label, stroke, opacity * fade]);
    }
  }
  if (opts.boundaries && frame.boundaries) for (const b of frame.boundaries) line(b, { stroke: '#c49a7a', width: 0.7, dash: [2, 3], opacity: 0.45 * fade });
  if (opts.ecliptic && frame.ecliptic) line(frame.ecliptic, { stroke: '#e3b45c', width: 1, dash: [6, 4], opacity: 0.6 * fade });
  const labels = [], objects = [];
  if (opts.constellations) for (const k of frame.constellations) {
    if (k.curves) for (const l of k.curves) line(l, { stroke: '#6d9be0', width: 0.9, opacity: 0.55 * fade });
    else for (const l of k.lines) line(l, { stroke: '#6d9be0', width: 0.9, opacity: 0.55 * fade });
    const q = xy(k);
    if (above(q) && onScreen(q, 0)) labels.push({ ...q, name: k.name, color: `rgba(140,175,230,${0.8 * fade})`, r: 0, priority: 4, size: Math.max(10, opts.labelSize - 2), center: true });
  }
  if (opts.deep) for (const o of frame.deep) {
    const q = xy(o);
    if (!above(q) || !onScreen(q, 5)) continue;
    p.circle(q.x, q.y, 4.5, { stroke: deepColor(o.type), width: 1, opacity: 0.75 * fade });
    objects.push({ ...o, x: q.x, y: q.y, radius: 4.5 });
    labels.push({ ...q, name: o.name, color: deepColor(o.type), r: 5.5, priority: 3 });
  }
  // Stars: visible to the sky's limiting magnitude, dimmed near the
  // horizon; brighter ones with a soft halo. Sizes follow the magnitude
  // below the limit, which deepens as the view zooms in, so a magnified
  // cluster keeps its bright and faint members apart.
  const zoom = Math.log2(Math.max(1, view.scale)), limit = light.limit + 0.8 * zoom, grow = Math.min(1.4, 1 + 0.1 * zoom);
  const point = (o, mag, rgb, q) => {
    const rel = limit - mag;
    if (rel < 0) return 0;
    const r = Math.min(4.2, 0.5 + 0.05 * rel * rel) * grow, a = Math.min(1, Math.max(0.15, rel / 1.8));
    if (rel > 4 || o.body) {
      const s = r * (o.body ? 9 : 7) * (0.6 + 0.4 * Math.max(0, Math.min(1, (rel - 4) / 4)));
      ctx.globalAlpha = Math.min(1, 0.55 * a * (opts.atmosphere ? 1 : 0.6)); ctx.drawImage(glow(rgb), q.x - s, q.y - s, 2 * s, 2 * s);
    }
    ctx.globalAlpha = a; ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    return r;
  };
  for (const o of frame.stars) {
    const q = xy(o);
    if (!onScreen(q, 4) || !above(q)) continue;
    const r = point(o, o.mag + (opts.atmosphere ? extinction(o.alt) : 0), bvRGB(o.bv), q);
    if (!r) continue;
    objects.push({ ...o, x: q.x, y: q.y, radius: r });
    if (o.name === view.selected || o.named && o.mag < (view.scale > 1.5 ? 4.5 : 2.5) && o.mag + 0.5 < limit) labels.push({ ...q, name: o.name, color: `rgba(215,225,240,${0.85 * fade + 0.15})`, r, priority: 2 });
  }
  // Downloaded fainter stars, to the same limit.
  eachFaint(frame, limit, (i, v, mag) => {
    const q = apparent(refract(v));
    if (!onScreen(q, 2) || !above(q)) return;
    const o = faintObject(frame, i, v), r = point(o, mag + (opts.atmosphere ? extinction(o.alt) : 0), bvRGB(o.bv), q);
    if (r) objects.push({ ...o, x: q.x, y: q.y, radius: r });
  });
  const moonsOf = [];
  for (const o of frame.bodies) {
    const minor = o.body === 'minor' || o.body === 'comet';
    if (minor && !opts.minor && o.name !== view.selected) continue;
    const q = xy(o);
    if (!onScreen(q, 60) || !above(q)) continue;
    const pxPerRad = radius / 2 / Math.cos(Math.acos(Math.max(-1, Math.min(1, q.z))) / 2) ** 2;
    let r;
    if (o.body === 'sun') {
      const reddening = opts.atmosphere ? Math.exp(-Math.max(0, o.alt) / 4) : 0, rgb = [255, Math.round(246 - 90 * reddening), Math.round(228 - 170 * reddening)];
      r = Math.max(5, Math.asin(695700 / o.dist) * pxPerRad);
      const s = r * 9;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9; ctx.drawImage(glow(rgb), q.x - s, q.y - s, 2 * s, 2 * s);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
    } else if (o.body === 'moon') {
      r = Math.max(6, Math.asin(1737.4 / o.dist) * pxPerRad);
      drawMoon(ctx, o, q, r, xy(o.light), xy(o.north), light, opts.atmosphere);
    } else {
      r = point(o, o.mag + (opts.atmosphere ? extinction(o.alt) : 0), BODY_RGB[o.body], q);
      if (!r) continue;
      const disk = diskRadius(o) * R * pxPerRad;
      if (disk > r) { drawPlanet(ctx, o, q, disk, xy(o.light), o.body === 'saturn' && saturnRings(frame, o, xy, disk)); r = disk; }
    }
    objects.push({ ...o, x: q.x, y: q.y, radius: Math.max(r, 4) });
    labels.push({ ...q, name: o.name, color: o.body === 'sun' || o.body === 'moon' ? '#fff1c9' : '#ffc98f', r: Math.max(r, 3), priority: o.name === view.selected ? 0 : minor ? 2 : 1, important: !minor, mag: o.mag });
    if (hasMoons(o) && pxPerRad * R > 20) moonsOf.push([o, r, pxPerRad * R]);
  }
  // Zoomed in, the planets' moons, to the same limiting magnitude.
  for (const [o, r, pxPerDeg] of moonsOf) for (const m of planetMoons(frame, o)) {
    if (m.hidden || m.separation * pxPerDeg < r + 3) continue;
    const q = xy(m);
    if (!onScreen(q, 4) || !above(q)) continue;
    const mr = point(m, m.mag + (opts.atmosphere ? extinction(m.alt) : 0), BODY_RGB[o.body], q);
    if (!mr && m.name !== view.selected) continue;
    objects.push({ ...m, x: q.x, y: q.y, radius: Math.max(mr, 3) });
    labels.push({ ...q, name: m.name, color: '#ffd9b0', r: Math.max(mr, 2), priority: m.name === view.selected ? 0 : 2, mag: m.mag });
  }
  if (bg.ground) ctx.drawImage(bg.ground, 0, bg.groundY, bg.w, bg.h, 0, 0, bg.width, bg.height);
  // Cardinal points on the horizon, then labels over everything.
  for (const [name, az, size, color] of [['N', 0, 17, '#ff8a6b'], ['NE', 45, 12, '#ffb49e'], ['E', 90, 17, '#ff8a6b'], ['SE', 135, 12, '#ffb49e'], ['S', 180, 17, '#ff8a6b'], ['SW', 225, 12, '#ffb49e'], ['W', 270, 17, '#ff8a6b'], ['NW', 315, 12, '#ffb49e']]) {
    const q = proj(pointVector({ alt: -1.2, az }));
    if (onScreen(q, 20)) { ctx.font = fontFor(size, 700); ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.shadowColor = '#000a'; ctx.shadowBlur = 4; ctx.fillText(name, q.x, q.y + size / 2); ctx.shadowBlur = 0; }
  }
  ctx.font = fontFor(11); ctx.textAlign = 'left'; ctx.shadowColor = '#000c'; ctx.shadowBlur = 3;
  for (const [q, text, color, alpha] of gridLabels) { ctx.globalAlpha = Math.min(1, 1.8 * alpha); ctx.fillStyle = color; ctx.fillText(text, q.x + 3, q.y - 4); }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  const symbols = objects.filter((o) => o.body), names = new Set(objects.map((o) => o.name));
  let hitLabels = [];
  if (opts.labels) {
    ctx.shadowColor = '#000c'; ctx.shadowBlur = 3;
    hitLabels = placeLabels(labels, {
      W, H, size: opts.labelSize, symbols,
      draw: (l, x, y) => { ctx.font = fontFor(l.size || opts.labelSize); ctx.textAlign = 'left'; ctx.fillStyle = l.color; ctx.fillText(l.name, x, y); },
      leader: (l, x, y) => { ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(x, y); ctx.strokeStyle = l.color; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.7; ctx.stroke(); ctx.globalAlpha = 1; },
    }).filter((l) => names.has(l.name));
    ctx.shadowBlur = 0;
  }
  const chosen = findObject(frame, view.selected);
  if (chosen) {
    const o = objects.find((x) => x.name === chosen.name), q = o || xy(chosen);
    if (o || q.z > -0.2) reticle(p, q.x, q.y, o ? o.radius : 3, '#ffe9a8');
  }
  return { objects, radius, hitLabels, light };
}

// A planet's disk with its phase (the night side faint), darker toward the
// limb; Saturn's rings behind it, then their near half in front.
function drawPlanet(ctx, o, q, r, lightPoint, rings) {
  const rgb = BODY_RGB[o.body], ring = (near) => {
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(rings.angle);
    if (near) { ctx.beginPath(); ctx.rect(-rings.outer - 2, 0, 2 * rings.outer + 4, rings.near * (rings.outer + 2)); ctx.clip(); }
    ctx.beginPath(); ctx.ellipse(0, 0, rings.outer, rings.outer * rings.open, 0, 0, Math.PI * 2); ctx.ellipse(0, 0, rings.inner, rings.inner * rings.open, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(214, 196, 150, 0.85)'; ctx.fill('evenodd'); ctx.restore();
  };
  if (rings) ring(false);
  const k = Math.cos((o.phase || 0) * R), lit = new Path2D();
  for (let i = 0; i <= 32; i++) { const a = -Math.PI / 2 + i * Math.PI / 32; lit[i ? 'lineTo' : 'moveTo'](r * Math.cos(a), r * Math.sin(a)); }
  for (let i = 0; i <= 32; i++) { const a = Math.PI / 2 - i * Math.PI / 32; lit.lineTo(-k * r * Math.cos(a), r * Math.sin(a)); }
  ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(Math.atan2(lightPoint.y - q.y, lightPoint.x - q.x));
  ctx.fillStyle = `rgb(${rgb.map((x) => Math.round(x * 0.07)).join(',')})`; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(r * 0.3, 0, 0, 0, 0, r);
  g.addColorStop(0, `rgb(${rgb.join(',')})`); g.addColorStop(1, `rgb(${rgb.map((x) => Math.round(x * 0.55)).join(',')})`);
  ctx.clip(lit); ctx.fillStyle = g; ctx.fillRect(-r, -r, 2 * r, 2 * r);
  ctx.restore();
  if (rings) ring(true);
}

// The Moon: its near side turned with celestial north, the lit part bright
// and the rest faint with earthshine; paler by day.
function drawMoon(ctx, o, q, r, lightPoint, northPoint, light, atmosphere) {
  const k = Math.cos(o.phase * R), angle = Math.atan2(lightPoint.y - q.y, lightPoint.x - q.x), north = Math.atan2(northPoint.y - q.y, northPoint.x - q.x) + Math.PI / 2;
  const illum = (1 + k) / 2, night = 1 - light.day;
  if (atmosphere) {
    const s = r * 10;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * illum * (0.3 + 0.7 * night);
    ctx.drawImage(glow([200, 210, 230]), q.x - s, q.y - s, 2 * s, 2 * s);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  const lit = new Path2D();
  for (let i = 0; i <= 32; i++) { const a = -Math.PI / 2 + i * Math.PI / 32; lit[i ? 'lineTo' : 'moveTo'](r * Math.cos(a), r * Math.sin(a)); }
  for (let i = 0; i <= 32; i++) { const a = Math.PI / 2 - i * Math.PI / 32; lit.lineTo(-k * r * Math.cos(a), r * Math.sin(a)); }
  lit.closePath();
  const face = (alpha) => {
    ctx.globalAlpha = alpha;
    if (moonImage) { ctx.save(); ctx.rotate(north - angle); ctx.drawImage(moonImage, -r, -r, 2 * r, 2 * r); ctx.restore(); }
    else { ctx.fillStyle = '#e9e5d9'; ctx.fillRect(-r, -r, 2 * r, 2 * r); }
  };
  ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(angle);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  face(atmosphere ? 0.06 + 0.06 * night : 0.1);
  ctx.clip(lit);
  face(atmosphere ? 0.75 + 0.25 * night : 1);
  ctx.restore(); ctx.globalAlpha = 1;
}

