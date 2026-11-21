// Land cover for terrain colours: ESA WorldCover 2021 (10 m, CC BY 4.0), read
// as raw class codes from Microsoft Planetary Computer's tiler, which allows
// browser requests (the original files on AWS do not). Classes only choose a
// material; colour and light come from the renderer. Missing or failed tiles
// stay 0 and keep the plain slope-based colouring.
import { RAD, tileXY, destination, squareBounds } from './terrainmodel.js';

export const LANDCOVER = Object.freeze({
  source: 'ESA WorldCover 2021 v200',
  attribution: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
  license: 'CC BY 4.0',
  host: 'Microsoft Planetary Computer',
});
// WorldCover codes → compact indices used by the shader (0 = unknown).
export const LANDCOVER_CODES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];
// Safari colour-manages greyscale PNGs while decoding: class values come back
// up to ±2 off (9 or 11 for 10). Codes are at least 5 apart, so values within
// 2 of a code are snapped to it; anything else is unknown.
const INDEX = new Uint8Array(256);
LANDCOVER_CODES.forEach((code, i) => { for (let v = code - 2; v <= code + 2; v++) INDEX[v] = i + 1; });
export const landcoverIndex = code => INDEX[code] || 0;
// Zoom per terrain ring: tile pixels near each ring's texel size.
export const LANDCOVER_ZOOMS = [14, 14, 12, 10, 9];

// The 3°×3° WorldCover item containing a point (named by its SW corner).
export function landcoverItem(lat, lon) {
  const a = Math.floor(lat / 3) * 3, b = Math.floor(lon / 3) * 3;
  return `ESA_WorldCover_10m_2021_v200_${a < 0 ? 'S' : 'N'}${String(Math.abs(a)).padStart(2, '0')}${b < 0 ? 'W' : 'E'}${String(Math.abs(b)).padStart(3, '0')}`;
}
export const landcoverUrl = (item, z, x, y) => `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/${z}/${x}/${y}@1x.png?collection=esa-worldcover&item=${item}&assets=map`;

const tileLon = (x, z) => x / 2 ** z * 360 - 180;
const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) / RAD;
// Every item a tile overlaps (tiles at low zoom can span several).
export function itemsForTile(z, x, y) {
  const west = tileLon(x, z), east = tileLon(x + 1, z), north = tileLat(y, z), south = tileLat(y + 1, z), items = new Set();
  for (let a = Math.floor(south / 3) * 3; a < north; a += 3) for (let b = Math.floor(west / 3) * 3; b < east; b += 3) items.add(landcoverItem(a + 1.5, b + 1.5));
  return [...items];
}

// Merge item tiles: each item's tile is transparent outside the item.
export function mergeTiles(parts, size = 256) {
  const out = new Uint8Array(size * size);
  for (const rgba of parts) for (let i = 0; i < out.length; i++) if (rgba[i * 4 + 3] && !out[i]) out[i] = landcoverIndex(rgba[i * 4]);
  return out;
}

// Classes at texel centres of a ring (as the height grids), nearest pixel.
export function resampleClasses({ tiles, place, zoom, extent, size, block = 32 }) {
  const out = new Uint8Array(size * size), step = extent * 2 / size, P = 256, n = 2 ** zoom, nb = Math.ceil(size / block), L = nb + 1;
  const gx = new Float64Array(L * L), gy = new Float64Array(L * L);
  for (let b = 0; b < L; b++) for (let a = 0; a < L; a++) {
    const x = -extent + (a * block + 0.5) * step, y = -extent + (b * block + 0.5) * step;
    const [fx, fy] = tileXY(...destination(place[0], place[1], Math.atan2(x, y) / RAD, Math.hypot(x, y)), zoom);
    gx[b * L + a] = fx * P; gy[b * L + a] = fy * P;
  }
  for (let j = 0; j < size; j++) {
    const b = Math.floor(j / block), v = (j - b * block) / block;
    for (let i = 0; i < size; i++) {
      const a = Math.floor(i / block), u = (i - a * block) / block, k0 = b * L + a, k1 = k0 + L;
      const px = Math.floor((gx[k0] * (1 - u) + gx[k0 + 1] * u) * (1 - v) + (gx[k1] * (1 - u) + gx[k1 + 1] * u) * v);
      const py = Math.floor((gy[k0] * (1 - u) + gy[k0 + 1] * u) * (1 - v) + (gy[k1] * (1 - u) + gy[k1 + 1] * u) * v);
      const tx = Math.floor(px / P), ty = Math.floor(py / P), tile = tiles.get(`${zoom}/${((tx % n) + n) % n}/${ty}`);
      out[j * size + i] = tile ? tile[(py - ty * P) * P + (px - tx * P)] : 0;
    }
  }
  return out;
}

// Tiles (z/x/y) covering a ring's square, as for elevation.
function tilesForRing(place, zoom, extent) {
  const { south, north, west, east } = squareBounds(place, extent), jobs = new Map();
  const [x0, y1] = tileXY(south, west, zoom), [x1, y0] = tileXY(north, east, zoom);
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(2 ** zoom - 1, Math.floor(y1)); y++)
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) jobs.set(`${zoom}/${x}/${y}`, [zoom, ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom, y]);
  return jobs;
}

// Download and resample land cover for all rings. decode(blob) → RGBA bytes.
export async function loadLandcover({ place, rings, sizes, decode, fetchImpl = fetch, progress = () => {}, concurrency = 6 }) {
  const jobs = new Map();
  rings.forEach(([, extent], r) => { for (const [key, job] of tilesForRing(place, LANDCOVER_ZOOMS[r], extent)) jobs.set(key, job); });
  const tiles = new Map(), queue = [...jobs.values()], total = queue.length;
  let done = 0, failed = 0, bytes = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const [z, x, y] = queue.shift(), parts = [];
      for (const item of itemsForTile(z, x, y)) {
        try {
          const response = await fetchImpl(landcoverUrl(item, z, x, y));
          // Items over open sea do not exist; any other failure is reported.
          if (!response.ok) { if (response.status !== 404) failed++; continue; }
          const blob = await response.blob(); bytes += blob.size; parts.push(await decode(blob));
        } catch { failed++; }
      }
      if (parts.length) tiles.set(`${z}/${x}/${y}`, mergeTiles(parts));
      progress(`Downloading land cover… ${++done}/${total}`);
    }
  }));
  const grids = rings.map(([, extent], r) => ({ size: sizes[r], classes: resampleClasses({ tiles, place, zoom: LANDCOVER_ZOOMS[r], extent, size: sizes[r] }) }));
  return { grids, metrics: { ...LANDCOVER, tiles: total, failed, bytes } };
}
