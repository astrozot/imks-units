// Offline whole-sky chart. Positions in this drawing are geometric (no
// refraction). An azimuthal equidistant camera looks out from inside the
// celestial sphere; its orientation is rotated by spherical drag gestures.
// This module holds the geometry, the catalogs of a frame and the map-like
// chart; coelumsky.js draws the realistic sky, coelumui.js the explorer.
import { CHART_STARS, CONSTELLATIONS, BOUNDARIES } from './skydata.js';
import { STARS, DEEP } from './catalog.js';
import { precessVector, centuries, nutation, siderealTime, topocentric, aspect, magnitude } from './astro.js';
import { skyRaster } from './skyraster.js';

export const R = Math.PI / 180;
const clamp = (x) => Math.max(-1, Math.min(1, x));
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const vec = (a, d) => [Math.cos(d * R) * Math.cos(a * R), Math.cos(d * R) * Math.sin(a * R), Math.sin(d * R)];
export const horizontalVector = (alt, az) => [Math.cos(alt * R) * Math.sin(az * R), Math.cos(alt * R) * Math.cos(az * R), Math.sin(alt * R)];
export const SOLAR_BODIES = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
export const DEFAULT_LAYERS = { ground: true, milkyway: true, constellations: true, boundaries: false, ecliptic: true, horizontal: false, equatorial: false, deep: false, labels: true, magnitude: 6, labelSize: 14 };
export const SKY_IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit3 = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Keep even a tall or wide viewport within the projection's antipode.
export const chartRadius = (w, h, scale) => Math.max(Math.min(w, h) * 0.435, Math.hypot(w, h) / 3.8) * scale;

// Rotate a camera so that one unit direction follows another. Rebuild an
// orthonormal frame after each gesture to avoid drift over many full turns.
export function rotateSky(rotation, from, to) {
  const a = unit3(from), b = unit3(to), c = clamp(dot3(a, b));
  let axis = cross3(a, b), s = Math.hypot(...axis);
  if (s < 1e-12 && c > 0) return [...rotation];
  if (s < 1e-12) { axis = unit3(cross3(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])); s = 0; }
  else axis = axis.map((x) => x / s);
  const turn = (v) => { const w = cross3(axis, v), d = dot3(axis, v); return v.map((x, i) => c * x + s * w[i] + (1 - c) * d * axis[i]); };
  const cols = [0, 1, 2].map((i) => turn([rotation[i], rotation[3 + i], rotation[6 + i]]));
  const rows = [0, 1, 2].map((i) => cols.map((v) => v[i]));
  const z = unit3(rows[2]), x = unit3(rows[0].map((v, i) => v - dot3(rows[0], z) * z[i])), y = cross3(z, x);
  return [...x, ...y, ...z];
}

// A camera looking at (az, alt) with the zenith up: the realistic view's
// orientation, and the one the chart takes when it centers an object.
export function lookAt(az, alt) {
  const d = horizontalVector(alt, az), up = [-Math.sin(alt * R) * Math.sin(az * R), -Math.sin(alt * R) * Math.cos(az * R), Math.cos(alt * R)];
  return [...cross3(up, d), ...up, ...d];
}

// Inverse projection, as a horizontal world vector [east, north, zenith].
// Equidistant for the chart; stereographic (conformal) for the sky view.
export function unprojectSky(x, y, rotation = SKY_IDENTITY, stereographic = false) {
  const r = Math.hypot(x, y), angle = stereographic ? 2 * Math.atan(r) : Math.min(r, 1.999999) * Math.PI / 2;
  const k = r > 1e-12 ? -Math.sin(angle) / r : 0, v = [x * k, y * k, Math.cos(angle)];
  return [0, 1, 2].map((i) => rotation[i] * v[0] + rotation[3 + i] * v[1] + rotation[6 + i] * v[2]);
}
// Explicit font and measured layout shared by SVG and canvas. System-font
// resolution and kerning can otherwise differ when playback changes renderer.
export const SKY_FONT = 'Arial, sans-serif';
const textMetrics = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
export const fontFor = (size, weight = 400) => `normal ${weight} ${size}px ${SKY_FONT}`;
export const measureLabel = (label, size, weight = 400) => {
  if (!textMetrics) return label.length * size * 0.61;
  textMetrics.font = fontFor(size, weight); textMetrics.fontKerning = 'normal';
  return textMetrics.measureText(label).width;
};
export const BODY_COLORS = { sun: '#ffd36c', moon: '#f2eee3', mercury: '#c7b5a2', venus: '#fff2c6', mars: '#f59872', jupiter: '#f2d2ac', saturn: '#e6d49a', uranus: '#9fe1de', neptune: '#8da9ff' };
// Atlas colours: deep-sky symbols follow the usual printed-atlas code
// (galaxies red, clusters yellow, nebulae green).
export const PALETTE = {
  sky: '#0c1730', ground: '#17211b', horizon: '#86a690', lines: '#5274a3', bounds: '#3d5780', ecliptic: '#d0a54c', equatorial: '#3d5384', horizontal: '#2e4c5e',
  terrain: '#9fd58c', galaxy: '#ff8f80', cluster: '#f0d36c', nebula: '#6fdc9a', other: '#b9a3ff', label: '#c3d1e6', constellation: '#86a3cc', planet: '#ffe2a8',
};
export const starTint = (bv) => (bv < 0 ? '#cbdcff' : bv < 0.3 ? '#eef2ff' : bv < 0.6 ? '#fffaf0' : bv < 1.0 ? '#ffecc9' : '#ffd5a4');
export const starRadius = (mag, scale = 1) => Math.max(0.55, 3.2 * Math.pow(10, -0.14 * (mag + 1.4))) * Math.min(1.6, 1 + 0.15 * Math.log2(Math.max(1, scale)));

// Match the named catalog once; use its motions and names in the chart,
// retaining HIP identifiers for the remaining stars.
const previews = new WeakMap();
export const MIN_TIME = Date.parse('-001000-01-01T00:00:00Z') / 1000, MAX_TIME = Date.parse('3001-01-01T00:00:00Z') / 1000 - 1;
export const limitTime = (t) => Math.min(MAX_TIME, Math.max(MIN_TIME, t));
const named = new Map();
for (const s of STARS) {
  let best = null, distance = 0.025;
  for (const c of CHART_STARS) {
    const da = ((c[1] - s[1] + 540) % 360 - 180) * Math.cos(s[2] * R);
    const d = Math.hypot(da, c[2] - s[2]);
    if (d < distance) { best = c[0]; distance = d; }
  }
  if (best !== null && !named.has(best)) named.set(best, s);
}

