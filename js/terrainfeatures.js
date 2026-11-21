// Named terrain points use the displayed triangles, including their existing
// curvature/refraction correction. No astronomical refraction is added.
import { EARTH, RAD } from './terrainmodel.js';
import { GRID_MISSING, gridHeightAt } from './terrainmesh.js';

export const TERRAIN_NAME_RADIUS = 150000;
export function terrainFeaturePosition(place, lat, lon) {
  const p = place[0] * RAD, q = lat * RAD, dl = (lon - place[1]) * RAD;
  const east = Math.cos(q) * Math.sin(dl), north = Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(dl);
  const angle = Math.atan2(Math.hypot(east, north), Math.sin(p) * Math.sin(q) + Math.cos(p) * Math.cos(q) * Math.cos(dl));
  const az = (Math.atan2(east, north) / RAD + 360) % 360, distance = angle * EARTH;
  return { az, distance, x: Math.sin(az * RAD) * distance, y: Math.cos(az * RAD) * distance };
}

// Gazetteer coordinates often lie tens of metres off the summit (on a slope,
// or at a map label), and the crest itself then "hides" the point. Climb the
// height grid (finest ring that contains the point) to the local maximum,
// at most SNAP_RADIUS away; never across a lower saddle to another summit.
// Records that reach the same summit are merged, keeping peaks/mountains
// over hills, recorded elevations and the closest original point.
export const SNAP_RADIUS = 250;
const CODE_RANK = { PK: 0, VLC: 0, MT: 1, HLL: 2 };
export function snapTerrainSummits(surface, features) {
  const grids = surface.meshes.map((m, ring) => m.grid && { ...m.grid, ring }).filter(Boolean).sort((a, b) => a.extent - b.extent);
  const summits = new Map(), loose = [];
  for (const f of features) {
    const q = terrainFeaturePosition(surface.place, f.lat, f.lon);
    const g = grids.find(g => Math.max(Math.abs(q.x), Math.abs(q.y)) < g.extent * (1 - 4 / g.size));
    if (!g) { loose.push({ ...f, ...q, snap: 0 }); continue; }
    // Raw 16-bit values are monotonic in height within one grid.
    const n = g.size, step = 2 * g.extent / n, h = (i, j) => { const v = g.heights[j * n + i]; return v === GRID_MISSING ? -1 : v; };
    const i0 = Math.max(1, Math.min(n - 2, Math.floor((q.x + g.extent) / step))), j0 = Math.max(1, Math.min(n - 2, Math.floor((q.y + g.extent) / step)));
    let i = i0, j = j0;
    for (;;) {
      let bi = i, bj = j, best = h(i, j);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 1 || jj < 1 || ii > n - 2 || jj > n - 2 || Math.hypot(ii - i0, jj - j0) * step > SNAP_RADIUS) continue;
        if (h(ii, jj) > best) { best = h(ii, jj); bi = ii; bj = jj; }
      }
      if (bi === i && bj === j) break;
      i = bi; j = bj;
    }
    // Unmoved points keep their own coordinates (they may be finer than a cell).
    const moved = i !== i0 || j !== j0, x = moved ? -g.extent + (i + .5) * step : q.x, y = moved ? -g.extent + (j + .5) * step : q.y;
    // ground: the grid's height there (relative to the eye, with curvature);
    // the simplified mesh may cut a summit by up to its angular tolerance.
    const out = { ...f, x, y, az: (Math.atan2(x, y) / RAD + 360) % 360, distance: Math.hypot(x, y), snap: Math.hypot(x - q.x, y - q.y), ground: gridHeightAt(g, x, y) };
    const key = `${g.ring}:${i}:${j}`, other = summits.get(key);
    const rank = r => [CODE_RANK[r.code] ?? 3, r.elevation == null ? 1 : 0, r.snap];
    if (!other || rank(out).reduce((c, v, k) => c || Math.sign(v - rank(other)[k]), 0) < 0) summits.set(key, out);
  }
  return [...summits.values(), ...loose];
}

