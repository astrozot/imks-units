// The local horizon: the altitude of the terrain all around a place, from
// elevation tiles (Terrarium PNGs of the AWS / Mapzen Terrain Tiles: SRTM,
// Copernicus and other models) out to 150 km, with the Earth's curvature
// and terrestrial refraction. Kept on the device for each place, so the
// sky uses it offline; buildings and trees are not in the models.
const TILE = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const KEY = 'imks-coelum-horizons', R = Math.PI / 180, EARTH = 6371008.8, K = 0.13, STEPS = 720;
// Finer tiles near the place: zoom, from, to (m).
const RINGS = [[12, 0, 6000], [10, 6000, 40000], [8, 40000, 150000]];
const placeKey = (place) => `${place[0].toFixed(3)},${place[1].toFixed(3)}`;

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
// The profile computed for a place (to about 100 m), or null.
export function storedHorizon(place) {
  const p = readAll()[placeKey(place)];
  return p ? Float32Array.from(p.alt) : null;
}
function save(place, profile) {
  const all = readAll();
  all[placeKey(place)] = { time: Date.now(), alt: Array.from(profile, (x) => Math.round(x * 100) / 100) };
  // Keep the twelve most recent places.
  const keys = Object.keys(all).sort((a, b) => all[b].time - all[a].time);
  for (const k of keys.slice(12)) delete all[k];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* full or private: kept for this session only */ }
}
export function forgetHorizon(place) {
  const all = readAll();
  delete all[placeKey(place)];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
}
// The terrain's altitude (degrees) at an azimuth, interpolated.
export const horizonAt = (profile) => (az) => {
  const x = ((az % 360) + 360) % 360 * (STEPS / 360), i = Math.floor(x), u = x - i;
  return profile[i % STEPS] * (1 - u) + profile[(i + 1) % STEPS] * u;
};

const tileX = (lon, z) => (lon + 180) / 360 * 2 ** z;
const tileY = (lat, z) => (1 - Math.log(Math.tan(lat * R) + 1 / Math.cos(lat * R)) / Math.PI) / 2 * 2 ** z;
async function loadTile(z, x, y) {
  const n = 2 ** z, url = TILE(z, ((x % n) + n) % n, y);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain tile ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob()), c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, h = new Float32Array(c.width * c.height);
  // Terrarium: (R × 256 + G + B / 256) − 32768 m; the sea at its surface.
  for (let i = 0; i < h.length; i++) h[i] = Math.max(0, d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768);
  return { size: c.width, h };
}

// The point at a distance (m) and azimuth (degrees) from a place.
function destination(lat, lon, az, d) {
  const a = d / EARTH, p = lat * R, t = az * R;
  const q = Math.asin(Math.sin(p) * Math.cos(a) + Math.cos(p) * Math.sin(a) * Math.cos(t));
  return [q / R, lon + Math.atan2(Math.sin(t) * Math.sin(a) * Math.cos(p), Math.cos(a) - Math.sin(p) * Math.sin(q)) / R];
}

// Downloads the tiles around a place (about 40, some MB) and computes its
// horizon every half degree; progress(fraction) reports the downloads.
export async function computeHorizon(place, progress = () => {}) {
  const [lat, lon] = place, jobs = [];
  for (const [z, , to] of RINGS) {
    const dLat = to / 111320, dLon = to / (111320 * Math.max(0.05, Math.cos(lat * R)));
    const x0 = Math.floor(tileX(lon - dLon, z)), x1 = Math.floor(tileX(lon + dLon, z));
    const y0 = Math.floor(tileY(Math.min(85, lat + dLat), z)), y1 = Math.floor(tileY(Math.max(-85, lat - dLat), z));
    for (let x = x0; x <= x1; x++) for (let y = Math.max(0, y0); y <= Math.min(2 ** z - 1, y1); y++) jobs.push([z, x, y]);
  }
  const tiles = new Map();
  let done = 0, failed = 0;
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const [z, x, y] = queue.shift();
      try { tiles.set(`${z}/${x}/${y}`, await loadTile(z, x, y)); } catch { failed++; }
      progress(++done / jobs.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (failed > jobs.length / 4) throw new Error('Could not download the terrain (offline?)');
  const elevation = (z, la, lo) => {
    const fx = tileX(lo, z), fy = tileY(la, z), tx = Math.floor(fx), ty = Math.floor(fy), t = tiles.get(`${z}/${tx}/${ty}`);
    if (!t) return null;
    const px = (fx - tx) * t.size - 0.5, py = (fy - ty) * t.size - 0.5;
    const i = Math.max(0, Math.min(t.size - 2, Math.floor(px))), j = Math.max(0, Math.min(t.size - 2, Math.floor(py)));
    const u = Math.max(0, Math.min(1, px - i)), v = Math.max(0, Math.min(1, py - j)), h = t.h, s = t.size;
    return (h[j * s + i] * (1 - u) + h[j * s + i + 1] * u) * (1 - v) + (h[(j + 1) * s + i] * (1 - u) + h[(j + 1) * s + i + 1] * u) * v;
  };
  // The eye: the given height, but never under the ground nearby (models
  // include some buildings and noise), plus 2 m; the rays start at 300 m,
  // so the closest bumps do not make the horizon.
  let ground = elevation(RINGS[0][0], lat, lon) ?? 0;
  for (let k = 0; k < 8; k++) for (const d of [50, 100, 150]) ground = Math.max(ground, elevation(RINGS[0][0], ...destination(lat, lon, k * 45, d)) ?? 0);
  const h0 = Math.max(place[2] || 0, ground) + 2;
  const profile = new Float32Array(STEPS);
  for (let k = 0; k < STEPS; k++) {
    let best = -90;
    for (let d = 300; d <= RINGS.at(-1)[2]; d *= 1.025) {
      const z = RINGS.find((r) => d < r[2])[0], [la, lo] = destination(lat, lon, k * 360 / STEPS, d), h = elevation(z, la, lo);
      if (h === null) continue;
      const alt = Math.atan2(h - h0 - d * d * (1 - K) / (2 * EARTH), d) / R;
      if (alt > best) best = alt;
    }
    profile[k] = best;
  }
  save(place, profile);
  return profile;
}