// A date's precession/nutation matrix is shared by the entire background.
// Annual aberration/parallax (< a chart pixel) are omitted in this drawing;
// the calculator's radec/altaz functions retain their full precision.
function dateRotation(t) {
  const T = centuries(t), n = nutation(T), c = Math.cos, s = Math.sin;
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => {
    const [x, y, z] = precessVector(v, T), e0 = n.eps0 * R, e = n.eps * R, p = n.dpsi * R;
    const q = y * c(e0) + z * s(e0), w = -y * s(e0) + z * c(e0);
    const a = x * c(p) - q * s(p), b = x * s(p) + q * c(p);
    return [a, b * c(e) - w * s(e), b * s(e) + w * c(e)];
  });
}

// The matrix (rows) from a horizontal vector [east, north, up] to J2000
// equatorial coordinates: used to paint the Milky Way.
export function horizonToJ2000(frame) {
  const lst = siderealTime(frame.t, frame.place[1]) * R, lat = frame.place[0] * R;
  const sl = Math.sin(lst), cl = Math.cos(lst), sp = Math.sin(lat), cp = Math.cos(lat);
  const E = [[-sl, cl, 0], [-sp * cl, -sp * sl, cp], [cp * cl, cp * sl, sp]], M = frame.matrix;
  return [0, 1, 2].flatMap((k) => E.map((col) => dot3(M[k], col)));
}

export function horizonPoint(ra, dec, lat, lst) {
  const h = (lst - ra) * R, d = dec * R, p = lat * R;
  return {
    alt: Math.asin(clamp(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h))) / R,
    az: (Math.atan2(-Math.cos(d) * Math.sin(h), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(h)) / R + 360) % 360,
  };
}

function solarBodies(t, place, hor) {
  const bodies = SOLAR_BODIES.map((body) => {
    const p = topocentric(body, t, place), h = hor(p);
    return { ...p, ...h, name: body[0].toUpperCase() + body.slice(1), body, mag: magnitude(body, t), type: body === 'sun' ? 'star' : body === 'moon' ? 'moon' : 'planet', color: BODY_COLORS[body] };
  });
  const moon = bodies[1], sun = bodies[0];
  moon.phase = aspect('moon', t).phase;
  // Project a nearby point toward the Sun to orient the illuminated limb.
  const m = vec(moon.ra, moon.dec), s = vec(sun.ra, sun.dec), dot = m.reduce((v, x, i) => v + x * s[i], 0);
  const tangent = s.map((x, i) => x - dot * m[i]), len = Math.hypot(...tangent);
  const v = m.map((x, i) => x + 0.001 * tangent[i] / Math.max(len, 1e-12));
  moon.light = hor({ ra: Math.atan2(v[1], v[0]) / R, dec: Math.atan2(v[2], Math.hypot(v[0], v[1])) / R });
  moon.north = hor({ ra: moon.ra, dec: Math.min(89.999, moon.dec + 0.06) });
  return bodies;
}

// Ecliptic of J2000 (the equinox moves it < 1′ a century against the stars),
// precessed like the catalogs; boundaries follow their B1875 parallels,
// so their long edges are subdivided in RA and Dec, not along great circles.
const ECLIPTIC = Array.from({ length: 181 }, (_, i) => {
  const l = i * 2 * R, e = 23.4392911 * R, x = Math.cos(l), y = Math.sin(l) * Math.cos(e), z = Math.sin(l) * Math.sin(e);
  return [Math.atan2(y, x) / R, Math.asin(z) / R];
});
const BOUNDARY_POINTS = BOUNDARIES.map((line) => {
  const out = [[line[0], line[1]]];
  for (let i = 2; i < line.length; i += 2) {
    const a = line[i - 2], d = line[i - 1], da = ((line[i] - a + 540) % 360) - 180, dd = line[i + 1] - d;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(da), Math.abs(dd)) / 2));
    for (let j = 1; j <= n; j++) out.push([a + da * j / n, d + dd * j / n]);
  }
  return out;
});

export function skyFrame(t, place) {
  const matrix = dateRotation(t), lst = siderealTime(t, place[1]);
  const eq = (ra, dec, pmra = 0, pmdec = 0) => {
    const v = vec(ra, dec), years = centuries(t) * 100, mas = R / 3600000;
    const east = [-Math.sin(ra * R), Math.cos(ra * R), 0], north = [-Math.sin(dec * R) * Math.cos(ra * R), -Math.sin(dec * R) * Math.sin(ra * R), Math.cos(dec * R)];
    const u = v.map((x, i) => x + years * mas * (pmra * east[i] + pmdec * north[i]));
    const w = [0, 1, 2].map((i) => matrix.reduce((sum, col, k) => sum + col[i] * u[k], 0));
    return { ra: (Math.atan2(w[1], w[0]) / R + 360) % 360, dec: Math.atan2(w[2], Math.hypot(w[0], w[1])) / R };
  };
  const hor = (p) => horizonPoint(p.ra, p.dec, place[0], lst);
  const catalog = (ra, dec, pmra, pmdec) => { const p = eq(ra, dec, pmra, pmdec); return { ...p, ...hor(p) }; };
  const stars = CHART_STARS.map(([id, ra, dec, mag, bv, flags = 0]) => {
    const n = named.get(id), p = n ? catalog(n[1], n[2], n[3], n[4]) : catalog(ra, dec);
    return { ...p, name: n ? n[0] : `HIP ${id}`, mag, bv, type: 'star', named: Boolean(n), catalogId: `HIP ${id}`, distancePc: n && n[5] > 0 ? 1000 / n[5] : null, double: Boolean(flags & 1), variable: Boolean(flags & 2) };
  });
  const bodies = solarBodies(t, place, hor);
  const deep = DEEP.map(([names, ra, dec, mag, type]) => ({ ...catalog(ra, dec), name: names[0], description: names.slice(1).join(' · '), mag, type }));
  const constellations = CONSTELLATIONS.map(([name, ra, dec, lines]) => ({ name, type: 'constellation', ...catalog(ra, dec), lines: lines.map((line) => line.map(([a, d]) => catalog(a, d))) }));
  const ecliptic = ECLIPTIC.map(([a, d]) => catalog(a, d));
  const boundaries = BOUNDARY_POINTS.map((line) => line.map(([a, d]) => catalog(a, d)));
  return { t, place, matrix, stars, bodies, deep, constellations, ecliptic, boundaries, hor, catalog };
}

