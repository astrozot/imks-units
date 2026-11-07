// The sky chart's stars, built in and downloadable, from one catalog:
// AT-HYG v4.0 (David Nash, CC BY-SA 4.0), which joins Tycho-2, Hipparcos,
// the Yale Bright Star and Gliese catalogs, Gaia DR3 (distances and proper
// motions) and the IAU's star names; V and B−V of Hipparcos stars from the
// Hipparcos catalogue (ESA 1997), which also gives the double and
// variable flags. Into a directory, download
//   athyg_40.csv.gz from https://codeberg.org/astronexus/athyg (data/)
//   hip_main.dat from https://vizier.cfa.harvard.edu/ftp/cats/I/239/
//   hip2.dat.gz from https://vizier.cfa.harvard.edu/ftp/cats/I/311/
//   suppl_1.dat.gz from https://vizier.cfa.harvard.edu/ftp/cats/I/259/
// then: node tools/stars.mjs <directory>
// It writes js/stardata.js (the built-in stars: to V 6, and all with a
// name, a Bayer letter or a Flamsteed number) and data/stars-8.bin,
// stars-10.bin and stars-11.bin (the others, to V 8, 10 and 11).
//
// A star file has tiles of the sky (zones of 3° in declination, cut in
// right ascension into near-square tiles), each brightest first, so that
// the app reads only the tiles in view and stops at the magnitude it
// shows. Little-endian:
//   'STAR', version 1, tiles T, stars N, aliases A (uint32)
//   T × [RA, Dec of the corner, RA span, Dec span] (float32, degrees)
//   T + 1 first-star indices (uint32)
//   N TYC numbers (uint32, TYC1 · 2¹⁶ + TYC2 · 4 + TYC3 − 1; 0 none)
//   N right ascensions, N declinations (uint16, in the tile: 0…65535)
//   N proper motions in RA (× cos Dec) and N in Dec (int16, mas/yr)
//   N parallaxes (uint16, 0.02 mas; 0 unknown)
//   N V magnitudes (uint8, 0.05 mag), N B−V (int8, 0.02 mag; −128 unknown)
//   A star indices, A aliases (uint32, ascending by star: 2²⁸ + HIP or
//   2 · 2²⁸ + HD)
// Positions are ICRS at J2000.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { STARS } from '../js/catalog.js';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node tools/stars.mjs <directory>');
const BUILT_IN = 6, LIMITS = [8, 10, 11];

// Hipparcos: V, B−V and the flags. A double is a CCDM system resolved by
// Hipparcos at 1.5″ or more with a companion within 4 mag, or two
// built-in stars of one CCDM system (Albireo, ε Lyrae); a variable varies
// by more than 0.6 mag (VarFlag 3), or by 0.25 mag or more over the Hp
// range of VarFlag 2 (Betelgeuse).
const hip = new Map(), num = (s) => (s.trim() === '' ? null : Number(s));
for (const l of fs.readFileSync(path.join(dir, 'hip_main.dat'), 'latin1').split('\n')) {
  if (l.length < 350) continue;
  const max = num(l.slice(301, 306)), min = num(l.slice(307, 312));
  hip.set(Number(l.slice(8, 14)), {
    v: num(l.slice(41, 46)), bv: num(l.slice(245, 251)), varFlag: num(l.slice(47, 48)) || 0, ccdm: l.slice(327, 337).trim(),
    rho: num(l.slice(359, 366)) || 0, dHp: num(l.slice(373, 378)) ?? 99, range: max !== null && min !== null ? min - max : 0,
  });
}

// AT-HYG's positions of the stars of the Tycho-2 supplement (most of the
// brightest) are of 1991.25, not 2000: those of HIP stars come from the
// Hipparcos new reduction (van Leeuwen 2007), the others are moved by
// their proper motions.
const hip2 = new Map();
for (const l of zlib.gunzipSync(fs.readFileSync(path.join(dir, 'hip2.dat.gz'))).toString('latin1').split('\n')) {
  if (l.length < 68) continue;
  hip2.set(Number(l.slice(0, 6)), { ra: Number(l.slice(15, 28)) * 180 / Math.PI, dec: Number(l.slice(29, 42)) * 180 / Math.PI, pmra: Number(l.slice(51, 59)), pmdec: Number(l.slice(60, 68)) });
}
const supplement = new Set(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'suppl_1.dat.gz'))).toString('latin1').split('\n').filter(Boolean)
  .map((l) => `${Number(l.slice(0, 4))}-${Number(l.slice(5, 10))}-${Number(l.slice(11, 12))}`));
