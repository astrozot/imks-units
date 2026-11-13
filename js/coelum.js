// Offline whole-sky chart. Positions in this drawing are apparent (without
// refraction). An azimuthal equidistant camera looks out from inside the
// celestial sphere; its orientation is rotated by spherical drag gestures.
// This module holds the geometry, the catalogs of a frame and the map-like
// chart; coelumsky.js draws the realistic sky, coelumui.js the explorer.
import { CONSTELLATIONS, BOUNDARIES } from './skydata.js';
import { CHART_STARS } from './stardata.js';
import { DEEP } from './catalog.js';
import { heliocentric, surfaceObserver, solarDeflectionState, apparentFrame, centuries, nutation, siderealTime, topocentric, aspect, magnitude, moons, planetOf, MOON_RADIUS, equatorial, horizontal, satellitePosition, earthShadow, moonDisk } from './astro.js';
import { satelliteLight } from './satellites.js';
import { EPOCHS, MINOR_PLANETS } from './minorplanets.js';
import { skyRaster } from './skyraster.js';
import { searchLunarFeatures, lunarFeatureState } from './lunarfeatures.js';
import { searchMarsFeatures, marsFeatureState, marsDisk } from './marsfeatures.js';

// Selection, labels and tracking use names as identifiers. Components of a
// multiple star can share a Bayer designation (e.g. three θ¹ Ori entries).
const STAR_NAMES = CHART_STARS.map(([hip, , , , , , , , , proper, names]) => {
  const designations = [...names ? names.split('|') : [], ...hip ? [`HIP ${hip}`] : []];
  return { name: proper || designations.shift() || 'Star', designations };
});
const starNameCounts = new Map();
for (const { name } of STAR_NAMES) starNameCounts.set(name, (starNameCounts.get(name) || 0) + 1);
for (const star of STAR_NAMES) if (starNameCounts.get(star.name) > 1) {
  const id = star.designations.find((s) => s.startsWith('HIP ')) || star.designations.find((s) => s.startsWith('HD '));
  star.designations.unshift(star.name);
  star.name = `${star.name} (${id})`;
}

export const R = Math.PI / 180;
const clamp = (x) => Math.max(-1, Math.min(1, x));
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const vec = (a, d) => [Math.cos(d * R) * Math.cos(a * R), Math.cos(d * R) * Math.sin(a * R), Math.sin(d * R)];
export const horizontalVector = (alt, az) => [Math.cos(alt * R) * Math.sin(az * R), Math.cos(alt * R) * Math.cos(az * R), Math.sin(alt * R)];
export const SOLAR_BODIES = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
// Rounded, reversible playback steps. Beyond two hours/s, keep two
// significant digits; 100 billion × spans millennia in a second.
export const PLAYBACK_SPEEDS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 240, 480, 900, 1800, 3600, 7200];
while (PLAYBACK_SPEEDS.at(-1) < 1e11) PLAYBACK_SPEEDS.push(Math.min(1e11, Number((PLAYBACK_SPEEDS.at(-1) * 2).toPrecision(2))));
export function stepPlaybackSpeed(rate, faster) {
  const value = Math.abs(rate), steps = faster ? PLAYBACK_SPEEDS : [...PLAYBACK_SPEEDS].reverse();
  return Math.sign(rate) * (steps.find((x) => faster ? x > value : x < value) ?? steps.at(-1));
}
export function formatPlaybackSpeed(rate) {
  const value = Math.abs(rate), unit = value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1;
  const suffix = unit === 1e9 ? 'G' : unit === 1e6 ? 'M' : unit === 1e3 ? 'k' : '';
  return `${rate < 0 ? '−' : ''}${unit === 1 ? value : Number((value / unit).toPrecision(2))}${suffix}×`;
}
// Hide bodies completing an orbit in one real second or less. Keep the
// Sun for daylight; omit minor bodies/satellites with the Moon rather
// than evaluating their many short or uncertain orbits at extreme rates.
const ORBIT_DAYS = { moon: 27.32, mercury: 87.97, venus: 224.7, mars: 686.98, jupiter: 4332.59, saturn: 10759.22, uranus: 30688.5, neptune: 60182 };
export const playbackBodyVisible = (body, rate) => Math.abs(rate) < (body === 'sun' ? 365.256 : ORBIT_DAYS[body] ?? ORBIT_DAYS.moon) * 86400;
export const DEFAULT_LAYERS = { ground: true, milkyway: true, constellations: true, boundaries: false, ecliptic: true, horizontal: false, equatorial: false, galactic: false, deep: false, minor: false, satellites: true, labels: true, magnitude: 6, labelSize: 14 };
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
export const BODY_COLORS = { sun: '#ffd36c', moon: '#f2eee3', mercury: '#c7b5a2', venus: '#fff2c6', mars: '#f59872', jupiter: '#f2d2ac', saturn: '#e6d49a', uranus: '#9fe1de', neptune: '#8da9ff', minor: '#c9c1b4', comet: '#9fe8d0' };
// Atlas colours: deep-sky symbols follow the usual printed-atlas code
// (galaxies red, clusters yellow, nebulae green).
export const PALETTE = {
  sky: '#0c1730', ground: '#17211b', horizon: '#86a690', lines: '#5274a3', bounds: '#3d5780', ecliptic: '#d0a54c', equatorial: '#3d5384', galactic: '#76558a', horizontal: '#2e4c5e',
  terrain: '#9fd58c', galaxy: '#ff8f80', cluster: '#f0d36c', nebula: '#6fdc9a', other: '#b9a3ff', label: '#c3d1e6', constellation: '#86a3cc', planet: '#ffe2a8',
  satellite: '#7fdcff', shadowed: '#71819a',
};
export const starTint = (bv = 0.6) => (bv < 0 ? '#cbdcff' : bv < 0.3 ? '#eef2ff' : bv < 0.6 ? '#fffaf0' : bv < 1.0 ? '#ffecc9' : '#ffd5a4');
// Sizes follow the magnitude below the chart's limit, which deepens as it
// zooms: a zoomed-in cluster keeps its bright and faint members apart.
export const starRadius = (mag, scale = 1) => {
  const zoom = Math.log2(Math.max(1, scale)), rel = Math.max(0, 6 + 1.25 * zoom - mag);
  return Math.min(4.6 * Math.min(1.5, 1 + 0.12 * zoom), 0.5 + 0.045 * rel ** 2.1);
};

const previews = new WeakMap();
export const MIN_TIME = Date.parse('-001000-01-01T00:00:00Z') / 1000, MAX_TIME = Date.parse('3001-01-01T00:00:00Z') / 1000 - 1;
export const limitTime = (t) => Math.min(MAX_TIME, Math.max(MIN_TIME, t));

// A date's precession/nutation matrix is shared by the entire background.
// Aberration and parallax are applied separately to physical catalog objects;
// coordinate grids retain this pure rotation.
function dateRotation(t) {
  return apparentFrame(centuries(t)).columns;
}

// The matrix (rows) from a horizontal vector [east, north, up] to J2000
// equatorial coordinates: used to paint the Milky Way.
export function horizonToJ2000(frame) {
  const lst = siderealTime(frame.t, frame.place[1]) * R, lat = frame.place[0] * R;
  const sl = Math.sin(lst), cl = Math.cos(lst), sp = Math.sin(lat), cp = Math.cos(lat);
  const E = [[-sl, cl, 0], [-sp * cl, -sp * sl, cp], [cp * cl, cp * sl, sp]], M = frame.matrix;
  return [0, 1, 2].flatMap((k) => E.map((col) => dot3(M[k], col)));
}

// ICRS/J2000 to Galactic rotation (ESA Gaia DR3 documentation, eq. 4.62).
// https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu3ast/sec_cu3ast_intro/ssec_cu3ast_intro_tansforms.html
const GALACTIC = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
];
// Rows of the rotation from the local horizon to the fixed Galactic frame.
export function horizonToGalactic(frame) {
  const h = horizonToJ2000(frame);
  return GALACTIC.flatMap((row) => [0, 1, 2].map((j) => row[0] * h[j] + row[1] * h[3 + j] + row[2] * h[6 + j]));
}
export function galacticCoordinates(o, frame) {
  // Undo the date's precession/nutation before applying the fixed system.
  const v = vec(o.ra, o.dec), j2000 = frame.matrix.map((col) => dot3(col, v));
  const g = GALACTIC.map((row) => dot3(row, j2000));
  return { lon: (Math.atan2(g[1], g[0]) / R + 360) % 360, lat: Math.atan2(g[2], Math.hypot(g[0], g[1])) / R };
}

export function horizonPoint(ra, dec, lat, lst) {
  const h = (lst - ra) * R, d = dec * R, p = lat * R;
  return {
    alt: Math.asin(clamp(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h))) / R,
    az: (Math.atan2(-Math.cos(d) * Math.sin(h), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(h)) / R + 360) % 360,
  };
}

// Minor planets and comets: the built-in ones (osculating elements at
// yearly epochs, as in lookup.js) and those the app has looked up.
// A minor planet named like a moon (85 Io) keeps its number.
const BUILTIN_MINOR = MINOR_PLANETS.map(([n, name, H, G, rows]) => ({
  name: !name ? `(${n})` : planetOf(name) ? `${n} ${name}` : name, number: n, H, G, orbits: rows.map(([q, e, i, node, peri, tp], k) => [EPOCHS[k], q, e, i, node, peri, EPOCHS[k] + tp]),
}));
let minorBodies = BUILTIN_MINOR;
export function setMinorBodies(extra = []) {
  const names = new Set(BUILTIN_MINOR.map((m) => m.name));
  const numbers = new Set(BUILTIN_MINOR.map((m) => m.number));
  minorBodies = [...BUILTIN_MINOR, ...extra.filter((m) => (m.orbits || m.orbit) && !names.has(m.name) && !numbers.has(Number(/^\d+/.exec(m.name)?.[0])) && names.add(m.name))];
}
const isComet = (m) => m.M1 !== undefined;