// Keep catalog reductions fixed for a day, rotate their equatorial vectors
// with sidereal time each frame, and interpolate solar-system positions
// between exact one-minute samples. No catalog rebuilds in the frame loop.
export function createSkyAnimator(t, place, layers = { deep: true, constellations: true, equatorial: true, ecliptic: true, boundaries: true }) {
  let frame, catalogTime = -Infinity, sampleTime = -Infinity, left, right;
  const lat = place[0] * R, sp = Math.sin(lat), cp = Math.cos(lat);
  let sl = 0, cl = 1;
  const hor = (p) => {
    const v = p.equatorialVector || (p.equatorialVector = vec(p.ra, p.dec));
    const meridian = v[0] * cl + v[1] * sl;
    const vector = [v[1] * cl - v[0] * sl, v[2] * cp - meridian * sp, v[2] * sp + meridian * cp];
    return { alt: Math.asin(clamp(vector[2])) / R, az: (Math.atan2(vector[0], vector[1]) / R + 360) % 360, vector };
  };
  const update = (p) => Object.assign(p, hor(p));
  const curve = (line) => {
    const out = [];
    for (let i = 1; i < line.length; i++) {
      const a = vec(line[i - 1].ra, line[i - 1].dec), b = vec(line[i].ra, line[i].dec);
      for (let j = 0; j <= 12; j++) {
        const v = unit3(a.map((x, k) => x * (1 - j / 12) + b[k] * j / 12));
        out.push({ ra: Math.atan2(v[1], v[0]) / R, dec: Math.asin(clamp(v[2])) / R, equatorialVector: v });
      }
    }
    return out;
  };
  return (time) => {
    if (!frame || Math.abs(time - catalogTime) >= 86400) {
      frame = skyFrame(time, place); catalogTime = time;
      for (const c of frame.constellations) c.curves = c.lines.map(curve);
      frame.equatorialGrid = [];
      for (let dec = -60; dec <= 60; dec += 30) frame.equatorialGrid.push(Array.from({ length: 181 }, (_, i) => ({ ra: i * 2, dec })));
      for (let ra = 0; ra < 360; ra += 30) frame.equatorialGrid.push(Array.from({ length: 91 }, (_, i) => ({ ra, dec: -90 + i * 2 })));
    }
    const lst = siderealTime(time, place[1]) * R; sl = Math.sin(lst); cl = Math.cos(lst);
    frame.t = time; frame.hor = hor;
    for (const p of frame.stars) update(p);
    if (layers.deep) for (const p of frame.deep) update(p);
    if (layers.constellations) for (const c of frame.constellations) { update(c); for (const line of c.curves) for (const p of line) update(p); }
    if (layers.equatorial) for (const line of frame.equatorialGrid) for (const p of line) update(p);
    if (layers.ecliptic) for (const p of frame.ecliptic) update(p);
    if (layers.boundaries) for (const line of frame.boundaries) for (const p of line) update(p);
    const sample = Math.floor(time / 60) * 60;
    if (sample !== sampleTime) {
      const exactHor = (p) => horizonPoint(p.ra, p.dec, place[0], siderealTime(sample, place[1]));
      left = sample === sampleTime + 60 ? right : solarBodies(sample, place, exactHor);
      right = solarBodies(sample + 60, place, exactHor); sampleTime = sample;
    }
    const fraction = (time - sampleTime) / 60;
    frame.bodies = left.map((a, i) => {
      const b = right[i], p = { ...a, ra: (a.ra + (((b.ra - a.ra + 540) % 360) - 180) * fraction + 360) % 360 };
      for (const key of ['dec', 'dist', 'mag', 'phase']) if (Number.isFinite(a[key])) p[key] = a[key] + (b[key] - a[key]) * fraction;
      return Object.assign(p, hor(p));
    });
    const moon = frame.bodies[1], sun = frame.bodies[0], m = vec(moon.ra, moon.dec), sv = vec(sun.ra, sun.dec), dot = dot3(m, sv);
    const tangent = unit3(sv.map((x, i) => x - dot * m[i]));
    const light = m.map((x, i) => x + 0.001 * tangent[i]);
    moon.light = hor({ ra: Math.atan2(light[1], light[0]) / R, dec: Math.atan2(light[2], Math.hypot(light[0], light[1])) / R });
    moon.north = hor({ ra: moon.ra, dec: Math.min(89.999, moon.dec + 0.06) });
    return frame;
  };
}

export function projectSky(alt, az, rotation = SKY_IDENTITY, stereographic = false) {
  return projectVector(horizontalVector(alt, az), rotation, stereographic);
}
// Screen offsets in units of the radius; z is the cosine of the angle from
// the view's center (the stereographic view drops points behind it).
export function projectVector(point, rotation, stereographic = false) {
  const v = [rotation[0] * point[0] + rotation[1] * point[1] + rotation[2] * point[2], rotation[3] * point[0] + rotation[4] * point[1] + rotation[5] * point[2], rotation[6] * point[0] + rotation[7] * point[1] + rotation[8] * point[2]];
  const z = clamp(v[2]), angle = Math.acos(z), norm = Math.hypot(v[0], v[1]);
  if (angle < 1e-12) return { x: -0, y: -0, z };
  if (norm < 1e-12 && v[2] < 0) return { x: 2, y: 0, z };
  const k = (stereographic ? Math.tan(angle / 2) : angle / (Math.PI / 2)) / Math.max(norm, 1e-12);
  return { x: -v[0] * k, y: -v[1] * k, z };
}
export const pointVector = (p) => p.vector || horizontalVector(p.alt, p.az);

// Refraction (degrees) to add to a true altitude (Saemundsson), for the
// pressure of the standard atmosphere at a height (m); below −3° it fades
// out, so the sky below the horizon stays continuous.
export function refraction(alt, height = 0) {
  const k = Math.max(0, 1 - 2.25577e-5 * height) ** 5.25588, h = Math.max(alt, -3);
  const r = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * R) / 60 * k;
  return alt >= -3 ? r : r * Math.max(0, (alt + 10) / 7);
}
// A horizontal vector raised by the refraction (the apparent direction).
export function refractVector(v, height = 0) {
  const alt = Math.asin(clamp(v[2])) / R, apparent = Math.min(90, alt + refraction(alt, height));
  const c = Math.cos(alt * R), k = c > 1e-9 ? Math.cos(apparent * R) / c : 1;
  return [v[0] * k, v[1] * k, Math.sin(apparent * R)];
}

