// A small IAU/USGS catalogue: planetocentric latitude, east longitude.
// Albedo coordinates are MDIM 2.0; Olympus/Valles use MDIM 2.1.
// https://planetarynames.wr.usgs.gov/Feature/<id>
import { moons } from './astro.js';
import { surfaceVector } from './skyview.js';

export const MARS_COLOR = '#ffc98f';
export const MARS_MIN_RADIUS = 120;
const R = Math.PI / 180, MARS_KM = 3396.19, FLATTENING = 0.00589;
const catalogue = [
  [5795, 'Syrtis Major', 70, 9.88, 'Albedo feature'],
  [2429, 'Hellas', 70, -39.67, 'Albedo feature'],
  [3663, 'Mare Acidalium', 330, 44.66, 'Albedo feature'],
  [5568, 'Sinus Meridiani', 0, -4.94, 'Albedo feature'],
  [5570, 'Sinus Sabaeus', 20, -7.91, 'Albedo feature'],
  [3669, 'Mare Cimmerium', 140, -19.78, 'Albedo feature'],
  [3672, 'Mare Erythraeum', 320, -24.74, 'Albedo feature'],
  [5624, 'Solis Lacus', 270, -27.72, 'Albedo feature'],
  [4453, 'Olympus Mons', 226.20, 18.65, 'Volcano', 610.13],
  [6288, 'Valles Marineris', 301.41, -14.01, 'Canyon system', 3761.28],
].map(([id, name, lon, lat, type, diameter = null]) => ({ id, name, lon, lat, type, diameter, key: `mars:${id}` }));
const byKey = new Map(catalogue.map((f) => [f.key, f]));
export const findMarsFeature = (key) => byKey.get(key) || null;
export const marsDisk = (t) => ({ ...moons('mars', t), planet: 'mars', t, moons: [] });
const fold = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function searchMarsFeatures(query, limit = 8) {
  const q = fold(query).replace(/^(mars|martian) +/, '').replace(/ +(mars|martian)$/, '');
  if (!q) return [];
  return catalogue.flatMap((f) => {
    const name = fold(f.name);
    const score = name === q ? 0 : name.startsWith(q) ? 1 : name.split(' ').some((w) => w.startsWith(q)) ? 2 : name.includes(q) ? 3 : null;
    return score === null ? [] : [{ ...f, score }];
  }).sort((a, b) => a.score - b.score).slice(0, limit);
}

export function marsFeatureState(disk, feature) {
  return surfaceState(disk, surfaceVector(disk, feature.lon, feature.lat));
}
function surfaceState(disk, direction) {
  const polar = direction.reduce((s, x, k) => s + x * disk.pole[k], 0);
  const k = (1 - FLATTENING) ** -2 - 1;
  // Intersect the geographic radius with the same oblate globe as the shader.
  const length = 1 / Math.sqrt(1 + polar * polar * k);
  const v = direction.map((x) => x * length);
  const normal = direction.map((x, i) => x + disk.pole[i] * polar * k);
  const norm = Math.hypot(...normal), sunlight = normal.reduce((s, x, i) => s + x * disk.sun[i], 0) / norm;
  return { v, sunlight, visible: normal[2] / norm >= 0.06, sunlit: sunlight > 0.005 };
}

// Catalogue diameter/longest extent represented by a small circle, as for
// lunar labels, not a surveyed boundary. Project onto the renderer's oblate
// globe and omit arc segments behind the limb or on the night side.
export function marsFeatureOutline(disk, feature, center, radius, north) {
  if (!feature.diameter) return null; // USGS gives no extents for albedo names.
  const C = surfaceVector(disk, feature.lon, feature.lat), E = surfaceVector(disk, feature.lon + 90, 0);
  const N = [C[1] * E[2] - C[2] * E[1], C[2] * E[0] - C[0] * E[2], C[0] * E[1] - C[1] * E[0]];
  const a = feature.diameter / (2 * MARS_KM), c = Math.cos(north), s = Math.sin(north);
  return Array.from({ length: 129 }, (_, i) => {
    const theta = i * 2 * Math.PI / 128;
    const direction = C.map((x, k) => x * Math.cos(a) + Math.sin(a) * (E[k] * Math.cos(theta) + N[k] * Math.sin(theta)));
    const state = surfaceState(disk, direction), v = state.v;
    return { x: center.x + radius * (v[0] * c + v[1] * s), y: center.y + radius * (v[0] * s - v[1] * c),
      visible: state.visible && state.sunlit };
  });
}