function solarBodies(t, place, hor, rate = 0) {
  const bodies = SOLAR_BODIES.filter((body) => body === 'sun' || playbackBodyVisible(body, rate)).map((body) => {
    const p = topocentric(body, t, place), h = hor(p);
    return { ...p, ...h, name: body[0].toUpperCase() + body.slice(1), body, mag: magnitude(body, t), type: body === 'sun' ? 'star' : body === 'moon' ? 'moon' : 'planet', color: BODY_COLORS[body] };
  });
  bodies[0].bv = 0.65;
  // Retain the Sun's coordinates for lighting/status, but suppress its
  // disk, label and selection target once Earth's orbit is too fast.
  bodies[0].hidden = !playbackBodyVisible('sun', rate);
  for (const m of playbackBodyVisible('minor', rate) ? minorBodies : []) {
    let p, mag;
    try { p = topocentric(m, t, place); mag = magnitude(m, t); } catch { continue; }
    if (!Number.isFinite(p.ra) || !Number.isFinite(p.dec)) continue;
    const comet = isComet(m);
    bodies.push({ ...p, ...hor(p), name: m.name, number: m.number, body: comet ? 'comet' : 'minor', mag, type: comet ? 'comet' : 'minor planet', color: BODY_COLORS[comet ? 'comet' : 'minor'] });
  }
  const moon = bodies.find((o) => o.body === 'moon'), sun = bodies[0];
  for (const o of bodies.filter((o) => ORBIT_DAYS[o.body])) {
    const a = aspect(o.body, t);
    o.phase = a.phase; o.elong = a.elong; o.light = hor(towardSun(o, sun));
  }
  if (moon) {
    moon.north = hor({ ra: moon.ra, dec: Math.min(89.999, moon.dec + 0.06) });
    moon.shadow = shadowOnMoon(moon, t, hor);
  }
  return bodies;
}
// The Earth's shadow on the Moon, near the full moon: its center where the
// Moon is seen (the offset from the Moon's geocentric place, scaled to its
// size seen from the place), and the radii of the umbra and the penumbra
// and the distance of their center, in the Moon's radii; or null
function shadowOnMoon(moon, t, hor) {
  if (!(moon.phase < 6)) return null;
  const g = earthShadow(t), dra = ((g.center.ra - g.moon.ra + 540) % 360) - 180, dy = g.center.dec - g.moon.dec;
  const d = Math.hypot(dra * Math.cos(g.moon.dec * R), dy);
  if (d > g.penumbra + g.moon.r) return null;
  const k = Math.asin(1737.4 / moon.dist) / R / g.moon.r;
  return { center: hor({ ra: moon.ra + dra * k, dec: moon.dec + dy * k }), umbra: g.umbra / g.moon.r, penumbra: g.penumbra / g.moon.r, d: d / g.moon.r };
}
// A point just off a body toward the Sun: it orients the lit limb.
function towardSun(o, sun) {
  const m = vec(o.ra, o.dec), s = vec(sun.ra, sun.dec), dot = dot3(m, s);
  const tangent = s.map((x, i) => x - dot * m[i]), len = Math.hypot(...tangent);
  const v = m.map((x, i) => x + 0.001 * tangent[i] / Math.max(len, 1e-12));
  return { ra: Math.atan2(v[1], v[0]) / R, dec: Math.atan2(v[2], Math.hypot(v[0], v[1])) / R };
}

// Artificial satellites (satellites.js, set by the app): exact at every
// frame, as they cross the sky in minutes; those docked to a station are
// left out, and all with elements over 30 days from the time. Sunlit or in
// the Earth's shadow, with the magnitude estimated; above the horizon, the
// trail of the last 80 s, from where they came.
let satellites = [];
export function setSatellites(list) { satellites = list; }
const SAT_SPAN = 30 * 86400;
function satelliteBodies(t, place, hor) {
  const out = [];
  let s = null;
  for (const sat of satellites) {
    if (sat.docked || Math.abs(t - sat.epoch) > SAT_SPAN) continue;
    const g = satellitePosition(sat, t);
    if (!g) continue;
    const p = topocentric(sat, t, place);
    if (!Number.isFinite(p.ra)) continue;
    if (!s) { const sun = equatorial('sun', t); s = vec(sun.ra, sun.dec); }
    const h = hor(p), light = satelliteLight(sat.std, g, vec(p.ra, p.dec).map((x) => x * p.dist), s);
    const o = { ...p, ...h, name: sat.name, body: 'satellite', type: 'satellite', satellite: sat, lit: light.lit, mag: light.mag ?? undefined, height: Math.hypot(...g) - 6378.137 };
    if (h.alt > -3) o.trail = Array.from({ length: 8 }, (_, k) => horizontal(sat, t - 10 * (k + 1), place)).filter((q) => Number.isFinite(q.alt));
    out.push(o);
  }
  return out;
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

// Shared by all catalog stars, including the tiled drawing path. The Earth
// state is evaluated once per update, never inside the per-star loop.
function catalogObserver(t, place, matrix) {
  const T = centuries(t), n = nutation(T), [earth, velocity] = heliocentric('earth', T, true);
  const rotate = ([x, y, z]) => {
    const a = x * Math.cos(n.dpsi * R) - y * Math.sin(n.dpsi * R), b = x * Math.sin(n.dpsi * R) + y * Math.cos(n.dpsi * R);
    return [a, b * Math.cos(n.eps * R) - z * Math.sin(n.eps * R), b * Math.sin(n.eps * R) + z * Math.cos(n.eps * R)];
  };
  const f = apparentFrame(T);
  const obs = surfaceObserver(t, place), E = f.fromLegacy(rotate(earth)), V = f.fromLegacy(rotate(velocity));
  const position = E.map((x, i) => x + obs.position[i] / 149597870.7), beta = V.map((x, i) => x / 173.1446327 + obs.beta[i]);
  const positionJ2000 = matrix.map((col) => dot3(col, position));
  return { position, beta, positionJ2000, betaJ2000: matrix.map((col) => dot3(col, beta)), deflection: solarDeflectionState(position), deflectionJ2000: solarDeflectionState(positionJ2000) };
}

// Propagated catalog vectors need not have unit length. Retaining that
// length also retains the small distance change due to transverse motion.
function apparentCatalogVector(v, parallax, frame) {
  const m = frame.matrix, o = frame.observer, px = parallax > 0 ? parallax / 206264806 : 0;
  let x = m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2] - px * o.position[0];
  let y = m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2] - px * o.position[1];
  let z = m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2] - px * o.position[2];
  const r = Math.sqrt(x * x + y * y + z * z), solar = o.deflection, e = solar.direction;
  const pe = (x * e[0] + y * e[1] + z * e[2]) / r;
  const w = solar.strength / Math.max(1 + pe, solar.limiter);
  x += w * (r * e[0] - pe * x); y += w * (r * e[1] - pe * y); z += w * (r * e[2] - pe * z);
  x += r * o.beta[0]; y += r * o.beta[1]; z += r * o.beta[2];
  const norm = Math.sqrt(x * x + y * y + z * z);
  return [x / norm, y / norm, z / norm];
}

export function skyFrame(t, place, rate = 0) {
  const matrix = dateRotation(t), lst = siderealTime(t, place[1]);
  const state = { matrix, years: centuries(t) * 100, observer: catalogObserver(t, place, matrix) };
  const eq = (ra, dec, pmra = 0, pmdec = 0) => {
    const v = vec(ra, dec), years = state.years, mas = R / 3600000;
    const east = [-Math.sin(ra * R), Math.cos(ra * R), 0], north = [-Math.sin(dec * R) * Math.cos(ra * R), -Math.sin(dec * R) * Math.sin(ra * R), Math.cos(dec * R)];
    const u = v.map((x, i) => x + years * mas * (pmra * east[i] + pmdec * north[i]));
    const w = [0, 1, 2].map((i) => state.matrix.reduce((sum, col, k) => sum + col[i] * u[k], 0));
    return { ra: (Math.atan2(w[1], w[0]) / R + 360) % 360, dec: Math.atan2(w[2], Math.hypot(w[0], w[1])) / R, catalogVector: u };
  };
  const hor = (p) => horizonPoint(p.ra, p.dec, place[0], lst);
  const catalog = (ra, dec, pmra, pmdec) => { const p = eq(ra, dec, pmra, pmdec); return { ...p, ...(state.hor || hor)(p) }; };
  const apparentCatalog = (ra, dec, pmra = 0, pmdec = 0, parallax = 0) => {
    const p = eq(ra, dec, pmra, pmdec), v = apparentCatalogVector(p.catalogVector, parallax, state);
    p.ra = (Math.atan2(v[1], v[0]) / R + 360) % 360;
    p.dec = Math.atan2(v[2], Math.hypot(v[0], v[1])) / R;
    return { ...p, parallax, ...(state.hor || hor)(p) };
  };
  const stars = CHART_STARS.map(([hip, ra, dec, mag, bv, flags, pmra, pmdec, parallax, proper, names, spect], i) => {
    // named by the IAU, or by the first designation (Bayer, Flamsteed, HIP)
    const { name, designations } = STAR_NAMES[i];
    return { ...apparentCatalog(ra, dec, pmra, pmdec, parallax), name, designations, mag, bv: bv ?? undefined, type: 'star', named: Boolean(proper), parallax, pmra, pmdec, spect, double: Boolean(flags & 1), variable: Boolean(flags & 2) };
  });
  const bodies = [...solarBodies(t, place, hor, rate), ...(playbackBodyVisible('satellite', rate) ? satelliteBodies(t, place, hor) : [])];
  const deep = DEEP.map(([names, ra, dec, mag, type, major, minor]) => ({ ...apparentCatalog(ra, dec), name: names[0], description: names.slice(1).join(' · '), mag, size: major ? [major, minor ?? major] : null, type }));
  const constellations = CONSTELLATIONS.map(([name, ra, dec, lines]) => ({ name, type: 'constellation', ...apparentCatalog(ra, dec), lines: lines.map((line) => line.map(([a, d]) => apparentCatalog(a, d))) }));
  const ecliptic = ECLIPTIC.map(([a, d]) => catalog(a, d));
  const boundaries = BOUNDARY_POINTS.map((line) => line.map(([a, d]) => catalog(a, d)));
  return Object.assign(state, { t, place, stars, bodies, deep, constellations, ecliptic, boundaries, hor, catalog, apparentCatalog });
}