// Optional fainter stars (downloaded by the explorer): one Float32Array of
// [RA, Dec (J2000, degrees), V, B−V, HIP] per star, brightest first.
let FAINT = null, FAINT_INDEX = null;
export function setFaintStars(data) {
  FAINT = data && data.length ? data : null;
  FAINT_INDEX = FAINT ? new Map(Array.from({ length: FAINT.length / 5 }, (_, i) => [FAINT[i * 5 + 4], i])) : null;
}
export const faintCount = () => (FAINT ? FAINT.length / 5 : 0);
// Equatorial vectors of date, once per frame, when they are first needed.
function faintVectors(frame) {
  if (!FAINT) return null;
  if (frame.faintData === FAINT) return frame.faintEq;
  const n = FAINT.length / 5, eq = new Float32Array(3 * n), M = frame.matrix;
  for (let i = 0; i < n; i++) {
    const u = vec(FAINT[5 * i], FAINT[5 * i + 1]);
    for (let k = 0; k < 3; k++) eq[3 * i + k] = M[0][k] * u[0] + M[1][k] * u[1] + M[2][k] * u[2];
  }
  frame.faintData = FAINT; frame.faintEq = eq;
  return eq;
}
// Calls visit(i, horizontal vector, magnitude) for the downloaded stars
// brighter than the limit; no objects are made for the others.
export function eachFaint(frame, limit, visit) {
  const eq = faintVectors(frame);
  if (!eq) return;
  const lst = siderealTime(frame.t, frame.place[1]) * R, lat = frame.place[0] * R;
  const sl = Math.sin(lst), cl = Math.cos(lst), sp = Math.sin(lat), cp = Math.cos(lat), n = FAINT.length / 5;
  for (let i = 0; i < n && FAINT[5 * i + 2] <= limit; i++) {
    const x = eq[3 * i], y = eq[3 * i + 1], z = eq[3 * i + 2], m = x * cl + y * sl;
    visit(i, [y * cl - x * sl, z * cp - m * sp, z * sp + m * cp], FAINT[5 * i + 2]);
  }
}
export function faintObject(frame, i, v) {
  const eq = faintVectors(frame), x = eq[3 * i], y = eq[3 * i + 1], z = eq[3 * i + 2];
  return {
    name: `HIP ${FAINT[5 * i + 4]}`, catalogId: `HIP ${FAINT[5 * i + 4]}`, type: 'star', mag: FAINT[5 * i + 2], bv: FAINT[5 * i + 3], vector: v,
    ra: (Math.atan2(y, x) / R + 360) % 360, dec: Math.asin(clamp(z)) / R, alt: Math.asin(clamp(v[2])) / R, az: (Math.atan2(v[0], v[1]) / R + 360) % 360,
  };
}
function findFaint(frame, name) {
  const m = /^HIP (\d+)$/.exec(name || '');
  if (!m || !FAINT_INDEX || !FAINT_INDEX.has(Number(m[1]))) return null;
  const i = FAINT_INDEX.get(Number(m[1]));
  let found = null;
  eachFaint(frame, FAINT[5 * i + 2], (j, v) => { if (j === i) found = faintObject(frame, i, v); });
  return found;
}

// Approximate only the ground silhouette, not object positions. Fully filled
// cells are merged into strips; boundary triangles interpolate the horizon.
// This also handles looking straight down and crossing the horizon antipode.
function groundShape(W, H, radius, rotation) {
  const step = 8, nx = Math.ceil(W / step), ny = Math.ceil(H / step), dx = W / nx, dy = H / ny;
  const sample = (i, j) => { const x = i * dx, y = j * dy; return { x, y, z: unprojectSky((x - W / 2) / radius, (y - H / 2) / radius, rotation)[2] }; };
  const polygon = (vertices) => {
    const out = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      if (a.z < 0) out.push(a);
      if ((a.z < 0) !== (b.z < 0)) { const u = a.z / (a.z - b.z); out.push({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) }); }
    }
    return out.length < 3 ? '' : out.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') + 'Z';
  };
  let d = '', top = Array.from({ length: nx + 1 }, (_, i) => sample(i, 0));
  for (let j = 0; j < ny; j++) {
    const bottom = Array.from({ length: nx + 1 }, (_, i) => sample(i, j + 1));
    let start = -1;
    const flush = (i) => { if (start >= 0) { d += `M${(start * dx).toFixed(2)},${(j * dy).toFixed(2)}H${(i * dx).toFixed(2)}V${((j + 1) * dy).toFixed(2)}H${(start * dx).toFixed(2)}Z`; start = -1; } };
    for (let i = 0; i < nx; i++) {
      const v = [top[i], top[i + 1], bottom[i + 1], bottom[i]];
      if (v.every((p) => p.z < 0)) { if (start < 0) start = i; }
      else { flush(i); if (v.some((p) => p.z < 0)) d += polygon([v[0], v[1], v[2]]) + polygon([v[0], v[2], v[3]]); }
    }
    flush(nx); top = bottom;
  }
  return d;
}

