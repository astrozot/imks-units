// Selection identity audit across every built-in and downloadable star.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readStars, setFaintStars, FaintHit, skyFrame, findObject, searchSky } from '../js/coelum.js';

const frame = skyFrame(Date.UTC(2026, 10, 12) / 1000, [45, 9, 0]);
const builtins = frame.stars.flatMap((s) => [s.name, ...s.designations]);
for (const depth of [8, 10, 11, 12]) {
  const bytes = fs.readFileSync(new URL(`../data/stars-${depth}.bin`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const catalog = readStars(buffer);
  setFaintStars(buffer);
  const names = new Set(builtins), exceptional = new Set();
  for (let j = 0; j < catalog.n; j++) {
    const name = new FaintHit(j, 0, 0, 1).name;
    assert.ok(!names.has(name), `V${depth}: ambiguous selection ${name}`);
    names.add(name);
    if (name.startsWith('Catalog ')) exceptional.add(j);
  }
  for (let k = 0; k < catalog.alias.length; k++) {
    const code = catalog.alias[k], alias = `${code >= 2 ** 29 ? 'HD' : 'HIP'} ${code % 2 ** 28}`;
    if (catalog.sharedNames.has(alias)) exceptional.add(catalog.aliasStar[k]);
  }
  // Every formerly ambiguous or unnamed entry must resolve to its own
  // coordinates, and remain selectable after a search result is chosen.
  for (const j of exceptional) {
    const name = new FaintHit(j, 0, 0, 1).name, star = findObject(frame, name);
    assert.equal(star?.name, name);
    let tile = 0;
    while (catalog.start[tile + 1] <= j) tile++;
    const offset = 4 * tile;
    const expected = frame.apparentCatalog(catalog.box[offset] + catalog.ra[j] / 65535 * catalog.box[offset + 2],
      catalog.box[offset + 1] + catalog.dec[j] / 65535 * catalog.box[offset + 3], catalog.pmra[j], catalog.pmdec[j], catalog.plx[j] * 0.02);
    assert.equal(star.ra, expected.ra, `V${depth}: correct component RA for ${name}`);
    assert.equal(star.dec, expected.dec, `V${depth}: correct component declination for ${name}`);
    assert.equal(searchSky(frame, name)[0]?.name, name);
  }
  console.log(`V${depth}: ${catalog.n.toLocaleString('en')} unique selectable stars; ${exceptional.size} formerly ambiguous/unnamed entries checked`);
}
setFaintStars(null);
