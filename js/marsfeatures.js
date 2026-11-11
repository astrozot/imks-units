// Offline IAU names and source-aware geometry. All positions share the
// telescope texture's planetocentric/east coordinate system and rotation.
import { moons } from './astro.js';
import { surfaceVector } from './skyview.js';
import { MARS_FEATURES } from './marsdata.js';

export const MARS_COLOR = '#ffc98f';
export const MARS_MIN_RADIUS = 120;
const R = Math.PI / 180, MARS_KM = 3396.19, FLATTENING = 0.00589;
const TYPES = { AL: 'Albedo feature', AA: 'Crater', CA: 'Crater chain', CB: 'Hollows', CH: 'Canyon', CM: 'Chaos terrain', CO: 'Hills', DO: 'Ridge', FL: 'Flow terrain', FO: 'Troughs', LA: 'Landslide', LB: 'Labyrinth', LN: 'Ice tongue', MA: 'Dark spot', MN: 'Mesa', MO: 'Mountain / volcano', PA: 'Dark plain', PE: 'Volcanic crater', PL: 'Low plain / basin', PM: 'Plateau', RU: 'Scarp', SC: 'Scarp / cliff', SE: 'Sinuous feature', SU: 'Grooves', TA: 'Highland region', TH: 'Volcanic dome', UN: 'Dune field', VA: 'Valley / canyon system', VS: 'Vast plain' };
const prominent = new Set(['Syrtis Major', 'Hellas', 'Mare Acidalium', 'Sinus Meridiani', 'Sinus Sabaeus', 'Mare Cimmerium', 'Mare Erythraeum', 'Solis Lacus', 'Olympus Mons', 'Ascraeus Mons', 'Pavonis Mons', 'Arsia Mons', 'Elysium Mons', 'Alba Mons', 'Valles Marineris', 'Noctis Labyrinthus', 'Hellas Planitia', 'Argyre Planitia', 'Isidis Planitia', 'Utopia Planitia', 'Chryse Planitia', 'Syrtis Major Planum', 'Gale', 'Jezero', 'Gusev', 'Schiaparelli', 'Huygens', 'Herschel', 'Cassini', 'Lyot', 'Schiaparelli', 'Meridiani Planum']);
const vector = (lon, lat) => [Math.cos(lat*R)*Math.cos(lon*R), Math.cos(lat*R)*Math.sin(lon*R), Math.sin(lat*R)];
const dot = (a, b) => a.reduce((s, x, i) => s+x*b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

// Ellipses are intrinsic to Mars, in local east/north kilometres. The angle
// is counterclockwise from east, as documented for the source fitter.
function ellipseRing(shape) {
  const [lon, lat] = shape.center, C = vector(lon, lat), E = vector(lon+90, 0), N = cross(C, E);
  const a = shape.angle*R, c = Math.cos(a), s = Math.sin(a);
  return Array.from({ length: 129 }, (_, i) => {
    const t = 2*Math.PI*i/128, u = shape.major/2*Math.cos(t), v = shape.minor/2*Math.sin(t);
    const x = u*c-v*s, y = u*s+v*c, length = Math.hypot(x, y), angle = length/MARS_KM;
    return C.map((z, k) => z*Math.cos(angle) + Math.sin(angle)*(E[k]*x+N[k]*y)/Math.max(1e-12, length));
  });
}
const catalogue = MARS_FEATURES.map(([id, name, lon, lat, diameter, code, shape]) => {
  const v = vector(lon, lat);
  const rings = shape?.kind === 'polygon' ? shape.rings.map((r) => r.map(([x, y]) => vector(x, y)))
    : shape?.kind === 'ellipse' ? [ellipseRing(shape)] : diameter > 0 ? [ellipseRing({ center: [lon, lat], major: diameter, minor: diameter, angle: 0 })] : [];
  const extent = diameter || (shape?.major ?? Math.max(0, ...rings.flat().map((p) => 2*MARS_KM*Math.acos(Math.max(-1, Math.min(1, dot(v, p)))))));
  return { id, name, lon, lat, diameter, code, type: TYPES[code] || 'Surface feature', shape, key: `mars:${id}`, v, rings, extent, major: prominent.has(name) };
});
const byKey = new Map(catalogue.map((f) => [f.key, f]));
export const findMarsFeature = (key) => byKey.get(key) || null;
export const marsDisk = (t) => ({ ...moons('mars', t), planet: 'mars', t, moons: [] });
const fold = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const searchable = catalogue.map((f) => ({ f, name: fold(f.name) }));
export function searchMarsFeatures(query, limit = 8) {
  const q = fold(query).replace(/^(mars|martian) +/, '').replace(/ +(mars|martian)$/, '');
  if (!q) return [];
  return searchable.flatMap(({ f, name }) => {
    const score = name === q ? 0 : name.startsWith(q) ? 1 : name.split(' ').some((w) => w.startsWith(q)) ? 2 : name.includes(q) ? 3 : null;
    return score === null ? [] : [{ ...f, score }];
  }).sort((a, b) => a.score-b.score || Number(b.major)-Number(a.major) || b.extent-a.extent).slice(0, limit);
}
export function marsFeatureState(disk, feature) {
  return surfaceState(disk, surfaceVector(disk, feature.lon, feature.lat));
}
function surfaceState(disk, direction) {
  const polar = dot(direction, disk.pole), k = (1-FLATTENING)**-2-1;
  const length = 1/Math.sqrt(1+polar*polar*k), v = direction.map((x) => x*length);
  const normal = direction.map((x, i) => x+disk.pole[i]*polar*k), norm = Math.hypot(...normal);
  const sunlight = dot(normal, disk.sun)/norm;
  return { v, sunlight, visible: normal[2]/norm >= 0.06, sunlit: sunlight > 0.005 };
}
const basis = (disk) => [surfaceVector(disk, 0, 0), surfaceVector(disk, 90, 0), surfaceVector(disk, 0, 90)];
const transform = (v, axes) => axes[0].map((x, k) => x*v[0]+axes[1][k]*v[1]+axes[2][k]*v[2]);
function projectPoint(disk, direction, center, radius, north) {
  const state = surfaceState(disk, direction), v = state.v, c = Math.cos(north), s = Math.sin(north);
  return { x: center.x+radius*(v[0]*c+v[1]*s), y: center.y+radius*(v[0]*s-v[1]*c), visible: state.visible && state.sunlit };
}
function projectedRings(disk, feature, center, radius, north, axes) {
  return feature.rings.map((r) => r.map((v) => projectPoint(disk, transform(v, axes), center, radius, north)));
}
const flattenRings = (rings) => rings.flatMap((r) => [...r, { x: 0, y: 0, visible: false }]);
export function marsFeatureOutline(disk, feature, center, radius, north) {
  const rings = projectedRings(disk, feature, center, radius, north, basis(disk));
  return rings.length ? flattenRings(rings) : null;
}

export function projectMarsFeatures(disk, center, radius, north, W, H, selected = null) {
  if (radius < MARS_MIN_RADIUS) return [];
  const axes = basis(disk), c = Math.cos(north), s = Math.sin(north), projection = { disk, center, radius, north };
  return catalogue.flatMap((f) => {
    const size = radius*f.extent/MARS_KM;
    if (size < 4 && f.code !== 'AL' && f.key !== selected) return [];
    const state = surfaceState(disk, transform(f.v, axes)), v = state.v;
    if (!state.visible || !state.sunlit) return [];
    const x = center.x+radius*(v[0]*c+v[1]*s), y = center.y+radius*(v[0]*s-v[1]*c);
    if (x < 0 || x > W || y < 0 || y > H) return [];
    const threshold = f.code === 'AA' ? 28 : ['MO', 'TH', 'PE'].includes(f.code) ? 24 : 60;
    const projected = { ...f, x, y, sunlight: state.sunlight,
      radius: radius*Math.sin(Math.min(Math.PI/2, f.extent/(2*MARS_KM))), size,
      label: f.key === selected || (f.code === 'AL' ? f.major || radius >= 480 : size >= (f.major ? 8 : threshold)), projection };
    // Only the selected outline and nearby pick candidates need full geometry.
    // Non-enumerable getters keep label-layout spreads from projecting it all.
    let rings;
    Object.defineProperties(projected, {
      rings: { enumerable: false, get: () => rings ||= projectedRings(disk, f, center, radius, north, axes) },
      outline: { enumerable: false, get: () => projected.rings.length ? flattenRings(projected.rings) : null },
    });
    return [projected];
  });
}
function insideRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length-1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside = !inside;
  }
  return inside;
}
// Reject picks on the night side even if a large region's projected footprint
// crosses the terminator. Recover the front hit on the oblate globe.
function sunlitPick({ disk, center, radius, north }, px, py) {
  const c = Math.cos(north), s = Math.sin(north), dx = (px-center.x)/radius, dy = (py-center.y)/radius;
  const x = dx*c+dy*s, y = dx*s-dy*c, p = disk.pole, k = (1-FLATTENING)**-2-1;
  const q = x*p[0]+y*p[1], A = 1+k*p[2]**2, B = k*q*p[2], C = x*x+y*y+k*q*q-1, det = B*B-A*C;
  if (det < 0) return false;
  const z = (-B+Math.sqrt(det))/A, n = Math.hypot(x, y, z), state = surfaceState(disk, [x/n, y/n, z/n]);
  return state.visible && state.sunlit;
}
export function pickMarsFeature(features, x, y) {
  if (!features?.length || !sunlitPick(features[0].projection, x, y)) return null;
  let best = null, score = Infinity;
  for (const f of features) {
    const distance = Math.hypot(f.x-x, f.y-y);
    if (distance > Math.max(16, f.radius*1.5+16)) continue;
    if (distance > 16 && !f.rings.some((ring) => insideRing(ring, x, y))) continue;
    const candidate = distance/Math.max(16, Math.min(40, f.radius));
    if (candidate < score) { best = f; score = candidate; }
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
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function marsFeatureDetails(feature) {
  const lon = (feature.lon+540)%360-180, shape = feature.shape;
  const coord = (v, plus, minus) => `${Math.abs(v).toFixed(2)}° ${v < 0 ? minus : plus}`;
  const km = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const note = shape?.source === 'albedo-map' ? `Approximate identification contour from the ${shape.epoch} albedo map; markings can change`
    : shape?.source === 'robbins2020' ? 'Measured crater ellipse · Robbins 2020'
    : shape?.source === 'polygon-fit' ? 'Approximate ellipse fitted to the mapped nomenclature footprint'
    : shape?.kind === 'polygon' ? 'Mapped nomenclature footprint; boundaries are approximate'
    : feature.diameter ? 'Catalogue diameter / extent; outline is a circular approximation' : 'Named albedo region; extent not specified in the catalogue. Marker at the named center';
  const source = shape?.source === 'robbins2020' ? '<a href="https://craters.sjrdesign.net/" target="_blank" rel="noopener">Crater measurements</a>'
    : shape?.source === 'albedo-map' ? '<a href="https://britastro.org/section_information_/mars-section-overview/maps-of-mars" target="_blank" rel="noopener">BAA / Martin Lewis map</a>' : '';
  return `<div class="coelum-object-head coelum-mars-head"><h3>${esc(feature.name)}</h3><span>Mars · ${esc(feature.type)}</span></div>
    <dl>${feature.diameter ? `<div><dt>Diameter / extent</dt><dd>${km(feature.diameter)} km</dd></div>` : ''}${shape?.kind === 'ellipse' ? `<div><dt>Ellipse axes</dt><dd>${km(shape.major)} × ${km(shape.minor)} km</dd></div>` : ''}<div><dt>Latitude</dt><dd>${coord(feature.lat, 'N', 'S')}</dd></div><div><dt>Longitude</dt><dd>${coord(lon, 'E', 'W')}</dd></div></dl>
    <p class="coelum-coordinate-note">${esc(note)} · <a href="https://planetarynames.wr.usgs.gov/Feature/${feature.id}" target="_blank" rel="noopener">IAU/USGS nomenclature</a>${source ? ` · ${source}` : ''}</p>`;
}
