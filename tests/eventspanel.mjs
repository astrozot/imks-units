import assert from 'node:assert/strict';
import { moonPhases, planetConjunctions, planetOppositions } from '../js/eventspanel.js';
import { ecliptic, centuries, elongation } from '../js/astro.js';

const start = Date.UTC(2026, 10, 8, 12) / 1000, day = 86400;
const angle = (x) => (x % 360 + 540) % 360 - 180;
const longitude = (body, t) => ecliptic(body, centuries(t)).lon;
const ordered = (list) => list.forEach((e, i) => assert.ok(e.t >= start && (!i || e.t > list[i - 1].t)));
const phases = moonPhases(start, null, 8);
ordered(phases.list);
phases.list.forEach((e, i) => assert.ok(Math.abs(angle(elongation(e.t) - i % 4 * 90)) < 1e-5));
assert.deepEqual([...moonPhases(start, null, 4).list, ...moonPhases(moonPhases(start, null, 4).next, null, 4).list], phases.list);
const oppositions = planetOppositions(start, null, 8);
ordered(oppositions.list);
for (const e of oppositions.list) {
  assert.ok(!['mercury', 'venus', 'moon'].includes(e.body));
  assert.ok(Math.abs(angle(longitude(e.body, e.t) - longitude('sun', e.t) - 180)) < 1e-5);
}
const conjunctions = await planetConjunctions(start, 60 * day, null, {});
ordered(conjunctions);
assert.ok(conjunctions.some((e) => e.body === 'moon'));
assert.ok(conjunctions.some((e) => e.body === 'mars' && e.other === 'jupiter'));
for (const e of conjunctions) {
  assert.ok(e.t < start + 60 * day);
  assert.ok(Math.abs(angle(longitude(e.body, e.t) - longitude(e.other, e.t))) < 1e-5);
}
const split = [...await planetConjunctions(start, 30 * day, null, {}), ...await planetConjunctions(start + 30 * day, 30 * day, null, {})];
assert.equal(split.length, conjunctions.length);
split.forEach((e, i) => assert.ok(e.body === conjunctions[i].body && e.other === conjunctions[i].other && Math.abs(e.t - conjunctions[i].t) < 1));
assert.equal(await planetConjunctions(start, 30 * day, null, { stop: true }), null);
console.log('Event searches passed: phase cycle, longitude residuals, planet pairs, ordering, pagination and cancellation');
