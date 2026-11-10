// Catalogue, surface alignment and illumination: node tests/lunarfeatures.mjs
import assert from 'node:assert/strict';
import { LUNAR_FEATURES } from '../js/lunardata.js';
import { projectLunarFeatures, pickLunarFeature, lunarFeatureDetails, LUNAR_MIN_RADIUS, lunarFeatureEllipse, searchLunarFeatures, findLunarFeature, lunarFeatureTarget, earthObservableLunarFeature } from '../js/lunarfeatures.js';
import { skyFrame, searchSky, searchAngularField, findObject } from '../js/coelum.js';
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

// The projection is an ellipse, verified against points on the actual
// spherical circle, including rotation and the shifted center near the limb.
for (const north of [0, 0.7, 1.9]) {
  for (const v of [[0, 0, 1], [0.8, 0, 0.6], [0, -Math.sqrt(0.99), 0.1]]) {
    const radius = 500, diameter = 300, center = { x: 600, y: 600 };
    const e = lunarFeatureEllipse(v, diameter, center, radius, north);
    assert.ok(Math.abs(e.ry / e.rx - v[2]) < 1e-12, 'Foreshortening follows surface angle');
    const E = v[0] === 0 && v[1] === 0 ? [1, 0, 0] : [-v[1], v[0], 0].map((x) => x / Math.hypot(v[0], v[1]));
    const N = [v[1] * E[2] - v[2] * E[1], v[2] * E[0] - v[0] * E[2], v[0] * E[1] - v[1] * E[0]];
    const a = diameter / (2 * 1737.4);
    for (let k = 0; k < 32; k++) {
      const theta = k * Math.PI / 16;
      const p = v.map((x, i) => x * Math.cos(a) + Math.sin(a) * (E[i] * Math.cos(theta) + N[i] * Math.sin(theta)));
      const x = center.x + radius * (p[0] * Math.cos(north) + p[1] * Math.sin(north)), y = center.y + radius * (p[0] * Math.sin(north) - p[1] * Math.cos(north));
      const dx = x - e.x, dy = y - e.y, c = Math.cos(e.angle), s = Math.sin(e.angle);
      assert.ok(Math.abs(((dx * c + dy * s) / e.rx) ** 2 + ((-dx * s + dy * c) / e.ry) ** 2 - 1) < 1e-10, 'Ellipse matches projected spherical boundary');
    }
  }
}
const f = skyFrame(Date.UTC(2026, 10, 24, 21) / 1000, [41.892, 12.511, 20]);
const sameName = searchSky(f, 'Copernicus');
assert.ok(sameName.some((o) => o.name === 'Copernicus' && o.type === 'star' && !o.key));
assert.ok(sameName.some((o) => o.name === 'Copernicus' && o.type === 'lunar feature' && o.key === 'lunar:1296'));
assert.equal(searchSky(f, 'moon Copernicus')[0].key, 'lunar:1296');
assert.equal(searchLunarFeatures('COPÉRNICUS')[0].key, 'lunar:1296');
assert.deepEqual(searchSky(f, 'Tsiolkovskiy'), [], 'Permanently hidden lunar names are excluded');
assert.deepEqual(searchLunarFeatures('moon Tsiolkovskiy'), [], 'Prefixes do not bypass Earth observability');
assert.ok(searchLunarFeatures('Al-Biruni').length, 'Libration-zone features stay searchable');
assert.ok(!earthObservableLunarFeature({ lon: 180, lat: 0 }));
assert.ok(earthObservableLunarFeature({ lon: 180, lat: 86 }), 'Polar libration is considered');
assert.equal(sameName[0].type, 'star', 'Star precedes its namesake lunar feature');
const companion = { ...f.stars[0], name: 'Copernicus companion' };
assert.equal(searchSky({ ...f, stars: [companion] }, 'Copernicus')[0].name, companion.name, 'Ordinary prefix match precedes exact feature');
for (const query of ['a', 'mar', 'co']) {
  const matches = searchSky(f, query, 40), firstFeature = matches.findIndex((m) => m.key);
  assert.ok(firstFeature < 0 || matches.slice(firstFeature).every((m) => m.key), 'Surface names follow all ordinary results');
}
const target = lunarFeatureTarget(f, findLunarFeature('lunar:1296'));
assert.ok(target.lunarState.sunlit && target.lunarState.visible);
assert.ok(Math.hypot(target.alt - f.bodies[1].alt, target.az - f.bodies[1].az) > 0.01, 'Fly to the surface feature rather than Moon center');
assert.ok(searchAngularField(findObject(f, 'Moon')) < searchAngularField(findObject(f, 'M31')));
assert.ok(searchAngularField(findObject(f, 'Jupiter')) < searchAngularField(findObject(f, 'Moon')));
assert.ok(searchAngularField(findObject(f, 'Sirius')) > searchAngularField(findObject(f, 'M31')));
console.log('Lunar search, target direction, object framing and projected ellipse checks passed');
