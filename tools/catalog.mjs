// Writes js/catalog.js, the named stars, the Messier and other named
// deep-sky objects, and the large cities:
//
//   node tools/catalog.mjs <directory>
//
// The directory holds the downloaded sources:
//   IAU-CSN.txt         the IAU Catalog of Star Names (WGSN),
//                       https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt
//   hygdata_v41.csv     the HYG database (Hipparcos, Yale, Gliese), for the
//                       proper motions, parallaxes and radial velocities,
//                       https://github.com/astronexus/HYG-Database
//   NGC.csv, addendum.csv  OpenNGC (CC BY-SA 4.0),
//                       https://github.com/mattiaverga/OpenNGC
//   cities15000.txt     GeoNames (CC BY 4.0), unzipped from
//                       https://download.geonames.org/export/dump/cities15000.zip
//
// Stars: every IAU name, with its position (ICRS, epoch J2000),
// the proper motion (mas/yr, μα cos δ and μδ), the parallax (mas) and the
// radial velocity (km/s) of its Hipparcos star in HYG, and the V magnitude.
// Deep-sky objects: the Messier objects and those of NGC and IC with a
// common name. Cities: the capitals and those of 500 000 people or more,
// with their elevation (m, from the SRTM model where GeoNames has none).

import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node tools/catalog.mjs <directory>");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const round = (x, n) => Number(x.toFixed(n));

// HYG by Hipparcos number
const hyg = new Map();
{
  const lines = read("hygdata_v41.csv").split("\n");
  const head = lines[0].split(",").map((h) => h.replace(/"/g, ""));
  const col = (name) => head.indexOf(name);
  const [HIP, DIST, PMRA, PMDEC, RV, RA, DEC] = ["hip", "dist", "pmra", "pmdec", "rv", "ra", "dec"].map(col);
  for (const line of lines.slice(1)) {
    const f = line.split(",");
    if (f[HIP]) hyg.set(Number(f[HIP]), { ra: Number(f[RA]) * 15, dec: Number(f[DEC]), dist: Number(f[DIST]), pmra: Number(f[PMRA]), pmdec: Number(f[PMDEC]), rv: Number(f[RV]) });
  }
}

// [name, ra, dec, pmra, pmdec, parallax, rv, V]
const stars = [];
for (const line of read("IAU-CSN.txt").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const name = line.slice(18, 36).trim();
  const f = line.slice(36).trim().split(/\s+/);
  if (f.at(-1) === "*") f.pop();
  const [mag, , hip, , ra, dec] = f.slice(-7, -1);
  const h = hyg.get(Number(hip));
  if (!(Number(ra) >= 0)) continue;
  // the HYG positions are rounded, some of the epoch 1991.25: the same star
  // within 3′
  const same = h && Math.abs(h.dec - Number(dec)) < 0.05 && Math.abs((h.ra - Number(ra)) * Math.cos(h.dec * Math.PI / 180)) < 0.05;
  const plx = same && h.dist > 0 && h.dist < 1e5 ? round(1000 / h.dist, 2) : 0;
  // HYG stops at 9999.99 mas/yr: Barnard's Star from Gaia DR3
  if (name === "Barnard's Star") { stars.push([name, round(Number(ra), 6), round(Number(dec), 6), -801.55, 10362.39, 546.98, -110.5, 9.54]); continue; }
  stars.push([name, round(Number(ra), 6), round(Number(dec), 6), same ? round(h.pmra, 2) : 0, same ? round(h.pmdec, 2) : 0, plx, same ? round(h.rv, 1) : 0, round(Number(mag), 2)]);
}
// those without a magnitude (Geminga) last
const magOf = (s) => (Number.isFinite(s[7]) ? s[7] : 99);
stars.sort((a, b) => magOf(a) - magOf(b));

// [names, ra, dec, V, type]
const TYPES = { G: "galaxy", GPair: "galaxy pair", GTrpl: "galaxy triplet", GGroup: "group of galaxies", OCl: "open cluster", GCl: "globular cluster", "Cl+N": "cluster with nebula", PN: "planetary nebula", HII: "H II region", RfN: "reflection nebula", EmN: "emission nebula", Neb: "nebula", SNR: "supernova remnant", "*Ass": "star cloud", "**": "double star", "*": "star", Other: "object" };
const deep = [];
const seen = new Set();
const sexa = (s, k) => {
  const [a, b, c] = s.split(":").map(Number), sign = s.trim().startsWith("-") ? -1 : 1;
  return round(k * sign * (Math.abs(a) + b / 60 + c / 3600), 5);
};
for (const file of ["NGC.csv", "addendum.csv"]) {
  const lines = read(file).split("\n");
  const head = lines[0].split(";");
  const col = (name) => head.indexOf(name);
  for (const line of lines.slice(1)) {
    const f = line.split(";");
    const m = f[col("M")], common = f[col("Common names")];
    if (!(m || common) || !f[col("RA")]) continue;
    const names = [];
    if (m) names.push(`M${Number(m)}`);
    const id = /^(NGC|IC)0*(\d+.*)$/.exec(f[col("Name")]);
    names.push(id ? `${id[1]} ${id[2]}` : f[col("Name")]);
    if (common) names.push(...common.split(","));
    if (seen.has(names[0])) continue;
    seen.add(names[0]);
    const v = f[col("V-Mag")] || f[col("B-Mag")];
    deep.push([names, sexa(f[col("RA")], 15), sexa(f[col("Dec")], 1), v ? Number(v) : null, TYPES[f[col("Type")]] || "object"]);
  }
}
const mnum = (x) => (/^M\d+$/.test(x[0][0]) ? Number(x[0][0].slice(1)) : 1000);
deep.sort((a, b) => mnum(a) - mnum(b) || a[0][0].localeCompare(b[0][0]));

// name|ascii name|country|latitude|longitude|elevation, by population
const cities = [];
for (const line of read("cities15000.txt").split("\n")) {
  const f = line.split("\t");
  if (f.length < 18) continue;
  const pop = Number(f[14]);
  if (!(pop >= 500000 || f[7] === "PPLC")) continue;
  let h = f[15] !== "" ? Number(f[15]) : Number(f[16]);
  if (!(h > -500)) h = 0;
  cities.push([pop, [f[1], f[2] === f[1] ? "" : f[2], f[8], round(Number(f[4]), 3), round(Number(f[5]), 3), Math.round(h)].join("|")]);
}
cities.sort((a, b) => b[0] - a[0]);

const out = `// Generated by tools/catalog.mjs: the named stars (IAU Catalog of Star
// Names, with the motions of HYG), the Messier and other named deep-sky
// objects (OpenNGC, CC BY-SA 4.0) and the large cities (GeoNames, CC BY 4.0).
//
// STARS: [name, ra, dec (degrees, ICRS, epoch J2000), proper motion in ra
// (μα cos δ) and dec (mas/yr), parallax (mas), radial velocity (km/s), V],
// brightest first. DEEP: [names, ra, dec, V, kind]. CITIES: lines
// name|ASCII name (if different)|country|latitude|longitude|elevation (m),
// the largest first.

const STARS = [
${stars.map((s) => "  " + JSON.stringify(s)).join(",\n")},
];

const DEEP = [
${deep.map((s) => "  " + JSON.stringify(s)).join(",\n")},
];

const CITIES = \`
${cities.map((c) => c[1]).join("\n")}
\`;

export { STARS, DEEP, CITIES };
`;
fs.writeFileSync(new URL("../js/catalog.js", import.meta.url), out);
console.log(`${stars.length} stars, ${deep.length} deep-sky objects, ${cities.length} cities, ${out.length} bytes`);
