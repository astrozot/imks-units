// Lunar surface labels/picking. Features share the texture's exact rotation,
// including libration and observer parallax. Earthshine does not qualify as
// illumination: only features whose centers receive direct sunlight are shown.
import { LUNAR_FEATURES } from './lunardata.js';
import { surfaceVector } from './skyview.js';

export const LUNAR_COLOR = '#65b9ff';
export const LUNAR_MIN_RADIUS = 120; // CSS pixels, independent of device/viewport
const R = Math.PI / 180, MOON_KM = 1737.4;
const prominent = new Set(['Tycho', 'Copernicus', 'Kepler', 'Aristarchus', 'Plato', 'Clavius', 'Eratosthenes', 'Archimedes', 'Aristoteles', 'Eudoxus', 'Ptolemaeus', 'Alphonsus', 'Arzachel', 'Theophilus', 'Cyrillus', 'Catharina', 'Posidonius', 'Gassendi', 'Grimaldi', 'Schickard', 'Petavius', 'Langrenus', 'Picard', 'Proclus', 'Stevinus', 'Janssen', 'Schiller', 'Montes Apenninus', 'Montes Alpes', 'Montes Caucasus', 'Vallis Alpes', 'Rupes Recta']);
const catalogue = LUNAR_FEATURES.map(([id, name, lon, lat, diameter, code]) => ({
  key: `lunar:${id}`, id, name, lon, lat, diameter, code,
  major: ['ME', 'OC', 'SI'].includes(code) || prominent.has(name),
  v: [Math.cos(lat * R) * Math.cos(lon * R), Math.cos(lat * R) * Math.sin(lon * R), Math.sin(lat * R)],
}));

export function projectLunarFeatures(disk, center, radius, north, W, H, shadow = null) {
  if (radius < LUNAR_MIN_RADIUS) return [];
  const X = surfaceVector(disk, 0, 0), Y = surfaceVector(disk, 90, 0), Z = surfaceVector(disk, 0, 90);
  const c = Math.cos(north), s = Math.sin(north), result = [];
  for (const feature of catalogue) {
    // Ignore features too small to identify at this zoom; lettered craters
    // are available to taps but never generate automatic labels.
    const diameterPx = radius * feature.diameter / MOON_KM;
    if (diameterPx < 4) continue;
    const v = X.map((x, k) => x * feature.v[0] + Y[k] * feature.v[1] + Z[k] * feature.v[2]);
    const sunlight = v.reduce((sum, x, k) => sum + x * disk.sun[k], 0);
    if (v[2] < 0.06 || sunlight <= 0.005) continue;
    const x = center.x + radius * (v[0] * c + v[1] * s), y = center.y + radius * (v[0] * s - v[1] * c);
    if (x < 0 || x > W || y < 0 || y > H) continue;
    if (shadow && Math.hypot(x - shadow.x, y - shadow.y) < shadow.umbra * radius) continue;
    const size = diameterPx * Math.sqrt(v[2]);
    if (size < 4) continue;
    result.push({ ...feature, x, y, radius: Math.min(35, size / 2), size, sunlight, limb: v[2], label: feature.major && size >= (feature.code === 'AA' ? 10 : 18) });
  }
  return result;
}

export function pickLunarFeature(features, x, y) {
  let best = null, score = Infinity;
  for (const feature of features || []) {
    const d = Math.hypot(feature.x - x, feature.y - y), reach = Math.max(10, feature.radius);
    const candidate = d / reach;
    if (candidate < 1 && candidate < score) { best = feature; score = candidate; }
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
