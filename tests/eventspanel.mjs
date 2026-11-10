import assert from 'node:assert/strict';
import { moonPhases, planetConjunctions, planetOppositions, equinoxesSolstices } from '../js/eventspanel.js';
import { ecliptic, centuries, elongation, horizontal, aspect, solarLongitude } from '../js/astro.js';

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
const place = [45.4642, 9.19, 120];
const local = await planetConjunctions(start, 60 * day, place, {});
const heights = (e, p) => [e.body, e.other].map((b) => horizontal(b, e.t, p).alt);
assert.deepEqual(local.map((e) => e.t), conjunctions.filter((e) => heights(e, place).every((a) => a >= 0)).map((e) => e.t));
assert.ok(local.length < conjunctions.length);
for (const e of local) {
  const alt = heights(e, place);
  assert.ok(Math.abs(e.alt - (alt[0] + alt[1]) / 2) < 1e-10);
}
for (const e of conjunctions) {
  if (e.body === 'moon' || e.other === 'moon') assert.ok(Math.abs(e.lit - (1 + Math.cos(aspect('moon', e.t).phase * Math.PI / 180)) / 2) < 1e-10);
  else assert.equal(e.lit, undefined);
}
// A pair straddling the horizon must be excluded even if its average is positive.
const first = conjunctions[0];
const straddling = Array.from({ length: 360 }, (_, lon) => [45, lon - 180, 0]).find((p) => {
  const a = heights(first, p);
  return Math.min(...a) < 0 && Math.max(...a) > 0 && a[0] + a[1] > 0;
});
assert.ok(straddling);
assert.ok(!(await planetConjunctions(start, 30 * day, straddling, {})).some((e) => e.t === first.t));
assert.deepEqual(moonPhases(start, place, 8), phases, 'Local phases include below-horizon events');
assert.deepEqual(planetOppositions(start, place, 8), oppositions, 'Local oppositions include below-horizon events');
const seasons = equinoxesSolstices(start, null, 8);
ordered(seasons.list);
assert.deepEqual(seasons.list.slice(0, 4).map((e) => e.name), ['December solstice', 'March equinox', 'June solstice', 'September equinox']);
seasons.list.forEach((e, i) => assert.ok(Math.abs(angle(solarLongitude(e.t) - (i + 3) % 4 * 90)) < 0.01));
assert.deepEqual(equinoxesSolstices(start, place, 8), seasons);
const fourSeasons = equinoxesSolstices(start, null, 4);
assert.deepEqual([...fourSeasons.list, ...equinoxesSolstices(fourSeasons.next, null, 4).list], seasons.list);
assert.equal(equinoxesSolstices(Date.UTC(3001, 0, 1) / 1000, null, 4).list.length, 0);
console.log('Event searches passed: phases, local conjunction filtering, average altitude, Moon illumination, oppositions, seasons, pagination and cancellation');
