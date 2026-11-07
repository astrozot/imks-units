// Geometry and calculator integration: node tests/coelum.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCalculator } from '../js/defs.js';
import { skyFrame, createSkyAnimator, skyChart, projectSky, unprojectSky, rotateSky, SKY_IDENTITY, objectDetails, coelumPreview } from '../js/coelum.js';
import { horizontal, siderealTime } from '../js/astro.js';
import { STARS } from '../js/catalog.js';
import { CHART_STARS, CONSTELLATIONS } from '../js/skydata.js';
const window = {};
new Function('window', fs.readFileSync(new URL('../js/data.js', import.meta.url), 'utf8'))(window);
const { calc, errors } = createCalculator({ constants: window.IMKS_DATA.constants });
assert.deepEqual(errors, []);
const run = (s) => { const r = calc.run(s); assert.equal(r.kind, 'value', r.message); return r.q; };
const model = run('coelum(2026.11.06 21:00 Z, "Rome")');
assert.equal(model.rows.length, 9);
assert.deepEqual(model.heads, ['altitude', 'azimuth']);
assert.equal(model.coelum.label, 'Rome');
assert.equal(JSON.stringify(model.coelum).length < 150, true, 'History keeps a small descriptor');
assert.equal(calc.run('coelum(1, "Rome")').kind, 'error');
assert.equal(calc.run('coelum(now)').kind, 'error', 'Location is required without Settings');
assert.equal(calc.run('coelum(now, (91, 0) deg)').kind, 'error');
assert.equal(calc.run('coelum(3001.01.01 00:00 Z, "Rome")').kind, 'error');
calc.env.location = [-33.9, 151.2, 50];
assert.deepEqual(run('coelum(now)').coelum.place, calc.env.location);
assert.deepEqual(run('coelum(now, (45, 9) deg)').coelum.place, [45, 9, 0]);
assert.ok(CHART_STARS.length > 5000);
assert.equal(new Set(CONSTELLATIONS.map((c) => c[0])).size, 88);
{ const zenith = projectSky(90, 0); assert.deepEqual([zenith.x, zenith.y], [-0, -0]); }
assert.ok(projectSky(0, 90).x < -0.999, 'East is left');
assert.ok(projectSky(0, 0).y < -0.999, 'North is up');
assert.ok(projectSky(0, 180).y > 0.999, 'South is down');
assert.ok(projectSky(0, 270).x > 0.999, 'West is right');
// Projection and inverse agree after rotations through both hemispheres.
let rotation = [...SKY_IDENTITY];
for (let i = 0; i < 250; i++) {
  rotation = rotateSky(rotation, [0, 0, 1], unprojectSky(0.13, -0.09));
  for (const [alt, az] of [[80, 10], [-70, 230], [0, 100]]) {
    const p = projectSky(alt, az, rotation), v = unprojectSky(p.x, p.y, rotation);
    const expected = [Math.cos(alt * Math.PI / 180) * Math.sin(az * Math.PI / 180), Math.cos(alt * Math.PI / 180) * Math.cos(az * Math.PI / 180), Math.sin(alt * Math.PI / 180)];
    assert.ok(Math.hypot(...v.map((x, j) => x - expected[j])) < 1e-8, 'Spherical projection is invertible after repeated rolling');
  }
}
const from = unprojectSky(-0.3, 0.2), to = unprojectSky(0.4, -0.5);
const followed = rotateSky(SKY_IDENTITY, from, to);
const anchor = { alt: Math.asin(from[2]) * 180 / Math.PI, az: Math.atan2(from[0], from[1]) * 180 / Math.PI };
const projected = projectSky(anchor.alt, anchor.az, followed);
assert.ok(Math.hypot(projected.x - 0.4, projected.y + 0.5) < 1e-10, 'A grabbed sky direction follows the finger');
const down = rotateSky(SKY_IDENTITY, [0, 0, -1], [0, 0, 1]);
const underground = { name: 'Underground test star', alt: -80, az: 0, mag: 1, type: 'star', bv: 0, named: true };
const fixture = { stars: [underground], bodies: [], deep: [], constellations: [] };
assert.equal(skyChart(fixture, 360, 360, { ground: true }, { rotation: down }).objects.length, 0);
const transparent = skyChart(fixture, 360, 360, { ground: false }, { rotation: down });
assert.equal(transparent.objects.length, 1, 'Ground off reveals below-horizon objects while looking down');
assert.ok(!transparent.svg.includes('class="coelum-ground"'));
const card = objectDetails({ name: 'M31', type: 'galaxy', description: '<Andromeda>', ra: 10.5, dec: 41.2, alt: -10, az: 45, mag: null });
for (const label of ['M31', 'galaxy', 'Right ascension', 'Declination', 'Altitude', 'Azimuth', 'Visual magnitude', 'Not available', 'below the horizon', '&lt;Andromeda&gt;']) assert.ok(card.includes(label));
const angleDiff = (a, b) => Math.abs((a - b + 540) % 360 - 180);
const all = { constellations: true, horizontal: true, equatorial: true, deep: true, labels: true, magnitude: 6 };
for (const t of [Date.UTC(1950, 0, 1), Date.UTC(2026, 10, 6), Date.UTC(2100, 0, 1)].map((t) => t / 1000)) {
  for (const place of [[41.892, 12.511, 20], [-33.9, 151.2, 50], [90, 0, 0], [-90, 0, 0]]) {
    const frame = skyFrame(t, place);
    for (const b of frame.bodies) {
      const h = horizontal(b.body, t, place);
      assert.ok(Math.abs(h.alt - b.alt) < 1e-8, b.name);
      assert.ok(angleDiff(h.az, b.az) < 1e-8, b.name);
    }
    for (const name of ['Sirius', 'Vega', 'Canopus', 'Betelgeuse']) {
      const s = STARS.find((s) => s[0] === name), p = frame.stars.find((s) => s.name === name);
      assert.ok(p, name);
      const h = horizontal({ ra: s[1], dec: s[2], pmra: s[3], pmdec: s[4], plx: s[5], rv: s[6] }, t, place);
      const a = projectSky(h.alt, h.az), b = projectSky(p.alt, p.az);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.0005, `${name} agrees with full engine to a fraction of a pixel`);
    }
    const chart = skyChart(frame, 600, 600, all);
    assert.ok(!/NaN|Infinity|undefined/.test(chart.svg));
    assert.ok(chart.objects.every((o) => o.alt >= 0));
    assert.ok(chart.objects.some((o) => o.type === 'star'));
    assert.ok(chart.svg.includes('0h'), 'Equatorial hour labels');
    const starsOnly = skyChart(frame, 600, 600, { ...all, deep: false, constellations: false, magnitude: 3 });
    assert.ok(starsOnly.objects.every((o) => o.body || o.type === 'star' && o.mag <= 3));
    assert.ok(starsOnly.objects.length < chart.objects.length);
    // Zenith should be at the center independent of location/date.
    const { horizonPoint } = await import('../js/coelum.js');
    assert.ok(horizonPoint(siderealTime(t, place[1]), place[0], place[0], siderealTime(t, place[1])).alt > 89.999);
  }
}
// Cached/interpolated playback agrees with exact calculations, including
// reverse movement, minute boundaries and refreshing the background daily.
const origin = model.coelum.t, advance = createSkyAnimator(origin, model.coelum.place);
for (const offset of [0, 30, 59.5, 60.1, 3600, 86390, 86430, -600]) {
  const live = advance(origin + offset), exact = skyFrame(origin + offset, model.coelum.place);
  for (const [a, b] of [...live.bodies.map((p, i) => [p, exact.bodies[i]]), ...live.stars.filter((p) => p.named).map((p) => [p, exact.stars.find((s) => s.name === p.name)])]) {
    const x = projectSky(a.alt, a.az), y = projectSky(b.alt, b.az);
    assert.ok(Math.hypot(x.x - y.x, x.y - y.y) < 0.00002, `Live ${a.name} at ${offset}s agrees within a fraction of a chart pixel`);
  }
}
assert.match(coelumPreview(model.coelum), /Open interactive sky chart/);
// Jupiter and Mars at the reported local time must both have labels, even
// on a phone and with the optional layers enabled.
for (const place of [[41.892, 12.511, 20], [45.4642, 9.19, 120]]) {
  const f = skyFrame(Date.parse('2026-11-11T02:32:00+01:00') / 1000, place);
  for (const width of [320, 360, 600]) {
    const c = skyChart(f, width, width, { constellations: true, deep: true, horizontal: true, equatorial: true });
    const j = c.hitLabels.find((l) => l.name === 'Jupiter'), m = c.hitLabels.find((l) => l.name === 'Mars');
    assert.ok(j && m, `Both planet labels at width ${width}`);
    assert.ok(!(j.box[0] < m.box[2] && j.box[2] > m.box[0] && j.box[1] < m.box[3] && j.box[3] > m.box[1]), 'Planet labels do not overlap');
  }
}
// Measure the drawn illuminated area independently of the terminator code:
// the visible fraction must be (1 + cos(phase angle)) / 2.
for (const phase of [0, 45, 90, 135, 180]) {
  const frame = { stars: [], deep: [], constellations: [], bodies: [{ body: 'moon', name: 'Moon', alt: 60, az: 180, phase, light: { alt: 60, az: 170 }, color: '#f2eee3' }] };
  const svg = skyChart(frame).svg;
  const d = svg.match(/<path d="([^"]+)Z" fill="#f2eee3"/)[1];
  const points = [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const area = Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - p[1] * q[0]; }, 0)) / 2;
  assert.ok(Math.abs(area / (Math.PI * 49) - (1 + Math.cos(phase * Math.PI / 180)) / 2) < 0.003, `Moon phase ${phase}°`);
}
// Hipparcos flags, search and the realistic view's camera.
{
  const { searchSky, lookAt, findObject } = await import('../js/coelum.js');
  const { BOUNDARIES, MILKY_WAY } = await import('../js/skydata.js');
  const { hillAt } = await import('../js/skyraster.js');
  const f = skyFrame(model.coelum.t, model.coelum.place), star = (n) => f.stars.find((s) => s.name === n);
  assert.ok(star('Mizar').double && star('Albireo').double && star('Castor').double, 'Doubles');
  assert.ok(star('Algol').variable && star('Betelgeuse').variable && !star('Vega').variable && !star('Vega').double, 'Variables');
  assert.ok(f.stars.filter((s) => s.double).length > 200 && f.stars.filter((s) => s.variable).length > 50);
  assert.ok(BOUNDARIES.length > 50 && MILKY_WAY.length === 5);
  assert.ok(f.ecliptic.length > 100 && f.boundaries.length === BOUNDARIES.length);
  assert.equal(searchSky(f, 'saturn')[0].name, 'Saturn');
  assert.equal(searchSky(f, 'M 31')[0].name, 'M31', 'Spaces ignored');
  assert.equal(searchSky(f, 'andromeda galaxy')[0].name, 'M31', 'Aliases');
  assert.ok(searchSky(f, 'andromeda').some((r) => r.name === 'Andromeda' && r.type === 'constellation'));
  assert.equal(searchSky(f, 'betelgeuse')[0].name, 'Betelgeuse');
  assert.equal(searchSky(f, 'ALDÉBARAN')[0].name, 'Aldebaran', 'Accents and case ignored');
  assert.equal(searchSky(f, 'hip 91262')[0].name, 'Vega', 'Catalog numbers');
  assert.deepEqual(searchSky(f, ''), []);
  assert.ok(searchSky(f, 'a').length <= 8);
  assert.equal(findObject(f, 'Orion').type, 'constellation');
  // Looking south at 30°: the view's center is there, the zenith above it,
  // east to the left; the stereographic projection inverts.
  const cam = lookAt(180, 30), c = projectSky(30, 180, cam, true), up = projectSky(60, 180, cam, true), east = projectSky(30, 150, cam, true);
  assert.ok(Math.hypot(c.x, c.y) < 1e-12 && up.y < 0 && Math.abs(up.x) < 1e-12 && east.x < 0);
  const back = unprojectSky(east.x, east.y, cam, true), exp = [Math.cos(30 * Math.PI / 180) * Math.sin(150 * Math.PI / 180), Math.cos(30 * Math.PI / 180) * Math.cos(150 * Math.PI / 180), Math.sin(30 * Math.PI / 180)];
  assert.ok(Math.hypot(...back.map((x, i) => x - exp[i])) < 1e-12);
  for (let az = 0; az < 360; az += 0.37) assert.ok(hillAt(az) >= 0.3 && hillAt(az) < 4, 'Landscape height');
}
// Refraction: about 34′ at the horizon at sea level, less higher up, 1′ at
// 45°, none at the zenith; continuous below the horizon, gone by −10°.
{
  const { refraction, refractVector } = await import('../js/coelum.js');
  const { horizonAt } = await import('../js/skyhorizon.js');
  assert.ok(Math.abs(refraction(0) - 0.483) < 0.01 && refraction(0, 3000) < 0.36 && refraction(0, 3000) > 0.33);
  assert.ok(Math.abs(refraction(45) * 60 - 0.99) < 0.05 && refraction(90) < 1e-6);
  assert.ok(Math.abs(refraction(-3.001) - refraction(-2.999)) < 1e-3 && refraction(-10) === 0 && refraction(-80) === 0);
  for (let a = -2; a < 90; a += 0.5) assert.ok(refraction(a) > refraction(a + 0.5), 'Decreasing with altitude');
  const v = refractVector([0, Math.cos(10 * Math.PI / 180), Math.sin(10 * Math.PI / 180)]);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12 && Math.abs(Math.asin(v[2]) * 180 / Math.PI - 10 - refraction(10)) < 1e-9 && v[0] === 0, 'Raised in altitude only');
  const at = horizonAt(Float32Array.from({ length: 720 }, (_, i) => i / 100));
  assert.ok(Math.abs(at(0.25) - 0.005) < 1e-6 && Math.abs(at(359.75) - 3.595) < 1e-5 && Math.abs(at(-0.25) - at(359.75)) < 1e-6);
}
console.log('Coelum geometry, catalogs and calculator checks passed');
