import assert from 'node:assert/strict';
import { skyPointHit, nearbySkyObjects } from '../js/coelumsky.js';

const p = { x: 100, y: 100 };
const star = (name, x, mag, limit = 7, radius = 1) =>
  ({ name, x, y: 100, radius, ...skyPointHit(mag, limit, radius) });
const pick = (objects, point = p) => nearbySkyObjects(objects, point)[0]?.o.name;

// Rendered but imperceptible dots must not capture empty-sky clicks.
assert.equal(pick([star('at the limit', 100, 7)]), undefined);
assert.equal(pick([star('low contrast', 100, 6.8)]), undefined);
assert.equal(pick([star('subpixel', 100, 3, 7, 0.4)]), undefined);
assert.equal(pick([star('twilight', 100, 1, 2, 0.55)]), 'twilight');
assert.equal(pick([star('visible', 100, 3)]), 'visible');
assert.equal(pick([star('visible', 110, 3)]), 'visible');
assert.equal(pick([star('visible', 114, 3)]), undefined);
assert.equal(pick([star('visible', 104, 3)]), 'visible');
// Zooming deepens the limit; extinction/sky brightness can reverse that.
assert.equal(pick([star('faint', 100, 8, 8)]), undefined);
assert.equal(pick([star('faint', 100, 8, 11)]), 'faint');
assert.equal(pick([star('extinguished', 100, 10.8, 11)]), undefined);

// Clicking either member of an unresolved binary chooses the brighter star,
// independently of catalogue order. Invisible stars never win by proximity.
const bright = star('primary', 103, 1), faint = star('secondary', 100, 4);
assert.equal(pick([faint, bright]), 'primary');
assert.equal(pick([bright, faint]), 'primary');
assert.equal(pick([bright, star('invisible', 100, 7)]), 'primary');
assert.equal(pick([star('primary', 108, 1, 7, 4), faint]), 'secondary');
assert.equal(pick([star('primary', 105, 1, 7, 4), faint]), 'primary');

// An unresolved planetary moon cannot steal its planet's target. When
// separated, it remains selectable; large disks retain their full extent.
const planet = { ...star('Jupiter', 103, -2, 7, 3), body: 'jupiter', radius: 4 };
const moon = { ...star('Io', 100, 4), planet: 'jupiter', radius: 3 };
assert.equal(pick([moon, planet]), 'Jupiter');
assert.equal(pick([{ ...planet, x: 110 }, moon]), 'Io');
const disk = { name: 'Moon', x: 100, y: 100, radius: 50, ...skyPointHit(-10, 7, 50, true) };
assert.equal(pick([disk], { x: 145, y: 100 }), 'Moon');
assert.equal(skyPointHit(12, 7, 3, true).pickable, true);
assert.equal(skyPointHit(12, 7, 0.4, true).pickable, false);
// Deep-sky and binary-reference symbols are explicit visible targets.
assert.equal(pick([{ name: 'barycenter', ...p, radius: 4 }]), 'barycenter');
console.log('Sky picking visibility and unresolved-object priority passed');
