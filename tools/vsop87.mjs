// Writes js/vsop87.js, the VSOP87D series truncated for the app, from the
// files of Bretagnon and Francou (ftp.imcce.fr/pub/ephem/planets/vsop87/,
// VSOP87D.mer … VSOP87D.nep):
//
//   node tools/vsop87.mjs <directory of the files> [arcseconds]
//
// The terms are dropped from the smallest, as long as the geocentric
// direction of the body stays within the given error (default 0.5″) of the
// full series over the years 1000 to 3000; the Earth first, to a third of
// it, as it enters every planet.

import fs from "node:fs";

const PLANETS = ["mer", "ven", "ear", "mar", "jup", "sat", "ura", "nep"];
const NAMES = { mer: "mercury", ven: "venus", ear: "earth", mar: "mars", jup: "jupiter", sat: "saturn", ura: "uranus", nep: "neptune" };
const dir = process.argv[2];
const target = Number(process.argv[3] || 0.5) / 206264.806;
if (!dir) throw new Error("usage: node tools/vsop87.mjs <directory> [arcseconds]");

// series[coordinate][power] = [[A, B, C], …] (L, B, R)
function read(p) {
  const series = [[], [], []];
  let cur = null;
  for (const line of fs.readFileSync(`${dir}/VSOP87D.${p}`, "utf8").split("\n")) {
    const head = line.match(/VARIABLE (\d).*\*T\*\*(\d)/);
    if (head) {
      cur = [];
      series[head[1] - 1][head[2]] = cur;
    } else if (line.trim()) {
      cur.push(line.trim().split(/\s+/).slice(-3).map(Number));
    }
  }
  return series;
}

// the series with the terms of A τ^α below the threshold (radians, and
// radians times the mean distance for R) left out, τ up to 1 millennium
function cut(series, eps, a) {
  return series.map((powers, c) => powers.map((terms) => terms.filter(([A]) => A >= (c === 2 ? eps * a : eps))));
}

function lbr(series, tau) {
  return series.map((powers) => powers.reduce((s, terms, k) =>
    s + tau ** k * terms.reduce((x, [A, B, C]) => x + A * Math.cos(B + C * tau), 0), 0));
}

const xyz = ([L, B, R]) => [R * Math.cos(B) * Math.cos(L), R * Math.cos(B) * Math.sin(L), R * Math.sin(B)];
const angle = (u, v) => Math.atan2(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]),
  u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);

// dates spread over 1000 to 3000, in millennia from J2000
const TAUS = Array.from({ length: 1500 }, (_, i) => -1 + 2 * (i + 0.5) / 1500);
const full = Object.fromEntries(PLANETS.map((p) => [p, read(p)]));
const fullPos = Object.fromEntries(PLANETS.map((p) => [p, TAUS.map((t) => xyz(lbr(full[p], t)))]));

// the largest error of the geocentric direction, against the full series
function worst(p, series, earthPos) {
  let w = 0;
  TAUS.forEach((t, i) => {
    const pos = xyz(lbr(series, t));
    const e = earthPos[i], f = fullPos.ear[i], q = fullPos[p][i];
    const got = p === "ear" ? pos.map((x) => -x) : pos.map((x, k) => x - e[k]);
    const ref = p === "ear" ? f.map((x) => -x) : q.map((x, k) => x - f[k]);
    w = Math.max(w, angle(got, ref));
  });
  return w;
}

// the largest threshold (a power of 10^0.1) within the error
function choose(p, earthPos, goal) {
  const a = Math.hypot(...fullPos[p][0]);
  let best = null;
  for (let k = 0; k < 60; k++) {
    const eps = goal * 10 ** (-k / 10);
    const s = cut(full[p], eps, a);
    const w = worst(p, s, earthPos);
    if (w <= goal) { best = { s, eps, w }; break; }
  }
  return best;
}

// numbers rounded to the tolerance, as short as possible
const num = (x, tol) => {
  for (let d = 0; d < 15; d++) {
    const s = x.toFixed(d);
    if (Math.abs(Number(s) - x) <= tol) return s.replace(/^(-?)0\./, "$1.");
  }
  return String(x);
};

const out = {};
const earth = choose("ear", fullPos.ear, target / 3);
const earthPos = TAUS.map((t) => xyz(lbr(earth.s, t)));
const report = [];
for (const p of PLANETS) {
  const r = p === "ear" ? earth : choose(p, earthPos, target);
  // A to a hundredth of the threshold; B and C so that A δB and A δC stay below it
  const a = Math.hypot(...fullPos[p][0]);
  out[NAMES[p]] = r.s.map((powers, c) => powers.map((terms) => {
    const tol = (c === 2 ? r.eps * a : r.eps) / 100;
    return terms.flatMap(([A, B, C]) => [num(A, tol), num(B, tol / A), num(C, tol / A)]);
  }));
  const n = r.s.flat(2).length;
  report.push(`${NAMES[p]}: ${n} terms, ${(r.w * 206264.806).toFixed(2)}″`);
}

const body = Object.entries(out).map(([name, coords]) =>
  `  ${name}: [\n${coords.map((powers) => `    [\n${powers.map((t) => `      [${t.join(",")}],`).join("\n")}\n    ],`).join("\n")}\n  ],`).join("\n");
fs.writeFileSync(new URL("../js/vsop87.js", import.meta.url), `// VSOP87D (Bretagnon and Francou, 1988): heliocentric ecliptic longitude,
// latitude (radians) and distance (au) of the planets, referred to the
// ecliptic and equinox of the date. Truncated by tools/vsop87.mjs, within
// ${(target * 206264.806).toFixed(1)}″ of the full series for the years 1000 to 3000:
// ${report.join("; ")}.
// For each coordinate, the series of the powers of τ (Julian millennia of
// TT from J2000), each a flat list of A, B, C for the terms A cos(B + C τ).

export const VSOP87 = {
${body}
};
`);
console.log(report.join("\n"));
