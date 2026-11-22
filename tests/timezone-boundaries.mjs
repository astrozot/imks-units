import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalTimezone, decodeTimezoneBoundaries } from '../js/timezoneboundaries.js';
const topology = JSON.parse(fs.readFileSync(new URL('../data/timezones.topo.json', import.meta.url), 'utf8'));
const data = decodeTimezoneBoundaries(topology);
assert.equal(data.source.project, 'Timezone Boundary Builder');
assert.equal(data.source.version, '2026f');
assert.equal(data.source.license, 'ODbL-1.0');
assert.ok(data.byZone.size > 400);
for (const [lat, lon, expected] of [
  [45.4642, 9.19, 'Europe/Rome'], [35.68, 139.65, 'Asia/Tokyo'], [40.71, -74.01, 'America/New_York'],
  [43.7384, 7.4246, 'Europe/Monaco'], [22.3193, 114.1694, 'Asia/Hong_Kong'], [22.1987, 113.5439, 'Asia/Macau'],
  [46.345, 48.766, 'Europe/Astrakhan'], // Compressed lookup incorrectly assigns Asia/Atyrau.
  [24.881, 59.984, 'Etc/GMT-4'], // Compressed lookup incorrectly assigns Asia/Tehran.
  [38.012, .082, 'Etc/GMT'], // Offshore, not the compressed lookup's Europe/Madrid.
]) assert.equal(data.lookup(lat, lon), expected, `${lat}, ${lon}`);
// Upstream intentionally allows both national marine claims in the Gulf of Lion.
assert.deepEqual(data.lookupAll(42.4791165, 3.369903005).sort(), ['Europe/Madrid', 'Europe/Paris']);
assert.deepEqual(data.lookupAll(41.1155, 85.1845).sort(), ['Asia/Shanghai', 'Asia/Urumqi']);
assert.equal(data.lookup(NaN, 0), null);
assert.equal(data.lookup(91, 0), null);
assert.equal(data.lookup(0, 181), null);
for (const [zone, point] of data.points) {
  // Upstream intentionally overlaps Asia/Urumqi with Asia/Shanghai.
  const actual = canonicalTimezone(data.lookup(...point));
  assert.ok(actual === zone || zone === 'Asia/Urumqi' && actual === 'Asia/Shanghai', `${zone}: interior point returned ${actual}`);
}
// Shared polygon arcs and holes must not assign an enclave to its neighbour.
const fixture = decodeTimezoneBoundaries({
  transform: { scale: [1, 1], translate: [0, 0] },
  arcs: [
    [[-10, -10], [20, 0], [0, 20], [-20, 0], [0, -20]],
    [[-2, -2], [4, 0], [0, 4], [-4, 0], [0, -4]],
  ],
  objects: { timezones: { geometries: [
    { type: 'Polygon', properties: { tzid: 'outer' }, arcs: [[0], [1]] },
    { type: 'Polygon', properties: { tzid: 'enclave' }, arcs: [[-2]] },
  ] } },
});
assert.equal(fixture.lookup(0, 0), 'enclave');
assert.equal(fixture.lookup(5, 5), 'outer');
assert.equal(fixture.lookup(20, 20), null);
console.log('Geographic timezone polygons: provenance, national/enclave regions, offshore zones, shared arcs, holes, and lookup regressions passed');
