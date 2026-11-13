// Writes js/moons.js, series for the major moons of Mars, Jupiter, Saturn,
// Uranus and Neptune, fitted to JPL Horizons over 1900 to 2100:
//
//   node tools/moons.mjs <directory>
//   node tools/moons.mjs <directory> --fetch     training + baseline cache
//   node tools/moons.mjs <directory> --validate  shipped series, 402 dates
//   node tools/moons.mjs <directory> --audit     fresh independent 1002 dates
// Refine with tools/refine-moons.py; its fitting dependencies are offline
// development tools, never required by the browser.
//
// The positions of each moon from its planet (geometric, ICRF, km) at
// random dates are fetched once into the directory. In the frame of the
// planet's equator (x, y in it, z to its north pole) the series are
//   x + i y = Σ C exp(i f t),   z = Σ (a cos f t + b sin f t),
// with t in days of TT from J2000 and frequencies f near multiples of the
// mean motion n, found one at a time by scanning the residuals (all the
// amplitudes are fitted again after each new term), until the largest
// error is below a fraction of the planet's radius.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { MOONS } from "../js/moons.js";
import { moonSeriesPosition } from "../js/moonposition.js";

const dir = process.argv[2];

// planet: Horizons id, equatorial radius (km), north pole (J2000, degrees);
// moons: Horizons id and period (days)
const SYSTEMS = {
  mars: { id: 499, radius: 3396.19, pole: [317.68143, 52.8865], moons: { Phobos: [401, 0.31891], Deimos: [402, 1.26244] } },
  jupiter: { id: 599, radius: 71492, pole: [268.056595, 64.495303], moons: { Io: [501, 1.769138], Europa: [502, 3.551181], Ganymede: [503, 7.154553], Callisto: [504, 16.689018] } },
  saturn: {
    id: 699, radius: 60268, pole: [40.589, 83.537],
    moons: { Mimas: [601, 0.942422], Enceladus: [602, 1.370218], Tethys: [603, 1.887802], Dione: [604, 2.736915], Rhea: [605, 4.5175], Titan: [606, 15.945421], Hyperion: [607, 21.276609], Iapetus: [608, 79.330183] },
  },
  uranus: { id: 799, radius: 25559, pole: [257.311, -15.175], moons: { Miranda: [705, 1.413479], Ariel: [701, 2.520379], Umbriel: [702, 4.144177], Titania: [703, 8.705869], Oberon: [704, 13.463237] } },
  neptune: { id: 899, radius: 24764, pole: [299.36, 43.46], moons: { Triton: [801, -5.876854] } },
};
const J0 = 2415020.5, J1 = 2488069.5, SAMPLES = 2400;

// ---------------------------------------------------------------------
// Fetching

// the same random dates for every run
function dates(seed, count = SAMPLES) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  // Stratification covers the whole interval even with a small test set.
  // Never take the first N of an already sorted, larger random set.
  return Array.from({ length: count }, (_, i) => J0 + (J1 - J0) * (i + rnd()) / count);
}

