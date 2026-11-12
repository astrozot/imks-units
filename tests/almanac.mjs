import assert from 'node:assert/strict';
import { dailyAlmanac, dailyHighlights, meteorShowers } from '../js/almanac.js';
import { skyClock } from '../js/coelumtime.js';
const t = (s) => Date.parse(s) / 1000;
const milan = [45.4642, 9.19, 120];
const d = dailyAlmanac(t('2026-11-12T12:00Z'), milan, 'Europe/Rome');
assert.equal(skyClock(d.sun.rise[0], 'Europe/Rome'), '07:17');
assert.equal(skyClock(d.sun.set[0], 'Europe/Rome'), '16:56');
assert.ok(Math.abs(d.daylight - (d.sun.set[0] - d.sun.rise[0])) < 1);
assert.equal(d.phaseName, 'Waxing crescent');
assert.ok(d.phase.age > 3 && d.phase.age < 3.3);
for (const [date, hours] of [['2026-03-08T12:00Z', 23], ['2026-11-01T12:00Z', 25]]) {
  const day = dailyAlmanac(t(date), [40.7, -74, 0], 'America/New_York');
  assert.equal(day.end - day.start, hours * 3600);
  for (const body of [day.sun, day.moon, day.civil, day.nautical, day.astronomical]) {
    for (const event of [...body.rise, ...body.set]) assert.ok(event >= day.start && event < day.end);
  }
}
const summer = dailyAlmanac(t('2026-06-21T12:00Z'), [78, 15, 0], 'Arctic/Longyearbyen');
assert.equal(summer.daylight, 86400);
assert.deepEqual(summer.sun, { rise: [], set: [] });
const winter = dailyAlmanac(t('2026-12-21T12:00Z'), [78, 15, 0], 'Arctic/Longyearbyen');
assert.equal(winter.daylight, 0);
// A lunar day is longer: some civil days have only one crossing.
let missing = false;
for (let i = 1; i <= 31; i++) {
  const day = dailyAlmanac(t(`2026-01-${String(i).padStart(2, '0')}T12:00Z`), milan, 'Europe/Rome');
  if (!day.moon.rise.length || !day.moon.set.length) missing = true;
}
assert.ok(missing);
for (const [date, pattern] of [['2026-08-12T12:00Z', /solar eclipse/], ['2026-03-03T12:00Z', /lunar eclipse/], ['2026-12-21T12:00Z', /December solstice/], ['2026-11-09T12:00Z', /New Moon/]]) {
  const day = dailyAlmanac(t(date), milan, 'UTC');
  const events = await dailyHighlights(day.start, day.end);
  assert.ok(events.some((e) => pattern.test(e.name)), date);
  for (const e of events) assert.ok(e.t >= day.start && e.t < day.end);
}
assert.ok(meteorShowers(t('2026-12-31T12:00Z'), 'UTC').some((s) => s.name === 'Quadrantids'));
assert.ok(meteorShowers(t('2026-01-01T12:00Z'), 'UTC').some((s) => s.name === 'Quadrantids'));
assert.equal(meteorShowers(t('2026-03-01T12:00Z'), 'UTC').length, 0);
console.log('Almanac: civil days, polar daylight, Moon crossings, phases, eclipses, seasons and meteor windows passed');

// Independent IMO published maxima: correct J2000 frame, leap-year and
// calendar drift. Agreement within 30 min of the rounded published times.
import { meteorPeak } from '../js/meteors.js';
for (const [year, longitude, expected] of [
  [2026, 283.15, '2026-01-03T21:00Z'],
  [2026, 140, '2026-08-13T02:00Z'],
  [2026, 235.27, '2026-11-17T23:45Z'],
  [2026, 262.2, '2026-12-14T14:00Z'],
  [2027, 283.15, '2027-01-04T03:25Z'],
  [2027, 262.2, '2027-12-14T20:00Z'],
]) assert.ok(Math.abs(meteorPeak(year, longitude) - t(expected)) < 1800, expected);
const dec = meteorShowers(t('2026-12-31T12:00Z'), 'UTC').find((s) => s.name === 'Quadrantids');
assert.equal(new Date(dec.peak * 1000).getUTCFullYear(), 2027);
assert.deepEqual(meteorShowers(t('0001-01-01T12:00Z'), 'UTC'), []);
console.log('Meteor peaks match independent IMO 2026/2027 predictions');
