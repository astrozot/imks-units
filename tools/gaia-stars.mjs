// Build the optional V<=12 catalog, retaining every AT-HYG star from stars-11.
// Usage: node tools/gaia-stars.mjs <Gaia CSV> [output.bin]
// Query: gaia-stars.adql, run asynchronously with MAXREC=10000000 (no TOP).
// See data/stars-12.json and README.md for provenance and limitations.
// STAR v2 retains the v1 layout and appends N little-endian uint64 Gaia IDs
// (zero for retained AT-HYG entries). Two uint32 words avoid JS number rounding
// and uint64 alignment requirements. Only new Gaia entries have estimated V/B−V.
import fs from 'node:fs';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readStars } from '../js/coelum.js';
import { CHART_STARS } from '../js/stardata.js';
import { visualMagnitude, johnsonColour, j2000 } from './gaia-photometry.mjs';

const input = process.argv[2];
if (!input) throw new Error('usage: node tools/gaia-stars.mjs <Gaia CSV> [output.bin]');
const output = process.argv[3] || fileURLToPath(new URL('../data/stars-12.bin', import.meta.url));
const baseBytes = fs.readFileSync(new URL('../data/stars-11.bin', import.meta.url));
const base = readStars(baseBytes.buffer.slice(baseBytes.byteOffset, baseBytes.byteOffset + baseBytes.byteLength));
const { T, box } = base, R = Math.PI / 180;
const tiles = Array.from({ length: T }, () => ({ bytes: Buffer.alloc(8192), n: 0 }));
const zoneStart = [];
for (let t = 0; t < T; t++) if (!t || box[4 * t + 1] !== box[4 * (t - 1) + 1]) zoneStart.push(t);
function tileOf(ra, dec) {
  const z = Math.max(0, Math.min(zoneStart.length - 1, Math.floor((dec + 90) / 3)));
  const first = zoneStart[z], n = (zoneStart[z + 1] ?? T) - first;
  return first + Math.min(n - 1, Math.floor(ra / 360 * n));
}
const clip = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
function append(t, { ra, dec, pmra, pmdec, plx, mag, bv, tyc = 0, hip = 0, hd = 0, gaia = 0n }) {
  const tile = tiles[t], o = 32 * tile.n++;
  if (o + 32 > tile.bytes.length) {
    const larger = Buffer.alloc(tile.bytes.length * 2); tile.bytes.copy(larger); tile.bytes = larger;
  }
  const b = tile.bytes;
  b.writeBigUInt64LE(gaia, o); b.writeUInt32LE(tyc, o + 8);
  b.writeUInt16LE(clip(((ra - box[4 * t] + 360) % 360) / box[4 * t + 2] * 65535, 0, 65535), o + 12);
  b.writeUInt16LE(clip((dec - box[4 * t + 1]) / 3 * 65535, 0, 65535), o + 14);
  b.writeInt16LE(clip(pmra, -32767, 32767), o + 16); b.writeInt16LE(clip(pmdec, -32767, 32767), o + 18);
  b.writeUInt16LE(clip(plx / 0.02, 0, 65535), o + 20);
  b.writeUInt8(clip(mag * 20, 0, 255), o + 22);
  b.writeInt8(bv === null ? -128 : clip(bv * 50, -127, 127), o + 23);
  b.writeUInt32LE(hip, o + 24); b.writeUInt32LE(hd, o + 28);
}

