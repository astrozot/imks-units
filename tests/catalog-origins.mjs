import assert from 'node:assert/strict';
import {skyFrame, createSkyAnimator, findObject, catalogDetailCoordinates, objectDetails} from '../js/coelum.js';

const t = Date.parse('2026-11-24T21:00Z') / 1000, place = [45, 9, 120];
const animator = createSkyAnimator(t, place);
for (const time of [t, t + 86400 * 100]) {
  const frame = animator(time), geoFrame = skyFrame(time, [...place, 'geocentric']);
  for (const name of ['Sirius', 'M31', 'α Centauri barycenter']) {
    const source = findObject(frame, name), before = {...source};
    const geo = catalogDetailCoordinates(source, frame, 'geocentric');
    const expected = findObject(geoFrame, name);
    assert.ok(Math.abs(geo.object.ra - expected.ra) < 1e-10);
    assert.ok(Math.abs(geo.object.dec - expected.dec) < 1e-10);
    const helio = catalogDetailCoordinates(source, frame, 'heliocentric');
    assert.notEqual(helio.object.ra, geo.object.ra);
    assert.equal(helio.frame.observer.deflection.strength, 0);
    assert.deepEqual(helio.frame.observer.beta, [0, 0, 0]);
    assert.ok(Math.hypot(...helio.frame.observer.position) > 0, 'Sun is distinct from the solar system barycentre');
    for (const view of [geo, helio]) {
      const html = objectDetails(view.object, view.frame);
      assert.doesNotMatch(html, /<dt>Altitude|<dt>Azimuth|refraction|below the horizon/);
    }
    assert.doesNotMatch(objectDetails(helio.object, helio.frame), /<dt>Solar light deflection/);
    const local = catalogDetailCoordinates(source, frame, 'topocentric');
    assert.ok(Math.abs(local.object.ra - source.ra) < 1e-10);
    assert.deepEqual(source, before, 'Detail changes leave the chart object unchanged');
    assert.deepEqual(frame.place, place);
  }
}
console.log('Catalog detail origins agree with chart frames and preserve playback and chart state');
