import assert from 'node:assert/strict';
import { marsDisk, searchMarsFeatures, findMarsFeature, marsFeatureState, marsFeatureTarget, projectMarsFeatures, pickMarsFeature, marsFeatureDetails, MARS_MIN_RADIUS, marsFeatureOutline } from '../js/marsfeatures.js';
import { skyFrame, searchSky } from '../js/coelum.js';
const R = Math.PI / 180, seen = new Set(), start = Date.parse('2026-11-24T21:00:00Z') / 1000;
assert.equal(searchMarsFeatures('Mars Olympus')[0].key, 'mars:4453');
assert.equal(searchMarsFeatures('VÁLLES MARINERIS')[0].name, 'Valles Marineris');
assert.equal(findMarsFeature('lunar:4453'), null);
for (let hour = 0; hour < 50; hour += 2) {
  const t = start + hour * 3600, disk = marsDisk(t), center = { x: 600, y: 600 }, radius = 500, north = 0.7;
  assert.deepEqual(projectMarsFeatures(disk, center, MARS_MIN_RADIUS - 1, north, 1200, 1200), []);
  const features = projectMarsFeatures(disk, center, radius, north, 1200, 1200);
  const frame = skyFrame(t, [41.892, 12.511, 20]);
  for (const f of features) {
    seen.add(f.key);
    const state = marsFeatureState(disk, f), v = state.v;
    assert.ok(state.visible && state.sunlit);
    // Independently recover the map coordinates and ellipsoid surface.
    const polar = v.reduce((s, x, k) => s + x * disk.pole[k], 0);
    assert.ok(Math.abs(v.reduce((s, x) => s + x * x, 0) + polar ** 2 * ((1 - 0.00589) ** -2 - 1) - 1) < 1e-8);
    assert.ok(Math.abs(Math.asin(polar / Math.hypot(...v)) / R - f.lat) < 1e-8);
    const u = v.map((x, k) => x - disk.pole[k] * polar);
    const meridian = [0, 0, 1].map((x, k) => x - disk.pole[k] * disk.pole[2]);
    const cross = [meridian[1] * u[2] - meridian[2] * u[1], meridian[2] * u[0] - meridian[0] * u[2], meridian[0] * u[1] - meridian[1] * u[0]];
    const lon = disk.facing.lon + Math.atan2(cross.reduce((s, x, k) => s + x * disk.pole[k], 0), u.reduce((s, x, k) => s + x * meridian[k], 0)) / R;
    assert.ok(Math.abs((lon - f.lon + 540) % 360 - 180) < 1e-8);
    assert.ok(Math.abs(f.x - center.x - radius * (v[0] * Math.cos(north) + v[1] * Math.sin(north))) < 1e-8);
    assert.ok(Math.abs(f.y - center.y - radius * (v[0] * Math.sin(north) - v[1] * Math.cos(north))) < 1e-8);
    assert.equal(pickMarsFeature([f], f.x + 5, f.y), f);
    assert.equal(pickMarsFeature([f], f.x + 2 * Math.max(16, f.radius) + 30, f.y), null);
    const target = marsFeatureTarget(frame, f), mars = frame.bodies.find((o) => o.body === 'mars');
    assert.ok(target.marsState.visible && target.marsState.sunlit);
    assert.ok(Math.hypot(target.ra - mars.ra, target.dec - mars.dec) < target.marsRadius * 2);
    assert.match(marsFeatureDetails(f), /Mars.*IAU\/USGS/s);
    if (f.diameter) {
      assert.match(marsFeatureDetails(f), /Diameter \/ extent/);
      assert.ok(f.outline.length > 100 && f.outline.some((p) => p.visible));
      assert.ok(Math.abs(f.outline[0].x - f.outline.at(-1).x) < 1e-8, 'Size outline is closed');
      // The outline spans exactly the catalogue angular radius around the
      // named center, with foreshortening and the oblate surface included.
      const unit = v.map((x) => x / Math.hypot(...v));
      const c = Math.cos(north), s = Math.sin(north);
      for (const p of f.outline.filter((p) => p.visible)) {
        const dx = (p.x - center.x) / radius, dy = (p.y - center.y) / radius;
        const x = dx * c + dy * s, y = dx * s - dy * c;
        // Ray/ellipsoid quadratic, solved independently in view coordinates.
        const k = (1 - 0.00589) ** -2 - 1, pole = disk.pole;
        const A = 1 + k * pole[2] ** 2, B = k * (x * pole[0] + y * pole[1]) * pole[2];
        const C = x*x + y*y + k * (x * pole[0] + y * pole[1]) ** 2 - 1;
        const z = (-B + Math.sqrt(Math.max(0, B*B - A*C))) / A;
        const norm = Math.hypot(x, y, z);
        const angle = Math.acos(Math.max(-1, Math.min(1, (x * unit[0] + y * unit[1] + z * unit[2]) / norm)));
        assert.ok(Math.abs(angle - f.diameter / (2 * 3396.19)) < 1e-8, 'Outline uses the actual extent');
      }
      const inside = f.outline.find((p) => p.visible);
      assert.equal(pickMarsFeature([f], (inside.x + f.x) / 2, (inside.y + f.y) / 2), f, 'Size footprint is selectable');
    } else {
      assert.equal(f.outline, null, 'Unknown albedo extents are not invented');
      assert.match(marsFeatureDetails(f), /extent not specified/);
    }
    const result = searchSky(frame, `Mars ${f.name}`)[0];
    assert.equal(result.key, f.key);
    assert.equal(result.type, 'Mars feature');
    assert.equal(result.availability, null);
  }
  const dark = { ...disk, sun: [0, 0, -1] };
  assert.deepEqual(projectMarsFeatures(dark, center, radius, north, 1200, 1200), []);
}
assert.equal(seen.size, 10, 'Every feature appears during a rotation');
console.log('Mars feature checks passed: rotation, oblate texture alignment, illumination, picking, search and targeting');

assert.equal(findMarsFeature('mars:4453').diameter, 610.13);
assert.equal(findMarsFeature('mars:6288').diameter, 3761.28);
assert.equal(marsFeatureOutline(marsDisk(start), findMarsFeature('mars:5795'), { x: 0, y: 0 }, 500, 0), null);
const frame = skyFrame(start, [41.892, 12.511, 20]);
const companion = { ...frame.stars[0], name: 'Olympus Mons companion' };
assert.equal(searchSky({ ...frame, stars: [companion] }, 'Olympus Mons')[0].name, companion.name, 'Ordinary result precedes an exact Mars feature');
