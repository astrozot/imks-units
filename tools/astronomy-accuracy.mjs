// Build the reproducible error budget and compact offline reference fixture:
// node tools/astronomy-accuracy.mjs <Horizons-cache>
// Requires tools/moons.mjs --audit and tools/stellarium-check.py first.
import fs from 'node:fs';
import { MOONS } from '../js/moons.js';
import { moonSeriesPosition } from '../js/moonposition.js';
import { frame, J0, J1 } from './moons.mjs';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node tools/astronomy-accuracy.mjs <Horizons-cache>');
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}`, 'utf8'));
const systems = read('systems.json'), baseline = read('moons-baseline-series.json');
const stellarium = read('stellarium-comparison.json'), stellariumPositions = read('stellarium-positions.json');
const fixture = { source: 'JPL Horizons geometric ICRF vectors, planet-centered, km, TT Julian days; independent of fitting data', moons: {} };
const report = { interval: [1900, 2100], samplesPerMoon: 1002, method: 'Independent stratified audit plus endpoints; 25-year coverage bins. Maxima are sampled, not guaranteed bounds. Working allowances include a 25% margin over training/validation/audit maxima.', moons: {}, stellarium };
const icrf = (model, axes, jd) => {
  const p = moonSeriesPosition(model, jd - 2451545);
  return [0, 1, 2].map((k) => p.reduce((sum, x, j) => sum + x * axes[j][k], 0));
};
for (const [planet, sys] of Object.entries(systems)) {
  const axes = frame(sys.pole);
  for (const [name, [id]] of Object.entries(sys.moons)) {
    const rows = read(`${id}-audit-v1.json`), model = MOONS[planet].moons[name];
    const errors = rows.map(([jd, ...r]) => Math.hypot(...icrf(model, axes, jd).map((x, k) => x - r[k])));
    const old = rows.map(([jd, ...r]) => Math.hypot(...icrf(baseline[planet].moons[name], axes, jd).map((x, k) => x - r[k])));
    const indices = new Set([0, rows.length - 1]);
    const bins = [];
    for (let k = 0; k < 8; k++) {
      const within = rows.map((r, i) => [r, i]).filter(([r]) => Math.min(7, Math.floor(8 * (r[0] - J0) / (J1 - J0))) === k).map(([, i]) => i);
      const worst = within.reduce((a, b) => errors[a] > errors[b] ? a : b), worstOld = within.reduce((a, b) => old[a] > old[b] ? a : b);
      indices.add(worst); indices.add(worstOld);
      bins.push(errors[worst]);
    }
    report.moons[name] = { planet, beforeMaxKm: Math.max(...old), maxKm: Math.max(...errors), rmsKm: Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / rows.length), allowanceKm: model[2], binsKm: bins };
    const selected = [...indices].sort((a, b) => a - b).map((i) => rows[i]);
    fixture.moons[name] = { planet, rows: selected };
    if (stellariumPositions[name]) {
      const tests = read(`${id}-test-v2.json`);
      fixture.moons[name].stellarium = Array.from({ length: 9 }, (_, i) => {
        const index = Math.round((tests.length - 1) * i / 8);
        return { horizons: tests[index], stellarium: stellariumPositions[name][index] };
      });
    }
  }
}
fixture.stellariumCommit = stellarium.commit;
fixture.stellariumMain = read('stellarium-main-positions.json');
if (process.argv[3]) {
  const lunar = process.argv[3], load = (file) => JSON.parse(fs.readFileSync(`${lunar}/${file}`, 'utf8'));
  const audit = load('moon-audit.json'), fit = load('moon-refined-validation.json'), rows = load('moon-audit-v1.json');
  const selected = new Set([0, rows.length - 1]);
  for (let c = 0; c < 8; c++) {
    const indices = audit.errors.map((e, i) => [e, i]).filter(([e]) => Math.min(7, Math.floor((e.jd - 2305447.5) / (2597641.5 - 2305447.5) * 8)) === c).map(([, i]) => i);
    selected.add(indices.reduce((a, b) => audit.errors[a].arcsec > audit.errors[b].arcsec ? a : b));
    selected.add(indices.reduce((a, b) => audit.errors[a].distanceKm > audit.errors[b].distanceKm ? a : b));
  }
  fixture.moon = { source: 'JPL Horizons geocentric geometric ICRF vectors, km, TT Julian days', rows: [...selected].sort((a, b) => a - b).map((i) => rows[i]) };
  report.moon = { interval: [1600, 2400], samples: audit.samples, before: fit.beforeAudit,
    maxArcsec: audit.maxArcsec, rmsArcsec: audit.rmsArcsec, maxDistanceKm: audit.maxDistanceKm, validation: fit.validation,
    limitations: 'Sampled ephemeris errors; apparent-position reduction, Earth rotation, lunar limb terrain and adopted radii also affect contacts. Training begins in 1601; audit explicitly includes 1600 and 2400.' };
}
fs.writeFileSync(new URL('../data/astronomy-accuracy.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(new URL('../tests/fixtures/astronomy-positions.json', import.meta.url), JSON.stringify(fixture) + '\n');
console.log('Wrote independent error budget and regression references for all 20 moons, plus Stellarium main-body comparisons');