// Cache catalog space motion for a day; update the shared frame, parallax
// and aberration each frame, and interpolate solar-system positions
// between exact one-minute samples. No catalog rebuilds in the frame loop.
export function createSkyAnimator(t, place, layers = { deep: true, constellations: true, equatorial: true, ecliptic: true, boundaries: true }, rate = 0) {
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
  const updateStar = (p) => {
    const v = apparentCatalogVector(p.catalogVector, p.parallax, frame);
    p.ra = (Math.atan2(v[1], v[0]) / R + 360) % 360;
    p.dec = Math.atan2(v[2], Math.hypot(v[0], v[1])) / R;
    p.equatorialVector = v;
    update(p);
  };
  const curve = (line) => {
    const out = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1].catalogVector, b = line[i].catalogVector;
      for (let j = 0; j <= 12; j++) {
        const v = unit3(a.map((x, k) => x * (1 - j / 12) + b[k] * j / 12));
        out.push({ ra: Math.atan2(v[1], v[0]) / R, dec: Math.asin(clamp(v[2])) / R, catalogVector: v });
      }
    }
    return out;
  };
  return (time) => {
    if (!frame || Math.abs(time - catalogTime) >= 86400) {
      frame = skyFrame(time, place, rate); catalogTime = time;
      for (const c of frame.constellations) c.curves = c.lines.map(curve);
    }
    const lst = siderealTime(time, place[1]) * R; sl = Math.sin(lst); cl = Math.cos(lst);
    frame.t = time; frame.hor = hor; frame.years = centuries(time) * 100;
    frame.matrix = dateRotation(time);
    frame.observer = catalogObserver(time, place, frame.matrix);
    for (const p of frame.stars) updateStar(p);
    if (layers.deep) for (const p of frame.deep) updateStar(p);
    if (layers.constellations) for (const c of frame.constellations) { updateStar(c); for (const line of c.curves) for (const p of line) updateStar(p); }
    if (layers.ecliptic) for (const p of frame.ecliptic) update(p);
    if (layers.boundaries) for (const line of frame.boundaries) for (const p of line) update(p);
    const sample = Math.floor(time / 60) * 60;
    if (sample !== sampleTime) {
      const exactHor = (p) => horizonPoint(p.ra, p.dec, place[0], siderealTime(sample, place[1]));
      left = sample === sampleTime + 60 ? right : solarBodies(sample, place, exactHor, rate);
      right = solarBodies(sample + 60, place, exactHor, rate); sampleTime = sample;
    }
    const fraction = (time - sampleTime) / 60;
    frame.bodies = left.map((a, i) => {
      const b = right[i]?.name === a.name ? right[i] : a, p = { ...a, ra: (a.ra + (((b.ra - a.ra + 540) % 360) - 180) * fraction + 360) % 360 };
      for (const key of ['dec', 'dist', 'mag', 'phase']) if (Number.isFinite(a[key])) p[key] = a[key] + (b[key] - a[key]) * fraction;
      // East/west flips at opposition; interpolate the angular distance
      // separately so a planet opposite the Sun never passes through 0°.
      if (Number.isFinite(a.elong)) p.elong = (Math.abs(a.elong) + (Math.abs(b.elong) - Math.abs(a.elong)) * fraction) * Math.sign(fraction < 0.5 ? a.elong : b.elong);
      return Object.assign(p, hor(p));
    });
    const moon = frame.bodies.find((o) => o.body === 'moon'), sun = frame.bodies[0];
    for (const o of frame.bodies.filter((o) => ORBIT_DAYS[o.body])) o.light = hor(towardSun(o, sun));
    if (moon) {
      moon.north = hor({ ra: moon.ra, dec: Math.min(89.999, moon.dec + 0.06) });
      moon.shadow = shadowOnMoon(moon, time, hor);
    }
    if (playbackBodyVisible('satellite', rate)) frame.bodies.push(...satelliteBodies(time, place, hor));
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

// Coordinate grids that get denser as the view zooms in: lines about 70 px
// apart, only within fov (degrees) of the view's center (a horizontal
// vector). Horizontal (alt/az), equatorial (RA/Dec of date), or galactic (l/b).
const GRID_STEPS = [30, 15, 10, 5, 2, 1, 0.5, 0.25, 1 / 6, 1 / 12, 1 / 30];
const RA_STEPS = [30, 15, 7.5, 5, 2.5, 1.25, 0.5, 0.25, 0.125, 1 / 12];
const gridStep = (steps, pxPerDeg) => { let step = steps[0]; for (const s of steps) if (s * pxPerDeg >= 70) step = s; return step; };
const degrees = (x) => {
  const t = Math.round(Math.abs(x) * 60), m = t % 60;
  return `${x < 0 && t ? '−' : ''}${Math.floor(t / 60)}°${m ? `${m}′` : ''}`;
};
const hours = (ra) => {
  const t = Math.round(((ra % 360) + 360) % 360 / 15 * 3600) % 86400, m = Math.floor(t / 60) % 60, s = t % 60;
  return `${Math.floor(t / 3600)}h${m || s ? `${m}m` : ''}${s ? `${s}s` : ''}`;
};
export function skyGrid(kind, frame, center, fov, pxPerDeg) {
  const horizontal = kind === 'horizontal', galactic = kind === 'galactic';
  const galPoint = (lat, lon) => {
    const v = vec(lon, lat), j = [0, 1, 2].map((i) => GALACTIC.reduce((s, row, k) => s + row[i] * v[k], 0));
    return frame.catalog((Math.atan2(j[1], j[0]) / R + 360) % 360, Math.atan2(j[2], Math.hypot(j[0], j[1])) / R);
  };
  const point = galactic ? galPoint : horizontal ? (lat, lon) => ({ alt: lat, az: ((lon % 360) + 360) % 360, vector: horizontalVector(lat, lon) }) : (lat, lon) => frame.hor({ ra: ((lon % 360) + 360) % 360, dec: lat });
  let c = center;
  if (!horizontal) {
    // The center in RA/Dec of date: hor() is a rotation, so its transpose.
    const axes = (galactic ? [point(0, 0), point(0, 90), point(90, 0)] : [frame.hor({ ra: 0, dec: 0 }), frame.hor({ ra: 90, dec: 0 }), frame.hor({ ra: 0, dec: 90 })]).map(pointVector);
    c = axes.map((a) => dot3(a, center));
  }
  const lat0 = Math.asin(clamp(c[2])) / R, lon0 = horizontal ? Math.atan2(c[0], c[1]) / R : Math.atan2(c[1], c[0]) / R;
  const f = Math.min(180, fov), cos0 = Math.max(0.25, Math.cos(lat0 * R));
  const latStep = gridStep(GRID_STEPS, pxPerDeg), lonStep = gridStep((horizontal || galactic) ? GRID_STEPS : RA_STEPS, pxPerDeg * cos0);
  const latLo = Math.max(-90, lat0 - f), latHi = Math.min(90, lat0 + f), polar = Math.abs(lat0) + f >= 89.9;
  const lonHalf = polar ? 180 : Math.asin(Math.min(1, Math.sin(f * R) / Math.cos(lat0 * R))) / R;
  const res = Math.min(2, f / 30), lines = [];
  for (let k = Math.ceil(latLo / latStep); k * latStep <= latHi; k++) {
    const lat = k * latStep;
    if (Math.abs(lat) > 89.99) continue;
    const n = Math.min(720, Math.ceil(2 * lonHalf * Math.cos(lat * R) / res) + 2);
    lines.push({ parallel: true, value: lat, label: `${galactic ? 'b ' : ''}${degrees(lat)}`, points: Array.from({ length: n + 1 }, (_, i) => point(lat, lon0 - lonHalf + 2 * lonHalf * i / n)) });
  }
  const from = polar ? 0 : Math.ceil((lon0 - lonHalf) / lonStep), to = polar ? Math.round(360 / lonStep) - 1 : Math.floor((lon0 + lonHalf) / lonStep);
  const n = Math.min(400, Math.ceil((latHi - latLo) / res) + 1);
  for (let k = from; k <= to; k++) {
    const lon = k * lonStep;
    lines.push({ parallel: false, value: lon, label: galactic ? `l ${degrees(((lon % 360) + 360) % 360)}` : horizontal ? degrees(((lon % 360) + 360) % 360) : hours(lon), points: Array.from({ length: n + 1 }, (_, i) => point(latLo + (latHi - latLo) * i / n, lon)) });
  }
  return lines;
}
// Where a grid line's label goes: parallels at their leftmost visible
// point, meridians where they cross a band low in the view (clear of the
// full-screen controls at the edges).
export function gridLabelAt(screen, W, H, visible, previous = null) {
  const candidates = [...screen.points], target = 0.78 * H;
  // Interpolate crossings instead of snapping to the closest mesh vertex.
  // Include the viewport edges so labels slide smoothly as lines enter it.
  for (let i = 1; i < screen.points.length; i++) {
    const a = screen.points[i - 1], b = screen.points[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) > Math.max(W, H)) continue;
    for (const [axis, value] of [['x', 6], ['x', W - 48], ['y', 16], ['y', H - 6], ['y', target]]) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      if (!(t >= 0 && t <= 1)) continue;
      const q = { ...a };
      for (const key of Object.keys(a)) if (typeof a[key] === 'number' && typeof b[key] === 'number') {
        // Azimuth wraps at north.
        const d = key === 'az' ? ((b[key] - a[key] + 540) % 360) - 180 : b[key] - a[key];
        q[key] = a[key] + t * d;
      }
      q[axis] = value;
      candidates.push(q);
    }
  }
  const valid = candidates.filter((q) => q.x >= 6 && q.x <= W - 48 && q.y >= 16 && q.y <= H - 6 && (screen.parallel || Math.abs(q.y - target) <= 0.1 * H) && visible(q));
  const score = (q) => screen.parallel ? q.x : Math.abs(q.y - target);
  valid.sort((a, b) => score(a) - score(b));
  if (!valid.length) return null;
  // A curved meridian can cross the band twice. Keep the same branch.
  if (previous) return valid.filter((q) => score(q) <= score(valid[0]) + 1e-6).sort((a, b) => Math.hypot(a.x - previous.x, a.y - previous.y) - Math.hypot(b.x - previous.x, b.y - previous.y))[0];
  return valid[0];
}

