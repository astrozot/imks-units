// Catalogue, surface alignment and illumination: node tests/lunarfeatures.mjs
import assert from 'node:assert/strict';
import { LUNAR_FEATURES } from '../js/lunardata.js';
import { projectLunarFeatures, pickLunarFeature, lunarFeatureDetails, LUNAR_MIN_RADIUS } from '../js/lunarfeatures.js';
import { surfaceVector } from '../js/skyview.js';
import { moonDisk, equatorial, nextPhase, topocentric } from '../js/astro.js';
const R = Math.PI / 180;
assert.ok(LUNAR_FEATURES.length > 9000);
assert.equal(new Set(LUNAR_FEATURES.map((f) => f[0])).size, LUNAR_FEATURES.length);
for (const [id, name, lon, lat, diameter] of LUNAR_FEATURES) {
  assert.ok(id > 0 && name && lon >= 0 && lon < 360 && Math.abs(lat) <= 90 && diameter >= 0);
}
const start = Date.UTC(2026, 10, 1) / 1000, center = { x: 600, y: 600 };
for (const phase of [0, 90, 180, 270]) {
  const t = nextPhase(start, phase), disk = moonDisk(t, topocentric('moon', t, [45, 9, 0]));
  const north = 0.7;
  const features = projectLunarFeatures(disk, center, 500, north, 1200, 1200);
  assert.deepEqual(projectLunarFeatures(disk, center, LUNAR_MIN_RADIUS - 1, north, 1200, 1200), []);
  for (const f of features) {
    const v = surfaceVector(disk, f.lon, f.lat);
    assert.ok(v[2] >= 0.06, 'Far-side/limb features excluded');
    assert.ok(v.reduce((s, x, k) => s + x * disk.sun[k], 0) > 0.005, 'Every feature directly sunlit');
    assert.ok(Math.abs(f.x - (center.x + 500 * (v[0] * Math.cos(north) + v[1] * Math.sin(north)))) < 1e-8);
    assert.ok(Math.abs(f.y - (center.y + 500 * (v[0] * Math.sin(north) - v[1] * Math.cos(north)))) < 1e-8);
    // Recover mapAt's geographic coordinates independently from the view
    // vector; this checks that labels use the same orientation as the shader.
    const pole = disk.pole, lat = Math.asin(v.reduce((s, x, k) => s + x * pole[k], 0)) / R;
    const u = v.map((x, k) => x - pole[k] * Math.sin(f.lat * R));
    const meridian = [0, 0, 1].map((x, k) => x - pole[k] * pole[2]);
    const cross = [meridian[1] * u[2] - meridian[2] * u[1], meridian[2] * u[0] - meridian[0] * u[2], meridian[0] * u[1] - meridian[1] * u[0]];
    const lon = disk.facing.lon + Math.atan2(cross.reduce((s, x, k) => s + x * pole[k], 0), u.reduce((s, x, k) => s + x * meridian[k], 0)) / R;
    assert.ok(Math.abs(lat - f.lat) < 1e-8);
    assert.ok(Math.abs(((lon - f.lon + 540) % 360) - 180) < 1e-8);
  }
  if (phase === 180) {
    const tycho = features.find((f) => f.name === 'Tycho');
    assert.ok(tycho?.label, 'Major crater labelled at sufficient zoom');
    const small = features.find((f) => !f.major && f.code === 'AA');
    assert.ok(small && !small.label, 'Minor craters available without automatic labels');
    assert.equal(pickLunarFeature([small], small.x, small.y), small);
    assert.equal(pickLunarFeature([small], small.x + 100, small.y + 100), null);
    assert.match(lunarFeatureDetails(tycho), /Tycho.*Moon/s);
    const eclipsed = projectLunarFeatures(disk, center, 500, north, 1200, 1200, { x: center.x, y: center.y, umbra: 2 });
    assert.deepEqual(eclipsed, [], 'Umbra suppresses surface labels and picks');
  }
  const hiddenSun = { ...disk, sun: [0, 0, -1] };
  assert.deepEqual(projectLunarFeatures(hiddenSun, center, 500, north, 1200, 1200), [], 'Earthshine never reveals unilluminated features');
}
console.log('Lunar feature checks passed: catalogue, texture alignment, libration, zoom, sunlight, eclipse and picking');
