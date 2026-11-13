// Writes js/moonseries.js, series for the geocentric position of the Moon
// fitted to JPL Horizons over the years 1600 to 2400:
//
//   node tools/moon.mjs <directory> [arcseconds]
//
// The positions (geometric, ICRF) at random dates are fetched once into the
// directory, turned to the ecliptic and equinox of the date (IAU 1976), and
// fitted, longitude, latitude and distance, with terms in the arguments of
// Delaunay D, M, M′, F (the polynomials of Meeus, chapter 47; the terms in
// M times the eccentricity of the Earth's orbit, as there), chosen one at
// a time where they reduce the error most, until it is below the given
// arcseconds (default 0.5), and then terms of fixed frequency found in what
// remains (the planets).

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
const goal = Number(process.argv[3] || 0.5);

const J0 = 2305813.5, J1 = 2597641.5, SAMPLES = 4000, TESTS = 400;
const RAD = Math.PI / 180, AS = RAD / 3600;

// ---------------------------------------------------------------------
// Fetching (the batch interface of Horizons takes long lists of dates)

function dates(seed, n) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, () => J0 + (J1 - J0) * rnd()).sort((a, b) => a - b);
}

async function fetchMoon(name, seed, n) {
  const file = `${dir}/${name}.json`;
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const jds = dates(seed, n), rows = [];
  if (name.includes("audit")) { jds.unshift(2305447.5); jds.push(J1); }
  for (let k = 0; k < jds.length; k += 1000) {
    const input = ["!$$SOF", "COMMAND='301'", "CENTER='500@399'", "OBJ_DATA=NO", "MAKE_EPHEM=YES", "EPHEM_TYPE=VECTORS",
      "REF_PLANE=FRAME", "REF_SYSTEM=ICRF", "VEC_TABLE=1", "VEC_CORR=NONE", "OUT_UNITS=KM-S", "CSV_FORMAT=YES", "TLIST_TYPE=JD",
      "TIME_TYPE=TT", "TLIST=", ...jds.slice(k, k + 1000).map((x) => `'${x.toFixed(6)}'`), "!$$EOF", ""].join("\n");
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
// Frames: ICRF to the mean ecliptic and equinox of the date

function precess([x, y, z], T) {
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * AS;
  const zz = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * AS;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * AS;
  const x1 = x * Math.cos(zeta) - y * Math.sin(zeta), y1 = x * Math.sin(zeta) + y * Math.cos(zeta);
  const x2 = x1 * Math.cos(th) - z * Math.sin(th), z2 = x1 * Math.sin(th) + z * Math.cos(th);
  return [x2 * Math.cos(zz) - y1 * Math.sin(zz), x2 * Math.sin(zz) + y1 * Math.cos(zz), z2];
}
const obliquity = (T) => (84381.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T ** 3) * AS;

// longitude (radians, unwrapped later), latitude (radians), distance (km)
function ecliptic([jd, ...r]) {
  const T = (jd - 2451545) / 36525, [x, y, z] = precess(r, T), e = obliquity(T);
  const ye = y * Math.cos(e) + z * Math.sin(e), ze = -y * Math.sin(e) + z * Math.cos(e);
  return [T, Math.atan2(ye, x), Math.atan2(ze, Math.hypot(x, ye)), Math.hypot(x, y, z)];
}

// ---------------------------------------------------------------------
// The arguments of Delaunay and the mean longitude (radians)

function args(T) {
  const deg = (c) => c.reduce((s, a, k) => s + a * T ** k, 0) * RAD;
  return {
    L: deg([218.3164477, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000]),
    D: deg([297.8501921, 445267.1114034, -0.0018819, 1 / 545868, -1 / 113065000]),
    M: deg([357.5291092, 35999.0502909, -0.0001536, 1 / 24490000]),
    Mp: deg([134.9633964, 477198.8675055, 0.0087414, 1 / 69699, -1 / 14712000]),
    F: deg([93.272095, 483202.0175233, -0.0036539, -1 / 3526000, 1 / 863310000]),
    E: 1 - 0.002516 * T - 0.0000074 * T * T,
  };
}

// ---------------------------------------------------------------------
// Fitting: orthogonal matching pursuit, the chosen columns kept
// orthonormal (Gram–Schmidt) so that each new term costs little

// |Σ y exp(−i f t)|² over f0, f0 + df…, rotating each sample step by step
function scan(t, y, f0, df, count) {
  const re = new Float64Array(count), im = new Float64Array(count);
  for (let j = 0; j < t.length; j++) {
    const dc = Math.cos(df * t[j]), ds = -Math.sin(df * t[j]);
    let pr = y[j] * Math.cos(f0 * t[j]), pi = -y[j] * Math.sin(f0 * t[j]);
    for (let k = 0; k < count; k++) {
      re[k] += pr; im[k] += pi;
      const nr = pr * dc - pi * ds;
      pi = pr * ds + pi * dc;
      pr = nr;
    }
  }
  return re.map((r, k) => r * r + im[k] * im[k]);
}
const power = (t, y, f) => scan(t, y, f, 0, 1)[0];
function bestFrequency(t, y, lo, hi, df) {
  const count = Math.ceil((hi - lo) / df), p = scan(t, y, lo, df, count);
  let k = 1;
  for (let i = 2; i < count; i++) if (p[i] > p[k]) k = i;
  let a = lo + (k - 1) * df, b = lo + (k + 1) * df;
  for (let i = 0; i < 40; i++) {
    const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
    if (power(t, y, m1) > power(t, y, m2)) b = m2; else a = m1;
  }
  const f = (a + b) / 2;
  return { f, gain: 2 * power(t, y, f) / t.length };
}

// The fit of y (one coordinate) at the samples: polynomial columns, then
// pairs (sin, cos) of Delaunay terms (multipliers of D, M, M′, F) or of
// fixed frequencies, while the largest error is above goal
function fit(S, y, { parityF, poly, goal, cap }) {
  const N = y.length, t = S.map((s) => s.T * 36525);
  const Q = [], R = [], cols = [], res = Float64Array.from(y);
  // a new column, orthonormalized; false when it adds nothing
  const add = (col, what) => {
    const q = Float64Array.from(col), r = [];
    for (let pass = 0; pass < 2; pass++) {
      Q.forEach((u, i) => {
        let d = 0;
        for (let j = 0; j < N; j++) d += u[j] * q[j];
        for (let j = 0; j < N; j++) q[j] -= d * u[j];
        r[i] = (r[i] || 0) + d;
      });
    }
    let n = 0;
    for (let j = 0; j < N; j++) n += q[j] * q[j];
    n = Math.sqrt(n);
    if (n < 1e-9 * Math.sqrt(N)) return false;
    for (let j = 0; j < N; j++) q[j] /= n;
    r[Q.length] = n;
    Q.push(q);
    R.push(r);
    cols.push(what);
    let d = 0;
    for (let j = 0; j < N; j++) d += q[j] * res[j];
    for (let j = 0; j < N; j++) res[j] -= d * q[j];
    return true;
  };
  poly.forEach((k) => add(S.map((s) => s.T ** k), ["T", k]));
  // the candidates: multipliers of D, M, M′, F, the first not zero positive
  const cands = [];
  for (let d = -6; d <= 6; d++) for (let m = -3; m <= 3; m++) for (let mp = -5; mp <= 5; mp++) for (let f = -4; f <= 4; f++) {
    const v = [d, m, mp, f], first = v.find((x) => x !== 0);
    if (first > 0 && Math.abs(f) % 2 === parityF) cands.push(v);
  }
  const chosen = new Set();
  const column = ([d, m, mp, f], fn) => S.map((s) => s.E ** Math.abs(m) * fn(d * s.D + m * s.M + mp * s.Mp + f * s.F));
  const worst = () => res.reduce((w, x) => Math.max(w, Math.abs(x)), 0);
  const span = t[N - 1] - t[0], top = 3 * 0.23;
  while (worst() > goal && cols.length < cap) {
    if (cols.length % 50 < 2) console.log(`  ${cols.length} coefficients, residual ${(worst() / goal).toFixed(1)} times target`);
    // the best Delaunay term: the part of the residual its sine and cosine explain
    let best = null;
    for (const v of cands) {
      if (chosen.has(v.join())) continue;
      let ss = 0, sc = 0, s2 = 0, c2 = 0;
      for (let j = 0; j < N; j++) {
        const s = S[j], e = s.E ** Math.abs(v[1]), a = v[0] * s.D + v[1] * s.M + v[2] * s.Mp + v[3] * s.F;
        const sn = e * Math.sin(a), cs = e * Math.cos(a);
        ss += sn * res[j]; sc += cs * res[j]; s2 += sn * sn; c2 += cs * cs;
      }
      const gain = ss * ss / s2 + sc * sc / c2;
      if (!best || gain > best.gain) best = { v, gain };
    }
    const fq = bestFrequency(t, res, 2 * Math.PI / span, top, 2 * Math.PI / span);
    if (best && best.gain >= fq.gain) {
      chosen.add(best.v.join());
      add(column(best.v, Math.sin), ["s", ...best.v]);
      add(column(best.v, Math.cos), ["c", ...best.v]);
    } else {
      add(t.map((x) => Math.sin(fq.f * x)), ["fs", fq.f]);
      add(t.map((x) => Math.cos(fq.f * x)), ["fc", fq.f]);
    }
  }
  // the coefficients: R x = Qᵀ y
  const qy = Q.map((u) => u.reduce((a, x, j) => a + x * y[j], 0)), x = new Array(Q.length).fill(0);
  for (let i = Q.length - 1; i >= 0; i--) {
    let v = qy[i];
    for (let k = i + 1; k < Q.length; k++) v -= R[k][i] * x[k];
    x[i] = v / R[i][i];
  }
  return { cols, x, worst: worst() };
}

// the value of a fit at a sample (or any T, with its arguments)
function value({ cols, x }, s) {
  let v = 0;
  cols.forEach((c, i) => {
    const t = s.T * 36525;
    if (c[0] === "T") v += x[i] * s.T ** c[1];
    else if (c[0] === "s" || c[0] === "c") {
      const a = c[1] * s.D + c[2] * s.M + c[3] * s.Mp + c[4] * s.F, e = s.E ** Math.abs(c[2]);
      v += x[i] * e * (c[0] === "s" ? Math.sin(a) : Math.cos(a));
    } else v += x[i] * (c[0] === "fs" ? Math.sin(c[1] * t) : Math.cos(c[1] * t));
  });
  return v;
}

const samples = (rows) => rows.map((r) => {
  const [T, lon, lat, dist] = ecliptic(r), a = args(T);
  // the longitude from the mean longitude, between −π and π
  const dl = lon - a.L - 2 * Math.PI * Math.round((lon - a.L) / (2 * Math.PI));
  return { T, ...a, dl, lat, dist };
});

async function main() {
if (!dir) throw new Error("usage: node tools/moon.mjs <directory> [arcseconds | --fetch | --audit]");
fs.mkdirSync(dir, { recursive: true });
if (process.argv.includes("--audit")) {
  const { ecliptic, nutation } = await import("../js/astro.js");
  const rows = await fetchMoon("moon-audit-v1", 104729, 1000), S = samples(rows), errors = [];
  for (const s of S) {
    const p = ecliptic("moon", s.T), lon = (p.lon - nutation(s.T).dpsi + 13.176358 / 86400 * p.dist / 299792.458) * RAD;
    const dl = lon - s.L - s.dl;
    errors.push({ jd: 2451545 + s.T * 36525, arcsec: Math.hypot(Math.atan2(Math.sin(dl), Math.cos(dl)) * Math.cos(s.lat), p.lat * RAD - s.lat) / AS, distanceKm: Math.abs(p.dist - s.dist) });
  }
  const report = { samples: rows.length, maxArcsec: Math.max(...errors.map((r) => r.arcsec)), rmsArcsec: Math.sqrt(errors.reduce((s, r) => s + r.arcsec ** 2, 0) / errors.length), maxDistanceKm: Math.max(...errors.map((r) => r.distanceKm)), errors };
  fs.writeFileSync(`${dir}/moon-audit.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(`Moon audit: ${report.maxArcsec.toFixed(3)}″ max, ${report.rmsArcsec.toFixed(3)}″ RMS, distance ${report.maxDistanceKm.toFixed(3)} km`);
  return;
}
const train = samples(await fetchMoon("moon", 301, SAMPLES)), test = samples(await fetchMoon("moon-test", 7301, TESTS));
if (process.argv.includes("--fetch")) {
  const { MOON } = await import("../js/moonseries.js");
  if (!fs.existsSync(`${dir}/moon-baseline-series.json`)) fs.writeFileSync(`${dir}/moon-baseline-series.json`, JSON.stringify(MOON));
  return;
}
const km = goal * AS * 385000, cache = `${dir}/fit-${goal}.json`;
let fits;
if (fs.existsSync(cache)) fits = JSON.parse(fs.readFileSync(cache, "utf8"));
else {
  const t0 = Date.now();
  fits = [
    fit(train, train.map((s) => s.dl), { parityF: 0, poly: [0, 1, 2], goal: goal * AS, cap: 900 }),
    fit(train, train.map((s) => s.lat), { parityF: 1, poly: [0], goal: goal * AS, cap: 600 }),
    fit(train, train.map((s) => s.dist), { parityF: 0, poly: [0, 1], goal: km, cap: 700 }),
  ];
  console.log(`fitted in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  fs.writeFileSync(cache, JSON.stringify(fits));
}
// the error at other dates: of the direction (″) and of the distance (km),
// by century
const bins = {};
let wd = 0;
for (const s of test) {
  const e = Math.hypot((value(fits[0], s) - s.dl) * Math.cos(s.lat), value(fits[1], s) - s.lat) / AS;
  const k = 2000 + 100 * Math.round(s.T);
  bins[k] = Math.max(bins[k] || 0, e);
  wd = Math.max(wd, Math.abs(value(fits[2], s) - s.dist));
}
const report = Object.entries(bins).map(([y, e]) => `${y} ${e.toFixed(1)}″`).join(", ");
console.log(report, `; distance ${wd.toFixed(1)} km`);

// js/moonseries.js: for longitude (radians, from the mean longitude),
// latitude (radians) and distance (km): the polynomial in T, the Delaunay
// terms d, m, m′, f, sine, cosine (times E^|m|), and the terms of fixed
// frequency (radians per day from J2000), frequency, sine, cosine
const write = ({ cols, x }, unit) => {
  const poly = [], del = new Map(), fix = new Map();
  const n = (v) => (unit === "km" ? v.toFixed(3) : v.toPrecision(8));
  cols.forEach((c, i) => {
    if (c[0] === "T") poly[c[1]] = x[i];
    else if (c[0] === "s" || c[0] === "c") {
      const k = c.slice(1).join(","), e = del.get(k) || [0, 0];
      e[c[0] === "s" ? 0 : 1] = x[i];
      del.set(k, e);
    } else {
      const k = c[1], e = fix.get(k) || [0, 0];
      e[c[0] === "fs" ? 0 : 1] = x[i];
      fix.set(k, e);
    }
  });
  return `{\n    poly: [${Array.from(poly, (v) => (v || 0).toPrecision(12)).join(", ")}],\n` +
    `    delaunay: [${[...del].map(([k, [a, b]]) => `${k},${n(a)},${n(b)}`).join(",")}],\n` +
    `    fixed: [${[...fix].map(([f, [a, b]]) => `${Number(f).toPrecision(15)},${n(a)},${n(b)}`).join(",")}],\n  }`;
};
fs.writeFileSync(new URL("../js/moonseries.js", import.meta.url), `// The geocentric Moon, geometric, on the mean ecliptic and equinox of the
// date: series fitted by tools/moon.mjs to JPL Horizons over 1600 to 2400
// (largest errors at other dates: ${report}; distance ${wd.toFixed(1)} km).
// Longitude (radians, from the mean longitude L′), latitude (radians) and
// distance (km), each as
//   Σ poly[k] T^k + Σ E^|m| (a sin A + b cos A) + Σ (a sin f t + b cos f t),
// A = d D + m M + m′ M′ + f F with the arguments of Meeus (chapter 47),
// T in Julian centuries and t in days of TT from J2000.

export const MOON = {
  lon: ${write(fits[0], "rad")},
  lat: ${write(fits[1], "rad")},
  dist: ${write(fits[2], "km")},
};
`);
}

export { samples, value, args, ecliptic, fetchMoon };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
