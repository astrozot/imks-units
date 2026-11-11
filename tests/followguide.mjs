import assert from 'node:assert/strict';
import { followGuide } from '../js/followguide.js';
import { lookAt, horizontalVector } from '../js/coelum.js';

for (const stereo of [false, true]) {
  const camera = lookAt(0, 0);
  const guide = (az, alt = 0, radius = 400) => followGuide(horizontalVector(alt, az), camera, 390, 600, radius, stereo);
  const center = guide(0);
  assert.equal(center.acquired, true);
  assert.equal(center.x, 195);
  assert.equal(center.y, 300);
  assert.equal(center.ring, 22);
  assert.ok(guide(10).ring < guide(40).ring, 'Ring shrinks as aim improves');
  assert.ok(guide(90).x > 195, 'East is to the right when facing north');
  assert.ok(guide(270).x < 195, 'West is to the left');
  assert.ok(guide(0, 45).y < 300, 'Higher target points up');
  assert.equal(guide(180).acquired, false, 'Target behind camera is not acquired');
  assert.equal(guide(1, 0, 100000).acquired, false, 'Narrow field still needs an arrow');
  for (const az of [0, 90, 180, 270, 359]) for (const alt of [-90, 0, 90]) {
    const g = guide(az, alt);
    assert.ok(Object.values(g).every(v => typeof v === 'boolean' || Number.isFinite(v)));
    assert.ok(g.x >= g.ring + 29 && g.x <= 390 - g.ring - 29);
    assert.ok(g.y >= g.ring + 29 && g.y <= 600 - g.ring - 29);
  }
  const rolled = [...camera.slice(3, 6), ...camera.slice(0, 3).map(x => -x), ...camera.slice(6)];
  const g = followGuide(horizontalVector(0, 30), rolled, 600, 390, 400, stereo);
  assert.ok(g.y < 195, 'Bearing follows the actual rolled camera');
}
console.log('Follow guide: bearings, roll, shrinking ring, acquisition and antipodes passed');
