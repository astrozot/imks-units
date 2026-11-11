import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { visualMagnitude, gaiaColour, johnsonColour, j2000 } from '../tools/gaia-photometry.mjs';
import { readStars, setFaintStars, faintCount, faintDepth, skyFrame, findObject, searchSky, eachFaint, objectDetails, lookAt, skyChart, pointVector } from '../js/coelum.js';

assert.equal(visualMagnitude(10, 0), 10.02704);
assert.ok(Math.abs(visualMagnitude(10, 1) - 10.21414) < 1e-12);
assert.ok(Math.abs(visualMagnitude(10, 3) - 11.5397) < 1e-10);
for (const x of [null, NaN, -0.51, 5.01]) assert.equal(visualMagnitude(10, x), null);
for (let bv = -0.5; bv <= 3.5; bv += 0.025) assert.ok(Math.abs(johnsonColour(gaiaColour(bv)) - bv) < 2e-7);
assert.equal(johnsonColour(6), null);
assert.deepEqual(j2000(25, -30, 0, 0).map((x) => Math.round(x * 1e8) / 1e8), [25, -30]);
const moved = j2000(0, 0, 1000, 0);
assert.ok(Math.abs(((moved[0] + 180) % 360 - 180) * 3600 + 16) < 1e-6, '2016 -> 2000 subtracts 16 years of proper motion');
assert.ok(j2000(10, 89.999, 1000, 1000).every(Number.isFinite), 'Finite propagation across a pole');

const bytes = (path) => { const b = fs.readFileSync(new URL(path, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const frame = skyFrame(Date.UTC(2026, 10, 11) / 1000, [45, 9, 0]);
// IDs beyond JS's exact integer range must survive loading and search,
// including two adjacent values which would round to the same Number.
{
  const fixture = new ArrayBuffer(68), data = new DataView(fixture), id = 6917529027641081857n;
  new Uint8Array(fixture, 0, 4).set([83, 84, 65, 82]);
  for (const [o, v] of [[4, 2], [8, 1], [12, 1], [40, 1]]) data.setUint32(o, v, true);
  data.setFloat32(28, 3, true); data.setFloat32(32, 3, true);
  data.setUint8(58, 240); data.setInt8(59, 30); data.setBigUint64(60, id, true);
  setFaintStars(fixture);
  assert.equal(findObject(frame, `Gaia DR3 ${id}`).name, `Gaia DR3 ${id}`);
  assert.equal(findObject(frame, `Gaia DR3 ${id - 1n}`), null);
  assert.equal(searchSky(frame, `gaia dr3 ${id}`)[0].name, `Gaia DR3 ${id}`);
  assert.equal(faintDepth(), 12);
  assert.throws(() => readStars(fixture.slice(0, -1)), /incomplete/);
}
for (const depth of [8, 10, 11]) {
  const b = bytes(`../data/stars-${depth}.bin`);
  setFaintStars(b); assert.equal(faintDepth(), depth);
  assert.throws(() => readStars(b.slice(0, -4)), /incomplete/);
}
setFaintStars(bytes('../data/stars-11.bin'));
const oldStar = findObject(frame, 'HIP 439');
const b = bytes('../data/stars-12.bin'), start = performance.now(), catalog = readStars(b), readMs = performance.now() - start;
setFaintStars(b);
assert.equal(faintDepth(), 12);
assert.ok(faintCount() > 936502);
assert.equal(b.byteLength, 24 + 20 * catalog.T + 24 * catalog.n + 8 * catalog.alias.length);
assert.deepEqual(findObject(frame, 'HIP 439'), { ...oldStar, estimatedPhotometry: false }, 'Retained identifiers and astrometry');
const { gaia } = catalog;
let index = -1, added = 0;
for (let t = 0; t < catalog.T; t++) {
  for (let j = catalog.start[t]; j < catalog.start[t + 1]; j++) {
    assert.ok(catalog.mag[j] <= 240, 'No stars beyond V12');
    if (j > catalog.start[t]) assert.ok(catalog.mag[j] >= catalog.mag[j - 1], 'Tiles sorted brightest first');
    if (gaia[2 * j] || gaia[2 * j + 1]) { added++; if (catalog.mag[j] > 220 && index < 0) index = j; }
  }
}
assert.ok(added > 100000 && index >= 0);
const id = (BigInt(gaia[2 * index + 1]) << 32n) + BigInt(gaia[2 * index]), name = `Gaia DR3 ${id}`;
const star = findObject(frame, name);
assert.ok(star && star.mag > 11 && star.mag <= 12 && star.estimatedPhotometry);
assert.ok([star.name, ...star.designations].includes(name), 'Full 64-bit ID preserved');
assert.equal(searchSky(frame, `gaia dr3 ${id}`)[0].name, star.name);
assert.equal(searchSky(frame, `Gaia ${id}`)[0].name, star.name);
assert.equal(findObject(frame, 'Gaia DR3 0'), null);
assert.match(objectDetails(star), /estimated from Gaia/);
const cone = { v: pointVector(star), radius: 0.025 };
// frame.hor() returns vector on the star; compare tiled selection with a
// brute-force traversal, including tile boundaries and proper motions.
const selected = new Set();
const inside = (v) => v.reduce((n, x, i) => n + x * cone.v[i], 0) > Math.cos(cone.radius);
eachFaint(frame, 12, (j, v) => { if (inside(v)) selected.add(j); }, cone);
const brute = new Set(); eachFaint(frame, 12, (j, v) => { if (inside(v)) brute.add(j); });
assert.deepEqual(selected, brute);
assert.ok(selected.has(index), 'New V11–12 star appears in its sky tile');
const view = { scale: 32, rotation: lookAt(star.az, star.alt) };
const times = [];
let drawn = 0;
for (let i = 0; i < 8; i++) {
  const began = performance.now();
  const chart = skyChart(frame, 390, 844, { magnitude: 12, ground: false, constellations: false, deep: false, labels: false }, view);
  times.push(performance.now() - began); drawn = chart.objects.length;
}
console.log(JSON.stringify({ stars: catalog.n, added, bytes: b.byteLength, readMs, drawn,
  chartMedianMs: times.sort((a, b) => a - b)[4], sample: name }, null, 2));
setFaintStars(null);
console.log('Gaia catalog checks passed');
