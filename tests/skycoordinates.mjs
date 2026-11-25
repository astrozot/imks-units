import assert from 'node:assert/strict';
import { parseSkyCoordinates } from '../js/skycoordinates.js';
import { coordinateTarget, skyFrame, searchSky, pointVector, horizonToJ2000, dot3, vec, R, objectDetails, findObject, galacticCoordinates } from '../js/coelum.js';

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} ≠ ${b}`);
const ra = (1 + 23 / 60 + 45.67 / 3600) * 15, dec = 23 + 32 / 60 + 13.23 / 3600;
for (const query of ['01 23 45.67 +23 32 13.23', '01:23:45.67 +23:32:13.23',
  '01h 23m 45.67s +23d 32m 13.23s', '01h23m45.67s+23°32\'13.23"',
  '01H 23M 45.67S +23° 32′ 13.23″', '01:23:45.67, +23:32:13.23']) {
  const p = parseSkyCoordinates(query);
  assert.equal(p?.system, 'EQ', query); close(p.lon, ra, query); close(p.lat, dec, query);
}
for (const [query, system, lon, lat] of [
  ['01 23.5 -23 32.5', 'EQ', (1 + 23.5 / 60) * 15, -23 - 32.5 / 60],
  ['01 23 +23 32', 'EQ', (1 + 23 / 60) * 15, 23 + 32 / 60],
  ['01h23.5m −00°32.5′', 'EQ', (1 + 23.5 / 60) * 15, -32.5 / 60],
  ['123.45 -23.32', 'EQ', 123.45, -23.32],
  ['123d25m30s +23°32\'13.23"', 'EQ', 123 + 25 / 60 + 30 / 3600, dec],
  ['123°25.5\' -23d32.5m', 'EQ', 123 + 25.5 / 60, -23 - 32.5 / 60],
  ['GA 12.3453 -23.32132', 'GA', 12.3453, -23.32132],
  ['ga 12 25.5 -23 32.5', 'GA', 12 + 25.5 / 60, -23 - 32.5 / 60],
  ['GA 12d25m30s -23d32m13s', 'GA', 12 + 25 / 60 + 30 / 3600, -23 - 32 / 60 - 13 / 3600],
  ['AZ 180 +45', 'AZ', 180, 45], ['az -90:00 +45:30', 'AZ', 270, 45.5],
  ['AZ 180°30′15″ +45d30m', 'AZ', 180.50416666666666, 45.5],
  ['24h 0m 0s -90d', 'EQ', 0, -90], ['360d +90d', 'EQ', 0, 90],
]) {
  const p = parseSkyCoordinates(query);
  assert.equal(p?.system, system, query); close(p.lon, lon, query); close(p.lat, lat, query);
}
for (const query of ['', 'Vega', 'HIP 91262', 'M 31', 'NGC 1234', 'GA', 'AZ 12',
  '01 23 45.67 +123 32 13.23', '25h +20d', '361 -20', 'AZ 10 91', 'GA 10 -91',
  '01:60 +20:00', '01:23:60 -20:00:00', '1.5h 2m +20d', '1h 2.5m 3s +20d',
  'GA 1h +20d', 'AZ 10d +2h', '10 -20 junk', '10 -20 -30', '1 2 3 4 5',
  '1::2 -3:4', '1d 2s -3d', '10,,20', 'NaN 0', 'Infinity 0']) {
  assert.equal(parseSkyCoordinates(query), null, query);
}
// Every supported system and angle notation requires a signed second angle,
// even for zero; the first angle remains optionally signed.
for (const prefix of ['', 'GA ', 'AZ ']) {
  for (const [first, second] of [['12.5', '23.5'], ['12', '0'],
    ['12 25', '23 32'], ['12 25 30', '23 32 15'],
    ['12:25', '23:32'], ['12:25:30', '23:32:15'],
    ['12d25m', '23d32m'], ['12°25′30″', '23°32′15″']]) {
    for (const separator of [' ', ', ']) {
      const unsigned = `${prefix}${first}${separator}${second}`;
      assert.equal(parseSkyCoordinates(unsigned), null, unsigned);
      for (const sign of ['+', '-']) {
        const signed = `${prefix}${first}${separator}${sign}${second}`;
        assert.ok(parseSkyCoordinates(signed), signed);
      }
    }
  }
}
assert.equal(parseSkyCoordinates('01h23m45s 23d32m15s'), null);
// Recover independent J2000 vectors from local targets at multiple dates and
// places, including the Galactic center and pole (standard ICRS directions).
for (const [t, place] of [[Date.parse('2026-11-25T21:00Z') / 1000, [42, 12, 20]],
  [Date.parse('2050-06-01T00:00Z') / 1000, [-34, 151, 0]]]) {
  const frame = skyFrame(t, place), h = horizonToJ2000(frame);
  for (const [query, expected] of [['123.45 -23.32', vec(123.45, -23.32)],
    ['GA 0 +0', [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132]],
    ['GA 0 +90', [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]]]) {
    const target = coordinateTarget(frame, query), local = pointVector(target);
    h.reduce((rows, _, i) => i % 3 ? rows : [...rows, h.slice(i, i + 3)], []).forEach((row, i) => close(dot3(row, local), expected[i], query));
    assert.deepEqual(searchSky(frame, query), [target]);
  }
  const az = coordinateTarget(frame, 'AZ 90 +30');
  close(az.az, 90, 'East'); close(az.alt, 30, 'Altitude');
  close(pointVector(az)[0], Math.cos(30 * R), 'East vector');
  assert.deepEqual(searchSky(frame, 'AZ 90 +30', 0), []);
  assert.equal(searchSky(frame, 'M 31')[0].name, 'M31');
  assert.equal(searchSky(frame, 'HIP 91262')[0].name, 'Vega');
}
console.log('Coordinate formats, validation, frame transforms and catalogue search passed');

const frame = skyFrame(Date.parse('2026-11-25T21:00Z') / 1000, [42, 12, 20]);
const copyRows = (html) => Object.fromEntries([...html.matchAll(/<dt>([^<]+)<\/dt><dd><button[^>]*data-copy-coordinates="([^"]+)"/g)].map((m) => [m[1], m[2]]));
for (const o of [findObject(frame, 'Vega'), findObject(frame, 'M31'), ...frame.bodies,
  { name: 'Test satellite', type: 'satellite', ra: 15, dec: -0.5, alt: -0.25, apparentAlt: 0.125, az: 90, dist: 500, height: 400,
    satellite: { epoch: frame.t, group: 'stations', norad: 1 }, mag: 2, lit: true }]) {
  const rows = copyRows(objectDetails(o, frame));
  const eq = rows['Right ascension (RA)'], ga = rows['Galactic longitude (l)'], az = rows['Azimuth (Az)'];
  assert.equal(eq, rows['Declination (Dec)'], o.name);
  assert.equal(ga, rows['Galactic latitude (b)'], o.name);
  assert.equal(az, rows['Altitude (Alt)'], o.name);
  assert.match(eq, /^\d+h \d+m [\d.]+s [+-]\d+d \d+m [\d.]+s$/, o.name);
  assert.match(ga, /^GA /, o.name); assert.match(az, /^AZ /, o.name);
  const g = galacticCoordinates(o, frame);
  for (const [text, expectedLon, expectedLat] of [[eq, o.ra, o.dec], [ga, g.lon, g.lat], [az, o.az, o.alt]]) {
    const parsed = parseSkyCoordinates(text);
    assert.ok(parsed, text);
    assert.ok(Math.abs(((parsed.lon - expectedLon + 540) % 360) - 180) <= 15 / 7200 + 1e-9, text);
    assert.ok(Math.abs(parsed.lat - expectedLat) <= 1 / 7200 + 1e-9, text);
  }
  if (Number.isFinite(o.apparentAlt)) {
    assert.equal(parseSkyCoordinates(rows['Apparent altitude']).lat, o.apparentAlt);
  }
  const remoteRows = copyRows(objectDetails({ ...o, coordinateOrigin: 'geocentric' }, frame));
  assert.ok(remoteRows['Right ascension (RA)']);
  assert.equal(remoteRows['Altitude (Alt)'], undefined, 'No local coordinates for a remote origin');
}
console.log('Copyable coordinate pairs cover stars, deep sky, solar system bodies and satellites');
