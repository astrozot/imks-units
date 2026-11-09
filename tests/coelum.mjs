// Geometry and calculator integration: node tests/coelum.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCalculator } from '../js/defs.js';
import { PLAYBACK_SPEEDS, stepPlaybackSpeed, formatPlaybackSpeed, playbackBodyVisible, SOLAR_BODIES, lookAt, skyFrame, createSkyAnimator, skyChart, projectSky, unprojectSky, rotateSky, SKY_IDENTITY, objectDetails, coelumPreview, planetMoons, findObject, searchSky, starTemperature } from '../js/coelum.js';
import { horizontal, siderealTime } from '../js/astro.js';
import { STARS } from '../js/catalog.js';
import { CONSTELLATIONS } from '../js/skydata.js';
import { CHART_STARS } from '../js/stardata.js';
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
    for (const b of frame.bodies.filter((o) => o.type !== 'minor planet' && o.type !== 'comet')) {
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
    assert.ok(/>\d+h(\d+m)?</.test(chart.svg) && />-?\d+°</.test(chart.svg), 'Grid labels in hours and degrees');
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
// Speed steps are reversible, including the rounded transitions and limits.
assert.deepEqual(PLAYBACK_SPEEDS.slice(0, 22), [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 240, 480, 900, 1800, 3600, 7200, 14000, 28000]);
for (const [i, speed] of PLAYBACK_SPEEDS.entries()) {
  for (const sign of [1, -1]) {
    assert.equal(stepPlaybackSpeed(sign * speed, true), sign * PLAYBACK_SPEEDS[Math.min(i + 1, PLAYBACK_SPEEDS.length - 1)]);
    assert.equal(stepPlaybackSpeed(sign * speed, false), sign * PLAYBACK_SPEEDS[Math.max(i - 1, 0)]);
  }
}
for (const [rate, label] of [[1, '1×'], [0.025, '0.025×'], [14000, '14k×'], [-28000, '−28k×'], [1800, '1.8k×'], [1.4e6, '1.4M×'], [2.8e9, '2.8G×']]) assert.equal(formatPlaybackSpeed(rate), label);
// Fast bodies disappear before slower ones, in both time directions.
assert.equal(playbackBodyVisible('moon', 27.32 * 86400 - 1), true);
assert.equal(playbackBodyVisible('moon', 27.32 * 86400), false);
assert.equal(playbackBodyVisible('moon', -27.32 * 86400), false);
assert.equal(playbackBodyVisible('sun', 365.256 * 86400 - 1), true);
assert.equal(playbackBodyVisible('sun', 365.256 * 86400), false);
let previous = Infinity;
for (const rate of [60, 3e6, 1e7, 2e7, 6e7, 4e8, 1e9, 3e9, 6e9, 1e11]) {
  for (const sign of [1, -1]) {
    const animate = createSkyAnimator(origin, model.coelum.place, {}, sign * rate);
    for (const offset of [0, sign * 123456]) {
      const frame = animate(origin + offset), names = frame.bodies.filter((o) => !o.hidden).map((o) => o.body);
      assert.deepEqual(names.filter((b) => SOLAR_BODIES.includes(b)), SOLAR_BODIES.filter((b) => playbackBodyVisible(b, rate)));
      assert.ok(names.length <= previous || sign < 0);
      const chart = skyChart(frame, 360, 360);
      assert.ok(!/NaN|Infinity|undefined/.test(chart.svg));
    }
  }
  previous = createSkyAnimator(origin, model.coelum.place, {}, rate)(origin).bodies.filter((o) => !o.hidden).length;
}
// A Sun centered on the chart has no disk, label or hit target above
// the threshold, and returns when slowed/paused, also in reverse.
for (const rate of [0, 365.256 * 86400 - 1, 365.256 * 86400, -365.256 * 86400, 1e11]) {
  const frame = createSkyAnimator(origin, model.coelum.place, {}, rate)(origin);
  const sun = frame.bodies[0];
  const chart = skyChart(frame, 360, 360, { ground: false }, { rotation: lookAt(sun.az, sun.alt), selected: 'Sun' });
  assert.equal(chart.objects.some((o) => o.body === 'sun'), playbackBodyVisible('sun', rate));
  assert.equal(chart.hitLabels.some((o) => o.name === 'Sun'), playbackBodyVisible('sun', rate));
  assert.equal(chart.svg.includes('#ffcf5a'), playbackBodyVisible('sun', rate), 'The selection marker is hidden too');
}
assert.deepEqual(createSkyAnimator(origin, model.coelum.place)(origin).bodies.slice(0, 9).map((o) => o.body), SOLAR_BODIES, 'Normal/paused calculations restore all bodies');
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
{
  // Grids get denser with zoom, only around the view's center, and their
  // points lie on the right circles; labels read in degrees or hours.
  const { skyGrid, starRadius, horizontalVector, pointVector } = await import('../js/coelum.js');
  const f = skyFrame(Date.parse('2026-11-06T21:00:00Z') / 1000, [41.892, 12.511, 20]);
  const center = horizontalVector(30, 180);
  const spacing = (lines) => { const p = lines.filter((l) => l.parallel).map((l) => l.value); return p[1] - p[0]; };
  assert.equal(spacing(skyGrid('horizontal', f, center, 120, 2)), 30);
  assert.equal(spacing(skyGrid('horizontal', f, center, 10, 20)), 5);
  const fine = skyGrid('horizontal', f, center, 1, 400);
  assert.ok(Math.abs(spacing(fine) - 0.25) < 1e-12 && fine.every((l) => l.points.every((p) => Math.abs(p.alt - 30) < 1.01 && Math.abs(p.az - 180) < 1.2)), 'Fine grids stay near the center');
  assert.ok(fine.some((l) => l.label === '30°15′'));
  const eq = skyGrid('equatorial', f, center, 8, 40);
  const meridian = eq.find((l) => !l.parallel), parallel = eq.find((l) => l.parallel);
  assert.match(meridian.label, /^\d+h(\d+m)?$/);
  // Back to RA/Dec of date through the equator's and the pole's directions.
  const axes = [{ ra: 0, dec: 0 }, { ra: 90, dec: 0 }, { ra: 0, dec: 90 }].map((p) => pointVector(f.hor(p)));
  const radec = (p) => {
    const e = axes.map((a) => a.reduce((s, x, i) => s + x * pointVector(p)[i], 0));
    return { ra: (Math.atan2(e[1], e[0]) * 180 / Math.PI + 360) % 360, dec: Math.asin(e[2]) * 180 / Math.PI };
  };
  assert.ok(meridian.points.every((p) => Math.abs(((radec(p).ra - meridian.value + 540) % 360) - 180) < 1e-6), 'Meridians at constant RA');
  assert.ok(parallel.points.every((p) => Math.abs(radec(p).dec - parallel.value) < 1e-6), 'Parallels at constant Dec');
  // Zoomed in, a cluster's bright and faint members keep different sizes.
  assert.ok(starRadius(2.9, 8) / starRadius(6, 8) > 2 && starRadius(6, 8) > starRadius(8, 8) * 1.5, 'Sizes follow the magnitude when zoomed');
  assert.ok(Math.abs(starRadius(-1.4) - starRadius(-1.4, 1)) < 1e-12 && starRadius(0) > starRadius(3) * 2);
}
// Minor planets, planets' moons and the spectrum on a star's card.
{
  const f = skyFrame(Date.UTC(2026, 10, 6, 21) / 1000, [41.892, 12.511, 20]);
  const ceres = f.bodies.find((o) => o.name === 'Ceres'), pluto = f.bodies.find((o) => o.name === 'Pluto');
  assert.equal(ceres.type, 'minor planet');
  assert.ok(ceres.mag > 6 && ceres.mag < 9.5 && pluto.mag > 13.5 && pluto.mag < 15.5, `${ceres.mag} ${pluto.mag}`);
  assert.equal(searchSky(f, 'vesta')[0].name, 'Vesta');
  const jupiter = f.bodies.find((o) => o.body === 'jupiter'), galilean = planetMoons(f, jupiter);
  assert.deepEqual(galilean.map((m) => m.name), ['Io', 'Europa', 'Ganymede', 'Callisto']);
  assert.ok(galilean.every((m) => m.separation < 0.2 && m.mag > 4 && m.mag < 6.5), JSON.stringify(galilean.map((m) => [m.separation, m.mag])));
  assert.ok(galilean[0].separation < 0.05);
  assert.equal(findObject(f, 'Titan').type, 'moon of Saturn');
  assert.equal(searchSky(f, 'titan')[0].name, 'Titan');
  assert.ok(Math.abs(starTemperature(0.65) - 5778) < 30);
  const card = (bv) => objectDetails({ name: 'X', type: 'star', ra: 0, dec: 0, alt: 10, az: 0, mag: 1, bv });
  assert.match(card(0), /type A/); assert.match(card(0.65), /type G/); assert.match(card(1.85), /type M/);
  assert.ok(!objectDetails({ ...galilean[0], ra: 0, dec: 0 }).includes('coelum-spectrum'));
}
// The stars (AT-HYG, tools/stars.mjs): J2000 positions as the calculator's
// catalog (but for Barnard's Star, of 1991 there), proper motions over the
// centuries, designations in search and on the cards.
{
  const { STARS } = await import('../js/catalog.js');
  const R = Math.PI / 180, sep = (a, b) => Math.acos(Math.min(1, Math.sin(a.dec * R) * Math.sin(b.dec * R) + Math.cos(a.dec * R) * Math.cos(b.dec * R) * Math.cos((a.ra - b.ra) * R))) / R;
  const named = new Map(CHART_STARS.filter((s) => s[9]).map((s) => [s[9], s]));
  const off = STARS.filter((s) => named.has(s[0]) && sep({ ra: s[1], dec: s[2] }, { ra: named.get(s[0])[1], dec: named.get(s[0])[2] }) * 3600 > 0.5).map((s) => s[0]);
  assert.ok(named.size > 500 && off.length <= 2 && off.includes("Barnard's Star"), `Positions differ: ${off}`);
  // against the J2000 place without motion, both precessed to 1000
  const barnard = named.get("Barnard's Star"), then = skyFrame(Date.UTC(1000, 0, 1) / 1000, [45, 9, 0]);
  const moved = sep(findObject(then, "Barnard's Star"), then.catalog(barnard[1], barnard[2]));
  assert.ok(Math.abs(moved - Math.hypot(barnard[6], barnard[7]) * 1000 / 3.6e6) < 0.05, `Barnard's Star moved ${moved}°`);
  const f = skyFrame(Date.UTC(2026, 10, 6, 21) / 1000, [41.892, 12.511, 20]);
  for (const q of ['alpha Lyr', 'alf Lyr', 'α Lyr', 'HD 172167', 'HR 7001', 'HIP 91262', '3 Lyr']) assert.equal(searchSky(f, q)[0].name, 'Vega', q);
  assert.equal(searchSky(f, 'alpha Cen')[0].name, 'Rigil Kentaurus');
  assert.equal(searchSky(f, 'mu Her')[0].name, 'μ Her');
  const vega = objectDetails(findObject(f, 'Vega'));
  for (const text of ['α Lyr · 3 Lyr · HD 172167 · HR 7001 · HIP 91262', 'A0V', '130.23 mas', '7.68 pc · 25.0 light years', '349.7 mas a year, toward 35°']) assert.ok(vega.includes(text), text);
  assert.equal(new Set(CHART_STARS.filter((s) => s[9]).map((s) => s[9])).size, named.size, 'Names are unique');
}
// Satellites (satellites.js): the groups of tests/fixtures (2026-11-07/08)
// as CelesTrak gives them; in the sky, with their light, and to the
// calculator by name, alias or "… #NORAD"
{
  const { loadSatellites, satelliteList, findSatellite, satelliteLight } = await import('../js/satellites.js');
  const { setSatellites } = await import('../js/coelum.js');
  const fixture = JSON.parse(fs.readFileSync(new URL('fixtures/celestrak.json', import.meta.url)));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => fixture[new URL(url).searchParams.get('GROUP')] || [] });
  try { await loadSatellites(); } finally { globalThis.fetch = realFetch; }
  const list = satelliteList();
  assert.equal(findSatellite('ISS').norad, 25544);
  assert.equal(findSatellite('Tiangong').norad, 48274);
  assert.equal(findSatellite('NORAD 20580').name, 'HST');
  assert.equal(findSatellite('Poisk').docked, 'ISS (ZARYA)', 'Modules and visiting craft go with their station');
  assert.equal(list.filter((s) => s.docked).length, 11);
  const twin = list.find((s) => /#\d+$/.test(s.name));
  assert.ok(twin && findSatellite(twin.name) === twin, 'Names shared by several are told apart by number');
  // the standard magnitude at 1000 km and a phase angle of 90°; full, 1.24
  // brighter; in the Earth's shadow, unseen
  const sun = [1, 0, 0];
  assert.ok(Math.abs(satelliteLight(2, [0, 7000, 0], [0, 0, 1000], sun).mag - 2) < 1e-9);
  assert.ok(Math.abs(satelliteLight(2, [7000, 0, 0], [-1000, 0, 0], sun).mag - (2 - 2.5 * Math.log10(Math.PI))) < 1e-9);
  assert.equal(satelliteLight(2, [-7000, 0, 0], [-1000, 0, 0], sun).lit, false);
  // passes, by the calculator's names
  for (const name of ['ISS', 'Tiangong', twin.name]) assert.equal(calc.run(`passes("${name}", 2026.11.08 12:00 Z, "Milan")`).kind, 'value', name);
  // in the sky: exact, sunlit or not, with a trail above the horizon
  setSatellites(list);
  const t = Date.parse('2026-11-08T17:30:00Z') / 1000, milan = [45.4642, 9.19, 120];
  const f = skyFrame(t, milan), sats = f.bodies.filter((o) => o.body === 'satellite');
  assert.equal(sats.length, list.length - 11);
  const iss = sats.find((o) => o.name === 'ISS (ZARYA)'), h = horizontal(findSatellite('ISS'), t, milan);
  assert.ok(Math.abs(iss.alt - h.alt) < 0.01 && Math.abs(((iss.az - h.az + 540) % 360) - 180) < 0.01, 'The chart agrees with altaz');
  assert.ok(sats.some((o) => o.lit && Number.isFinite(o.mag)) && sats.some((o) => !o.lit));
  assert.ok(sats.filter((o) => o.alt > 0).every((o) => o.trail.length === 8));
  const animated = createSkyAnimator(t - 30, milan)(t).bodies.find((o) => o.name === 'ISS (ZARYA)');
  assert.ok(Math.abs(animated.alt - iss.alt) < 0.01, 'Exact while playing, not interpolated');
  assert.equal(searchSky(f, 'Zarya')[0].name, 'ISS (ZARYA)');
  assert.ok(objectDetails(iss).includes('NORAD number'));
  assert.ok(skyChart(f, 360, 360, { satellites: true }).objects.some((o) => o.body === 'satellite'));
  assert.equal(skyFrame(t + 60 * 86400, milan).bodies.filter((o) => o.body === 'satellite').length, 0, 'Elements two months old are not used');
  setSatellites([]);
}
// Occultations by the Moon (occultations.js): those seen from Milan in
// two months, as occultation() finds them one by one; anywhere, more
{
  const { lunarOccultations } = await import('../js/occultations.js');
  const { occultation } = await import('../js/astro.js');
  const t0 = Date.parse('2026-11-08T12:00:00Z') / 1000, milan = [45.4642, 9.19, 120];
  const here = await lunarOccultations(t0, 60, milan);
  assert.deepEqual(here.map((x) => x.name), ['52 Sgr', 'ε Ari', 'Taygeta', 'Yunü', '58 Leo']);
  const taygeta = here[2], one = occultation(taygeta.target, 'moon', t0, milan, 1);
  assert.ok(Math.abs(one.first - taygeta.e.first) < 1 && Math.abs(one.last - taygeta.e.last) < 1, 'As occultation() finds it');
  assert.ok(taygeta.in.seen && taygeta.out.seen && taygeta.in.alt > 55 && taygeta.in.sun < -60);
  assert.equal(here[1].in.seen, false, 'ε Ari disappears in twilight');
  const anywhere = await lunarOccultations(t0, 30, null);
  assert.ok(anywhere.length > 30 && anywhere.some((x) => x.name === 'Antares'), 'The Antares series');
  assert.ok(anywhere.every((x, i) => !i || anywhere[i - 1].t <= x.t));
}
// The Earth's shadow on the Moon (the sky view draws it): in the umbra at
// the total eclipse of 2029-12-20 (umbral magnitude 1.12), halfway in at
// 21:20 UTC, none at the full moon of 2026-11-24 (no eclipse); the
// animator gives it too
{
  const milan = [45.4642, 9.19, 120], at = (iso) => skyFrame(Date.parse(iso) / 1000, milan).bodies[1].shadow;
  const total = at('2029-12-20T22:42:00Z'), partial = at('2029-12-20T21:20:00Z');
  assert.ok(total && total.d + 1 < total.umbra, `Total: ${JSON.stringify(total)}`);
  assert.ok(total.umbra > 2.4 && total.umbra < 2.9 && total.penumbra > 4.4 && total.penumbra < 4.9, 'Umbra and penumbra about 2.6 and 4.6 Moon radii');
  assert.ok(partial && Math.abs(partial.d - partial.umbra) < 0.7, `Partial: ${JSON.stringify(partial)}`);
  assert.equal(at('2026-11-24T15:00:00Z'), null);
  const t = Date.parse('2029-12-20T22:42:00Z') / 1000, live = createSkyAnimator(t, milan, {})(t + 30).bodies[1].shadow;
  assert.ok(live && live.d + 1 < live.umbra);
}


