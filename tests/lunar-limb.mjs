import assert from 'node:assert/strict';
import { buildLunarLimb, elevationAt, limbRadius, appendLunarLimb, LUNAR_RADIUS_KM } from '../js/lunarlimb.js';
const sky = { pole: [0, 1, 0], facing: { lon: 0 } };
const field = { width: 1024, height: 512, data: new Uint16Array(1024 * 512).fill(20000) };
for (const height of [-5, 0, 8]) {
  field.data.fill(Math.round((height + 10) * 2000));
  const profile = buildLunarLimb(sky, field, { samples: 256 });
  for (const r of profile) assert.ok(Math.abs(r - (1 + height / LUNAR_RADIUS_KM)) < 1e-7, 'A constant-height Moon has the analytic circular outline');
}
// With finite distance, use the analytic angular radius of an elevated sphere.
field.data.fill(36000);
const angular = .26 * Math.PI / 180;
const perspective = buildLunarLimb({ ...sky, radius: .26 }, field, { samples: 256 });
const expected = Math.asin((1 + 8 / LUNAR_RADIUS_KM) * Math.sin(angular)) / angular;
for (const r of perspective) assert.ok(Math.abs(r - expected) < 1e-7, 'Finite-distance silhouette follows angular disk geometry');
field.data.fill(20000);
// At the right-hand tangent the longitude is 90 degrees (u=.75).
// A ridge behind that tangent must protrude even though the tangent is flat.
for (let y = 0; y < field.height; y++) for (let x = 777; x <= 780; x++) field.data[y * field.width + x] = 40000;
const ridge = buildLunarLimb(sky, field, { samples: 512 });
assert.ok(ridge[0] > 1.002, 'Far-side ridges contribute to the silhouette');
assert.ok(Math.abs(ridge[256] - 1) < 1e-7, 'Opposite limb stays unchanged');
assert.equal(limbRadius(ridge, -Math.PI / 2), limbRadius(ridge, 3 * Math.PI / 2));
assert.equal(elevationAt(field, 0, .5), elevationAt(field, 1, .5), 'Longitude wraps at the texture seam');
assert.ok(Number.isFinite(elevationAt(field, -.2, -1)) && Number.isFinite(elevationAt(field, 1.2, 2)), 'Polar sampling clamps');
const rotated = buildLunarLimb({ ...sky, facing: { lon: 180 } }, field, { samples: 512 });
assert.ok(rotated[256] > 1.002 && rotated[0] < 1.00001, 'Libration rotates the terrain into the correct limb');
const points = [], path = { moveTo: (x,y) => points.push([x,y]), lineTo: (x,y) => points.push([x,y]), closePath() {} };
appendLunarLimb(path, new Float32Array([1, 1, 1, 1]), 10, 20, 2, Math.PI / 2);
assert.ok(Math.hypot(points[0][0] - 10, points[0][1] - 22) < 1e-10, 'Canvas north rotation matches celestial west/north axes');
console.log('Lunar limb geometry checks passed');