// by the batch interface of Horizons, which takes long lists of dates
async function fetchMoon(id, center, test = false) {
  const audit = test === "audit";
  const file = `${dir}/${id}${audit ? "-audit-v1" : test ? "-test-v2" : "-train-v2"}.json`;
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const jds = audit ? [J0, ...dates(id + 104729, 1000), J1] : test ? [J0, ...dates(id + 7919, 400), J1] : dates(id), rows = [];
  for (let k = 0; k < jds.length; k += 1200) {
    const input = ["!$$SOF", `COMMAND='${id}'`, `CENTER='500@${center}'`, "OBJ_DATA=NO", "MAKE_EPHEM=YES", "EPHEM_TYPE=VECTORS",
      "REF_PLANE=FRAME", "REF_SYSTEM=ICRF", "VEC_TABLE=1", "VEC_CORR=NONE", "OUT_UNITS=KM-S", "CSV_FORMAT=YES", "TLIST_TYPE=JD",
      "TIME_TYPE=TT", "TLIST=", ...jds.slice(k, k + 1200).map((x) => `'${x.toFixed(6)}'`), "!$$EOF", ""].join("\n");
    for (let attempt = 0; ; attempt++) {
      try {
        const form = new FormData();
        form.append("format", "text");
        form.append("input", new Blob([input]), "input.txt");
        const text = await (await fetch("https://ssd.jpl.nasa.gov/api/horizons_file.api", { method: "POST", body: form })).text();
        const body = text.split("$$SOE")[1]?.split("$$EOE")[0];
        if (!body) throw new Error(text.slice(0, 300));
        for (const line of body.trim().split("\n")) {
          const c = line.split(",").map((x) => x.trim());
          rows.push([Number(c[0]), Number(c[2]), Number(c[3]), Number(c[4])]);
        }
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(rows));
  return rows;
}

// ---------------------------------------------------------------------
// Fitting

const RAD = Math.PI / 180;

// the axes of the planet's equatorial frame, in ICRF
function frame([a, d]) {
  const z = [Math.cos(d * RAD) * Math.cos(a * RAD), Math.cos(d * RAD) * Math.sin(a * RAD), Math.sin(d * RAD)];
  const h = Math.hypot(z[0], z[1]), x = [-z[1] / h, z[0] / h, 0];
  return [x, [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]], z];
}

// Least squares, by the normal equations (Cholesky)
function solve(A, b) {
  const n = b.length, L = A.map((r) => r.slice());
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < j; k++) L[j][j] -= L[j][k] ** 2;
    L[j][j] = Math.sqrt(Math.max(L[j][j], 1e-300));
    for (let i = j + 1; i < n; i++) {
      for (let k = 0; k < j; k++) L[i][j] -= L[i][k] * L[j][k];
      L[i][j] /= L[j][j];
    }
  }
  const y = b.slice();
  for (let i = 0; i < n; i++) { for (let k = 0; k < i; k++) y[i] -= L[i][k] * y[k]; y[i] /= L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { for (let k = i + 1; k < n; k++) y[i] -= L[k][i] * y[k]; y[i] /= L[i][i]; }
  return y;
}

// The amplitudes for the frequencies fs: complex (x + i y) or real (z)
function amplitudes(t, x, y, fs, complex) {
  const m = 2 * fs.length, A = Array.from({ length: m }, () => new Float64Array(m)), b = new Float64Array(m);
  const row = new Float64Array(m), row2 = new Float64Array(m);
  for (let j = 0; j < t.length; j++) {
    fs.forEach((f, k) => {
      const c = Math.cos(f * t[j]), s = Math.sin(f * t[j]);
      // x = a cos − b sin, y = a sin + b cos (complex); z = a cos + b sin
      row[2 * k] = c; row[2 * k + 1] = complex ? -s : s;
      row2[2 * k] = s; row2[2 * k + 1] = c;
    });
    for (let p = 0; p < m; p++) {
      b[p] += row[p] * x[j] + (complex ? row2[p] * y[j] : 0);
      for (let q = 0; q <= p; q++) A[p][q] += row[p] * row[q] + (complex ? row2[p] * row2[q] : 0);
    }
  }
  for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) A[p][q] = A[q][p];
  // a tiny ridge, for terms of nearly equal frequencies
  for (let p = 0; p < m; p++) A[p][p] *= 1 + 1e-12;
  return solve(A.map((r) => Array.from(r)), Array.from(b));
}

function evaluate(t, fs, amp, complex) {
  const x = new Float64Array(t.length), y = new Float64Array(t.length);
  fs.forEach((f, k) => {
    const a = amp[2 * k], b = amp[2 * k + 1];
    for (let j = 0; j < t.length; j++) {
      const c = Math.cos(f * t[j]), s = Math.sin(f * t[j]);
      if (complex) { x[j] += a * c - b * s; y[j] += a * s + b * c; } else x[j] += a * c + b * s;
    }
  });
  return [x, y];
}

// |Σ (x + i y) exp(−i f t)|² over the frequencies f0, f0 + df…, by
// rotating each sample step by step
function scan(t, x, y, f0, df, count) {
  const out = new Float64Array(count), re = new Float64Array(count), im = new Float64Array(count);
  for (let j = 0; j < t.length; j++) {
    const c = Math.cos(f0 * t[j]), s = -Math.sin(f0 * t[j]);
    const dc = Math.cos(df * t[j]), ds = -Math.sin(df * t[j]);
    let pr = x[j] * c - y[j] * s, pi = x[j] * s + y[j] * c;
    for (let k = 0; k < count; k++) {
      re[k] += pr; im[k] += pi;
      const nr = pr * dc - pi * ds;
      pi = pr * ds + pi * dc;
      pr = nr;
    }
  }
  for (let k = 0; k < count; k++) out[k] = re[k] ** 2 + im[k] ** 2;
  return out;
}
const power = (t, x, y, f) => scan(t, x, y, f, 0, 1)[0];