// A sparse spatial index of the retained catalog, at epoch J2000. Numeric
// cells and linked typed arrays avoid a million individual JS star objects.
// 2 arcsec matches positions; 10 arcsec around HIP systems preserves the
// integrated-light/double-star treatment of tools/stars.mjs.
const count = base.n + CHART_STARS.length;
const ras = new Float64Array(count), decs = new Float64Array(count), radii = new Float32Array(count);
const next = new Int32Array(count), cells = new Map(), tycs = new Set(), hips = new Set();
const CELL = 0.02, NC = Math.round(360 / CELL);
let indexed = 0;
function index(ra, dec, tyc, hip) {
  ra = (ra % 360 + 360) % 360;
  const i = indexed++, key = Math.floor((dec + 90) / CELL) * NC + Math.floor(ra / CELL);
  ras[i] = ra; decs[i] = dec; radii[i] = (hip ? 10 : 2) / 3600;
  next[i] = cells.get(key) ?? -1; cells.set(key, i);
  if (tyc) tycs.add(tyc); if (hip) hips.add(hip);
}
function matched(ra, dec) {
  const radius = 10 / 3600, span = Math.min(180, radius / Math.max(1e-9, Math.cos((Math.abs(dec) + radius) * R)));
  for (let d = Math.floor((dec - radius + 90) / CELL); d <= Math.floor((dec + radius + 90) / CELL); d++) {
    for (let a = Math.floor((ra - span) / CELL); a <= Math.floor((ra + span) / CELL); a++) {
      for (let i = cells.get(d * NC + (a % NC + NC) % NC) ?? -1; i >= 0; i = next[i]) {
        const dy = decs[i] - dec, dx = ((ras[i] - ra + 540) % 360 - 180) * Math.cos(dec * R);
        if (Math.hypot(dx, dy) < radii[i]) return true;
      }
    }
  }
  return false;
}
const aliases = new Map();
for (let a = 0; a < base.alias.length; a++) {
  const j = base.aliasStar[a];
  if (!aliases.has(j)) aliases.set(j, {});
  const code = base.alias[a]; aliases.get(j)[code >= 2 ** 29 ? 'hd' : 'hip'] = code % 2 ** 28;
}
for (let t = 0; t < T; t++) for (let j = base.start[t]; j < base.start[t + 1]; j++) {
  const ra = box[4 * t] + base.ra[j] / 65535 * box[4 * t + 2], dec = box[4 * t + 1] + base.dec[j] / 65535 * 3;
  const ids = aliases.get(j) || {};
  append(t, { ra, dec, pmra: base.pmra[j], pmdec: base.pmdec[j], plx: base.plx[j] * 0.02,
    mag: base.mag[j] / 20, bv: base.bv[j] === -128 ? null : base.bv[j] / 50, tyc: base.tyc[j], ...ids });
  index(ra, dec, base.tyc[j], ids.hip);
}
for (const s of CHART_STARS) index(s[1], s[2], 0, s[0]);
aliases.clear();

let columns, rows = 0, added = 0, duplicates = 0, rejected = 0, missingMotion = 0, missingColour = 0, repeatedRows = 0;
const seenGaia = new Set();
const hash = createHash('sha256'), stream = fs.createReadStream(input);
stream.on('data', (chunk) => hash.update(chunk));
const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
for await (const line of lines) {
  if (!columns) {
    columns = line.split(',');
    if (columns.join(',') !== 'source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag,bp_rp,tyc,hip') throw new Error('Unexpected Gaia CSV columns');
    continue;
  }
  if (!line.trim()) continue;
  const f = line.split(',').map((x) => x.replace(/^"|"$/g, ''));
  if (f.length !== columns.length || !/^\d{1,19}$/.test(f[0])) throw new Error(`Invalid CSV row ${rows + 1}`);
  rows++;
  // The external cross-match joins can return multiple rows per Gaia source.
  const gaia = BigInt(f[0]);
  if (seenGaia.has(gaia)) { repeatedRows++; continue; }
  seenGaia.add(gaia);
  const value = (i) => f[i].trim() === '' ? null : Number(f[i]);
  const v = visualMagnitude(value(6), value(7)), ra = value(1), dec = value(2);
  if (v === null || v > 12 || !Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) { rejected++; continue; }
  const pmra = value(3) ?? 0, pmdec = value(4) ?? 0, hip = value(9) || 0;
  const parts = /^(\d+)-(\d+)-(\d+)$/.exec(f[8]);
  const tyc = parts ? Number(parts[1]) * 65536 + Number(parts[2]) * 4 + Number(parts[3]) - 1 : 0;
  const [a, d] = j2000(ra, dec, pmra, pmdec);
  if ((tyc && tycs.has(tyc)) || (hip && hips.has(hip)) || matched(a, d)) { duplicates++; continue; }
  if (value(3) === null || value(4) === null) missingMotion++;
  const bv = johnsonColour(value(7));
  if (bv === null) missingColour++;
  append(tileOf(a, d), { ra: a, dec: d, pmra, pmdec, plx: Math.max(0, value(5) || 0), mag: v,
    bv, tyc, hip, gaia });
  added++;
}
// Independent COUNT(*) of the selection in gaia-stars.adql. The published
// DR3 tables are fixed; require the full result rather than a TAP row limit.
if (seenGaia.size !== 2323409) throw new Error(`Incomplete Gaia extract: expected 2323409 unique sources, received ${seenGaia.size}; refusing to write the catalog`);

