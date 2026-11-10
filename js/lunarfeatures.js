// Lunar surface labels/picking. Features share the texture's exact rotation,
// including libration and observer parallax. Earthshine does not qualify as
// illumination: only features whose centers receive direct sunlight are shown.
import { LUNAR_FEATURES } from './lunardata.js';
import { surfaceVector } from './skyview.js';
import { moonDisk } from './astro.js';

export const LUNAR_COLOR = '#65b9ff';
export const LUNAR_MIN_RADIUS = 120; // CSS pixels, independent of device/viewport
const R = Math.PI / 180, MOON_KM = 1737.4;
const prominent = new Set(['Tycho', 'Copernicus', 'Kepler', 'Aristarchus', 'Plato', 'Clavius', 'Eratosthenes', 'Archimedes', 'Aristoteles', 'Eudoxus', 'Ptolemaeus', 'Alphonsus', 'Arzachel', 'Theophilus', 'Cyrillus', 'Catharina', 'Posidonius', 'Gassendi', 'Grimaldi', 'Schickard', 'Petavius', 'Langrenus', 'Picard', 'Proclus', 'Stevinus', 'Janssen', 'Schiller', 'Montes Apenninus', 'Montes Alpes', 'Montes Caucasus', 'Vallis Alpes', 'Rupes Recta']);
const catalogue = LUNAR_FEATURES.map(([id, name, lon, lat, diameter, code]) => ({
  key: `lunar:${id}`, id, name, lon, lat, diameter, code,
  major: ['ME', 'OC', 'SI'].includes(code) || prominent.has(name),
  v: [Math.cos(lat * R) * Math.cos(lon * R), Math.cos(lat * R) * Math.sin(lon * R), Math.sin(lat * R)],
}));

