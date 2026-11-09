// Earthlight geometry and flux: node tests/earthshine.mjs
import assert from 'node:assert/strict';
import { equatorial, moonDisk, nextPhase, topocentric } from '../js/astro.js';
import { earthshineBrightness } from '../js/skyview.js';
const rad = Math.PI / 180;
const vector = ({ ra, dec, dist }) => [Math.cos(dec * rad) * Math.cos(ra * rad), Math.cos(dec * rad) * Math.sin(ra * rad), Math.sin(dec * rad)].map((x) => x * dist);
// Independently integrate Lambert reflection over Earth's projected disk.
// The Sun contributes cos(incidence); projected pixel area already includes
// the foreshortening toward the Moon. Normalize by the full-Earth integral.
function reflectedDisk(cosPhase) {
  const sinPhase = Math.sqrt(Math.max(0, 1 - cosPhase ** 2));
  let full = 0, lit = 0;
  const N = 240;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = (i + 0.5) * 2 / N - 1, y = (j + 0.5) * 2 / N - 1;
    if (x * x + y * y >= 1) continue;
    const z = Math.sqrt(1 - x * x - y * y);
    full += z;
    lit += Math.max(0, x * sinPhase + z * cosPhase);
  }
  return lit / full;
}
const start = Date.UTC(2026, 10, 1) / 1000;
const fluxes = [];
for (const phase of [0, 90, 180, 270]) {
  const t = nextPhase(start, phase), M = equatorial('moon', t), S = equatorial('sun', t);
  const disk = moonDisk(t, M), moon = vector(M), sun = vector(S);
  const cosEarthPhase = moon.reduce((sum, x, k) => sum + x * sun[k], 0) / (M.dist * S.dist);
  const dilution = 0.434 * (6371 / M.dist) ** 2 * (Math.hypot(...sun.map((x, k) => x - moon[k])) / S.dist) ** 2;
  assert.ok(Math.abs(disk.earthshine / dilution - reflectedDisk(cosEarthPhase)) < 0.0002, 'Flux matches numerical disk integration');
  assert.ok(disk.earthshine >= 0 && Number.isFinite(disk.earthshine));
  assert.ok(Math.abs(Math.hypot(...disk.earth) - 1) < 1e-12);
  assert.ok(Math.abs(disk.earth[2] - 1) < 1e-12, 'Geocentric observer looks toward Earth');
  // Observer parallax rotates the light direction but cannot change the
  // amount of sunlight Earth reflects toward the Moon.
  const local = moonDisk(t, topocentric('moon', t, [45, 9, 0]));
  assert.equal(local.earthshine, disk.earthshine);
  assert.ok(Math.hypot(local.earth[0], local.earth[1]) > 0.001, 'Earth differs from the surface observer direction');
  fluxes.push(disk.earthshine);
}
assert.ok(fluxes[0] > 100 * fluxes[2], 'Earthlight strongest near new Moon and negligible near full Moon');
assert.equal(earthshineBrightness({ earthshine: 0 }), 0, 'No fixed light on the night side');
assert.equal(earthshineBrightness({}), 0);
assert.ok(Math.abs(earthshineBrightness({ earthshine: fluxes[1] }) / earthshineBrightness({ earthshine: fluxes[0] }) - fluxes[1] / fluxes[0]) < 1e-12, 'Display exposure preserves physical phase ratios');
console.log('Earthshine checks passed: numerical phase integration, inverse-square flux, observer independence and display exposure');
