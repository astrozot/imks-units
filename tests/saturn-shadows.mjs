import assert from 'node:assert/strict';
import { solarSegment, globeCoverage, ringCoverage } from '../js/skyview.js';

const angle = 0.0046505 / 9.5388;
assert.equal(solarSegment(-1), 0);
assert.equal(solarSegment(0), 0.5);
assert.equal(solarSegment(1), 1);

// An independent two-dimensional integration over the solar disk.
function diskAverage(light, blocked) {
  const e = Math.abs(light[2]) < 0.9 ? [-light[1], light[0], 0] : [1, 0, 0];
  const h = Math.hypot(...e), u = e.map((x) => x / h);
  const v = [light[1] * u[2] - light[2] * u[1], light[2] * u[0] - light[0] * u[2], light[0] * u[1] - light[1] * u[0]];
  let sum = 0, count = 0;
  for (let i = 0; i < 240; i++) for (let j = 0; j < 240; j++) {
    const x = (i + 0.5) / 120 - 1, y = (j + 0.5) / 120 - 1;
    if (x * x + y * y > 1) continue;
    sum += blocked(light.map((l, k) => l + angle * (x * u[k] + y * v[k])));
    count++;
  }
  return sum / count;
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
for (const f of [0, 0.09796]) for (const t of [0.3, 1.7]) for (const fraction of [-1.2, -0.5, 0, 0.5, 1.2]) {
  const light = [1, 0, 0], q = [-t, 0, (1 - f) + fraction * angle * t];
  const reference = diskAverage(light, (d) => {
    const k = 1 / (1 - f), a = [q[0], q[1], q[2] * k], b = [d[0], d[1], d[2] * k];
    const B = dot(a, b);
    return B < 0 && B * B >= dot(b, b) * (dot(a, a) - 1) ? 1 : 0;
  });
  assert.ok(Math.abs(globeCoverage(q, light, f, angle) - reference) < 0.002, `Globe penumbra: ${f}, ${t}, ${fraction}`);
}
// A sharp B-ring edge: the average must match solar-disk ray tracing,
// including sunlight nearly in the ring plane and from either side.
const bands = [[1.239, 1.527, 0.15], [1.527, 1.951, 0.9], [1.951, 2.027, 0.08], [2.027, 2.269, 0.6]];
for (const z of [0.4, 0.01, 0, -0.01, -0.4]) for (const offset of [-0.5, 0, 0.5]) {
  const light = [Math.sqrt(1 - z * z), 0, z];
  const q = [1.527 - light[0] + offset * angle / Math.max(Math.abs(z), angle), 0, -z || angle * 0.5];
  const reference = diskAverage(light, (d) => {
    const t = -q[2] / d[2];
    if (t <= 0) return 0;
    const rho = Math.hypot(q[0] + t * d[0], q[1] + t * d[1]);
    return bands.find(([a, b]) => rho >= a && rho < b)?.[2] || 0;
  });
  assert.ok(Math.abs(ringCoverage(q, light, angle, null) - reference) < 0.045, `Ring penumbra: ${z}, ${offset}`);
}
const edge = [-1.7, 1 + 0.3 * angle * 1.7, 0];
assert.equal(globeCoverage(edge, [1, 0, 0], 0, angle, 70), 0, 'Subpixel shadows use the fast hard edge');
assert.ok(globeCoverage(edge, [1, 0, 0], 0, angle, 10000) > 0.2, 'Zoom resolves the penumbra');
console.log('Saturn finite-Sun shadows: disk integration, flattening, equinox and zoom thresholds passed');