// the best frequency in [lo, hi]: the highest peak of the scan, refined
function bestIn(t, x, y, lo, hi, df) {
  const count = Math.max(1, Math.ceil((hi - lo) / df));
  const p = scan(t, x, y, lo, df, count);
  let k = 0;
  for (let i = 1; i < count; i++) if (p[i] > p[k]) k = i;
  let a = lo + (k - 1) * df, b = lo + (k + 1) * df;
  for (let i = 0; i < 40; i++) {
    const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
    if (power(t, x, y, m1) > power(t, x, y, m2)) b = m2; else a = m1;
  }
  const f = (a + b) / 2;
  return { f, p: power(t, x, y, f) };
}

function fitMoon(name, rows, sys, period) {
  const [ex, ey, ez] = frame(sys.pole);
  const t = Float64Array.from(rows, (r) => r[0] - 2451545);
  const dot = (r, e) => r[1] * e[0] + r[2] * e[1] + r[3] * e[2];
  const X = Float64Array.from(rows, (r) => dot(r, ex)), Y = Float64Array.from(rows, (r) => dot(r, ey)), Z = Float64Array.from(rows, (r) => dot(r, ez));
  const span = t[t.length - 1] - t[0], df = 2 * Math.PI / span / 3;
  // the mean motion, within 2 % of the period
  const n0 = 2 * Math.PI / period;
  const n = bestIn(t, X, Y, n0 - 0.02 * Math.abs(n0), n0 + 0.02 * Math.abs(n0), df).f;
  const [a0, b0] = amplitudes(t, X, Y, [n], true), a = Math.hypot(a0, b0);
  // within 0.004 radii of the planet, or 10⁻⁴ of the orbit (Iapetus)
  const goal = Math.max(0.004 * sys.radius, 1e-4 * a);
  const zf = [n], wf = [n];
  let za, wa, worst = Infinity;
  for (;;) {
    za = amplitudes(t, X, Y, zf, true);
    wa = amplitudes(t, Z, null, wf, false);
    const [mx, my] = evaluate(t, zf, za, true), [mz] = evaluate(t, wf, wa, false);
    const rx = X.map((v, j) => v - mx[j]), ry = Y.map((v, j) => v - my[j]), rz = Z.map((v, j) => v - mz[j]);
    worst = 0;
    let wz = 0, ww = 0;
    for (let j = 0; j < t.length; j++) {
      worst = Math.max(worst, Math.hypot(rx[j], ry[j], rz[j]));
      wz = Math.max(wz, Math.hypot(rx[j], ry[j]));
      ww = Math.max(ww, Math.abs(rz[j]));
    }
    if (worst <= goal || zf.length + wf.length >= 100) break;
    // the next term, where the error is larger: in the plane or out of it,
    // over all the frequencies up to 3.5 n (the resonances of the
    // Galilean moons put terms between the multiples of n)
    const top = 3.5 * Math.abs(n), step = 2 * Math.PI / span;
    if (wz >= ww) zf.push(bestIn(t, rx, ry, -top, top, step).f);
    else wf.push(bestIn(t, rz, new Float64Array(t.length), 0, top, step).f);
  }
  console.log(`${name}: ${zf.length} + ${wf.length} terms, ${worst.toFixed(1)} km = ${(worst / sys.radius).toFixed(4)} R`);
  return { name, zf, za, wf, wa, worst };
}