// Optional fainter stars (downloaded by the explorer): an ArrayBuffer of
// tools/stars.mjs, in tiles of the sky, of which only those in view are
// read; positions move by the proper motions.
let STORED = null;
export function setFaintStars(data) { STORED = data ? readStars(data) : null; }
export const faintCount = () => (STORED ? STORED.n : 0);
// The deepest magnitude of the stored stars.
export const faintDepth = () => (STORED ? STORED.depth : 6);

// The file: its arrays, each tile's center (J2000) and radius (radians),
// a polar cap about the pole, and the fastest proper motion (radians a
// year), by which stars may leave their tiles.
export function readStars(buffer) {
  if (buffer.byteLength < 20) throw new Error('incomplete star file');
  const head = new Uint32Array(buffer, 0, 5);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'STAR' || ![1, 2].includes(head[1])) throw new Error('not a star file of this version');
  const [, , T, n, A] = head;
  if (buffer.byteLength !== 24 + 20 * T + (head[1] === 2 ? 24 : 16) * n + 8 * A) throw new Error('incomplete star file');
  const box = new Float32Array(buffer, 20, 4 * T);
  let o = 20 + 16 * T;
  const start = new Uint32Array(buffer, o, T + 1); o += 4 * (T + 1);
  const tyc = new Uint32Array(buffer, o, n); o += 4 * n;
  const ra = new Uint16Array(buffer, o, n); o += 2 * n;
  const dec = new Uint16Array(buffer, o, n); o += 2 * n;
  const pmra = new Int16Array(buffer, o, n); o += 2 * n;
  const pmdec = new Int16Array(buffer, o, n); o += 2 * n;
  const plx = new Uint16Array(buffer, o, n); o += 2 * n;
  const mag = new Uint8Array(buffer, o, n); o += n;
  const bv = new Int8Array(buffer, o, n); o += n;
  const aliasStar = new Uint32Array(buffer, o, A), alias = new Uint32Array(buffer, o + 4 * A, A);
  // v2 appends exact Gaia DR3 IDs as low/high words, zero for AT-HYG stars.
  const gaia = head[1] === 2 ? new Uint32Array(buffer, o + 8 * A, 2 * n) : null;
  const center = new Float64Array(3 * T), reach = new Float32Array(T);
  let depth = 0, fastest = 0;
  for (let t = 0; t < T; t++) {
    const [a, d, sa, sd] = box.subarray(4 * t, 4 * t + 4);
    if (sa > 180) {
      center.set([0, 0, d < 0 ? -1 : 1], 3 * t);
      reach[t] = (90 - Math.min(Math.abs(d), Math.abs(d + sd))) * R;
    } else {
      const c = vec(a + sa / 2, d + sd / 2);
      center.set(c, 3 * t);
      reach[t] = Math.max(...[[a, d], [a + sa, d], [a, d + sd], [a + sa, d + sd], [a + sa / 2, d], [a + sa / 2, d + sd]].map(([x, y]) => Math.acos(clamp(dot3(c, vec(x, y))))));
    }
    if (start[t + 1] > start[t]) depth = Math.max(depth, mag[start[t + 1] - 1] / 20);
  }
  for (let j = 0; j < n; j++) fastest = Math.max(fastest, Math.abs(pmra[j]), Math.abs(pmdec[j]));
  // HD numbers can describe more than one resolved component. Keep those
  // aliases for search, but prefer a component's individual TYC identifier.
  const seenAliases = new Set(), sharedNames = new Set();
  for (const code of alias) {
    if (seenAliases.has(code)) sharedNames.add(`${code >= 2 ** 29 ? 'HD' : 'HIP'} ${code % 2 ** 28}`);
    seenAliases.add(code);
  }
  return { n, T, box, start, tyc, ra, dec, pmra, pmdec, plx, mag, bv, aliasStar, alias, gaia, center, reach, depth, sharedNames, maxParallax: plx.reduce((a, b) => Math.max(a, b), 0) * 0.02, fastest: Math.SQRT2 * fastest * R / 3.6e6 };
}
// Stored star j: its J2000 vector at the epoch, its tile and data
function storedStar(j) {
  const S = STORED;
  let lo = 0, hi = S.T - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.start[m] <= j) lo = m; else hi = m - 1; }
  const b = 4 * lo, ra = S.box[b] + S.ra[j] / 65535 * S.box[b + 2], dec = S.box[b + 1] + S.dec[j] / 65535 * S.box[b + 3];
  return { ra, dec, pmra: S.pmra[j], pmdec: S.pmdec[j], mag: S.mag[j] / 20, bv: S.bv[j] === -128 ? undefined : S.bv[j] / 50, parallax: S.plx[j] * 0.02 };
}
// Its designations, HIP and HD (from the aliases, sorted by star) then TYC
function storedNames(j) {
  const S = STORED, out = [];
  let lo = 0, hi = S.alias.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (S.aliasStar[m] < j) lo = m + 1; else hi = m; }
  for (let k = lo; k < S.alias.length && S.aliasStar[k] === j; k++) out.push(`${S.alias[k] >= 2 ** 29 ? 'HD' : 'HIP'} ${S.alias[k] % 2 ** 28}`);
  const t = S.tyc[j];
  if (t) out.push(`TYC ${Math.floor(t / 65536)}-${Math.floor(t / 4) % 16384}-${t % 4 + 1}`);
  if (S.gaia && (S.gaia[2 * j] || S.gaia[2 * j + 1])) out.unshift(`Gaia DR3 ${(BigInt(S.gaia[2 * j + 1]) << 32n) + BigInt(S.gaia[2 * j])}`);
  const primary = out.findIndex((name) => !S.sharedNames.has(name));
  if (primary > 0) out.unshift(...out.splice(primary, 1));
  // A few AT-HYG rows have no individual catalog ID. Give them an explicit
  // identity within this download, rather than the unresolvable name 'Star'.
  if (primary < 0) out.unshift(`Catalog V${S.depth} star ${j + 1}`);
  return out;
}

