import assert from 'node:assert/strict';
import { MountSwitcher } from '../js/mountswitch.js';
import { skyFrame, horizonToGalactic, pointVector, dot3 } from '../js/coelum.js';
const s = new MountSwitcher();
assert.equal(s.next(0), 'equatorial');
assert.equal(s.next(100), 'galactic');
assert.deepEqual(s.pair, ['altaz', 'galactic']);
assert.equal(s.next(4001), 'altaz');
assert.equal(s.next(8002), 'galactic');
// A new fast sequence beginning in GA skips the intermediate AZ.
assert.equal(s.next(12003), 'altaz');
assert.equal(s.next(12103), 'equatorial');
assert.deepEqual(s.pair, ['galactic', 'equatorial']);
assert.equal(s.next(16004), 'galactic');
assert.equal(s.next(20005), 'equatorial');
for (const mode of ['altaz', 'equatorial', 'galactic']) {
  for (const presses of [3, 6, 9]) {
    const c = new MountSwitcher(mode, mode === 'altaz' ? ['galactic', 'altaz'] : ['equatorial', 'galactic']);
    const pair = [...c.pair];
    for (let i = 0; i < presses; i++) c.next(i * 100);
    assert.equal(c.mode, mode, `${presses} fast presses return to ${mode}`);
    assert.deepEqual(c.pair, pair, 'A complete cycle preserves the original pair');
    assert.equal(c.next(10000), pair.find((m) => m !== mode), 'The old pair is still used after the pause');
  }
}
const edge = new MountSwitcher();
assert.equal(edge.next(0), 'equatorial');
assert.equal(edge.next(1000), 'galactic', 'Exactly one second is still a fast sequence');
const slow = new MountSwitcher();
assert.equal(slow.next(0), 'equatorial');
assert.equal(slow.next(1001), 'altaz');
const restored = new MountSwitcher('galactic', ['equatorial', 'galactic']);
assert.equal(restored.next(100), 'equatorial', 'Restoring a mount preserves its pair');
for (const date of ['-001000-06-01T12:00Z', '2000-06-01T12:00Z', '3000-06-01T12:00Z']) {
  for (const place of [[45, 9, 0], [-33, 151, 0]]) {
    let previous;
    for (const hours of [0, 1]) {
      const frame = skyFrame(Date.parse(date) / 1000 + hours * 3600, place), flat = horizonToGalactic(frame);
      const rows = [flat.slice(0, 3), flat.slice(3, 6), flat.slice(6, 9)];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(dot3(rows[i], rows[j]) - (i === j ? 1 : 0)) < 1e-12);
      const pole = pointVector(frame.catalog(192.85948, 27.12825));
      assert.ok(dot3(rows[2], pole) > 1 - 1e-12, 'The mount north is the galactic pole');
      const star = pointVector(frame.catalog(100, 30)), g = rows.map((r) => dot3(r, star));
      if (previous) assert.ok(Math.hypot(...g.map((x, i) => x - previous[i])) < 1e-12, 'A fixed star keeps its galactic direction as time advances');
      previous = g;
    }
  }
}
console.log('Mount checks passed: endpoint pairs, complete fast cycles, the 1-second boundary, persistence and Galactic orientation');