const byKey = new Map(catalogue.map((feature) => [feature.key, feature]));
export const findLunarFeature = (key) => byKey.get(key) || null;
const fold = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Conservative envelope around optical libration (7.9° longitude, 6.7°
// latitude), allowing physical/diurnal libration too. Keep potentially
// observable limb centers; reject the permanently hidden hemisphere.
// https://amt.copernicus.org/articles/16/1527/2023/
export function earthObservableLunarFeature(feature) {
  const lat = feature.lat * R, lon = Math.abs((feature.lon + 540) % 360 - 180);
  const x = Math.cos(lat) * Math.cos(Math.max(0, lon - 10) * R), z = Math.sin(lat);
  const observerLat = Math.max(-8 * R, Math.min(8 * R, Math.atan2(z, x)));
  return x * Math.cos(observerLat) + z * Math.sin(observerLat) > 0;
}
const searchable = catalogue.filter(earthObservableLunarFeature).map((feature) => ({ feature, name: fold(feature.name) }));
export function searchLunarFeatures(query, limit = 8) {
  const q = fold(query).replace(/^(moon|lunar) +/, '').replace(/ +(moon|lunar)$/, '');
  if (!q) return [];
  return searchable.flatMap(({ feature, name }) => {
    const score = name === q ? 0 : name.startsWith(q) ? 1 : name.split(' ').some((word) => word.startsWith(q)) ? 2 : name.includes(q) ? 3 : null;
    return score === null ? [] : [{ ...feature, score }];
  }).sort((a, b) => a.score - b.score || Number(b.major) - Number(a.major) || b.diameter - a.diameter).slice(0, limit);
}

export function lunarFeatureState(disk, feature) {
  const v = surfaceVector(disk, feature.lon, feature.lat);
  const sunlight = v.reduce((sum, x, k) => sum + x * disk.sun[k], 0);
  return { v, visible: v[2] >= 0.06, sunlit: sunlight > 0.005 };
}

// Apparent direction of a surface point, offset from the topocentric Moon.
// The renderer's axes are west, celestial north and toward the observer.
export function lunarFeatureTarget(frame, feature) {
  const moon = frame.bodies.find((o) => o.body === 'moon');
  const disk = moonDisk(frame.t, moon), state = lunarFeatureState(disk, feature);
  const a = moon.ra * R, d = moon.dec * R;
  const u = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const west = [Math.sin(a), -Math.cos(a), 0], north = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const point = u.map((x, k) => moon.dist * x + MOON_KM * (state.v[0] * west[k] + state.v[1] * north[k] - state.v[2] * x));
  const ra = (Math.atan2(point[1], point[0]) / R + 360) % 360, dec = Math.atan2(point[2], Math.hypot(point[0], point[1])) / R;
  return { ...moon, ...(state.visible ? { ra, dec, ...frame.hor({ ra, dec }) } : {}), feature, lunarState: state,
    moonRadius: Math.asin(MOON_KM / moon.dist) / R };
}

// Orthographic projection of a circle on the lunar sphere. Its short axis
// points toward the limb; the ellipse includes the small-circle center shift.
export function lunarFeatureEllipse(v, diameter, center, radius, north) {
  const c = Math.cos(north), s = Math.sin(north);
  const x = v[0] * c + v[1] * s, y = v[0] * s - v[1] * c;
  const angle = Math.min(Math.PI / 2, diameter / (2 * MOON_KM));
  const rx = radius * Math.sin(angle);
  return { x: center.x + radius * x * Math.cos(angle), y: center.y + radius * y * Math.cos(angle),
    rx, ry: rx * Math.max(0, v[2]), angle: Math.atan2(y, x) + Math.PI / 2 };
}

export function projectLunarFeatures(disk, center, radius, north, W, H, shadow = null, selected = null) {
  if (radius < LUNAR_MIN_RADIUS) return [];
  const X = surfaceVector(disk, 0, 0), Y = surfaceVector(disk, 90, 0), Z = surfaceVector(disk, 0, 90);
  const c = Math.cos(north), s = Math.sin(north), result = [];
  for (const feature of catalogue) {
    // Ignore features too small to identify at this zoom; lettered craters
    // are available to taps but never generate automatic labels.
    const diameterPx = radius * feature.diameter / MOON_KM;
    if (diameterPx < 4 && feature.key !== selected) continue;
    const v = X.map((x, k) => x * feature.v[0] + Y[k] * feature.v[1] + Z[k] * feature.v[2]);
    const sunlight = v.reduce((sum, x, k) => sum + x * disk.sun[k], 0);
    if (v[2] < 0.06 || sunlight <= 0.005) continue;
    const x = center.x + radius * (v[0] * c + v[1] * s), y = center.y + radius * (v[0] * s - v[1] * c);
    if (x < 0 || x > W || y < 0 || y > H) continue;
    if (shadow && Math.hypot(x - shadow.x, y - shadow.y) < shadow.umbra * radius) continue;
    const size = diameterPx * Math.sqrt(v[2]);
    if (size < 4 && feature.key !== selected) continue;
    result.push({ ...feature, x, y, ellipse: lunarFeatureEllipse(v, feature.diameter, center, radius, north), radius: Math.min(35, size / 2), size, sunlight, limb: v[2], label: feature.major && size >= (feature.code === 'AA' ? 10 : 18) });
  }
  return result;
}

export function pickLunarFeature(features, x, y) {
  let best = null, score = Infinity;
  for (const feature of features || []) {
    const e = feature.ellipse, c = Math.cos(e.angle), s = Math.sin(e.angle), dx = x - e.x, dy = y - e.y;
    const within = ((dx * c + dy * s) / (e.rx + 8)) ** 2 + ((-dx * s + dy * c) / (e.ry + 8)) ** 2;
    const candidate = Math.hypot(feature.x - x, feature.y - y) / Math.max(10, feature.radius);
    if (within <= 1 && candidate < score) { best = feature; score = candidate; }
  }
  return best;
}

const TYPES = { AA: 'Crater', SF: 'Satellite crater', ME: 'Mare', OC: 'Oceanus', SI: 'Bay', MO: 'Mountain / mountain range', VA: 'Valley', RI: 'Rille', RU: 'Scarp', LC: 'Lake', DO: 'Ridge', CA: 'Crater chain', PR: 'Promontory', PA: 'Marsh', ST: 'Landing site', LF: 'Astronaut-named feature', AL: 'Albedo feature', PL: 'Plain' };
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function lunarFeatureDetails(feature) {
  const lon = (feature.lon + 540) % 360 - 180;
  const coordinate = (value, plus, minus) => `${Math.abs(value).toFixed(2)}° ${value < 0 ? minus : plus}`;
  return `<div class="coelum-object-head coelum-lunar-head"><h3>${esc(feature.name)}</h3><span>Moon · ${esc(TYPES[feature.code] || 'Surface feature')}</span></div>
    <dl><div><dt>Diameter / extent</dt><dd>${feature.diameter.toLocaleString(undefined, { maximumFractionDigits: 1 })} km</dd></div>
    <div><dt>Latitude</dt><dd>${coordinate(feature.lat, 'N', 'S')}</dd></div><div><dt>Longitude</dt><dd>${coordinate(lon, 'E', 'W')}</dd></div></dl>
    <p class="coelum-coordinate-note">Sunlit lunar surface · <a href="https://planetarynames.wr.usgs.gov/Feature/${feature.id}" target="_blank" rel="noopener">IAU/USGS nomenclature</a></p>`;
}