// a position moved by a proper motion (mas/yr, RA's times cos Dec) over years
const moved = (ra, dec, pmra, pmdec, years) => [
  (ra + pmra * years / 3.6e6 / Math.max(1e-9, Math.cos(dec * Math.PI / 180)) + 360) % 360, dec + pmdec * years / 3.6e6];

// One line of CSV, with quoted fields
function fields(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '', quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}
const GREEK = { Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω' };
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const bayerName = (b, con) => { const [l, n] = b.split('-'); return `${GREEK[l] || l}${n ? [...n].map((d) => SUP[d]).join('') : ''} ${con}`; };

// AT-HYG: the stars that may be V 11 or brighter. Tycho magnitudes (VT,
// and BT − VT as the colour) to V and B−V (ESA 1997, vol. 1, §1.3,
// appendix 4); for a HIP number given to one star only, Hipparcos's V and
// B−V. Parallaxes from the distances (Gaia DR3 for most).
const rows = [];
let col = null;
const lines = readline.createInterface({ input: fs.createReadStream(path.join(dir, 'athyg_40.csv.gz')).pipe(zlib.createGunzip()), crlfDelay: Infinity });
for await (const line of lines) {
  const f = fields(line);
  if (!col) { col = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
  const g = (k) => f[col[k]];
  if (g('proper') === 'Sol' || !g('ra') || Number(g('mag')) > 11.8) continue;
  rows.push({
    tyc: g('tyc'), hip: Number(g('hip')) || 0, hd: Number(g('hd')) || 0, hr: Number(g('hr')) || 0, bayer: g('bayer'), flam: g('flam'), con: g('con'), proper: g('proper'),
    ra: Number(g('ra')) * 15, dec: Number(g('dec')), dist: Number(g('dist')) || 0, mag: Number(g('mag')), ci: g('ci') === '' ? null : Number(g('ci')), magSrc: g('mag_src'),
    pmra: g('pmra') === '' ? 0 : Number(g('pmra')), pmdec: g('pmdec') === '' ? 0 : Number(g('pmdec')), spect: g('spect'),
  });
}
const hipCount = new Map();
for (const s of rows) if (s.hip) hipCount.set(s.hip, (hipCount.get(s.hip) || 0) + 1);
for (const s of rows) {
  const h2 = s.hip && hipCount.get(s.hip) === 1 && hip2.get(s.hip);
  if (h2) [s.ra, s.dec] = moved(h2.ra, h2.dec, h2.pmra, h2.pmdec, 8.75);
  else if (s.tyc && supplement.has(s.tyc)) [s.ra, s.dec] = moved(s.ra, s.dec, s.pmra, s.pmdec, 8.75);
  const h = s.hip && hipCount.get(s.hip) === 1 && hip.get(s.hip);
  if (h && h.v !== null) { s.v = h.v; s.bv = h.bv; continue; }
  const tycho = s.magSrc === 'T' && s.ci !== null;
  s.v = tycho ? s.mag - 0.09 * s.ci : s.mag;
  s.bv = tycho ? 0.85 * s.ci : s.magSrc === 'T' ? null : s.ci;
}
// Components without a HIP number within 10″ of a brighter Hipparcos star
// are left out: Hipparcos's V holds their light (the chart shows the
// system as one star, with the double flag), and some are duplicates.
const bright = rows.filter((s) => s.v <= LIMITS.at(-1)).sort((a, b) => a.v - b.v), near = new Map();
const cell = (dec) => Math.floor((dec + 90) * 20);
for (const s of bright) if (s.hip) { const c = cell(s.dec); if (!near.has(c)) near.set(c, []); near.get(c).push(s); }
const SEP = 10 / 3600;
const hidden = (s) => !s.hip && [-1, 0, 1].some((d) => (near.get(cell(s.dec) + d) || []).some((h) => h.v <= s.v
  && Math.abs(h.dec - s.dec) < SEP && Math.hypot(((h.ra - s.ra + 540) % 360 - 180) * Math.cos(s.dec * Math.PI / 180), h.dec - s.dec) < SEP));
const stars = bright.filter((s) => !hidden(s));
const plx = (s) => (s.dist > 0 ? 1000 / s.dist : 0);

// The built-in stars, with the IAU names of the app's catalog (js/catalog.js,
// the calculator's) where a star is within 0.025° of one, else AT-HYG's
const builtIn = stars.filter((s) => s.v <= BUILT_IN || s.proper || s.bayer || s.flam);
const inBuilt = new Set(builtIn);
for (const c of STARS) {
  let best = null, distance = 0.025;
  for (const s of builtIn) {
    if (Math.abs(s.dec - c[2]) > distance) continue;
    const d = Math.hypot(((s.ra - c[1] + 540) % 360 - 180) * Math.cos(c[2] * Math.PI / 180), s.dec - c[2]);
    if (d < distance) { best = s; distance = d; }
  }
  if (best && !best.iau) best.iau = c[0];
}
// a name once, for the brightest star that has it (AT-HYG gives a
// system's name to its components)
const used = new Set(builtIn.map((s) => s.iau).filter(Boolean));
for (const s of builtIn) {
  s.name = s.iau || (s.proper && !used.has(s.proper) ? s.proper : '');
  if (s.name) used.add(s.name);
}
const systems = new Map();
for (const s of builtIn) { const h = s.hip && hip.get(s.hip); if (h?.ccdm) systems.set(h.ccdm, (systems.get(h.ccdm) || 0) + 1); }
const r = (x, n) => Math.round(x * 10 ** n) / 10 ** n;
const chart = builtIn.map((s) => {
  const h = s.hip && hip.get(s.hip);
  const flags = h ? (h.ccdm && (h.rho >= 1.5 && h.dHp <= 4 || systems.get(h.ccdm) > 1) ? 1 : 0) | (h.varFlag === 3 || h.varFlag === 2 && h.range >= 0.25 ? 2 : 0) : 0;
  const names = [s.bayer && bayerName(s.bayer, s.con), s.flam && `${s.flam} ${s.con}`, s.hd && `HD ${s.hd}`, s.hr && `HR ${s.hr}`].filter(Boolean).join('|');
  return [s.hip, r(s.ra, 6), r(s.dec, 6), r(s.v, 2), s.bv === null ? null : r(s.bv, 3), flags, r(s.pmra, 2), r(s.pmdec, 2), r(plx(s), 3), s.name, names, s.spect];
});
fs.writeFileSync(new URL('../js/stardata.js', import.meta.url),
  '// Generated by tools/stars.mjs from AT-HYG v4.0 (David Nash,\n' +
  '// https://codeberg.org/astronexus/athyg, CC BY-SA 4.0: this file is under\n' +
  '// the same license), with V, B−V and the double and variable flags of the\n' +
  '// Hipparcos catalogue (ESA 1997). The stars to V 6, and all with a name, a\n' +
  '// Bayer letter or a Flamsteed number, brightest first:\n' +
  '// CHART_STARS: [HIP (0 none), RA, Dec (degrees, ICRS, J2000), V, B−V (null\n' +
  '//   unknown), flags (1 double, 2 variable), proper motion in RA × cos Dec\n' +
  '//   and in Dec (mas/yr), parallax (mas, 0 unknown), name, other\n' +
  "//   designations ('|' between them), spectral type].\n" +
  `export const CHART_STARS = [\n${chart.map((x) => JSON.stringify(x)).join(',\n')}\n];\n`);
console.log(`${chart.length} built-in stars (${chart.filter((c) => c[9]).length} named)`);

// The tiles
const ZONE = 3, tiles = [];
for (let dec0 = -90; dec0 < 90; dec0 += ZONE) {
  const n = Math.max(1, Math.round(360 * Math.cos((dec0 + ZONE / 2) * Math.PI / 180) / ZONE));
  for (let i = 0; i < n; i++) tiles.push({ ra0: 360 * i / n, span: 360 / n, dec0 });
}
const zoneStart = [];
for (let i = 0; i < tiles.length; i++) if (!i || tiles[i].dec0 !== tiles[i - 1].dec0) zoneStart.push(i);
const tileOf = (s) => {
  const z = Math.min(zoneStart.length - 1, Math.floor((s.dec + 90) / ZONE)), first = zoneStart[z], n = (zoneStart[z + 1] ?? tiles.length) - first;
  return first + Math.min(n - 1, Math.floor(((s.ra % 360) + 360) % 360 / (360 / n)));
};

for (const limit of LIMITS) {
  const per = tiles.map(() => []);
  for (const s of stars) if (s.v <= limit && !inBuilt.has(s)) per[tileOf(s)].push(s);
  const T = tiles.length, N = per.reduce((n, t) => n + t.length, 0);
  const aliases = [];
  let i = 0;
  for (const t of per) for (const s of t) {
    if (s.hip) aliases.push([i, 2 ** 28 + s.hip]);
    if (s.hd) aliases.push([i, 2 * 2 ** 28 + s.hd]);
    i++;
  }
  const A = aliases.length, buf = Buffer.alloc(20 + 16 * T + 4 * (T + 1) + 16 * N + 8 * A);
  buf.write('STAR', 0, 'latin1'); buf.writeUInt32LE(1, 4); buf.writeUInt32LE(T, 8); buf.writeUInt32LE(N, 12); buf.writeUInt32LE(A, 16);
  let o = 20;
  for (const t of tiles) for (const x of [t.ra0, t.dec0, t.span, ZONE]) { buf.writeFloatLE(x, o); o += 4; }
  let index = 0;
  for (const t of per) { buf.writeUInt32LE(index, o); o += 4; index += t.length; }
  buf.writeUInt32LE(index, o); o += 4;
  const at = {};
  for (const [k, size] of [['tyc', 4], ['ra', 2], ['dec', 2], ['pmra', 2], ['pmdec', 2], ['plx', 2], ['mag', 1], ['bv', 1]]) { at[k] = o; o += size * N; }
  const u16 = (x) => Math.max(0, Math.min(65535, Math.round(x * 65535))), i16 = (x) => Math.max(-32767, Math.min(32767, Math.round(x)));
  i = 0;
  per.forEach((list, k) => {
    const t = tiles[k];
    for (const s of list) {
      const [a, b, c] = s.tyc ? s.tyc.split('-').map(Number) : [0, 0, 1];
      buf.writeUInt32LE(s.tyc ? a * 65536 + b * 4 + c - 1 : 0, at.tyc + 4 * i);
      buf.writeUInt16LE(u16(((s.ra - t.ra0 + 360) % 360) / t.span), at.ra + 2 * i);
      buf.writeUInt16LE(u16((s.dec - t.dec0) / ZONE), at.dec + 2 * i);
      buf.writeInt16LE(i16(s.pmra), at.pmra + 2 * i);
      buf.writeInt16LE(i16(s.pmdec), at.pmdec + 2 * i);
      buf.writeUInt16LE(Math.min(65535, Math.round(plx(s) / 0.02)), at.plx + 2 * i);
      buf.writeUInt8(Math.max(0, Math.min(255, Math.round(s.v * 20))), at.mag + i);
      buf.writeInt8(s.bv === null ? -128 : Math.max(-127, Math.min(127, Math.round(s.bv * 50))), at.bv + i);
      i++;
    }
  });
  for (const [k, [j, code]] of aliases.entries()) { buf.writeUInt32LE(j, o + 4 * k); buf.writeUInt32LE(code, o + 4 * A + 4 * k); }
  fs.writeFileSync(new URL(`../data/stars-${limit}.bin`, import.meta.url), buf);
  console.log(`data/stars-${limit}.bin: ${N} stars to V ${limit}, ${A} HIP and HD numbers, ${(buf.length / 1e6).toFixed(1)} MB`);
}