let N = 0, A = 0;
for (const tile of tiles) {
  N += tile.n;
  for (let j = 0; j < tile.n; j++) A += Number(tile.bytes.readUInt32LE(32 * j + 24) > 0) + Number(tile.bytes.readUInt32LE(32 * j + 28) > 0);
}
const buffer = Buffer.alloc(24 + 20 * T + 24 * N + 8 * A);
buffer.write('STAR'); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(T, 8); buffer.writeUInt32LE(N, 12); buffer.writeUInt32LE(A, 16);
Buffer.from(box.buffer, box.byteOffset, box.byteLength).copy(buffer, 20);
let offset = 20 + 16 * T, first = 0;
for (const tile of tiles) { buffer.writeUInt32LE(first, offset); offset += 4; first += tile.n; }
buffer.writeUInt32LE(first, offset); offset += 4;
const at = {};
for (const [key, size] of [['tyc', 4], ['ra', 2], ['dec', 2], ['pmra', 2], ['pmdec', 2], ['plx', 2], ['mag', 1], ['bv', 1], ['aliasStar', 0], ['alias', 0]]) {
  at[key] = offset; offset += size * N;
}
at.alias = at.aliasStar + 4 * A;
const gaiaAt = at.aliasStar + 8 * A;
let j = 0, alias = 0;
for (const tile of tiles) {
  const b = tile.bytes, order = Uint32Array.from({ length: tile.n }, (_, i) => i);
  order.sort((a, b0) => b[32 * a + 22] - b[32 * b0 + 22] || a - b0);
  for (const k of order) {
    const o = 32 * k;
    b.copy(buffer, gaiaAt + 8 * j, o, o + 8); b.copy(buffer, at.tyc + 4 * j, o + 8, o + 12);
    for (const [key, pos] of [['ra', 12], ['dec', 14], ['pmra', 16], ['pmdec', 18], ['plx', 20]]) b.copy(buffer, at[key] + 2 * j, o + pos, o + pos + 2);
    buffer[at.mag + j] = b[o + 22]; buffer[at.bv + j] = b[o + 23];
    for (const [pos, flag] of [[24, 1], [28, 2]]) {
      const id = b.readUInt32LE(o + pos);
      if (id) {
        buffer.writeUInt32LE(j, at.aliasStar + 4 * alias); buffer.writeUInt32LE(flag * 2 ** 28 + id, at.alias + 4 * alias); alias++;
      }
    }
    j++;
  }
}
fs.writeFileSync(output, buffer);
const metadata = { format: 'STAR v2', depth: 12, stars: N, bytes: buffer.length, retainedATHYG: base.n, addedGaia: added,
  inputRows: rows, matchedExisting: duplicates, rejectedRows: rejected, addedWithoutProperMotion: missingMotion,
  uniqueGaiaSources: seenGaia.size, repeatedCrossmatchRows: repeatedRows,
  addedWithoutColour: missingColour,
  inputSha256: hash.digest('hex'), sha256: createHash('sha256').update(buffer).digest('hex'),
  source: 'ESA Gaia DR3, gaiadr3.gaia_source; query tools/gaia-stars.adql',
  photometry: 'Estimated Johnson V and B-V from observed G and BP-RP; ESA DR3 Tables 5.9/5.10; -0.5 <= BP-RP <= 5',
  matching: 'Keep AT-HYG data; exclude Gaia matches by TYC/HIP or J2000 position within 2 arcsec (10 arcsec for HIP systems)',
  acknowledgement: 'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.',
  license: 'Retained AT-HYG data: David Nash, CC BY-SA 4.0. Combined catalog distributed under CC BY-SA 4.0; Gaia acknowledgement above.' };
fs.writeFileSync(output.replace(/\.bin$/, '') + '.json', JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata, null, 2));
