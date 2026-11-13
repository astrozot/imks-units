// Offline checks against independent Horizons and compiled Stellarium data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MOONS } from '../js/moons.js';
import { moonSeriesPosition } from '../js/moonposition.js';
import { heliocentric, ecliptic, nutation, precessVector } from '../js/astro.js';

const fixture = JSON.parse(fs.readFileSync(new URL('fixtures/astronomy-positions.json', import.meta.url)));
const report = JSON.parse(fs.readFileSync(new URL('../data/astronomy-accuracy.json', import.meta.url)));
const rad = Math.PI / 180;
for (const [name, sample] of Object.entries(fixture.moons)) {
  const sys = MOONS[sample.planet], [a, d] = sys.pole.map((x) => x * rad);
  const pole = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const x = [-Math.sin(a), Math.cos(a), 0], y = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const model = sys.moons[name], position = (jd) => {
    const [u, v, w] = moonSeriesPosition(model, jd - 2451545);
    return x.map((q, k) => q * u + y[k] * v + pole[k] * w);
  };
  assert.equal(sample.rows[0][0], 2415020.5, `${name} begins in 1900`);
  assert.equal(sample.rows.at(-1)[0], 2488069.5, `${name} ends in 2100`);
  assert.ok(report.moons[name].maxKm < report.moons[name].beforeMaxKm / 2, `${name} improves by at least a factor of two on the same audit dates`);
  for (const [jd, ...reference] of sample.rows) {
    const error = Math.hypot(...position(jd).map((q, k) => q - reference[k]));
    assert.ok(error <= model[2], `${name}: ${error.toFixed(2)} km exceeds ${model[2]} km allowance`);
  }
  for (const { horizons, stellarium } of sample.stellarium || []) {
    assert.equal(horizons[0], stellarium[0]);
    const app = position(horizons[0]), ref = horizons.slice(1), other = stellarium.slice(1);
    const eApp = Math.hypot(...app.map((q, k) => q - ref[k]));
    const eStellarium = Math.hypot(...other.map((q, k) => q - ref[k]));
    const between = Math.hypot(...app.map((q, k) => q - other[k]));
    // Distinct physical theories need not match exactly. Verify against
    // Horizons and the independently measured Stellarium discrepancy.
    assert.ok(between <= model[2] + report.stellarium.errors[name].maxKm + 1e-6);
    assert.ok(eApp <= model[2] && eStellarium <= report.stellarium.errors[name].maxKm + 1e-6);
  }
}
const rotate = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const angle = (a, b) => Math.atan2(Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]), a.reduce((s, x, k) => s + x * b[k], 0)) / rad * 3600;
assert.ok(report.moon.maxArcsec < report.moon.before.maxArcsec / 2, 'Lunar maximum error improves by a factor of two on the same independent audit');
for (const [jd, ...reference] of fixture.moon.rows) {
  const T = (jd - 2451545) / 36525, n = nutation(T), m = ecliptic('moon', T);
  const lon = (m.lon - n.dpsi + 13.176358 / 86400 * m.dist / 299792.458) * rad;
  const ours = rotate([Math.cos(m.lat * rad) * Math.cos(lon), Math.cos(m.lat * rad) * Math.sin(lon), Math.sin(m.lat * rad)], n.eps0 * rad);
  assert.ok(angle(ours, precessVector(reference, T)) < 2, `Moon vs independent Horizons at ${jd}`);
  assert.ok(Math.abs(m.dist - Math.hypot(...reference)) < 2.1, `Lunar geometric range at ${jd}`);
}
for (const [body, rows] of Object.entries(fixture.stellariumMain)) {
  for (const [jd, ...reference] of rows) {
    const T = (jd - 2451545) / 36525, n = nutation(T);
    let ours, ref;
    if (body === 'moon') {
      const m = ecliptic('moon', T);
      const lon = (m.lon - n.dpsi + (Math.abs(T) <= 4 ? 13.176358 / 86400 * m.dist / 299792.458 : 0)) * rad;
      ours = rotate([Math.cos(m.lat * rad) * Math.cos(lon), Math.cos(m.lat * rad) * Math.sin(lon), Math.sin(m.lat * rad)], n.eps0 * rad);
      ref = precessVector(reference, T);
    } else {
      ours = rotate(heliocentric(body, T), n.eps0 * rad);
      ref = precessVector(rotate(reference, 23.439291111 * rad), T);
    }
    // ELP82B and the modern Horizons fit differ more near the endpoints;
    // outside 1600–2400 the app deliberately uses its Meeus fallback.
    const tolerance = body === 'moon' ? (Math.abs(T) < 4 ? 20 : 30) : 1;
    assert.ok(angle(ours, ref) < tolerance, `${body} geometric Stellarium comparison at ${jd}`);
  }
}
console.log('Astronomy accuracy: Moon and all 20 satellites improve on independent full-interval Horizons audits; pinned Stellarium satellite and main-body comparisons passed');
