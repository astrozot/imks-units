// node tools/openngc.mjs <directory containing NGC.csv and addendum.csv>
// Sources pinned at https://github.com/mattiaverga/OpenNGC/tree/be3cd6c5498806a2fbb2f7e0452ef802dbb02be0/database_files
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const dir = process.argv[2];
if (!dir) throw new Error('usage: node tools/openngc.mjs <directory>');
const types = { G: 'galaxy', GPair: 'galaxy pair', GTrpl: 'galaxy triplet', GGroup: 'group of galaxies', OCl: 'open cluster', GCl: 'globular cluster', 'Cl+N': 'cluster with nebula', PN: 'planetary nebula', HII: 'H II region', RfN: 'reflection nebula', EmN: 'emission nebula', Neb: 'nebula', DrkN: 'dark nebula', SNR: 'supernova remnant', '*Ass': 'star cloud', '**': 'double star', '*': 'star', Nova: 'nova', Other: 'object' };
const designation = (s) => s.replace(/^(NGC|IC)0*(\d+.*)$/, '$1 $2');
const sexa = (s, k) => { const [a, b, c] = s.split(':').map(Number); return Number((k * (s.startsWith('-') ? -1 : 1) * (Math.abs(a) + b / 60 + c / 3600)).toFixed(5)); };
// RFC 4180 quoting, with OpenNGC's semicolon separator (notes contain semicolons).
function csv(source) {
  const records = []; let record = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ';' || c === '\n')) {
      record.push(field); field = '';
      if (c === '\n') { records.push(record); record = []; }
    } else if (c !== '\r' || quoted) field += c;
  }
  if (quoted) throw new Error('Unterminated CSV field');
  if (field || record.length) { record.push(field); records.push(record); }
  return records;
}
const rows = [], hashes = {};
for (const file of ['NGC.csv', 'addendum.csv']) {
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  hashes[file] = createHash('sha256').update(source).digest('hex');
  const [columns, ...records] = csv(source);
  for (const record of records) {
    if (record.length !== columns.length) throw new Error(`Invalid row in ${file}`);
    rows.push(Object.fromEntries(record.map((v, i) => [columns[i], v])));
  }
}
const objects = [], byId = new Map();
for (const r of rows) {
  if (!types[r.Type] || !r.RA || !r.Dec) continue; // Dup and NonEx are not plotted.
  const names = [...r.M ? [`M${Number(r.M)}`] : [], designation(r.Name), ...r['Common names'].split(',').filter(Boolean).map((s) => s.trim())];
  for (const prefix of ['NGC', 'IC']) for (const id of r[prefix].split(',').filter(Boolean)) names.push(designation(prefix + id.trim()));
  const number = (v) => v ? Number(v) : null;
  const o = [[...new Set(names)], sexa(r.RA, 15), sexa(r.Dec, 1), number(r['V-Mag'] || r['B-Mag']), types[r.Type], number(r.MajAx), number(r.MinAx), r['V-Mag'] ? 'V' : r['B-Mag'] ? 'B' : null];
  objects.push(o); byId.set(r.Name, o);
}
for (const r of rows.filter((r) => r.Type === 'Dup')) {
  for (const prefix of ['NGC', 'IC']) for (const id of r[prefix].split(',').filter(Boolean)) {
    const master = byId.get(prefix + id.trim());
    if (master && !master[0].includes(designation(r.Name))) master[0].push(designation(r.Name));
  }
}
const out = { version: 1, source: 'https://github.com/mattiaverga/OpenNGC', revision: 'be3cd6c5498806a2fbb2f7e0452ef802dbb02be0', attribution: 'OpenNGC, Mattia Verga; NASA/IPAC NED, HyperLEDA, SIMBAD (CDS), HEASARC and Harold Corwin. Converted to decimal degrees and compact rows; duplicate designations merged; nonexistent objects omitted.', license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', sourceSha256: hashes, objects };
fs.writeFileSync(new URL('../data/openngc.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`${objects.length} objects`);
