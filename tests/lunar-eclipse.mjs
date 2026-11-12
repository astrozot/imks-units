// node tests/lunar-eclipse.mjs
import assert from 'node:assert/strict';
import { lunarShadowLight, lunarShadowMean, lunarEclipseColor } from '../js/skyview.js';
const shadow = { umbra: 2.6, penumbra: 4.6 };
// Independently trace rays across the Sun, rather than circle-overlap math.
for (const d of [2.6, 2.8, 3.1, 3.6, 4.1, 4.5, 4.6]) {
  let seen = 0, count = 0;
  for (let j = 0; j < 300; j++) for (let i = 0; i < 300; i++) {
    const x = (i + 0.5) / 150 - 1, y = (j + 0.5) / 150 - 1;
    if (x * x + y * y > 1) continue;
    count++;
    if (Math.hypot(d + x, y) > 3.6) seen++;
  }
  // Atmospheric leakage is at most 0.25% of full sunlight.
  assert.ok(Math.abs(lunarShadowLight(shadow, d)[0] - seen / count) < 0.003);
}
for (const boundary of [shadow.umbra, shadow.penumbra]) {
  const a = lunarShadowLight(shadow, boundary - 1e-6), b = lunarShadowLight(shadow, boundary + 1e-6);
  assert.ok(a.every((v, k) => Math.abs(v - b[k]) < 1e-6), 'No discontinuity at shadow contacts');
}
const center = lunarShadowLight(shadow, 0), edge = lunarShadowLight(shadow, 2.5);
assert.ok(center[0] > center[1] * 5 && center[1] > center[2] * 4, 'Umbra is red');
assert.ok(edge[0] > center[0] * 20, 'Atmospheric light fades into the deep umbra');
assert.deepEqual(lunarShadowLight(shadow, 5), [1, 1, 1]);
const total = lunarShadowMean({ ...shadow, d: 0 });
const partial = lunarShadowMean({ ...shadow, d: 2.6 });
const outer = lunarShadowMean({ ...shadow, d: 5.6 });
assert.ok(total.brightness < 0.001 && partial.brightness > 0.03 && partial.brightness < 0.2);
assert.ok(total.exposure > partial.exposure && partial.exposure > outer.exposure);
assert.ok(Math.abs(outer.exposure - 1) < 1e-12);
// Starting/ending an eclipse must not change an otherwise unshadowed pixel.
for (const c of [0, 0.01, 0.2, 0.8, 1]) {
  assert.ok(Math.abs(lunarEclipseColor([c, c, c], [1, 1, 1], 1)[0] - c) < 1e-12);
}
const dark = lunarEclipseColor([0.7, 0.7, 0.7], center, total.exposure);
assert.ok(dark[0] > dark[1] && dark[1] > dark[2] && dark[0] < 0.1);
assert.ok(lunarEclipseColor([0.7, 0.7, 0.7], edge, total.exposure)[0] > dark[0]);
console.log('Lunar eclipse: finite solar disk, continuous contacts, atmospheric colour, disk-integrated flux and exposure passed');