// Animation labels retain a collision-free side after a neighbor moves away.
// Small motions around a collision boundary must not make them switch back.
{
  const { placeLabels, gridLabelAt } = await import('../js/coelum.js');
  const history = new Map();
  const layout = (block) => {
    let position;
    placeLabels([{ name: 'Alcyone', x: 100, y: 100, r: 2, priority: 2 }], {
      W: 400, H: 300, size: 14, history,
      symbols: block ? [{ x: 125, y: 82, radius: 5 }] : [],
      draw: (_, x, y) => { position = [x, y]; },
    });
    return position;
  };
  const displaced = layout(true);
  assert.ok(displaced[1] > 100);
  for (let i = 0; i < 40; i++) assert.deepEqual(layout(i % 2 === 0), displaced, 'No alternating sides at a collision');
  // A real obstruction still forces a new placement.
  let moved;
  placeLabels([{ name: 'Alcyone', x: 100, y: 100, r: 2, priority: 2 }], {
    W: 400, H: 300, size: 14, history, symbols: [{ x: 125, y: 118, radius: 5 }],
    draw: (_, x, y) => { moved = [x, y]; },
  });
  assert.ok(moved && moved[1] < 100);
  const visible = () => true;
  let previous = null;
  for (let i = 0; i < 40; i++) {
    const delta = i % 2 ? 0.01 : -0.01;
    // Two branches, each with vertices straddling the label band.
    const points = [{ x: 100, y: 220 + delta }, { x: 110, y: 248 + delta },
      { x: 300, y: 248 - delta }, { x: 310, y: 220 - delta }];
    const q = gridLabelAt({ parallel: false, points }, 400, 300, visible, previous);
    assert.ok(Math.abs(q.y - 234) < 1e-9, 'RA label interpolates to its band');
    assert.ok(q.x < 120, 'RA label stays on the same branch');
    previous = q;
  }
  const q = gridLabelAt({ parallel: true, points: [{ x: -10, y: 80 }, { x: 30, y: 100 }] }, 400, 300, visible);
  assert.equal(q.x, 6, 'Parallel label slides along the viewport edge');
  assert.equal(q.y, 88);
}
console.log('Coelum geometry, catalogs and calculator checks passed');