export function projectMarsFeatures(disk, center, radius, north, W, H) {
  if (radius < MARS_MIN_RADIUS) return [];
  const c = Math.cos(north), s = Math.sin(north);
  return catalogue.flatMap((feature) => {
    const state = marsFeatureState(disk, feature), v = state.v;
    if (!state.visible || !state.sunlit) return [];
    const x = center.x + radius * (v[0] * c + v[1] * s), y = center.y + radius * (v[0] * s - v[1] * c);
    if (x < 0 || x > W || y < 0 || y > H) return [];
    return [{ ...feature, x, y, sunlight: state.sunlight, label: true,
      outline: marsFeatureOutline(disk, feature, center, radius, north),
      radius: feature.diameter ? radius * Math.sin(feature.diameter / (2 * MARS_KM)) : 0 }];
  });
}
export function pickMarsFeature(features, x, y) {
  let best = null, score = Infinity;
  for (const f of features || []) {
    const distance = Math.hypot(f.x - x, f.y - y);
    let inside = distance <= 16;
    if (!inside && f.outline) {
      for (let i = 0, j = f.outline.length - 1; i < f.outline.length; j = i++) {
        const a = f.outline[i], b = f.outline[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
    }
    const candidate = distance / Math.max(16, f.radius);
    if (inside && candidate < score) { best = f; score = candidate; }
  }
  return best;
}

export function marsFeatureTarget(frame, feature) {
  const mars = frame.bodies.find((o) => o.body === 'mars'), state = marsFeatureState(marsDisk(frame.t), feature);
  const a = mars.ra * R, d = mars.dec * R;
  const u = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const west = [Math.sin(a), -Math.cos(a), 0], north = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const point = u.map((x, k) => mars.dist * x + MARS_KM * (state.v[0] * west[k] + state.v[1] * north[k] - state.v[2] * x));
  const ra = (Math.atan2(point[1], point[0]) / R + 360) % 360, dec = Math.atan2(point[2], Math.hypot(point[0], point[1])) / R;
  return { ...mars, ...(state.visible ? { ra, dec, ...frame.hor({ ra, dec }) } : {}), feature, marsState: state, marsRadius: Math.asin(MARS_KM / mars.dist) / R };
}
export function marsFeatureDetails(feature) {
  const lon = (feature.lon + 540) % 360 - 180;
  const coord = (v, plus, minus) => `${Math.abs(v).toFixed(2)}° ${v < 0 ? minus : plus}`;
  return `<div class="coelum-object-head coelum-mars-head"><h3>${feature.name}</h3><span>Mars · ${feature.type}</span></div>
    <dl>${feature.diameter ? `<div><dt>Diameter / extent</dt><dd>${feature.diameter.toLocaleString(undefined, { maximumFractionDigits: 1 })} km</dd></div>` : ''}<div><dt>Latitude</dt><dd>${coord(feature.lat, 'N', 'S')}</dd></div><div><dt>Longitude</dt><dd>${coord(lon, 'E', 'W')}</dd></div></dl>
    <p class="coelum-coordinate-note">${feature.diameter ? 'Outline indicates catalogue diameter / extent, not a surveyed boundary' : 'Named albedo region; extent not specified in the catalogue. Marker at the named center'} · <a href="https://planetarynames.wr.usgs.gov/Feature/${feature.id}" target="_blank" rel="noopener">IAU/USGS nomenclature</a></p>`;
}
