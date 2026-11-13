// Independent ERFA reductions, large-catalog culling and playback parity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { horizontal, topocentric, equatorial, centuries, solarDeflection, solarDeflectionState } from '../js/astro.js';
import { skyFrame, createSkyAnimator, horizontalVector, eachFaint, setFaintStars, findObject, pointVector, objectDetails } from '../js/coelum.js';

const reference = JSON.parse(fs.readFileSync(new URL('fixtures/stellar-positions.json', import.meta.url)));
const arcsec = 180 / Math.PI * 3600;
const vector = (p) => horizontalVector(p.alt, p.az);
const difference = (a, b) => a.map((x, i) => x - b[i]);
const separation = (a, b) => 2 * Math.asin(Math.min(1, Math.hypot(...difference(a, b)) / 2)) * arcsec;
const frames = new Map();
const frameAt = (r) => {
  const key = JSON.stringify([r.t, r.place]);
  if (!frames.has(key)) frames.set(key, skyFrame(r.t, r.place));
  return frames.get(key);
};
let maximum = 0, diurnalMaximum = 0;
for (const r of reference.rows) {
  const s = r.star, frame = frameAt(r), p = frame.apparentCatalog(s.ra, s.dec, s.pmra, s.pmdec, s.plx);
  const compact = horizontal(s, r.t, r.place);
  // The compact engine retains truncated nutation, historical precession,
  // heliocentric Earth velocity and first-order aberration. This is an accuracy
  // allowance against a distinct full model, not a subarcsecond guarantee.
  const error = separation(vector(p), vector(r));
  maximum = Math.max(maximum, error);
  assert.ok(error < 0.2, `Full ERFA reduction: ${error} arcsec at ${r.t}`);
  assert.ok(separation(vector(compact), vector(r)) < 0.2);
  assert.ok(separation(vector(p), vector(compact)) < 0.001, 'Drawing and calculator agree with zero radial velocity');
  if (s.ra === 90 && s.plx === 768) {
    const zero = reference.rows.find((q) => q.t === r.t && JSON.stringify(q.place) === JSON.stringify(r.place) && q.star.ra === 90 && q.star.plx === 0);
    const unshifted = frame.apparentCatalog(90, 45);
    const actual = difference(vector(p), vector(unshifted)), expected = difference(vector(r), vector(zero));
    // The compact model uses heliocentric rather than barycentric Earth
    // position; the Sun's barycentric displacement contributes a few mas.
    assert.ok(Math.hypot(...difference(actual, expected)) * arcsec < 0.01, 'Annual parallax agrees independently with ERFA');
  }
}
for (const r of reference.diurnal) {
  const p = horizontal(r.star, r.t, r.place), error = separation(vector(p), vector(r));
  diurnalMaximum = Math.max(diurnalMaximum, error);
  assert.ok(error < 0.00001, `Isolated ERFA diurnal aberration: ${error} arcsec`);
}
// The solar correction itself agrees independently with ERFA ldsun, including
// the limb, solar centre, antipode and limiter boundary. Keep vectors finite
// and the angular displacement within the culling allowance.
for (const r of reference.deflection) {
  const state = solarDeflectionState(r.observer), raw = solarDeflection(r.source, state);
  const norm = Math.hypot(...raw), natural = raw.map((x) => x / norm);
  assert.ok(natural.every(Number.isFinite));
  assert.ok(separation(natural, r.natural) < 0.000001, 'Isolated ERFA solar deflection');
  assert.ok(separation(natural, r.source) / arcsec <= state.maxShift * 1.00001, 'Culling margin bounds deflection');
}
{
  const r = reference.rows.find((r) => r.t === Date.parse('2026-03-21T12:00Z') / 1000 && r.star.ra === 0);
  const frame = frameAt(r), p = frame.apparentCatalog(0, 0);
  const html = objectDetails({ ...p, name: 'Near-Sun reference', type: 'star' }, frame);
  assert.match(html, /Solar light deflection/);
  assert.match(html, /0\.9\d{2}″ \(included\)/, 'The detail card reports the included near-Sun offset');
  assert.ok(separation(vector(p), vector(r)) < 0.06, 'The former 0.924 arcsec case improves');
}
// Retain the distance component of catalog space motion (not only its
// angular direction) when converting parallax into a spatial position.
{
  const t = Date.parse('2100-01-01T12:00Z') / 1000, star = { ra: 90, dec: 45, plx: 1000 };
  const delta = equatorial({ ...star, rv: 100 }, t).dist - equatorial(star, t).dist;
  assert.ok(Math.abs(delta / (centuries(t) * 100 * 31557600 * 100) - 1) < 2e-7, 'Radial motion changes stellar distance');
}
// An external precision provider has already applied aberration.
const sentinel = { ra: 1, dec: 2, dist: 3 };
assert.equal(topocentric('mars', 0, [0, 0], { topocentric: () => sentinel }), sentinel);

