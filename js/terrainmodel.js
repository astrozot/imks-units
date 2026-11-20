// Terrain tile sampling and horizon geometry shared by the background worker.
export const RAD = Math.PI / 180, EARTH = 6371008.8;
export const providers = {
  mapterhorn: { size: 512, url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp` },
};
export const tileXY = (lat, lon, z) => [(lon + 180) / 360 * 2 ** z, (1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2 * 2 ** z];
export const spacing = (lat, z, size) => 2 * Math.PI * 6378137 * Math.cos(lat * RAD) / (size * 2 ** z);
export function destination(lat, lon, az, distance) {
  const a = distance / EARTH, p = lat * RAD, t = az * RAD;
  const q = Math.asin(Math.sin(p) * Math.cos(a) + Math.cos(p) * Math.sin(a) * Math.cos(t));
  return [q / RAD, lon + Math.atan2(Math.sin(t) * Math.sin(a) * Math.cos(p), Math.cos(a) - Math.sin(p) * Math.sin(q)) / RAD];
}
export function tilesFor(place, rings, radius) {
  const jobs = new Map(), [lat, lon] = place;
  for (const [z, end] of rings) {
    const d = Math.min(end, radius), dy = d / 110500, dx = d / (110500 * Math.cos(lat * RAD));
    const [x0, y1] = tileXY(lat - dy, lon - dx, z), [x1, y0] = tileXY(lat + dy, lon + dx, z);
    // One pixel of padding for interpolation across tile boundaries.
    const pad = 1 / 256;
    for (let y = Math.max(0, Math.floor(y0 - pad)); y <= Math.min(2 ** z - 1, Math.floor(y1 + pad)); y++)
      for (let x = Math.floor(x0 - pad); x <= Math.floor(x1 + pad); x++) jobs.set(`${z}/${x}/${y}`, [z, x, y]);
    if (end >= radius) break;
  }
  return [...jobs.values()];
}
export function tileSampler(tiles, legacyEdges = false, fallback = false) {
  const height = (tile, index) => { const raw = tile.h[index]; return raw === tile.noData ? null : raw * (tile.scale ?? 1) + (tile.offset ?? 0); };
  function pixel(z, x, y, size) {
    const n = 2 ** z, tx = Math.floor(x / size), ty = Math.floor(y / size);
    const tile = tiles.get(`${z}/${((tx % n) + n) % n}/${ty}`);
    return tile ? height(tile, ((y % size + size) % size) * size + ((x % size + size) % size)) : null;
  }
  const atZoom = (lat, lon, z) => {
    const [fx, fy] = tileXY(lat, lon, z), tx = Math.floor(fx), ty = Math.floor(fy);
    const tile = tiles.get(`${z}/${((tx % 2 ** z) + 2 ** z) % 2 ** z}/${ty}`);
    if (!tile) return null;
    const s = tile.size;
    let x = fx * s - 0.5, y = fy * s - 0.5;
    let i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, values;
    if (legacyEdges) {
      x = (fx - tx) * s - 0.5; y = (fy - ty) * s - 0.5;
      i = Math.max(0, Math.min(s - 2, Math.floor(x))); j = Math.max(0, Math.min(s - 2, Math.floor(y)));
      u = Math.max(0, Math.min(1, x - i)); v = Math.max(0, Math.min(1, y - j));
      values = [j*s+i,j*s+i+1,(j+1)*s+i,(j+1)*s+i+1].map(index => height(tile,index));
    } else values = [pixel(z, i, j, s), pixel(z, i + 1, j, s), pixel(z, i, j + 1, s), pixel(z, i + 1, j + 1, s)];
    if (values.some((h) => h === null || !Number.isFinite(h))) return null;
    return (values[0] * (1 - u) + values[1] * u) * (1 - v) + (values[2] * (1 - u) + values[3] * u) * v;
  };
  const zooms = [...new Set([...tiles.keys()].map((key) => Number(key.split('/')[0])))].sort((a, b) => b - a);
  const stats = { queries: 0, fallbackSamples: 0, missingSamples: 0, fallbackZooms: {} };
  const sample = (lat, lon, z) => {
    stats.queries++;
    const value = atZoom(lat, lon, z);
    if (value !== null) return value;
    if (fallback) for (const lower of zooms) if (lower < z) {
      const height = atZoom(lat, lon, lower);
      if (height !== null) { stats.fallbackSamples++; const key = `${z}->${lower}`; stats.fallbackZooms[key] = (stats.fallbackZooms[key] ?? 0) + 1; return height; }
    }
    stats.missingSamples++; return null;
  };
  sample.stats = stats;
  return sample;
}
export async function profile({ place, sample, rings, radius = 60000, legacy = false, size = 512, step = 0.05, distanceFraction = 0.75, startDistance = 20, onProgress = () => {}, depth = false }) {
  const started = performance.now(), [lat, lon, altitude] = place, n = Math.round(360 / step);
  let ground = sample(lat, lon, rings[0][0]);
  if (ground === null) throw new Error('Observer terrain is missing');
  const pointGround = ground;
  if (legacy) for (let k = 0; k < 8; k++) for (const d of [50, 100, 150]) ground = Math.max(ground, sample(...destination(lat, lon, k * 45, d), rings[0][0]) ?? 0);
  const eye = (legacy ? Math.max(altitude ?? 0, ground) : altitude ?? pointGround) + 2;
  const alt = [], distance = [], missing = [];
  const depthWidth = Math.min(n, 1800), depthStride = Math.max(1, Math.floor(n / depthWidth));
  const depthRaster = depth ? { width: depthWidth, height: 300, lo: -5, hi: 45, columns: [] } : null;
  const distances = [];
  for (let d = legacy ? 300 : startDistance; d <= radius;) {
    const z = rings.find((r) => d < r[1])?.[0] ?? rings.at(-1)[0];
    distances.push([d, z]);
    d = legacy ? d * 1.025 : d + Math.max(2, spacing(lat, z, size) * distanceFraction);
  }
  // Include ring boundaries so a thin crest at a resolution transition is not skipped.
  if (!legacy) {
    for (const [z, d] of rings) if (d <= radius) distances.push([d, z]);
    distances.sort((a, b) => a[0] - b[0]);
  }
  for (let k = 0; k < n; k++) {
    const az = k * 360 / n; let best = -90, bestD = null, absent = 0;
    const column = depth && k % depthStride === 0 && k / depthStride < depthWidth ? new Array(300).fill(0) : null;
    let nextHeight = 0;
    for (const [d, z] of distances) {
      let h = sample(...destination(lat, lon, az, d), z);
      if (h === null) { absent++; continue; }
      if (legacy) h = Math.max(0, h);
      const a = Math.atan2(h - eye - d * d * 0.87 / (2 * EARTH), d) / RAD;
      if (a > best) {
        best = a; bestD = d;
        if (column) while (nextHeight < 300 && -5 + nextHeight / 300 * 50 <= a) column[nextHeight++] = Math.round(d);
      }
    }
    alt.push(bestD === null ? null : best); distance.push(bestD); missing.push(absent / distances.length);
    if (column) depthRaster.columns.push(column);
    if (k % 120 === 0) { onProgress(k / n); await new Promise((r) => setTimeout(r, 0)); }
  }
  return { alt, distance, missing, depthRaster, eye, pointGround, nearbyGround: ground, step: 360 / n, radius, distanceFraction, samplesPerRay: distances.length, samplingCoverage: sample.stats ? structuredClone(sample.stats) : null, computeMs: performance.now() - started };
}
// Fast resampling of decoded tiles onto a local east/north lattice: texel
// centres -extent+(i+0.5)*2*extent/size, or with `corners` the mesh vertices
// -extent+i*2*extent/(size-1). The azimuthal → Web Mercator map
// is evaluated exactly on a lattice every `block` texels and interpolated in
// between (error far below 0.01 source pixel); the DEM is then bilinear.
// Texels whose source pixels are missing use `fallback` (lower zooms).
// Returns heights relative to `eye`, NaN where no data exists.
export function resampleGrid({ tiles, place, zoom, extent, size, eye, fallback = null, block = 32, corners = false }) {
  const out = new Float32Array(size * size), step = extent * 2 / (corners ? size - 1 : size), start = corners ? 0 : 0.5, nb = Math.ceil(size / block), L = nb + 1;
  const tileList = [...tiles].filter(([key]) => key.startsWith(zoom + '/'));
  const P = tileList[0]?.[1].size ?? 512, n = 2 ** zoom, gx = new Float64Array(L * L), gy = new Float64Array(L * L);
  const index = new Map(tileList.map(([key, tile]) => [key.slice(key.indexOf('/') + 1), tile]));
  for (let b = 0; b < L; b++) for (let a = 0; a < L; a++) {
    const x = -extent + (a * block + start) * step, y = -extent + (b * block + start) * step;
    const [fx, fy] = tileXY(...destination(place[0], place[1], Math.atan2(x, y) / RAD, Math.hypot(x, y)), zoom);
    gx[b * L + a] = fx * P; gy[b * L + a] = fy * P;
  }
  let lastX = NaN, lastY = NaN, last = null;
  const pixel = (i, j) => {
    const tx = Math.floor(i / P), ty = Math.floor(j / P);
    if (tx !== lastX || ty !== lastY) { lastX = tx; lastY = ty; last = index.get(`${((tx % n) + n) % n}/${ty}`) ?? null; }
    if (!last) return NaN;
    const raw = last.h[(j - ty * P) * P + (i - tx * P)];
    return raw === last.noData ? NaN : raw * (last.scale ?? 1) + (last.offset ?? 0);
  };
  for (let j = 0; j < size; j++) {
    const b = Math.floor(j / block), v = (j - b * block) / block;
    for (let i = 0; i < size; i++) {
      const a = Math.floor(i / block), u = (i - a * block) / block, k0 = b * L + a, k1 = k0 + L;
      const px = (gx[k0] * (1 - u) + gx[k0 + 1] * u) * (1 - v) + (gx[k1] * (1 - u) + gx[k1 + 1] * u) * v - 0.5;
      const py = (gy[k0] * (1 - u) + gy[k0 + 1] * u) * (1 - v) + (gy[k1] * (1 - u) + gy[k1 + 1] * u) * v - 0.5;
      const pi = Math.floor(px), pj = Math.floor(py), fu = px - pi, fv = py - pj;
      let h = (pixel(pi, pj) * (1 - fu) + pixel(pi + 1, pj) * fu) * (1 - fv) + (pixel(pi, pj + 1) * (1 - fu) + pixel(pi + 1, pj + 1) * fu) * fv;
      if (Number.isNaN(h) && fallback) {
        const x = -extent + (i + start) * step, y = -extent + (j + start) * step;
        h = fallback(...destination(place[0], place[1], Math.atan2(x, y) / RAD, Math.hypot(x, y)), zoom) ?? NaN;
      }
      out[j * size + i] = h - eye;
    }
  }
  return out;
}