// Calls visit(j, horizontal vector, magnitude, B−V) for the stored stars
// brighter than the limit; no objects are made for the others. With a
// cone ({ v: horizontal direction, radius: radians }), only the tiles that
// reach it are read.
export function eachFaint(frame, limit, visit, cone = null) {
  const S = STORED;
  if (!S) return;
  const H = horizonToJ2000(frame), top = limit * 20, years = centuries(frame.t) * 100, k = years * R / 3.6e6;
  // the cone's axis in J2000; from J2000 to the horizon by the transpose
  const c = cone && [0, 1, 2].map((i) => H[3 * i] * cone.v[0] + H[3 * i + 1] * cone.v[1] + H[3 * i + 2] * cone.v[2]);
  const obs = frame.observer, beta = obs.betaJ2000, earth = obs.positionJ2000, solar = obs.deflectionJ2000, sun = solar.direction;
  // Double-precision tile centres keep tiny cones safe at arcsecond zoom.
  const margin = cone ? cone.radius + 1e-7 + S.fastest * Math.abs(years) + (Math.hypot(...beta) + solar.maxShift) * 1.01 + S.maxParallax / 206264806 * Math.hypot(...earth) : 0;
  for (let t = 0; t < S.T; t++) {
    const first = S.start[t], end = S.start[t + 1];
    if (first === end || S.mag[first] > top) continue;
    if (c && c[0] * S.center[3 * t] + c[1] * S.center[3 * t + 1] + c[2] * S.center[3 * t + 2] < Math.cos(Math.min(Math.PI, margin + S.reach[t]))) continue;
    const b = 4 * t, a0 = S.box[b] * R, d0 = S.box[b + 1] * R, ka = S.box[b + 2] * R / 65535, kd = S.box[b + 3] * R / 65535;
    for (let j = first; j < end && S.mag[j] <= top; j++) {
      // moved in the tangent plane: east × μα cos δ + north × μδ
      const a = a0 + S.ra[j] * ka, d = d0 + S.dec[j] * kd, ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
      const e = S.pmra[j] * k, nn = S.pmdec[j] * k;
      let x = cd * ca - e * sa - nn * sd * ca, y = cd * sa + e * ca - nn * sd * sa, z = sd + nn * cd;
      const px = S.plx[j] * 0.02 / 206264806;
      x -= px * earth[0]; y -= px * earth[1]; z -= px * earth[2];
      const distance = Math.sqrt(x * x + y * y + z * z);
      const pe = (x * sun[0] + y * sun[1] + z * sun[2]) / distance;
      const w = solar.strength / Math.max(1 + pe, solar.limiter);
      x += w * (distance * sun[0] - pe * x); y += w * (distance * sun[1] - pe * y); z += w * (distance * sun[2] - pe * z);
      x += distance * beta[0]; y += distance * beta[1]; z += distance * beta[2];
      const norm = Math.sqrt(x * x + y * y + z * z); x /= norm; y /= norm; z /= norm;
      visit(j, [H[0] * x + H[3] * y + H[6] * z, H[1] * x + H[4] * y + H[7] * z, H[2] * x + H[5] * y + H[8] * z], S.mag[j] / 20, S.bv[j] === -128 ? 0.6 : S.bv[j] / 50);
    }
  }
}
// A drawn star, its name made only when it is tapped.
export class FaintHit {
  constructor(i, x, y, radius) { this.i = i; this.x = x; this.y = y; this.radius = radius; }
  get name() { return storedNames(this.i)[0]; }
}
// Stored star j as an object (as the built-in stars), at the frame's time
function faintObject(frame, j) {
  const s = storedStar(j), [name, ...designations] = storedNames(j), p = frame.apparentCatalog(s.ra, s.dec, s.pmra, s.pmdec, s.parallax);
  return { ...p, ...frame.hor(p), name, designations, type: 'star', mag: s.mag, bv: s.bv, parallax: s.parallax, pmra: s.pmra, pmdec: s.pmdec,
    estimatedPhotometry: Boolean(STORED.gaia && (STORED.gaia[2 * j] || STORED.gaia[2 * j + 1])) };
}
// A stored star by one of its designations: HIP 12345, HD 12345, TYC 1-2-1
function findFaint(frame, name) {
  if (!STORED) return null;
  // A selected star is resolved on every frame. Keep its index rather than
  // rescanning a multi-million-star ID array while panning or playing time.
  if (name && STORED.lookupName === name) return faintObject(frame, STORED.lookupIndex);
  const m = /^(HIP|HD) (\d+)$/.exec(name || ''), t = /^TYC (\d+)-(\d+)-(\d+)$/.exec(name || '');
  const row = /^Catalog V([\d.]+) star (\d+)$/.exec(name || '');
  let j = -1;
  if (row && Number(row[1]) === STORED.depth && Number(row[2]) >= 1 && Number(row[2]) <= STORED.n) j = Number(row[2]) - 1;
  else if (m) { const k = STORED.alias.indexOf((m[1] === 'HD' ? 2 : 1) * 2 ** 28 + Number(m[2])); j = k < 0 ? -1 : STORED.aliasStar[k]; }
  else if (t) j = STORED.tyc.indexOf(Number(t[1]) * 65536 + Number(t[2]) * 4 + Number(t[3]) - 1);
  else if (STORED.gaia && /^Gaia DR3 \d{1,19}$/.test(name || '')) {
    const id = BigInt(name.slice(9)), lo = Number(id & 0xffffffffn), hi = Number(id >> 32n);
    if (id > 0n) for (let k = 0; k < STORED.n; k++) if (STORED.gaia[2 * k] === lo && STORED.gaia[2 * k + 1] === hi) { j = k; break; }
  }
  if (j < 0) return null;
  STORED.lookupName = name; STORED.lookupIndex = j;
  return faintObject(frame, j);
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
    // many circles of one style, [x, y, r, x, y, r…], filled at once
    dots(xyr, st) {
      if (!ctx) { for (let i = 0; i < xyr.length; i += 3) this.circle(xyr[i], xyr[i + 1], xyr[i + 2], st); return; }
      ctx.beginPath();
      for (let i = 0; i < xyr.length; i += 3) { ctx.moveTo(xyr[i] + xyr[i + 2], xyr[i + 1]); ctx.arc(xyr[i], xyr[i + 1], xyr[i + 2], 0, Math.PI * 2); }
      paint(st);
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
export function placeLabels(labels, { W, H, size, symbols, draw, leader, history }) {
  const boxes = [], placed = [], next = new Map();
  const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  for (const l of labels.sort((a, b) => a.priority - b.priority || (a.mag || 0) - (b.mag || 0))) {
    const key = l.key || l.name;
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
    const prior = history?.get(key);
    const order = candidates.map((_, i) => i);
    if (prior !== undefined && prior < candidates.length) {
      order.splice(order.indexOf(prior), 1); order.unshift(prior);
    }
    let placement = null;
    for (const index of order) {
      const [px, py] = candidates[index];
      const x = Math.min(W - width - 6, Math.max(6, px)), y = Math.max(font + 4, Math.min(H - 6, py));
      const box = [x - 3, y - font - 2, x + width + 3, y + 5];
      // New positions need extra clearance; a retained one can approach
      // its neighbors normally. This prevents toggling at collision edges.
      const margin = history && index !== prior ? 3 : 0;
      const clearance = [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin];
      if (boxes.some((b) => overlap(clearance, b))) continue;
      if (symbols.some((o) => overlap(clearance, [o.x - o.radius - 2, o.y - o.radius - 2, o.x + o.radius + 2, o.y + o.radius + 2]))) continue;
      placement = { x, y, box }; next.set(key, index); break;
    }
    if (!placement) continue;
    const { x, y, box } = placement;
    if (l.important && leader && (Math.abs(x - candidates[0][0]) > 2 || Math.abs(y - candidates[0][1]) > 2)) {
      leader(l, Math.max(box[0], Math.min(box[2], l.x)), Math.max(box[1], Math.min(box[3], l.y)));
    }
    boxes.push(box); draw(l, x, y);
    placed.push({ name: key, box });
  }
  if (history) { history.clear(); for (const [name, index] of next) history.set(name, index); }
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
  if (o.body === 'minor') { p.circle(x, y, r, { fill: o.color }); return; }
  if (o.body === 'comet') { p.path(`M${(x + r).toFixed(2)},${(y - r).toFixed(2)}l${(3 * r).toFixed(2)},${(-3 * r).toFixed(2)}`, { stroke: o.color, width: 1 }); p.circle(x, y, r, { fill: o.color }); return; }
  if (o.body === 'sun') { p.circle(x, y, r, { fill: o.color, stroke: '#fff3c4', width: 1 }); p.circle(x, y, 1.7, { fill: '#7a4e00' }); return; }
  if (o.body === 'saturn') p.ellipse(x, y, r + 3.4, (r + 3.4) * 0.38, -18, { stroke: o.color, width: 1 });
  p.circle(x, y, r, { fill: o.color, stroke: '#ffffff', width: 0.35 });
  if (o.body !== 'saturn') p.circle(x, y, r + 2.2, { stroke: o.color, width: 0.7, opacity: 0.8 });
}

// A satellite: a diamond, filled when sunlit, an outline in the Earth's
// shadow.
export function satelliteSymbol(p, o, x, y, r) {
  const f = (v) => v.toFixed(2), d = r * 1.4, shape = `M${f(x)},${f(y - d)}L${f(x + d)},${f(y)}L${f(x)},${f(y + d)}L${f(x - d)},${f(y)}Z`;
  p.path(shape, o.lit ? { fill: PALETTE.satellite, stroke: '#e8fbff', width: 0.6 } : { stroke: PALETTE.shadowed, width: 1 });
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
  return frame.bodies.find((o) => o.name === name) || frame.stars.find((o) => o.name === name) || frame.deep.find((o) => o.name === name) || frame.constellations.find((o) => o.name === name) || frame.stars.find((o) => o.designations?.includes(name)) || findFaint(frame, name) || findMoon(frame, name);
}

// The major moons of a planet at the frame's time, placed by their offsets
// from it (seen from the Earth's center); magnitudes are their mean values
// at opposition, shifted with the planet's. Those behind the disk are
// hidden.
const MOON_MAG = {
  Phobos: 11.8, Deimos: 12.9, Io: 5.0, Europa: 5.3, Ganymede: 4.6, Callisto: 5.7, Mimas: 12.9, Enceladus: 11.7, Tethys: 10.2, Dione: 10.4,
  Rhea: 9.7, Titan: 8.4, Hyperion: 14.2, Iapetus: 11, Miranda: 16.5, Ariel: 14.4, Umbriel: 15.1, Titania: 13.9, Oberon: 14.1, Triton: 13.5,
};
const OPPOSITION_MAG = { mars: -2, jupiter: -2.7, saturn: 0.4, uranus: 5.7, neptune: 7.8 };
export const hasMoons = (o) => o.body in OPPOSITION_MAG;
const moonCache = new WeakMap();
export function planetMoons(frame, planet) {
  if (!hasMoons(planet)) return [];
  let cache = moonCache.get(frame);
  if (!cache || cache.t !== frame.t) { cache = { t: frame.t }; moonCache.set(frame, cache); }
  if (cache[planet.body]) return cache[planet.body];
  const c = Math.max(1e-6, Math.cos(planet.dec * R)), system = moons(planet.body, frame.t);
  cache[`${planet.body}-pole`] = system.pole;
  return (cache[planet.body] = system.moons.map((m) => {
    const p = { ra: (planet.ra + m.east / c + 360) % 360, dec: planet.dec + m.north };
    return {
      ...p, ...frame.hor(p), name: m.name, type: `moon of ${planet.name}`, planet: planet.name, color: planet.color,
      mag: MOON_MAG[m.name] + planet.mag - OPPOSITION_MAG[planet.body], separation: Math.hypot(m.east, m.north), hidden: m.occulted,
      dist: planet.dist - m.view.z * PLANET_RADIUS[planet.body],
      diameter: 2 * Math.asin(MOON_RADIUS[m.name] / planet.dist) / R,
    };
  }));
}
// A planet's disk when zoomed in: its apparent equatorial radius (degrees)
// and, for Saturn, the screen geometry of its rings: xy(o) places sky
// points; the pole is [west, north, toward the Earth].
const PLANET_RADIUS = { mercury: 2439.7, venus: 6051.8, mars: 3396.2, jupiter: 71492, saturn: 60268, uranus: 25559, neptune: 24764 };
export const diskRadius = (o) => (PLANET_RADIUS[o.body] && o.dist ? Math.asin(PLANET_RADIUS[o.body] / o.dist) / R : 0);
export function saturnRings(frame, o, xy, px) {
  planetMoons(frame, o);
  const [w, n, z] = moonCache.get(frame)['saturn-pole'], q = xy(o), d = 0.01;
  const at = (ra, dec) => { const p = xy({ ra, dec, ...frame.hor({ ra, dec }) }); return [(p.x - q.x) / d, (p.y - q.y) / d]; };
  const north = at(o.ra, o.dec + d), east = at(o.ra + d / Math.max(1e-6, Math.cos(o.dec * R)), o.dec);
  const pole = [-w * east[0] + n * north[0], -w * east[1] + n * north[1]];
  // Outer edge of the A ring and inner edge of the B ring, in radii; the
  // near half is on the side away from the visible pole.
  return { angle: Math.atan2(pole[1], pole[0]) - Math.PI / 2, open: Math.abs(z), outer: 2.27 * px, inner: 1.53 * px, near: z > 0 ? -1 : 1 };
}
function findMoon(frame, name) {
  const body = planetOf(name), planet = body && frame.bodies.find((o) => o.body === body);
  return (planet && planetMoons(frame, planet).find((m) => m.name === name)) || null;
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
    const mw = skyRaster(back || chartKey, { W, H, radius, camera: { rotation, stereographic: false }, toJ2000: horizonToJ2000(frame), kind: 'chart' });
    if (back) { back.imageSmoothingEnabled = true; back.drawImage(mw.sky, 0, 0, mw.w, mw.h, 0, 0, mw.width, mw.height); }
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
  // The horizon, the local one (terrain, when computed for the place) and
  // the cardinal points belong to the ground: without it, none.
  if (opts.ground) line(Array.from({ length: 181 }, (_, i) => ({ alt: 0, az: i * 2 })), { stroke: c.horizon, width: 1.2 });
  if (opts.ground && opts.terrain) {
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
  // Grids: denser as the chart zooms in, labelled toward the view's edges.
  for (const [kind, stroke, ink] of [['horizontal', c.horizontal, '#8baabd'], ['equatorial', c.equatorial, '#96a4ce'], ['galactic', c.galactic, '#c2a0d7']]) {
    if (!opts[kind]) continue;
    for (const g of skyGrid(kind, frame, rotation.slice(6, 9), Math.hypot(W, H) / 2 / radius * 90, radius / 90)) {
      if (kind === 'horizontal' && g.parallel && g.value === 0) continue;
      line(g.points, { stroke, width: 0.65 });
      const key = `${kind}:${g.parallel}:${g.label}`;
      const q = gridLabelAt({ parallel: g.parallel, points: g.points.map((o) => ({ ...xy(o), alt: o.alt })) }, W, H, (o) => !opts.ground || o.alt >= 0, view.gridHistory?.get(key));
      if (view.gridHistory) { if (q) view.gridHistory.set(key, q); else view.gridHistory.delete(key); }
      if (q) p.text(q.x + 3, q.y - 4, g.label, ink, 11);
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
    if (o.mag - (opts.starBoost || 0) > opts.magnitude) continue;
    const r = starRadius(o.mag - (opts.starBoost || 0), scale), q = add(o, r);
    if (!q) continue;
    starSymbol(p, o, q.x, q.y, r, starTint(o.bv));
    if (o.name === view.selected || o.named && o.mag < (scale > 2 ? 4.5 : 2)) labels.push({ ...q, name: o.name, color: c.label, r, priority: 2 });
  }
  // Downloaded stars: fainter ones appear as the chart is zoomed in.
  // by tint, so that thousands are filled at once
  const faintLimit = Math.min(opts.magnitude, 6 + 1.25 * Math.log2(scale)) + (opts.starBoost || 0), tints = new Map();
  if (faintLimit > 6) eachFaint(frame, faintLimit, (i, v, mag, bv) => {
    if (opts.ground && v[2] < 0) return;
    const pv = projectVector(v, rotation), x = cx + pv.x * radius, y = cy + pv.y * radius;
    if (x < -2 || x > W + 2 || y < -2 || y > H + 2) return;
    const r = Math.max(0.45, starRadius(mag - (opts.starBoost || 0), scale) * 0.9), tint = starTint(bv);
    if (!tints.has(tint)) tints.set(tint, []);
    tints.get(tint).push(x, y, r);
    objects.push(new FaintHit(i, x, y, r));
  }, { v: rotation.slice(6, 9), radius: Math.min(2, Math.hypot(W, H) / 2 / radius) * Math.PI / 2 + 0.02 });
  for (const [fill, xyr] of tints) p.dots(xyr, { fill });
  // Planets; zoomed in, their moons; minor planets and comets on request.
  const pxPerDeg = radius / 90;
  for (const o of frame.bodies) {
    if (o.hidden) continue;
    const minor = o.body === 'minor' || o.body === 'comet';
    if (o.body === 'satellite' || minor && !opts.minor && o.name !== view.selected) continue;
    const r = o.body === 'sun' || o.body === 'moon' ? 7 : minor ? Math.max(1.6, 3 - o.mag * 0.12) : Math.max(2.2, 4 - o.mag * 0.3), q = add(o, r);
    if (!q) continue;
    const disk = diskRadius(o) * pxPerDeg;
    if (o.body === 'moon') { const light = xy(o.light); moonSymbol(p, ctx, o, q.x, q.y, r, Math.atan2(light.y - q.y, light.x - q.x) / R); }
    else if (disk > r) {
      // Zoomed in: the planet's disk at its size (Saturn with its rings).
      const rings = o.body === 'saturn' && saturnRings(frame, o, xy, disk);
      const ring = () => rings && p.ellipse(q.x, q.y, (rings.outer + rings.inner) / 2, (rings.outer + rings.inner) / 2 * rings.open, rings.angle / R, { stroke: o.color, width: Math.max(1, (rings.outer - rings.inner) * Math.max(rings.open, 0.25)), opacity: 0.75 });
      const light = xy(o.light);
      moonSymbol(p, ctx, o, q.x, q.y, disk, Math.atan2(light.y - q.y, light.x - q.x) / R); ring();
      objects.at(-1).radius = disk;
    } else bodySymbol(p, o, q.x, q.y, r);
    const size = Math.max(r, disk);
    labels.push({ ...q, name: o.name, color: o.body === 'sun' || o.body === 'moon' ? o.color : c.planet, r: o.body === 'saturn' ? size + 3 : size, priority: o.name === view.selected ? 0 : minor ? 2 : 1, important: !minor, mag: o.mag });
  }
  // Moons remain in the chart when their planet has left the viewport.
  for (const o of frame.bodies) {
    if (o.hidden || !hasMoons(o) || pxPerDeg <= 20) continue;
    const size = Math.max(2.2, 4 - o.mag * 0.3, diskRadius(o) * pxPerDeg);
    for (const m of planetMoons(frame, o)) {
      if (m.hidden || m.separation * pxPerDeg < size + 3) continue;
      const mr = Math.max(1, Math.min(2.6, starRadius(m.mag, scale) * 0.8)), mq = add(m, mr);
      if (!mq) continue;
      p.circle(mq.x, mq.y, mr, { fill: o.color });
      labels.push({ ...mq, name: m.name, color: o.color, r: mr, priority: m.name === view.selected ? 0 : 2, mag: m.mag });
    }
  }
  // Satellites: sunlit, by their magnitude; in the shadow, a ring. The
  // stations are named, and the others brighter than magnitude 1.
  for (const o of frame.bodies) {
    if (o.hidden) continue;
    if (o.body !== 'satellite' || !opts.satellites && o.name !== view.selected) continue;
    const r = o.lit ? Math.max(1.8, Math.min(3.6, 2.8 - o.mag * 0.3)) : 1.8, q = add(o, r);
    if (!q) continue;
    if (o.trail?.length) line([o, ...o.trail], { stroke: o.lit ? c.satellite : c.shadowed, width: 1.2, opacity: 0.7 });
    satelliteSymbol(p, o, q.x, q.y, r);
    if (o.name === view.selected || o.lit && (o.satellite.group === 'stations' || o.mag < 1)) labels.push({ ...q, name: o.name, color: c.satellite, r: r + 2, priority: o.name === view.selected ? 0 : 2, mag: o.mag });
  }
  const symbols = objects.filter((o) => o.body), names = new Set(objects.map((o) => o.name));
  let hitLabels = [];
  if (opts.labels) {
    hitLabels = placeLabels(labels, {
      W, H, size: opts.labelSize, symbols, history: view.labelHistory,
      draw: (l, x, y) => p.text(x, y, l.name, l.color, l.size || opts.labelSize),
      leader: (l, x, y) => p.path(`M${f(l.x)},${f(l.y)}L${f(x)},${f(y)}`, { stroke: l.color, width: 0.7 }),
    }).filter((l) => names.has(l.name));
  }
  if (opts.ground) for (const [name, az, size, color] of [['N', 0, 15, '#eef3fa'], ['NE', 45, 11, '#a9bccf'], ['E', 90, 15, '#eef3fa'], ['SE', 135, 11, '#a9bccf'], ['S', 180, 15, '#eef3fa'], ['SW', 225, 11, '#a9bccf'], ['W', 270, 15, '#eef3fa'], ['NW', 315, 11, '#a9bccf']]) {
    const q = xy({ alt: -6.5, az }); p.text(q.x, q.y + size / 3, name, color, size, 'middle', c.ground, 700);
  }
  const chosen = findObject(frame, view.selected);
  if (chosen && !(chosen.body === 'sun' && chosen.hidden)) {
    const o = objects.find((x) => x.name === chosen.name), q = o || xy(chosen);
    if (Number.isFinite(q.x)) reticle(p, q.x, q.y, o ? o.radius : 3, '#ffcf5a');
  }
  p.raw('</g>');
  return { svg: p.svg, objects, radius, hitLabels };
}

// Legend for the chart, with the same symbols.
export function chartLegend({ starBoost = 0, scale = 1, magnitude = 6 } = {}) {
  const icon = (draw, w = 28) => { const p = pen(null); draw(p); return `<svg viewBox="0 0 ${w} 20" width="${w}" height="20" aria-hidden="true">${p.svg}</svg>`; };
  const star = (o, r, color = '#f3f5fa') => icon((p) => starSymbol(p, o, 14, 10, r, color));
  const mags = Array.from({ length: Math.max(1, Math.floor(magnitude + starBoost) + 2) }, (_, i) => i - 1).map((m) => `<span class="coelum-mag"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="${starRadius(m - starBoost, scale).toFixed(2)}" fill="#f3f5fa"/></svg>${m}</span>`).join('');
  const row = (svg, label) => `<li>${svg}<span>${label}</span></li>`;
  const lineIcon = (st) => icon((p) => p.path('M2,10H26', st));
  return `<h3>Legend</h3><p class="coelum-mags" aria-label="Star magnitudes">${mags}</p><ul>
    ${row(star({ double: true }, 2.2), 'Double star')}${row(star({ variable: true }, 2), 'Variable star')}
    ${row(icon((p) => bodySymbol(p, { body: 'sun', color: BODY_COLORS.sun }, 14, 10, 6)), 'Sun')}
    ${row(icon((p) => moonSymbol(p, null, { phase: 60, color: BODY_COLORS.moon }, 14, 10, 6, 0)), 'Moon (phase)')}
    ${row(icon((p) => bodySymbol(p, { body: 'mars', color: BODY_COLORS.mars }, 14, 10, 3.2)), 'Planet')}
    ${row(icon((p) => p.circle(14, 10, 1.6, { fill: BODY_COLORS.jupiter })), 'Planet’s moon (zoomed in)')}
    ${row(icon((p) => bodySymbol(p, { body: 'minor', color: BODY_COLORS.minor }, 14, 10, 2.2)), 'Minor planet')}
    ${row(icon((p) => bodySymbol(p, { body: 'comet', color: BODY_COLORS.comet }, 12, 12, 2.2)), 'Comet')}
    ${row(icon((p) => { p.path('M4,13L9,12L14,10', { stroke: PALETTE.satellite, width: 1, opacity: 0.55 }); satelliteSymbol(p, { lit: true }, 18, 9, 2.2); }), 'Satellite, sunlit (its trail)')}
    ${row(icon((p) => satelliteSymbol(p, { lit: false }, 14, 10, 1.8)), 'Satellite in the Earth’s shadow')}
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

// Search names, aliases (M31 → Andromeda Galaxy), constellations, star
// designations (Bayer, Flamsteed, HIP, HD, HR; for downloaded stars HIP,
// HD and TYC); accents, case and spaces are ignored ("m 31" finds M31).
// Greek letters are spelled out (α Tau as alpha Tau); their IAU
// abbreviations (alf Tau) are keys too.
const GREEK = { α: ['alpha', 'alf'], β: ['beta', 'bet'], γ: ['gamma', 'gam'], δ: ['delta', 'del'], ε: ['epsilon', 'eps'], ζ: ['zeta', 'zet'], η: ['eta', 'eta'], θ: ['theta', 'tet'], ι: ['iota', 'iot'], κ: ['kappa', 'kap'], λ: ['lambda', 'lam'], μ: ['mu', 'mu'], ν: ['nu', 'nu'], ξ: ['xi', 'ksi'], ο: ['omicron', 'omi'], π: ['pi', 'pi'], ρ: ['rho', 'rho'], σ: ['sigma', 'sig'], τ: ['tau', 'tau'], υ: ['upsilon', 'ups'], φ: ['phi', 'phi'], χ: ['chi', 'chi'], ψ: ['psi', 'psi'], ω: ['omega', 'ome'] };
const fold = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[α-ω]/g, (c) => GREEK[c]?.[0] ?? c).replace(/[^a-z0-9]+/g, ' ').trim();
const folded = new Map(), foldKey = (s) => { let f = folded.get(s); if (f === undefined) folded.set(s, f = fold(s)); return f; };
// a star's search keys: its name and designations, a Bayer letter also
// without its superscript (α Cen for α¹ Cen) and abbreviated
const starKeys = new WeakMap();
const keysOf = (o) => {
  let keys = starKeys.get(o);
  if (!keys) {
    keys = [o.name, ...o.designations || []];
    for (const k of [...keys]) if (/^[α-ω]/.test(k)) { const bare = k.replace(/[⁰-⁹¹²³]+/g, ''); keys.push(bare, bare.replace(/^[α-ω]/, (c) => GREEK[c][1])); }
    starKeys.set(o, keys);
  }
  return keys;
};
// Useful angular field for a search selection, independent of the old zoom.
// Catalog deep-sky sizes are arcminutes; solar-system diameters are degrees.
export function searchAngularField(o) {
  if (o.type === 'constellation' && o.lines?.length) {
    const center = pointVector(o);
    const reach = Math.max(...o.lines.flat().map((p) => Math.acos(clamp(dot3(center, pointVector(p)))) / R));
    return Math.min(170, Math.max(10, reach * 2.5));
  }
  if (o.size?.[0]) return Math.max(0.1, o.size[0] / 60 * 2);
  if (o.body === 'moon' || o.body === 'sun') return 2 * Math.asin((o.body === 'moon' ? 1737.4 : 695700) / o.dist) / R * 1.8;
  if (o.planet) return Math.max(o.separation * 3, (o.diameter || 0) * 6, 0.01);
  const radius = diskRadius(o);
  if (radius) return radius * 2 * (o.body === 'saturn' ? 2.3 : 1) * 4;
  return 25; // a star or unresolved body, with its surrounding sky
}

export function searchSky(frame, query, limit = 8) {
  const q = fold(query), qc = q.replace(/ /g, '');
  if (!qc) return [];
  const surface = (o) => o.type === 'lunar feature' || o.type === 'Mars feature';
  const order = { 'lunar feature': 3, 'Mars feature': 3, moon: 0, planet: 0, constellation: 2, star: 1, 'minor planet': 1.2, comet: 1.2, satellite: 1.3 }, rank = (o) => order[o.type] ?? (o.planet ? 0.5 : 1.5);
  const entries = [
    ...frame.bodies.map((o) => ({ o, keys: o.satellite ? [o.name, ...o.satellite.keys] : o.number ? [o.name, String(o.number)] : [o.name] })),
    ...frame.bodies.filter(hasMoons).flatMap((planet) => planetMoons(frame, planet).map((o) => ({ o, keys: [o.name] }))),
    ...frame.stars.map((o) => ({ o, keys: keysOf(o) })),
    ...frame.deep.map((o) => ({ o, keys: [o.name, ...(o.description ? o.description.split(' · ') : [])] })),
    ...frame.constellations.map((o) => ({ o, keys: [o.name] })),
  ];
  const out = [];
  for (const { o, keys } of entries) {
    let best = null;
    for (const key of keys) {
      const k = foldKey(key), kc = k.replace(/ /g, '');
      const score = kc === qc ? 0 : kc.startsWith(qc) ? 1 : k.split(' ').some((w) => w.startsWith(q)) ? 2 : kc.includes(qc) ? 3 : null;
      if (score !== null && (!best || score < best.score)) best = { score, alias: key === o.name ? null : key };
    }
    if (best) out.push({ ...best, object: o });
  }
  const lunar = searchLunarFeatures(query, limit), moon = frame.bodies.find((o) => o.body === 'moon');
  if (lunar.length && moon) {
    const disk = moonDisk(frame.t, moon);
    for (const feature of lunar) {
      const state = lunarFeatureState(disk, feature);
      out.push({ score: feature.score, alias: null, object: { ...feature, type: 'lunar feature', alt: moon.alt,
        availability: !state.visible ? 'beyond limb' : !state.sunlit ? 'not sunlit' : null } });
    }
  }
  const martian = searchMarsFeatures(query, limit), mars = frame.bodies.find((o) => o.body === 'mars');
  if (martian.length && mars) {
    const disk = marsDisk(frame.t);
    for (const feature of martian) {
      const state = marsFeatureState(disk, feature);
      out.push({ score: feature.score, alias: null, object: { ...feature, type: 'Mars feature', alt: mars.alt,
        availability: !state.visible ? 'far side' : !state.sunlit ? 'not sunlit' : null } });
    }
  }
  // downloaded stars by number: HIP 12345, HD 12345, TYC 1234-567-1
  const number = /^(hip|hd)(\d+)$/.exec(qc), tyc = /^tyc ?(\d+) (\d+) (\d+)$/.exec(q);
  const gaia = /^gaia(?:dr3)?(\d{1,19})$/.exec(qc);
  const row = /^catalogv([\d.]+)star(\d+)$/.exec(qc);
  const id = number ? `${number[1].toUpperCase()} ${Number(number[2])}` : tyc ? `TYC ${Number(tyc[1])}-${Number(tyc[2])}-${Number(tyc[3])}` : gaia ? `Gaia DR3 ${BigInt(gaia[1])}` : row && `Catalog V${Number(row[1])} star ${Number(row[2])}`;
  const extra = id && !out.some((r) => r.object.name === id || r.object.designations?.includes(id)) && findFaint(frame, id);
  if (extra) out.push({ score: 0, alias: null, object: extra });
  return out.sort((a, b) => Number(surface(a.object)) - Number(surface(b.object)) || a.score - b.score || rank(a.object) - rank(b.object) || (a.object.mag ?? 99) - (b.object.mag ?? 99)).slice(0, limit)
    .map(({ object, alias }) => ({ name: object.name, alias, type: object.type, alt: object.alt, mag: object.mag, ...(object.key ? { key: object.key, availability: object.availability } : {}) }));
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

// An angle (degrees) as arcminutes and arcseconds, or arcseconds alone
const angleText = (deg) => {
  const s = deg * 3600;
  if (s >= 60) { const r = Math.round(s); return `${Math.floor(r / 60)}′ ${String(r % 60).padStart(2, '0')}″`; }
  return `${s.toFixed(s < 10 ? 2 : 1)}″`;
};
// The apparent diameter (degrees) of a body or a planet's moon: the Sun,
// the Moon, a planet's equator, a moon of MOON_RADIUS
const apparentDiameter = (o) => (o.body === 'sun' ? 2 * Math.asin(695700 / o.dist) / R : o.body === 'moon' ? 2 * Math.asin(1737.4 / o.dist) / R : o.body ? 2 * diskRadius(o) : o.diameter) || 0;
// A distance in parsecs, and in light years
const distanceText = (pc) => {
  const f = (x) => (x < 100 ? x.toFixed(x < 10 ? 2 : 1) : Math.round(x).toLocaleString('en'));
  return `${f(pc)} pc · ${f(pc * 3.26156)} light years`;
};
// A proper motion (mas/yr) and its direction, the position angle from the
// north through the east
const motionText = (pmra, pmdec) => {
  const total = Math.hypot(pmra, pmdec), pa = (Math.atan2(pmra, pmdec) / R + 360) % 360;
  return `${total >= 1000 ? `${(total / 1000).toFixed(2)}″` : `${total.toFixed(1)} mas`} a year, toward ${Math.round(pa)}°`;
};
// A satellite's card: where it is, how far and how high, how bright, and
// the age of its elements
const GROUP_NAMES = { stations: 'Space station or crewed craft', visual: 'Bright satellite', science: 'Science satellite', amateur: 'Amateur radio satellite', weather: 'Weather satellite' };
function satelliteDetails(o, row, galacticRows) {
  const s = o.satellite, age = (Date.now() / 1000 - s.epoch) / 3600, km = (x) => `${Math.round(x).toLocaleString('en')} km`;
  return `<div class="coelum-object-head"><h3>${esc(o.name)}</h3><span>${esc(GROUP_NAMES[s.group] || 'Satellite')}</span></div><dl>
    ${row('Altitude (Alt)', sexagesimal(o.alt, false, true))}
    ${Number.isFinite(o.apparentAlt) ? row('Apparent altitude', sexagesimal(o.apparentAlt, false, true)) : ''}
    ${row('Azimuth (Az)', sexagesimal(o.az))}
    ${row('Right ascension (RA)', sexagesimal(o.ra / 15, true))}
    ${row('Declination (Dec)', sexagesimal(o.dec, false, true))}
    ${galacticRows}
    ${row('Distance', km(o.dist))}
    ${row('Height above the Earth', km(o.height))}
    ${row('Visual magnitude', o.lit ? `${o.mag.toFixed(1)} (${s.stdKnown ? 'estimated' : 'rough guess'})` : 'In the Earth’s shadow')}
    ${row('NORAD number', String(s.norad))}
    ${row('Elements', `${age < 48 ? `${Math.max(0, Math.round(age))} hours` : `${Math.round(age / 24)} days`} old (CelesTrak)`)}
    </dl><p class="coelum-coordinate-note">Seen from the place (topocentric), without refraction in the chart · SGP4 positions, good to a few km while the elements are fresh · brightness from the standard magnitude for the distance and the phase; tumbling and flares are not modeled${o.alt < 0 ? ' · below the horizon' : ''}.</p>`;
}
const preciseAngle=(value,hours=false,signed=false)=>{
 const digits=hours?3:2,scale=10**digits,total=Math.round(Math.abs(value)*3600*scale),a=Math.floor(total/(3600*scale)),b=Math.floor(total/(60*scale))%60,c=(total/scale%60).toFixed(digits).padStart(digits+3,'0'),sign=value<0?'−':signed?'+':'';
 return hours?`${String(a%24).padStart(2,'0')}h ${String(b).padStart(2,'0')}m ${c}s`:`${sign}${a}° ${String(b).padStart(2,'0')}′ ${c}″`;
};
// The physical offset is useful in the selected object's card. Calculate
// it on demand rather than storing another value for every drawn star.
function catalogSolarDeflection(o, frame) {
  if (!o.catalogVector || !frame?.observer || o.type === 'constellation' || o.preciseSource) return null;
  const px = o.parallax > 0 ? o.parallax / 206264806 : 0, m = frame.matrix, v = o.catalogVector;
  const g = [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2] - px * frame.observer.position[i]);
  const solar = frame.observer.deflection, pe = clamp(dot3(g, solar.direction) / Math.hypot(...g));
  return Math.atan(solar.strength * Math.sqrt(Math.max(0, 1 - pe * pe)) / Math.max(1 + pe, solar.limiter)) / R * 3600;
}
export function objectDetails(o, frame = null) {
  const row = (name, value) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`;
  const deflection = catalogSolarDeflection(o, frame);
  const angle=(value,hours=false,signed=false)=>o.preciseSource ? preciseAngle(value,hours,signed) : sexagesimal(value,hours,signed);
  const g = frame && galacticCoordinates(o, o.coordinateMatrix?{matrix:o.coordinateMatrix}:frame);
  const galacticRows = g ? row('Galactic longitude (l)', angle(g.lon)) + row('Galactic latitude (b)', angle(g.lat, false, true)) : '';
  if (o.satellite) return satelliteDetails(o, row, galacticRows);
  const notes = [o.double && 'double or multiple', o.variable && 'variable'].filter(Boolean);
  // a planet, or a planet's moon: a button for the close-up of the planet
  // (with its moons)
  const system = hasMoons(o) || o.body === 'mercury' || o.body === 'venus' ? o.body : o.planet ? planetOf(o.name) : null;
  return `<div class="coelum-object-head"><h3>${esc(o.name)}</h3><span>${esc(o.type)}</span></div>
    ${o.description ? `<p>${esc(o.description)}</p>` : ''}<dl>
    ${row('Right ascension (RA)', angle(o.ra / 15, true))}
    ${row('Declination (Dec)', angle(o.dec, false, true))}
    ${deflection !== null ? row('Solar light deflection', `${deflection.toFixed(3)}″ (included)`) : ''}
    ${galacticRows}
    ${Number.isFinite(o.alt) ? row('Altitude (Alt)', angle(o.alt, false, true)) : ''}
    ${Number.isFinite(o.apparentAlt) ? row('Apparent altitude', angle(o.apparentAlt, false, true)) : ''}
    ${Number.isFinite(o.az) ? row('Azimuth (Az)', angle(o.az)) : ''}
    ${o.type === 'constellation' ? '' : row('Visual magnitude', Number.isFinite(o.mag) ? o.mag.toFixed(2) + (o.estimatedPhotometry ? ' (estimated)' : '') : 'Not available')}
    ${apparentDiameter(o) > 0 ? row(o.body === 'saturn' ? 'Apparent diameter (globe)' : 'Apparent diameter', angleText(apparentDiameter(o))) : ''}
    ${o.size ? row('Apparent size', o.size.map((x) => `${x < 10 ? Number(x.toFixed(1)) : Math.round(x)}′`).filter((x, i, all) => !i || x !== all[0]).join(' × ')) : ''}
    ${notes.length ? row('Hipparcos', notes.join(', ')) : ''}
    ${o.estimatedPhotometry ? row('Photometry', `V${Number.isFinite(o.bv) ? ' and B−V' : ''} estimated from Gaia G and BP−RP`) : ''}
    ${o.designations?.length ? row('Designations', o.designations.join(' · ')) : ''}
    ${o.spect ? row('Spectral type', o.spect) : ''}
    ${o.parallax > 0 ? row('Parallax', `${o.parallax.toFixed(o.parallax < 10 ? 3 : 2)} mas`) + row('Distance', distanceText(1000 / o.parallax)) : ''}
    ${Number.isFinite(o.pmra) && (o.pmra || o.pmdec) ? row('Proper motion', motionText(o.pmra, o.pmdec)) : ''}
    ${(o.body || o.planet) && Number.isFinite(o.dist) ? row('Distance', o.preciseSource ? (o.dist>1e7?`${(o.dist/149597870.7).toFixed(10)} au`:`${o.dist.toLocaleString('en',{maximumFractionDigits:3})} km`) : o.dist > 1e7 ? `${(o.dist / 149597870.7).toFixed(3)} au` : `${Math.round(o.dist).toLocaleString('en')} km`) : ''}
    ${(o.body === 'moon' || o.type === 'planet') && Number.isFinite(o.phase) ? row('Illuminated', `${((1 + Math.cos(o.phase * R)) * 50).toFixed(1)} %`) : ''}
    ${o.type === 'planet' && Number.isFinite(o.phase) ? row('Phase angle', `${o.phase.toFixed(1)}°`) : ''}
    ${o.type === 'planet' && Number.isFinite(o.elong) ? row('Solar elongation', `${Math.abs(o.elong).toFixed(1)}° ${o.elong < 0 ? 'west' : 'east'} (geocentric)`) : ''}
    </dl>${Number.isFinite(o.bv) && o.type === 'star' ? spectrum(o.bv, !o.spect) : ''}${system ? `<button type="button" class="coelum-chip coelum-moons-button" data-action="moons" data-planet="${system}">${hasMoons(o) || o.planet ? `Moons of ${esc(o.planet || o.name)}` : `Close-up of ${esc(o.name)}`}</button>` : ''}<p class="coelum-coordinate-note">${esc(o.precisionNote || 'Equatorial coordinates of date')} · ${o.coordinateOrigin==='geocentric' ? 'Earth’s centre' : `${Number.isFinite(o.apparentAlt) ? 'apparent altitude with refraction (standard atmosphere)' : 'altitude without refraction'} · azimuth from north through east${o.alt < 0 ? ' · below the horizon' : ''}`}.</p>`;
}

// A star's colour index as a temperature (Ballesteros 2012), a rough
// spectral class, and the visible spectrum of a black body at that
// temperature: the colour the views give the star, without the absorption
// lines of a real spectrum.
const wavelengthRGB = (nm) => {
  const [r, g, b] = nm < 440 ? [(440 - nm) / 60, 0, 1] : nm < 490 ? [0, (nm - 440) / 50, 1] : nm < 510 ? [0, 1, (510 - nm) / 20] : nm < 580 ? [(nm - 510) / 70, 1, 0] : nm < 645 ? [1, (645 - nm) / 65, 0] : [1, 0, 0];
  const edge = nm < 420 ? 0.3 + 0.7 * (nm - 380) / 40 : nm > 700 ? 0.3 + 0.7 * (750 - nm) / 50 : 1;
  return [r, g, b].map((x) => x * edge);
};
export function starTemperature(bv) {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}
function spectrum(bv, type = true) {
  const T = starTemperature(Math.max(-0.4, Math.min(2, bv))), planck = (nm) => 1 / (nm ** 5 * (Math.exp(1.4388e7 / (nm * T)) - 1));
  const kind = bv < -0.3 ? 'O' : bv < -0.02 ? 'B' : bv < 0.3 ? 'A' : bv < 0.58 ? 'F' : bv < 0.81 ? 'G' : bv < 1.4 ? 'K' : 'M';
  const nms = Array.from({ length: 38 }, (_, i) => 380 + i * 10), top = Math.max(...nms.map(planck));
  const stops = nms.map((nm) => { const k = 0.15 + 0.85 * planck(nm) / top; return `<stop offset="${((nm - 380) / 370).toFixed(3)}" stop-color="rgb(${wavelengthRGB(nm).map((x) => Math.round(255 * x * k)).join(',')})"/>`; }).join('');
  const curve = nms.map((nm, i) => `${i ? 'L' : 'M'}${((nm - 380) / 370 * 300).toFixed(1)},${(30 - 26 * planck(nm) / top).toFixed(1)}`).join('');
  const id = `spectrum-${Math.round(T)}`;
  return `<figure class="coelum-spectrum"><svg viewBox="0 0 300 32" preserveAspectRatio="none" role="img" aria-label="Approximate visible spectrum"><defs><linearGradient id="${id}">${stops}</linearGradient></defs><rect width="300" height="32" rx="4" fill="url(#${id})"/><path d="${curve}" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>
    <figcaption><span>380 nm</span><span>B−V ${(Math.abs(bv) < 0.005 ? 0 : bv).toFixed(2).replace('-', '−')} · about ${(Math.round(T / 100) * 100).toLocaleString('en')} K${type ? ` · type ${kind}` : ''}</span><span>750 nm</span></figcaption>
    <p class="coelum-coordinate-note">Estimated from the colour index: the black-body spectrum that gives the star its colour in the views, without the absorption lines of the real one.</p></figure>`;
}