// A summit counts as visible when nearer terrain hides it by no more than the
// displayed mesh's own accuracy (its 0.05° simplification tolerance, with a
// margin) or a few metres: what a person would still name. Terrain within the
// summit's own zone (SUMMIT_ZONE, or 1% of the distance where grid cells are
// coarse) is its own slope, which simplification and smoothing can leave a
// little higher than the summit; it never hides it. The label is anchored on
// the visible crest in front, never inside a hill.
export const VISIBILITY_TOLERANCE = 0.08, MIN_TOLERANCE = 5, SUMMIT_ZONE = 300;
// Sweep triangle bearing intervals against sorted candidates. Each triangle
// only visits the few summit rays that cross it, rather than scanning the
// entire mesh once per summit. Anchor and foreground occlusion are solved in
// one pass. Terrain BEHIND a summit never hides it; the target's own triangle
// is allowed to touch its sightline. Missing target geometry is not visible.
export function visibleTerrainFeatures(surface, features) {
  const near = surface.metrics?.nearField ?? 2;
  const rays = features.map(f => Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.distance) && Number.isFinite(f.az) ? { ...f } : { ...f, ...terrainFeaturePosition(surface.place, f.lat, f.lon) })
    .filter(f => f.distance > near && f.distance <= TERRAIN_NAME_RADIUS)
    .sort((a, b) => a.az - b.az);
  if (!rays.length) return [];
  for (const f of rays) { f.dx = f.x / f.distance; f.dy = f.y / f.distance; f.z = NaN; f.foreground = -Infinity; f.zone = Math.max(SUMMIT_ZONE, f.distance * .01); }
  const lowerBound = a => { let lo = 0, hi = rays.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (rays[m].az < a) lo = m + 1; else hi = m; } return lo; };
  const bearing = (x, y) => (Math.atan2(x, y) / RAD + 360) % 360;
  for (const { positions: p, indices } of surface.meshes) for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const ux = p[b] - ax, uy = p[b + 1] - ay, uz = p[b + 2] - az;
    const vx = p[c] - ax, vy = p[c + 1] - ay, vz = p[c + 2] - az, det = ux * vy - uy * vx;
    if (!det) continue;
    const u0 = (-ax * vy + ay * vx) / det, v0 = (-ux * ay + uy * ax) / det, w0 = 1 - u0 - v0;
    const z0 = az + u0 * uz + v0 * vz;
    let start = 0, end = 360;
    if (Math.min(u0, v0, w0) < -1e-9) {
      const angles = [bearing(ax, ay), bearing(p[b], p[b + 1]), bearing(p[c], p[c + 1])].sort((a, b) => a - b);
      let gap = -1;
      for (let k = 0; k < 3; k++) { const next = angles[(k + 1) % 3] + (k === 2 ? 360 : 0), d = next - angles[k]; if (d > gap) { gap = d; start = next % 360; end = angles[k]; } }
      if (end < start) end += 360;
    }
    for (let pass = 0; pass < (end >= 360 ? 2 : 1); pass++) {
      const loAz = pass ? 0 : start, hiAz = pass ? end - 360 : Math.min(360, end);
      for (let k = lowerBound(loAz - 1e-9); k < rays.length && rays[k].az <= hiAz + 1e-9; k++) {
        const f = rays[k], us = (f.dx * vy - f.dy * vx) / det, vs = (ux * f.dy - uy * f.dx) / det;
        let lo = near, hi = f.distance;
        for (const [base, slope] of [[u0, us], [v0, vs], [w0, -us - vs]]) {
          if (Math.abs(slope) < 1e-15) { if (base < -1e-9) { hi = -1; break; } }
          else if (slope > 0) lo = Math.max(lo, -base / slope);
          else hi = Math.min(hi, -base / slope);
        }
        if (hi + 1e-7 < lo) continue;
        const slope = us * uz + vs * vz, front = Math.min(hi, f.distance - f.zone);
        if (front + 1e-7 >= lo) f.foreground = Math.max(f.foreground, slope + z0 / (z0 >= 0 ? lo : front));
        if (hi >= f.distance - 1e-6 && lo <= f.distance + 1e-6) {
          const z = z0 + slope * f.distance;
          f.z = Number.isFinite(f.z) ? Math.max(f.z, z) : z;
        }
      }
    }
  }
  const tolerance = Math.tan(VISIBILITY_TOLERANCE * RAD), profile = surface.profile, bins = profile?.length;
  for (const f of rays) if (Number.isFinite(f.z) && Number.isFinite(f.ground)) f.z = Math.max(f.z, f.ground);
  return rays.filter(f => Number.isFinite(f.z) && f.foreground * f.distance - f.z <= Math.max(MIN_TOLERANCE, f.distance * tolerance)).map(f => {
    const { dx, dy, foreground, zone, ground, ...out } = f;
    const z = Math.max(f.z, foreground * f.distance), length = Math.hypot(f.distance, z), alt = Math.atan2(z, f.distance) / RAD;
    // On the skyline: nothing beyond rises above it (the traced horizon,
    // sampled at the two neighbouring bins).
    const k = f.az / 360 * bins, skyline = bins ? alt >= Math.min(profile[Math.floor(k) % bins], profile[Math.ceil(k) % bins]) - VISIBILITY_TOLERANCE : false;
    return { ...out, alt, skyline, vector: [f.x / length, f.y / length, z / length],
      modelElevation: f.z + surface.eye + f.distance ** 2 * .87 / (2 * EARTH) };
  });
}

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function terrainFeatureDetails(f) {
  const types = { MT: 'Mountain', PK: 'Peak', HLL: 'Hill', VLC: 'Volcano' };
  return `<div class="coelum-object-head"><h3>${esc(f.name)}</h3><span>Earth · ${types[f.code] || 'Peak'}</span></div>
    <dl><div><dt>Elevation</dt><dd>${Number.isFinite(f.elevation) ? `${Math.round(f.elevation).toLocaleString()} m` : 'Unknown'}</dd></div>
    <div><dt>Distance</dt><dd>${(f.distance / 1000).toFixed(1)} km</dd></div><div><dt>Bearing</dt><dd>${f.az.toFixed(1)}°</dd></div>
    <div><dt>Latitude</dt><dd>${Math.abs(f.lat).toFixed(5)}° ${f.lat < 0 ? 'S' : 'N'}</dd></div><div><dt>Longitude</dt><dd>${Math.abs(f.lon).toFixed(5)}° ${f.lon < 0 ? 'W' : 'E'}</dd></div></dl>
    <p class="coelum-coordinate-note">Visibility and label position follow the terrain model; buildings and trees are excluded. Name: ${f.source === 'OpenStreetMap' ? `<a href="https://www.openstreetmap.org/node/${Number(f.id)}" target="_blank" rel="noopener">OpenStreetMap</a> (© OpenStreetMap contributors, ODbL)` : `<a href="https://www.geonames.org/${Number(f.id)}/" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)`}.</p>`;
}
