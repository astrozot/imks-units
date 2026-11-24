import assert from 'node:assert/strict';
import {detailRiseSet} from '../js/detailriseset.js';
import {skyFrame, findObject} from '../js/coelum.js';
import {riseSet} from '../js/astro.js';
import {visibilityIntervals} from '../js/almanac.js';
import {skyDayBounds} from '../js/coelumtime.js';

const time = Date.parse('2026-11-24T12:00Z') / 1000, place = [45, 9, 120];
const [start, end] = skyDayBounds(time, 'Europe/Rome'), frame = skyFrame(time, place);
const noYield = {yieldTask: async () => {}};
for (const [name, body] of [['Sun', 'sun'], ['Moon', 'moon'], ['Mars', 'mars'], ['Sirius', {ra: 101.287, dec: -16.716}]]) {
  const object = findObject(frame, name), result = await detailRiseSet(object, start, end, place, () => 10, noYield);
  for (const [event, rising] of [['rise', true], ['set', false]]) {
    const expected = riseSet(body, start, place, rising);
    if (expected && expected.t < end) {
      assert.equal(result.theoretical[event].length, 1);
      // Sirius reference omits its space motion; permit that small difference.
      assert.ok(Math.abs(result.theoretical[event][0] - expected.t) < (name === 'Sirius' ? 5 : 0.2), `${name} ${event} agrees with the existing solver`);
    }
  }
  if (['Sun', 'Moon', 'Mars'].includes(name)) {
    const expected = visibilityIntervals(body, start, end, place, () => 10);
    for (const event of ['rise', 'set']) assert.ok(Math.abs(result.terrain[event][0] - expected[event][0]) < 0.2, `${name} ${event} agrees with the almanac terrain model`);
  }
  if (name !== 'Mars') assert.ok(result.terrain.rise[0] > result.theoretical.rise[0], 'Elevated eastern skyline delays rising');
  assert.ok(result.terrain.set[0] < result.theoretical.set[0], 'Elevated western skyline advances setting');
}
for (const name of ['M31', 'Ceres', 'Io', 'Polaris']) {
  const object = findObject(frame, name);
  assert.ok(object, name);
  const result = await detailRiseSet(object, start, end, place, () => 10, noYield);
  for (const events of [result.theoretical, result.terrain]) {
    assert.ok([...events.rise, ...events.set].every(t => t >= start && t < end));
  }
  if (name === 'Polaris') {
    assert.equal(result.theoretical.above, true);
    assert.deepEqual(result.theoretical.set, []);
  } else assert.ok(result.theoretical.rise.length && result.theoretical.set.length, name);
}
// Several ridges can hide and reveal an object repeatedly in one day.
const synthetic = {position: (object, t) => ({alt: 5, az: (t - start) / (end - start) * 360}), ...noYield};
const ridges = await detailRiseSet({}, start, end, place, az => 5 + 3 * Math.cos(az * Math.PI / 60), synthetic);
assert.equal(ridges.terrain.rise.length, 3);
assert.equal(ridges.terrain.set.length, 3);
assert.deepEqual(ridges.theoretical.rise, []);
assert.equal(ridges.theoretical.above, true);
for (const [alt, above] of [[40, true], [-40, false]]) {
  const result = await detailRiseSet({}, start, end, place, null, {...noYield, position: () => ({alt, az: 0})});
  assert.equal(result.terrain, null);
  assert.equal(result.theoretical.above, above);
  assert.deepEqual(result.theoretical.rise, []);
  assert.deepEqual(result.theoretical.set, []);
}
const controller = new AbortController();
await assert.rejects(detailRiseSet({}, start, end, place, null, {...synthetic, signal: controller.signal, yieldTask: async () => controller.abort()}), {name: 'AbortError'});
const dst = skyDayBounds(Date.parse('2026-10-25T12:00Z') / 1000, 'Europe/Rome');
assert.equal(dst[1] - dst[0], 25 * 3600, 'Scans the entire local civil day across DST');
console.log('Detail rise/set: standard and terrain agreement, ridge crossings, polar states, cancellation and DST passed');
