import assert from 'node:assert/strict';
import { ellipseDistance, limbClearance, moonContactGeometry, contactIntervals } from '../js/moongeometry.js';
import { moonEvents } from '../js/astro.js';
import { dates, J0, J1 } from '../tools/moons.mjs';

// Independent closest-point integration along a projected ellipse.
for (const [x, y] of [[0, 0], [0.2, 0], [0.8, 0], [0.3, 0.4], [0.8, 0.9], [2, 0.2], [1e-9, 0.1]]) {
  let distance = Infinity;
  for (let i = 0; i < 100000; i++) {
    const a = i * 2 * Math.PI / 100000;
    distance = Math.min(distance, Math.hypot(x - Math.cos(a), y - 0.8 * Math.sin(a)));
  }
  assert.ok(Math.abs(Math.abs(ellipseDistance(x, y, 0.8)) - distance) < 1e-5, `Ellipse distance at ${x}, ${y}`);
}
assert.equal(limbClearance([0, 0, 80], [1, 0, 0], [0, 0, 1], 100, 0.2), 0);
assert.ok(Math.abs(limbClearance([0, 100, 0], [1, 0, 0], [0, 0, 1], 100, 0.2)) < 1e-8);

const setup = { observer: [1, 0, 0], light: [1, 0, 0], pole: [0, 0, 1], radius: 1000, flattening: 0, moonRadius: 10, sunDistance: 1e6, sunRadius: 10000 };
// Similar triangles give a projected planet of radius 1010 and a solar
// penumbral expansion of 100 at a moon 10000 km behind it.
for (const [y, boundary] of [[1120, 'eclipsed'], [920, 'eclipsedUmbra'], [900, 'eclipsedFull'], [1010, 'occulted'], [990, 'occultedFull']]) {
  const q = moonContactGeometry({ ...setup, v: [10000, y, 0] });
  assert.ok(Math.abs(q[boundary]) < 1e-7, `${boundary}: ${q[boundary]}`);
}
const eclipse = moonContactGeometry({ ...setup, v: [10000, 1000, 0] });
assert.ok(eclipse.eclipsed < 0 && eclipse.eclipsedUmbra > 0, 'Penumbral-only eclipse');
assert.ok(eclipse.transit > 0 && eclipse.shadow > 0, 'Moon behind planet cannot transit or cast a foreground shadow');
const shadow = moonContactGeometry({ ...setup, v: [-10000, 0, 0] });
assert.ok(shadow.shadow < 0 && shadow.eclipsed > 0);
// A small distant moon can have a penumbra with no umbra at the planet.
const annular = moonContactGeometry({ ...setup, v: [-200000, 0, 0] });
assert.ok(annular.shadow < 0 && annular.shadowUmbra > 0);
// At a 60-degree phase angle the Earth-visible limb reaches y=R cos60
// on the Sun-facing hemisphere. A shadow at y=520 is on the globe but
// invisible; at y=500 its finite footprint straddles the visible limb.
const phase = { ...setup, observer: [0.5, Math.sqrt(3) / 2, 0], sunRadius: 0, sunDistance: 1e9 };
assert.ok(moonContactGeometry({ ...phase, v: [-10000, 520, 0] }).shadow > 0, 'Exclude a shadow hidden behind the Earth-facing limb');
const limbShadow = moonContactGeometry({ ...phase, v: [-10000, 500, 0] });
assert.ok(limbShadow.shadow < 0 && limbShadow.shadowFull > 0, 'Partial visible shadow precedes full footprint');
assert.ok(moonContactGeometry({ ...phase, v: [-10000, 480, 0] }).shadowFull < 0, 'Footprint fully inside visible limb');

// A six-second graze wholly between five-minute samples, plus a normal
// event and an event clipped by the requested interval.
const grazing = contactIntervals((t) => (t - 431) ** 2 - 9, 0, 900);
assert.equal(grazing.length, 1);
assert.ok(Math.abs(grazing[0][0] - 428) < 0.1 && Math.abs(grazing[0][1] - 434) < 0.1);
const earlyGraze = contactIntervals((t) => (t - 10) ** 2 - 1, 0, 300);
assert.ok(Math.abs(earlyGraze[0][0] - 9) < 0.1 && Math.abs(earlyGraze[0][1] - 11) < 0.1, 'Refine the first/last coarse intervals too');
assert.deepEqual(contactIntervals(() => 1, 0, 900), []);
assert.deepEqual(contactIntervals(() => -1, 0, 900), [[0, 900]]);
const ongoing = contactIntervals((t) => t - 500, 100, 900);
assert.ok(ongoing[0][0] === 100 && Math.abs(ongoing[0][1] - 500) < 0.1);

// Regression for the original sorted-then-sliced validation-date bug.
const testDates = dates(8420, 400);
assert.equal(testDates.length, 400);
assert.ok(testDates[0] < J0 + (J1 - J0) / 400);
assert.ok(testDates.at(-1) > J1 - (J1 - J0) / 400);
for (let i = 0; i < 400; i++) assert.ok(testDates[i] >= J0 + i * (J1 - J0) / 400 && testDates[i] < J0 + (i + 1) * (J1 - J0) / 400);

const start = Date.UTC(2026, 10, 1) / 1000;
assert.throws(() => moonEvents('Io', Date.UTC(2200, 0, 1) / 1000), /1900–2100/);
const events = moonEvents('Io', start, 2);
for (const event of events) {
  const [kind, begin, end] = event, c = event.contacts;
  assert.ok(begin < end && event.errors.begin > 0 && event.errors.end > 0);
  for (const x of Object.values(c)) if (x !== null) assert.ok(x >= begin - 0.2 && x <= end + 0.2);
  if (c.C2 !== null) assert.ok(c.C1 <= c.C2 && c.C2 < c.C3 && c.C3 <= c.C4);
  if (kind === 'eclipsed' || kind === 'shadow') assert.ok(c.P1 < c.C1 && c.C4 < c.P4, 'Finite Sun separates penumbra and umbra');
}
const transit = events.find((e) => e[0] === 'transit');
assert.ok(transit.contacts.centerBegin - transit[1] > 90, 'Io limb contacts differ materially from center crossings');
const again = moonEvents('Io', (transit[1] + transit[2]) / 2, 1).find((e) => e[0] === 'transit');
assert.ok(Math.abs(again[1] - transit[1]) < 0.2 && Math.abs(again[2] - transit[2]) < 0.2, 'Ongoing events have stable complete contacts');
console.log('Moon contacts: ellipse integration, finite disks and Sun, penumbra/umbra, short grazes, full-interval validation and ongoing events passed');