// One drawing API for both outputs: SVG markup (paused, exported) or a
// canvas (playback, realistic view). Styles are explicit attributes so
// that the SVG exports to PNG without the stylesheet.
export function pen(ctx) {
  let svg = '';
  const f = (x) => x.toFixed(2);
  const attrs = ({ fill = 'none', stroke, width = 1, dash, opacity, cls }) => `${cls ? `class="${cls}" ` : ''}fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${width}"` : ''}${dash ? ` stroke-dasharray="${dash.join(' ')}"` : ''}${opacity !== undefined ? ` opacity="${opacity}"` : ''}`;
  const paint = ({ fill = 'none', stroke, width = 1, dash, opacity }, path) => {
    if (opacity !== undefined) ctx.globalAlpha = opacity;
    if (fill !== 'none') { ctx.fillStyle = fill; path ? ctx.fill(path) : ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash(dash || []); path ? ctx.stroke(path) : ctx.stroke(); ctx.setLineDash([]); }
    if (opacity !== undefined) ctx.globalAlpha = 1;
  };
  return {
    get svg() { return svg; },
    raw(s) { if (!ctx) svg += s; },
    circle(x, y, r, st) {
      if (!ctx) { svg += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" ${attrs(st)}/>`; return; }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); paint(st);
    },
    ellipse(x, y, rx, ry, angle, st) {
      if (!ctx) { svg += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" ${attrs(st)} transform="rotate(${f(angle)} ${f(x)} ${f(y)})"/>`; return; }
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, angle * R, 0, Math.PI * 2); paint(st);
    },
    rect(x, y, w, h, st) {
      if (!ctx) { svg += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${attrs(st)}/>`; return; }
      ctx.beginPath(); ctx.rect(x, y, w, h); paint(st);
    },
    path(d, st) {
      if (!d) return;
      if (!ctx) { svg += `<path d="${d}" ${attrs(st)}/>`; return; }
      paint(st, new Path2D(d));
    },
    text(x, y, label, color, size, anchor = 'start', halo = PALETTE.sky, weight = 400) {
      if (!ctx) { svg += `<text x="${f(x)}" y="${f(y)}" fill="${color}" font-family="${SKY_FONT}" font-size="${size}" font-weight="${weight}" font-style="normal" letter-spacing="0" font-kerning="normal" text-anchor="${anchor}" paint-order="stroke" stroke="${halo}" stroke-width="3" stroke-linejoin="round">${esc(label)}</text>`; return; }
      ctx.font = fontFor(size, weight); ctx.fontKerning = 'normal'; ctx.letterSpacing = '0px'; ctx.textAlign = anchor === 'middle' ? 'center' : 'left';
      ctx.strokeStyle = halo; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeText(label, x, y); ctx.fillStyle = color; ctx.fillText(label, x, y);
    },
  };
}

// Labels in priority order, each at the first free place around its point
// (important ones further away, with a leader line); returns hit boxes.
export function placeLabels(labels, { W, H, size, symbols, draw, leader }) {
  const boxes = [], placed = [];
  const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  for (const l of labels.sort((a, b) => a.priority - b.priority || (a.mag || 0) - (b.mag || 0))) {
    const font = l.size || size, width = measureLabel(l.name, font, l.weight), gap = l.r + 5;
    const candidates = [
      [l.x + gap, l.y - gap], [l.x + gap, l.y + gap + font],
      [l.x - gap - width, l.y - gap], [l.x - gap - width, l.y + gap + font],
      [l.x - width / 2, l.y - gap], [l.x - width / 2, l.y + gap + font],
    ];
    if (l.center) candidates.unshift([l.x - width / 2, l.y + font / 3]);
    if (l.important) for (let distance = 25; distance <= 100; distance += 25) {
      for (const side of [-1, 1]) candidates.push([l.x + gap, l.y + side * distance], [l.x - gap - width, l.y + side * distance]);
    }
    let placement = null;
    for (const [px, py] of candidates) {
      const x = Math.min(W - width - 6, Math.max(6, px)), y = Math.max(font + 4, Math.min(H - 6, py));
      const box = [x - 3, y - font - 2, x + width + 3, y + 5];
      if (boxes.some((b) => overlap(box, b))) continue;
      if (symbols.some((o) => overlap(box, [o.x - o.radius - 2, o.y - o.radius - 2, o.x + o.radius + 2, o.y + o.radius + 2]))) continue;
      placement = { x, y, box }; break;
    }
    if (!placement) continue;
    const { x, y, box } = placement;
    if (l.important && leader && (Math.abs(x - candidates[0][0]) > 2 || Math.abs(y - candidates[0][1]) > 2)) {
      leader(l, Math.max(box[0], Math.min(box[2], l.x)), Math.max(box[1], Math.min(box[3], l.y)));
    }
    boxes.push(box); draw(l, x, y);
    placed.push({ name: l.name, box });
  }
  return placed;
}

// Deep-sky symbols as in printed atlases.
export function deepSymbol(p, type, x, y, s) {
  const c = PALETTE;
  if (/galaxy pair|group of galaxies/.test(type)) { p.ellipse(x - s * 0.45, y, s * 0.6, s * 0.32, -30, { fill: c.galaxy, opacity: 0.85 }); p.ellipse(x + s * 0.45, y, s * 0.6, s * 0.32, -30, { stroke: c.galaxy, width: 1 }); }
  else if (/galaxy/.test(type)) p.ellipse(x, y, s, s * 0.5, -30, { fill: '#ff8f8040', stroke: c.galaxy, width: 1 });
  else if (/globular/.test(type)) { p.circle(x, y, s, { fill: '#f0d36c30', stroke: c.cluster, width: 1 }); p.path(`M${(x - s).toFixed(2)},${y.toFixed(2)}H${(x + s).toFixed(2)}M${x.toFixed(2)},${(y - s).toFixed(2)}V${(y + s).toFixed(2)}`, { stroke: c.cluster, width: 0.8 }); }
  else if (/cluster with nebula/.test(type)) { p.rect(x - s, y - s, 2 * s, 2 * s, { stroke: c.nebula, width: 1 }); p.circle(x, y, s * 0.7, { stroke: c.cluster, width: 1, dash: [1.5, 1.5] }); }
  else if (/cluster|star cloud/.test(type)) p.circle(x, y, s, { stroke: c.cluster, width: 1.1, dash: [1.6, 1.6] });
  else if (/planetary/.test(type)) {
    p.circle(x, y, s * 0.55, { stroke: c.nebula, width: 1 });
    p.path(`M${(x - s).toFixed(2)},${y.toFixed(2)}H${(x - s * 0.55).toFixed(2)}M${(x + s * 0.55).toFixed(2)},${y.toFixed(2)}H${(x + s).toFixed(2)}M${x.toFixed(2)},${(y - s).toFixed(2)}V${(y - s * 0.55).toFixed(2)}M${x.toFixed(2)},${(y + s * 0.55).toFixed(2)}V${(y + s).toFixed(2)}`, { stroke: c.nebula, width: 1 });
  } else if (/nebula|H II|remnant/.test(type)) p.rect(x - s * 0.85, y - s * 0.85, 1.7 * s, 1.7 * s, { fill: '#6fdc9a26', stroke: c.nebula, width: 1 });
  else p.circle(x, y, s * 0.6, { stroke: c.other, width: 1 });
}
export const deepColor = (type) => (/galax/.test(type) ? PALETTE.galaxy : /nebula|H II|remnant/.test(type) && !/cluster with/.test(type) ? PALETTE.nebula : /cluster|cloud/.test(type) ? PALETTE.cluster : PALETTE.other);

// Star with its atlas marks: a bar through doubles, a ring around variables.
export function starSymbol(p, o, x, y, r, color) {
  if (o.double) p.path(`M${(x - r - 2.6).toFixed(2)},${y.toFixed(2)}H${(x + r + 2.6).toFixed(2)}`, { stroke: color, width: 0.9 });
  p.circle(x, y, r, r > 1.2 ? { fill: color, stroke: PALETTE.sky, width: 0.6 } : { fill: color });
  if (o.variable) p.circle(x, y, r + 1.9, { stroke: color, width: 0.8 });
}

// A planet: a disc in a ring (Saturn with its rings); the Sun: ☉.
export function bodySymbol(p, o, x, y, r) {
  if (o.body === 'sun') { p.circle(x, y, r, { fill: o.color, stroke: '#fff3c4', width: 1 }); p.circle(x, y, 1.7, { fill: '#7a4e00' }); return; }
  if (o.body === 'saturn') p.ellipse(x, y, r + 3.4, (r + 3.4) * 0.38, -18, { stroke: o.color, width: 1 });
  p.circle(x, y, r, { fill: o.color, stroke: '#ffffff', width: 0.35 });
  if (o.body !== 'saturn') p.circle(x, y, r + 2.2, { stroke: o.color, width: 0.7, opacity: 0.8 });
}

// The Moon with its phase: dark disc, lit part turned to the Sun.
export function moonSymbol(p, ctx, o, x, y, r, lightAngle) {
  const f = (v) => v.toFixed(2), k = Math.cos(o.phase * R);
  p.circle(x, y, r, { fill: '#28364a', stroke: '#a4b3c7', width: 0.6 });
  let d = '';
  for (let i = 0; i <= 32; i++) { const a = -Math.PI / 2 + i * Math.PI / 32; d += `${i ? 'L' : 'M'}${f(r * Math.cos(a))},${f(r * Math.sin(a))}`; }
  for (let i = 0; i <= 32; i++) { const a = Math.PI / 2 - i * Math.PI / 32; d += `L${f(-k * r * Math.cos(a))},${f(r * Math.sin(a))}`; }
  if (ctx) { ctx.save(); ctx.translate(x, y); ctx.rotate(lightAngle * R); ctx.fillStyle = o.color; ctx.fill(new Path2D(d + 'Z')); ctx.restore(); }
  else p.raw(`<path d="${d}Z" fill="${o.color}" transform="translate(${f(x)} ${f(y)}) rotate(${f(lightAngle)})"/>`);
}

// The selected object: a reticle, drawn even when the ground hides it.
export function reticle(p, x, y, r, color) {
  const a = r + 5, b = r + 10, f = (v) => v.toFixed(2);
  p.circle(x, y, a, { stroke: color, width: 1.2 });
  p.path(`M${f(x - b)},${f(y)}H${f(x - a)}M${f(x + a)},${f(y)}H${f(x + b)}M${f(x)},${f(y - b)}V${f(y - a)}M${f(x)},${f(y + a)}V${f(y + b)}`, { stroke: color, width: 1.2 });
}

export function findObject(frame, name) {
  if (!name) return null;
  return frame.bodies.find((o) => o.name === name) || frame.stars.find((o) => o.name === name) || frame.deep.find((o) => o.name === name) || frame.constellations.find((o) => o.name === name) || findFaint(frame, name);
}

const chartKey = {};
// Explicit SVG styles support PNG export. Rotation moves the viewing
// direction on the sphere; it never translates the projection's center.
const canvasGround = new WeakMap();
export function skyChart(frame, W = 360, H = 360, layers = DEFAULT_LAYERS, view = {}, ctx = null) {
  const opts = { ...DEFAULT_LAYERS, ...layers }, scale = view.scale || 1, radius = chartRadius(W, H, scale);
  const rotation = view.rotation || SKY_IDENTITY, cx = W / 2, cy = H / 2, p = pen(ctx), c = PALETTE;
  const xy = (o) => { const v = o.vector ? projectVector(o.vector, rotation) : projectSky(o.alt, o.az, rotation); return { x: cx + v.x * radius, y: cy + v.y * radius }; };
  const visible = (o) => (!opts.ground || o.alt >= 0) && Number.isFinite(o.x) && Number.isFinite(o.y) && o.x >= 0 && o.x <= W && o.y >= 0 && o.y <= H;
  const f = (x) => x.toFixed(2);
  // Clip only when ground is enabled; break segments at the projection
  // antipode to avoid drawing spurious lines across the view.
  const line = (points, st) => {
    let d = '', last = null;
    for (const q of points) {
      if (last && (!opts.ground || last.alt >= 0 || q.alt >= 0)) {
        let a = last, b = q;
        if (opts.ground && (a.alt >= 0) !== (b.alt >= 0)) {
          const u = -a.alt / (b.alt - a.alt), da = ((b.az - a.az + 540) % 360) - 180;
          const edge = { alt: 0, az: a.az + u * da };
          if (a.alt < 0) a = edge; else b = edge;
        }
        const axy = xy(a), bxy = xy(b);
        if (Math.hypot(axy.x - bxy.x, axy.y - bxy.y) < radius * 0.4) d += `M${f(axy.x)},${f(axy.y)}L${f(bxy.x)},${f(bxy.y)}`;
      }
      last = q;
    }
    p.path(d, st);
  };
  // The sky and the Milky Way: on the canvas, on a backdrop canvas under
  // the SVG (no image to decode, so no flicker), or inline for export.
  const back = ctx || view.backdrop || null;
  if (back) { back.fillStyle = c.sky; back.fillRect(0, 0, W, H); }
  else p.raw(`<rect width="${W}" height="${H}" rx="10" fill="${c.sky}"/>`);
  if (opts.milkyway && frame.matrix && typeof document !== 'undefined') {
    const mw = skyRaster(back || chartKey, { W, H, radius, unproject: (x, y) => unprojectSky(x, y, rotation), toJ2000: horizonToJ2000(frame), kind: 'chart' });
    if (back) { back.imageSmoothingEnabled = true; back.drawImage(mw.sky, 0, 0, mw.width, mw.height); }
    else p.raw(`<image class="coelum-milkyway" href="${mw.sky.toDataURL()}" width="${f(mw.width)}" height="${f(mw.height)}" preserveAspectRatio="none"/>`);
  }
  if (opts.ground) {
    if (ctx) {
      const key = [W, H, radius, ...rotation].join(',');
      let cached = canvasGround.get(ctx);
      if (!cached || cached.key !== key) { cached = { key, path: new Path2D(groundShape(W, H, radius, rotation)) }; canvasGround.set(ctx, cached); }
      ctx.fillStyle = c.ground; ctx.fill(cached.path);
    } else p.raw(`<path class="coelum-ground" d="${groundShape(W, H, radius, rotation)}" fill="${c.ground}"/>`);
  }
  p.raw('<g font-family="system-ui, sans-serif">');
  line(Array.from({ length: 181 }, (_, i) => ({ alt: 0, az: i * 2 })), { stroke: opts.ground ? c.horizon : '#52647d', width: 1.2 });
  // The local horizon (terrain), when it has been computed for the place.
  if (opts.terrain) {
    let d = '';
    for (let i = 0; i <= 720; i++) {
      const az = i / 2, q = xy({ alt: opts.terrain(az), az }), prev = i && xy({ alt: opts.terrain(az - 0.5), az: az - 0.5 });
      d += i && Math.hypot(q.x - prev.x, q.y - prev.y) < radius * 0.4 ? `L${f(q.x)},${f(q.y)}` : `M${f(q.x)},${f(q.y)}`;
    }
    p.path(d, { stroke: PALETTE.terrain, width: 1.2 });
  }
  // Azimuth ticks below the horizon: every 10°, longer at 30° and 90°.
  let ticks = '';
  for (let az = 0; az < 360; az += 10) {
    const a = xy({ alt: 0, az }), b = xy({ alt: az % 90 === 0 ? -3.2 : az % 30 === 0 ? -2.2 : -1.2, az });
    if (Math.hypot(a.x - b.x, a.y - b.y) < radius * 0.2) ticks += `M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`;
  }
  p.path(ticks, { stroke: c.horizon, width: 1 });
  if (opts.horizontal) {
    for (const alt of [-60, -30, 30, 60]) {
      line(Array.from({ length: 181 }, (_, i) => ({ alt, az: i * 2 })), { stroke: c.horizontal, width: 0.65 });
      const q = { alt, az: 0 }, v = xy(q);
      if (visible({ ...q, ...v })) p.text(v.x + 4, v.y + 14, `${alt}°`, '#8baabd', 12);
    }
    for (let az = 0; az < 360; az += 30) line(Array.from({ length: 91 }, (_, i) => ({ alt: -90 + i * 2, az })), { stroke: c.horizontal, width: 0.65 });
  }
  if (opts.equatorial) {
    if (frame.equatorialGrid) for (const g of frame.equatorialGrid) line(g, { stroke: c.equatorial, width: 0.65 });
    else for (let dec = -60; dec <= 60; dec += 30) line(Array.from({ length: 181 }, (_, i) => frame.hor({ ra: i * 2, dec })), { stroke: c.equatorial, width: 0.65 });
    for (let ra = 0; ra < 360; ra += 30) {
      if (!frame.equatorialGrid) line(Array.from({ length: 91 }, (_, i) => frame.hor({ ra, dec: -90 + i * 2 })), { stroke: c.equatorial, width: 0.65 });
      const q = frame.hor({ ra, dec: 0 }), v = xy(q);
      if (visible({ ...q, ...v })) p.text(v.x, v.y, `${ra / 15}h`, '#96a4ce', 12);
    }
  }
  if (opts.boundaries && frame.boundaries) for (const b of frame.boundaries) line(b, { stroke: c.bounds, width: 0.7, dash: [2, 3] });
  if (opts.ecliptic && frame.ecliptic) line(frame.ecliptic, { stroke: c.ecliptic, width: 1, dash: [6, 4] });
  const objects = [], labels = [];
  if (opts.constellations) for (const k of frame.constellations) {
    // Subdivide the great-circle segments before projection (and clipping).
    if (k.curves) for (const l of k.curves) line(l, { stroke: c.lines, width: 0.8 });
    else for (const l of k.lines) {
      const points = [];
      for (let i = 1; i < l.length; i++) {
        const a = vec(l[i - 1].ra, l[i - 1].dec), b = vec(l[i].ra, l[i].dec);
        for (let j = 0; j <= 12; j++) {
          const u = a.map((x, n) => x * (1 - j / 12) + b[n] * j / 12);
          points.push(frame.hor({ ra: Math.atan2(u[1], u[0]) / R, dec: Math.atan2(u[2], Math.hypot(u[0], u[1])) / R }));
        }
      }
      line(points, { stroke: c.lines, width: 0.8 });
    }
    { const q = xy(k); if (visible({ ...k, ...q })) labels.push({ ...q, name: k.name.toUpperCase(), color: c.constellation, r: 0, priority: 4, size: Math.max(10, opts.labelSize - 3), center: true }); }
  }
  const add = (o, r) => {
    const q = xy(o);
    if ((opts.ground && o.alt < 0) || !Number.isFinite(q.x) || !Number.isFinite(q.y) || q.x < -r || q.x > W + r || q.y < -r || q.y > H + r) return null;
    objects.push({ ...o, ...q, radius: r });
    return q;
  };
  const deepSize = 4.5 * Math.min(1.8, 1 + 0.2 * Math.log2(scale));
  if (opts.deep) for (const o of frame.deep) {
    const q = add(o, deepSize);
    if (!q) continue;
    deepSymbol(p, o.type, q.x, q.y, deepSize);
    labels.push({ ...q, name: o.name, color: deepColor(o.type), r: deepSize + 1, priority: 3 });
  }
  for (const o of frame.stars) {
    if (o.mag > opts.magnitude) continue;
    const r = starRadius(o.mag, scale), q = add(o, r);
    if (!q) continue;
    starSymbol(p, o, q.x, q.y, r, starTint(o.bv));
    if (o.name === view.selected || o.named && o.mag < (scale > 2 ? 4.5 : 2)) labels.push({ ...q, name: o.name, color: c.label, r, priority: 2 });
  }
  // Downloaded stars: fainter ones appear as the chart is zoomed in.
  const faintLimit = Math.min(opts.magnitude, 6 + 1.25 * Math.log2(scale));
  if (faintLimit > 6) eachFaint(frame, faintLimit, (i, v, mag) => {
    if (opts.ground && v[2] < 0) return;
    const pv = projectVector(v, rotation), x = cx + pv.x * radius, y = cy + pv.y * radius;
    if (x < -2 || x > W + 2 || y < -2 || y > H + 2) return;
    const r = Math.max(0.45, starRadius(mag, scale) * 0.9), o = faintObject(frame, i, v);
    p.circle(x, y, r, { fill: starTint(o.bv) });
    objects.push({ ...o, x, y, radius: r });
  });
  for (const o of frame.bodies) {
    const r = o.body === 'sun' || o.body === 'moon' ? 7 : Math.max(2.2, 4 - o.mag * 0.3), q = add(o, r);
    if (!q) continue;
    if (o.body === 'moon') { const light = xy(o.light); moonSymbol(p, ctx, o, q.x, q.y, r, Math.atan2(light.y - q.y, light.x - q.x) / R); }
    else bodySymbol(p, o, q.x, q.y, r);
    labels.push({ ...q, name: o.name, color: o.body === 'sun' || o.body === 'moon' ? o.color : c.planet, r: o.body === 'saturn' ? r + 3 : r, priority: o.name === view.selected ? 0 : 1, important: true, mag: o.mag });
  }
  const symbols = objects.filter((o) => o.body), names = new Set(objects.map((o) => o.name));
  let hitLabels = [];
  if (opts.labels) {
    hitLabels = placeLabels(labels, {
      W, H, size: opts.labelSize, symbols,
      draw: (l, x, y) => p.text(x, y, l.name, l.color, l.size || opts.labelSize),
      leader: (l, x, y) => p.path(`M${f(l.x)},${f(l.y)}L${f(x)},${f(y)}`, { stroke: l.color, width: 0.7 }),
    }).filter((l) => names.has(l.name));
  }
  for (const [name, az, size, color] of [['N', 0, 15, '#eef3fa'], ['NE', 45, 11, '#a9bccf'], ['E', 90, 15, '#eef3fa'], ['SE', 135, 11, '#a9bccf'], ['S', 180, 15, '#eef3fa'], ['SW', 225, 11, '#a9bccf'], ['W', 270, 15, '#eef3fa'], ['NW', 315, 11, '#a9bccf']]) {
    const q = xy({ alt: -6.5, az }); p.text(q.x, q.y + size / 3, name, color, size, 'middle', c.ground, 700);
  }
  const chosen = findObject(frame, view.selected);
  if (chosen) {
    const o = objects.find((x) => x.name === chosen.name), q = o || xy(chosen);
    if (Number.isFinite(q.x)) reticle(p, q.x, q.y, o ? o.radius : 3, '#ffcf5a');
  }
  p.raw('</g>');
  return { svg: p.svg, objects, radius, hitLabels };
}

// Legend for the chart, with the same symbols.
export function chartLegend() {
  const icon = (draw, w = 28) => { const p = pen(null); draw(p); return `<svg viewBox="0 0 ${w} 20" width="${w}" height="20" aria-hidden="true">${p.svg}</svg>`; };
  const star = (o, r, color = '#f3f5fa') => icon((p) => starSymbol(p, o, 14, 10, r, color));
  const mags = [-1, 0, 1, 2, 3, 4, 5, 6].map((m) => `<span class="coelum-mag"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="${starRadius(m).toFixed(2)}" fill="#f3f5fa"/></svg>${m}</span>`).join('');
  const row = (svg, label) => `<li>${svg}<span>${label}</span></li>`;
  const lineIcon = (st) => icon((p) => p.path('M2,10H26', st));
  return `<h3>Legend</h3><p class="coelum-mags" aria-label="Star magnitudes">${mags}</p><ul>
    ${row(star({ double: true }, 2.2), 'Double star')}${row(star({ variable: true }, 2), 'Variable star')}
    ${row(icon((p) => bodySymbol(p, { body: 'sun', color: BODY_COLORS.sun }, 14, 10, 6)), 'Sun')}
    ${row(icon((p) => moonSymbol(p, null, { phase: 60, color: BODY_COLORS.moon }, 14, 10, 6, 0)), 'Moon (phase)')}
    ${row(icon((p) => bodySymbol(p, { body: 'mars', color: BODY_COLORS.mars }, 14, 10, 3.2)), 'Planet')}
    ${row(icon((p) => deepSymbol(p, 'galaxy', 14, 10, 6)), 'Galaxy')}
    ${row(icon((p) => deepSymbol(p, 'open cluster', 14, 10, 6)), 'Open cluster')}
    ${row(icon((p) => deepSymbol(p, 'globular cluster', 14, 10, 6)), 'Globular cluster')}
    ${row(icon((p) => deepSymbol(p, 'nebula', 14, 10, 6)), 'Nebula')}
    ${row(icon((p) => deepSymbol(p, 'planetary nebula', 14, 10, 6)), 'Planetary nebula')}
    ${row(lineIcon({ stroke: PALETTE.lines, width: 1.2 }), 'Constellation figure')}
    ${row(lineIcon({ stroke: PALETTE.bounds, width: 1, dash: [2, 3] }), 'Constellation boundary')}
    ${row(lineIcon({ stroke: PALETTE.ecliptic, width: 1.2, dash: [6, 4] }), 'Ecliptic')}
    ${row(lineIcon({ stroke: PALETTE.terrain, width: 1.2 }), 'Local horizon (terrain)')}
    ${row(icon((p) => p.rect(2, 4, 24, 12, { fill: '#5d73a8', opacity: 0.55 })), 'Milky Way')}
    ${row(icon((p) => reticle(p, 14, 10, 0, '#ffcf5a'), 28), 'Selected object')}
  </ul>`;
}

// Search names, aliases (M31 → Andromeda Galaxy), constellations and HIP
// numbers; accents, case and spaces are ignored ("m 31" finds M31).
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function searchSky(frame, query, limit = 8) {
  const q = fold(query), qc = q.replace(/ /g, '');
  if (!qc) return [];
  const order = { moon: 0, planet: 0, constellation: 2, star: 1 };
  const entries = [
    ...frame.bodies.map((o) => ({ o, keys: [o.name] })),
    ...frame.stars.filter((o) => o.named || o.mag < 6.1 && /^hip/.test(qc)).map((o) => ({ o, keys: o.named ? [o.name, o.catalogId] : [o.catalogId] })),
    ...frame.deep.map((o) => ({ o, keys: [o.name, ...(o.description ? o.description.split(' · ') : [])] })),
    ...frame.constellations.map((o) => ({ o, keys: [o.name] })),
  ];
  const out = [];
  for (const { o, keys } of entries) {
    let best = null;
    for (const key of keys) {
      const k = fold(key), kc = k.replace(/ /g, '');
      const score = kc === qc ? 0 : kc.startsWith(qc) ? 1 : k.split(' ').some((w) => w.startsWith(q)) ? 2 : kc.includes(qc) ? 3 : null;
      if (score !== null && (!best || score < best.score)) best = { score, alias: key === o.name ? null : key };
    }
    if (best) out.push({ ...best, object: o });
  }
  const hip = /^hip(\d+)$/.exec(qc), extra = hip && !out.some((r) => r.object.catalogId === `HIP ${hip[1]}`) && findFaint(frame, `HIP ${hip[1]}`);
  if (extra) out.push({ score: 0, alias: null, object: extra });
  return out.sort((a, b) => a.score - b.score || (order[a.object.type] ?? 1.5) - (order[b.object.type] ?? 1.5) || (a.object.mag ?? 99) - (b.object.mag ?? 99)).slice(0, limit)
    .map(({ object, alias }) => ({ name: object.name, alias, type: object.type, alt: object.alt, mag: object.mag }));
}

export function coelumPreview(model) {
  if (previews.has(model)) return previews.get(model);
  const chart = skyChart(skyFrame(model.t, model.place));
  const html = `<button type="button" class="coelum-preview" aria-label="Open interactive sky chart"><svg class="coelum-svg" viewBox="0 0 360 360" role="img" aria-label="Sky above the horizon, north up and east left">${chart.svg}</svg><span><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z" fill="currentColor"/></svg>Explore the sky · ${esc(model.label)} · ${esc(new Date(model.t * 1000).toISOString().replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, ''))} UTC</span></button>`;
  previews.set(model, html);
  return html;
}

const sexagesimal = (value, hours = false, signed = false) => {
  const total = Math.round(Math.abs(value) * 3600), a = Math.floor(total / 3600), b = Math.floor(total / 60) % 60, c = total % 60;
  const sign = value < 0 ? '−' : signed ? '+' : '';
  return hours ? `${String(a % 24).padStart(2, '0')}h ${String(b).padStart(2, '0')}m ${String(c).padStart(2, '0')}s`
    : `${sign}${a}° ${String(b).padStart(2, '0')}′ ${String(c).padStart(2, '0')}″`;
};

export function objectDetails(o) {
  const row = (name, value) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`;
  const notes = [o.double && 'double or multiple', o.variable && 'variable'].filter(Boolean);
  return `<div class="coelum-object-head"><h3>${esc(o.name)}</h3><span>${esc(o.type)}</span></div>
    ${o.description ? `<p>${esc(o.description)}</p>` : ''}<dl>
    ${row('Right ascension (RA)', sexagesimal(o.ra / 15, true))}
    ${row('Declination (Dec)', sexagesimal(o.dec, false, true))}
    ${row('Altitude (Alt)', sexagesimal(o.alt, false, true))}
    ${Number.isFinite(o.apparentAlt) ? row('Apparent altitude', sexagesimal(o.apparentAlt, false, true)) : ''}
    ${row('Azimuth (Az)', sexagesimal(o.az))}
    ${o.type === 'constellation' ? '' : row('Visual magnitude', Number.isFinite(o.mag) ? o.mag.toFixed(2) : 'Not available')}
    ${notes.length ? row('Hipparcos', notes.join(', ')) : ''}
    ${o.catalogId ? row('Catalog', o.catalogId) : ''}
    ${o.distancePc ? row('Distance', `${o.distancePc.toFixed(2)} pc`) : ''}
    ${o.body && Number.isFinite(o.dist) ? row('Distance', `${Math.round(o.dist).toLocaleString('en')} km`) : ''}
    ${o.body === 'moon' ? row('Illuminated', `${((1 + Math.cos(o.phase * R)) * 50).toFixed(1)} %`) : ''}
    </dl><p class="coelum-coordinate-note">Equatorial coordinates of date · ${Number.isFinite(o.apparentAlt) ? 'apparent altitude with refraction (standard atmosphere)' : 'altitude without refraction'} · azimuth from north through east${o.alt < 0 ? ' · below the horizon' : ''}.</p>`;
}