async function main() {
if (!dir) throw new Error("usage: node tools/moons.mjs <directory> [planet | --fetch | --validate | --audit]");
fs.mkdirSync(dir, { recursive: true });
if (process.argv.includes("--fetch")) {
  for (const [planet, sys] of Object.entries(SYSTEMS)) {
    for (const [name, [id]] of Object.entries(sys.moons)) {
      await fetchMoon(id, sys.id);
      console.log(`Fetched ${planet}: ${name}`);
    }
  }
  if (!fs.existsSync(`${dir}/moons-baseline-series.json`)) fs.writeFileSync(`${dir}/moons-baseline-series.json`, JSON.stringify(MOONS));
  fs.writeFileSync(`${dir}/series.json`, JSON.stringify(MOONS));
  fs.writeFileSync(`${dir}/systems.json`, JSON.stringify(SYSTEMS));
  return;
}
if (process.argv.includes("--validate") || process.argv.includes("--audit")) {
  const audit = process.argv.includes("--audit");
  const report = {};
  for (const [planet, sys] of Object.entries(SYSTEMS)) {
    const axes = frame(sys.pole);
    for (const [name, [id]] of Object.entries(sys.moons)) {
      const rows = await fetchMoon(id, sys.id, audit ? "audit" : true), model = MOONS[planet].moons[name], old = model[2];
      let max = 0, sum = 0;
      const bins = Array(8).fill(0);
      for (const [jd, ...r] of rows) {
        const [x, y, zv] = moonSeriesPosition(model, jd - 2451545);
        const err = Math.hypot(...r.map((v, k) => x * axes[0][k] + y * axes[1][k] + zv * axes[2][k] - v));
        max = Math.max(max, err); sum += err * err;
        const bin = Math.min(7, Math.floor(8 * (jd - J0) / (J1 - J0)));
        bins[bin] = Math.max(bins[bin], err);
      }
      report[name] = { planet, samples: rows.length, firstJD: rows[0][0], lastJD: rows.at(-1)[0], oldKm: old, maxKm: max, rmsKm: Math.sqrt(sum / rows.length), binsKm: bins };
      console.log(`${name}: max ${max.toFixed(1)} km (stored ${old}), RMS ${report[name].rmsKm.toFixed(1)} km`);
      fsWriteReport();
    }
  }
  function fsWriteReport() { fs.writeFileSync(`${dir}/moons-${audit ? "audit" : "validation"}.json`, JSON.stringify(report, null, 2) + "\n"); }
  return;
}
const out = {};
for (const [planet, sys] of Object.entries(SYSTEMS)) {
  if (process.argv[3] && process.argv[3] !== planet) continue;
  const moons = [];
  for (const [name, [id, period]] of Object.entries(sys.moons)) {
    const fit = fitMoon(name, await fetchMoon(id, sys.id), sys, period);
    // the error at other dates
    const [ex, ey, ez] = frame(sys.pole);
    let worst = 0;
    for (const [jd, ...r] of await fetchMoon(id, sys.id, true)) {
      const t = [jd - 2451545];
      const [[x], [y]] = evaluate(t, fit.zf, fit.za, true), [[z]] = evaluate(t, fit.wf, fit.wa, false);
      const p = [0, 1, 2].map((k) => x * ex[k] + y * ey[k] + z * ez[k]);
      worst = Math.max(worst, Math.hypot(...p.map((v, k) => v - r[k])));
    }
    console.log(`  at other dates: ${(worst / sys.radius).toFixed(4)} R`);
    moons.push({ ...fit, test: worst });
  }
  out[planet] = { sys, moons };
}

// js/moons.js: for each planet its equatorial radius (km) and pole, and
// for each moon the flat lists f, a, b of the terms of x + i y and of z,
// and its largest error at other dates (km);
// all the planets only when none was named
if (process.argv[3]) return;
const terms = (fs, amp) => fs.flatMap((f, k) => [f.toPrecision(15), amp[2 * k].toFixed(2), amp[2 * k + 1].toFixed(2)]).join(",");
const report = [], body = Object.entries(out).map(([planet, { sys, moons }]) => {
  report.push(...moons.map((m) => `${m.name} ${(m.test / sys.radius).toFixed(4)}`));
  const list = moons.map((m) => `      ${m.name}: [\n        [${terms(m.zf, m.za)}],\n        [${terms(m.wf, m.wa)}],\n        ${Math.ceil(m.test)},\n      ],`).join("\n");
  return `  ${planet}: {\n    radius: ${sys.radius},\n    pole: [${sys.pole.join(", ")}],\n    moons: {\n${list}\n    },\n  },`;
}).join("\n");
fs.writeFileSync(new URL("../js/moons.js", import.meta.url), `// The major moons of Mars, Jupiter, Saturn, Uranus and Neptune: series
// fitted by tools/moons.mjs to JPL Horizons over 1900 to 2100. In the frame
// of the planet's equator (its pole of J2000; x toward the ascending node
// of the equator on the ICRF equator, z to the north pole), in km, with t
// in days of TT from J2000:
//   x + i y = Σ (a + i b) exp(i f t),   z = Σ (a cos f t + b sin f t),
// and the largest error at other dates (km). In planet radii (Mimas,
// Hyperion and Iapetus, with their resonances and the Sun, need more):
${report.map((r, i) => (i % 6 ? " " : "// ") + r + (i % 6 === 5 || i === report.length - 1 ? "\n" : ",")).join("").trimEnd()}

export const MOONS = {
${body}
};
`);
}

export { SYSTEMS, J0, J1, dates, frame, evaluate, amplitudes, bestIn, fetchMoon };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
