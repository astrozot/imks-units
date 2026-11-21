import assert from 'node:assert/strict';
import { landcoverItem, itemsForTile, mergeTiles, resampleClasses, landcoverIndex, loadLandcover, LANDCOVER_CODES } from '../js/terrainlandcover.js';
import { tileXY } from '../js/terrainmodel.js';
// 3°×3° items are named by their south-west corner.
assert.equal(landcoverItem(45.9, 10.8), 'ESA_WorldCover_10m_2021_v200_N45E009');
assert.equal(landcoverItem(-0.5, -0.5), 'ESA_WorldCover_10m_2021_v200_S03W003');
assert.equal(landcoverItem(-33.9, 151.2), 'ESA_WorldCover_10m_2021_v200_S36E150');
// A tile across an item edge (lon 12°) needs both items; one inside needs one.
assert.deepEqual(itemsForTile(10, 546, 364).sort(), ['ESA_WorldCover_10m_2021_v200_N45E009', 'ESA_WorldCover_10m_2021_v200_N45E012']);
assert.deepEqual(itemsForTile(14, 8685, 5836), ['ESA_WorldCover_10m_2021_v200_N45E009']);
// Codes map to compact indices; unknown codes are 0.
LANDCOVER_CODES.forEach((code, i) => assert.equal(landcoverIndex(code), i + 1));
assert.equal(landcoverIndex(0), 0); assert.equal(landcoverIndex(55), 0);
// Safari returns decoded class values up to ±2 off: they snap to the code.
for (const [v, code] of [[9, 10], [11, 10], [8, 10], [79, 80], [82, 80], [93, 95], [97, 95], [98, 100]]) assert.equal(landcoverIndex(v), landcoverIndex(code), `${v}`);
// Merging: each item's tile is transparent outside the item.
const part = (value, from, to) => { const rgba = new Uint8Array(256 * 256 * 4); for (let i = from; i < to; i++) { rgba[i * 4] = value; rgba[i * 4 + 3] = 255; } return rgba; };
const merged = mergeTiles([part(10, 0, 30000), part(80, 30000, 65536)]);
assert.equal(merged[0], landcoverIndex(10)); assert.equal(merged[65535], landcoverIndex(80));
// Resampling picks the tile pixel under each texel centre.
const place = [45.88, 10.84], z = 14, [cx, cy] = tileXY(place[0], place[1], z), tiles = new Map();
for (let ty = Math.floor(cy) - 2; ty <= Math.floor(cy) + 2; ty++) for (let tx = Math.floor(cx) - 2; tx <= Math.floor(cx) + 2; tx++) {
  const t = new Uint8Array(65536); for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) t[j * 256 + i] = 1 + ((tx * 256 + i) >> 6) % 11; tiles.set(`${z}/${tx}/${ty}`, t);
}
const grid = resampleClasses({ tiles, place, zoom: z, extent: 1000, size: 64 });
for (let k = 0; k < grid.length; k += 97) {
  const i = k % 64, j = (k - i) / 64, x = -1000 + (i + .5) * 2000 / 64, y = -1000 + (j + .5) * 2000 / 64;
  const lon = place[1] + x / (111320 * Math.cos(place[0] * Math.PI / 180)), px = Math.floor(((lon + 180) / 360) * 2 ** z * 256);
  const expected = 1 + (px >> 6) % 11, near = [px - 1, px + 1].map(p => 1 + (p >> 6) % 11);
  assert.ok(grid[k] === expected || near.includes(grid[k]), `texel ${k}: ${grid[k]} vs ${expected}`);
}
// Loading: sea items (404) are not failures; other errors are counted; no
// tile leaves class 0 (the plain colouring).
const png = rgba => ({ ok: true, status: 200, blob: async () => ({ size: 100, rgba }) });
let calls = 0;
const result = await loadLandcover({ place, rings: [[14, 1000]], sizes: [32], decode: async blob => blob.rgba,
  fetchImpl: async url => { calls++; return /N45E009/.test(url) ? png(part(30, 0, 65536)) : { ok: false, status: 404 }; } });
assert.ok(calls > 0); assert.equal(result.metrics.failed, 0);
assert.ok(result.grids[0].classes.every(c => c === landcoverIndex(30)));
const broken = await loadLandcover({ place, rings: [[14, 1000]], sizes: [32], decode: async () => { throw new Error('bad'); }, fetchImpl: async () => png(null) });
assert.ok(broken.metrics.failed > 0); assert.ok(broken.grids[0].classes.every(c => c === 0));
console.log('Land cover: item names, edge merging, class indices, resampling and failures passed');
