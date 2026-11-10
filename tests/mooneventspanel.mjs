import assert from 'node:assert/strict';
import { planetMoonEvents } from '../js/mooneventspanel.js';
import { moons, planetOf } from '../js/astro.js';

const start = Date.UTC(2026, 10, 8, 12) / 1000;
for (const planet of ['mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
  const list = await planetMoonEvents(planet, start, 3);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    assert.equal(planetOf(e.moon), planet);
    assert.ok(e.end > start && e.begin <= start + 3 * 86400);
    assert.ok(e.begin < e.t && e.t < e.end);
    if (i) assert.ok(e.begin >= list[i - 1].begin);
    const state = moons(planet, e.t).moons.find((m) => m.name === e.moon);
    assert.equal(state[e.kind], true, `${e.moon} ${e.kind} at midpoint`);
  }
  if (planet === 'jupiter') {
    assert.ok(list.length > 0);
    const ongoing = await planetMoonEvents(planet, list[0].t);
    assert.ok(ongoing.some((e) => e.moon === list[0].moon && e.kind === list[0].kind && e.begin < list[0].t), 'Include events already underway');
  }
}
assert.deepEqual(await planetMoonEvents('mercury', start), []);
const job = { progress() { this.stop = true; } };
assert.equal(await planetMoonEvents('jupiter', start, 1, job), null);
console.log('Planetary moon events passed: planet ownership, chronology, midpoint states, ongoing events and cancellation');