// One zero-radius tile: the star moves outside its catalog tile solely due
// to aberration/parallax. A tiny cone must still find the displaced star.
const buffer = new ArrayBuffer(60), data = new DataView(buffer);
new Uint8Array(buffer, 0, 4).set([83, 84, 65, 82]);
for (const [offset, value] of [[4, 1], [8, 1], [12, 1], [40, 1]]) data.setUint32(offset, value, true);
data.setFloat32(20, 90, true); data.setFloat32(24, 45, true);
data.setInt16(52, 1200, true); data.setInt16(54, -800, true);
data.setUint16(56, 38400, true); data.setUint8(58, 160);
setFaintStars(buffer);
try {
  const t = Date.parse('2026-06-21T12:00Z') / 1000, place = [45, 9, 120];
  const advance = createSkyAnimator(t, place, { deep: true, constellations: true });
  for (const offset of [0, 30, 3600, 86390, 86430, -600, -90000]) {
    const frame = advance(t + offset), exact = skyFrame(t + offset, place);
    const expected = exact.apparentCatalog(90, 45, 1200, -800, 768), found = [];
    eachFaint(frame, 8, (j, v) => found.push(v), { v: vector(expected), radius: 1e-8 });
    assert.equal(found.length, 1, 'Expanded culling includes displaced stars');
    assert.ok(separation(found[0], vector(expected)) < 0.00001, 'Tiled drawing uses the current observer and matrix');
    const selected = findObject(frame, 'Catalog V8 star 1');
    assert.ok(separation(pointVector(selected), found[0]) < 0.00001, 'Selected coordinates agree with drawn star during playback');
    for (const [i, p] of frame.stars.entries()) {
      // Space motion is cached for a day; allow 0.04 arcsec for the fastest
      // star while requiring the annual/diurnal terms to track playback.
      assert.ok(separation(pointVector(p), pointVector(exact.stars[i])) < 0.04, `Playback star ${p.name} at ${offset}s`);
    }
  }
} finally { setFaintStars(null); }
// Isolate culling caused by solar deflection: no proper motion, parallax or
// aberration can contribute to the margin in this zero-radius tile.
{
  const frame = skyFrame(Date.parse('2026-03-21T12:00Z') / 1000, [45, 9, 120]);
  const e = frame.observer.deflectionJ2000.direction, a = 0.1 * Math.PI / 180;
  const tangent = [-e[1], e[0], 0], norm = Math.hypot(...tangent);
  const source = e.map((x, i) => -x * Math.cos(a) + tangent[i] / norm * Math.sin(a));
  data.setFloat32(20, (Math.atan2(source[1], source[0]) * 180 / Math.PI + 360) % 360, true);
  data.setFloat32(24, Math.asin(source[2]) * 180 / Math.PI, true);
  data.setInt16(52, 0, true); data.setInt16(54, 0, true); data.setUint16(56, 0, true);
  frame.observer.beta.fill(0); frame.observer.betaJ2000.fill(0);
  const p = frame.apparentCatalog(data.getFloat32(20, true), data.getFloat32(24, true)), found = [];
  try {
    setFaintStars(buffer);
    eachFaint(frame, 8, (j, v) => found.push(v), { v: vector(p), radius: 1e-9 });
    assert.equal(found.length, 1, 'Solar deflection alone expands the culling bounds');
    assert.ok(separation(found[0], vector(p)) < 0.00001);
  } finally { setFaintStars(null); }
}
console.log(`Stellar positions: ERFA full-model max ${maximum.toFixed(4)} arcsec; isolated diurnal max ${diurnalMaximum.toFixed(7)} arcsec; parallax, culling, selection and playback passed`);
