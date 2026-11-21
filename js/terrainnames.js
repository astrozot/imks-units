import { EARTH, RAD } from './terrainmodel.js';
import { terrainFeaturePosition, snapTerrainSummits, TERRAIN_NAME_RADIUS } from './terrainfeatures.js';

const BASE = new URL('../data/terrain-names/', import.meta.url), CACHE = 'imks-data-terrain-names-v2', LIMIT = 48;
const SOURCES = { O: ['osm', 'OpenStreetMap'], G: ['geonames', 'GeoNames'] };
const VISIBILITY_CACHE = 'imks-data-terrain-visibility-v2', VISIBILITY_VERSION = 2;
const aborted = signal => { if (signal?.aborted) throw new DOMException('Peak names cancelled', 'AbortError'); };
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
// Spherical-cap bounds, including longitude wrap and circles touching a pole.
export function terrainNameTiles(place, radius = TERRAIN_NAME_RADIUS) {
  const delta = radius / EARTH, lat = place[0] * RAD;
  const south = Math.max(-90, place[0] - delta / RAD), north = Math.min(90, place[0] + delta / RAD);
  const dl = south <= -90 || north >= 90 ? 180 : Math.asin(Math.min(1, Math.sin(delta) / Math.cos(lat))) / RAD;
  const lon = ((place[1] + 180) % 360 + 360) % 360 - 180, keys = new Set();
  for (let y = Math.max(0, Math.floor((south + 90) / 10)); y <= Math.min(17, Math.floor((north + 90) / 10)); y++)
    for (let x = Math.floor((lon - dl + 180) / 10); x <= Math.floor((lon + dl + 180) / 10); x++) keys.add(`${y}-${(x % 36 + 36) % 36}`);
  return [...keys];
}

// A separate bounded cache survives app-shell upgrades. Network and storage
// failures are independent: downloaded names can still be used this session.
export async function fetchTerrainNames(place, { signal, refresh = false, fetchImpl = globalThis.fetch, cacheStorage = globalThis.caches } = {}) {
  let cache = null, persisted = true;
  try { cache = await cacheStorage?.open(CACHE); } catch {}
  if (!cache) persisted = false;
  const decode = async response => {
    let bytes = await response.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
    // Explicit gzip assets work on static hosting without Content-Encoding;
    // also accept a response already decompressed by the HTTP stack.
    if (header[0] === 31 && header[1] === 139) bytes = await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return { data: JSON.parse(new TextDecoder().decode(bytes)), bytes };
  };
  const read = async (url, validator, preferNetwork = false) => {
    aborted(signal);
    let saved = null;
    try { saved = await cache?.match(url); } catch { persisted = false; }
    if (saved && !preferNetwork) {
      try { const { data, bytes } = await decode(saved.clone()); await validator(data, bytes); return data; } catch { /* refetch corrupt cache */ }
    }
    try {
      const response = await fetchImpl(url, { signal, cache: 'no-cache' });
      if (!response.ok) throw new Error(`Peak names download failed (HTTP ${response.status})`);
      const { data, bytes } = await decode(response.clone()); await validator(data, bytes); aborted(signal);
      try { if (cache) { await cache.delete(url); await cache.put(url, response); } } catch { persisted = false; }
      return data;
    } catch (e) {
      aborted(signal);
      if (saved) { const { data, bytes } = await decode(saved.clone()); await validator(data, bytes); return data; }
      throw e;
    }
  };
  const index = await read(new URL('index.json', BASE).href, data => {
    if (data?.version !== 2 || data.tileDegrees !== 10 || !data.tiles) throw new Error('Invalid peak name index');
  }, refresh);
  const features = new Map();
  for (const key of terrainNameTiles(place)) {
    aborted(signal);
    const info = index.tiles[key];
    if (!info) continue;
    if (!/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error('Invalid peak name tile revision');
    const url = new URL(`${key}.json.gz?v=${info.sha256}`, BASE).href;
    const rows = await read(url, async (rows, bytes) => {
      if (!Array.isArray(rows) || rows.length !== info.count || rows.some(r => !Array.isArray(r) || r.length !== 7 || !SOURCES[r[6]] || !Number.isSafeInteger(r[0]) || r[0] <= 0 || typeof r[1] !== 'string' || !r[1].trim() || !Number.isFinite(r[2]) || Math.abs(r[2]) > 90 || !Number.isFinite(r[3]) || Math.abs(r[3]) > 180 || !(r[4] === null || Number.isFinite(r[4])) || !['MT', 'PK', 'HLL', 'VLC'].includes(r[5]))) throw new Error('Invalid peak name tile');
      if (await hash(bytes) !== info.sha256) throw new Error('Peak name catalog changed. Download peak names again');
    });
    for (const [id, name, lat, lon, elevation, code, source] of rows) if (terrainFeaturePosition(place, lat, lon).distance <= TERRAIN_NAME_RADIUS) {
      const [prefix, label] = SOURCES[source], key = `terrain:${prefix}:${id}`;
      features.set(key, { key, source: label, id, name, lat, lon, elevation, code });
    }
  }
  aborted(signal);
  try {
    const keys = await cache?.keys();
    if (keys) for (const key of keys.filter(k => !k.url.endsWith('/index.json')).slice(0, Math.max(0, keys.length - LIMIT - 1))) await cache.delete(key);
  } catch { persisted = false; }
  return { features: [...features.values()], persisted };
}

// Caches of the previous catalog format (GeoNames only) and its sightlines.
const RETIRED = ['imks-data-terrain-names-v1', 'imks-data-terrain-visibility-v1'];
export async function prepareTerrainNames(surface, { signal, refresh = false } = {}) {
  for (const name of RETIRED) globalThis.caches?.delete(name).catch(() => {});
  // Bound the whole job, including unresponsive provider/storage operations.
  const job = new AbortController(), abort = () => job.abort();
  const timer = setTimeout(abort, 60000); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const work = async () => {
    const result = await fetchTerrainNames(surface.place, { signal: job.signal, refresh });
    aborted(job.signal);
    // Summit snapping reads the height grids, which stay on this thread
    // (a few milliseconds); the worker receives the snapped candidates.
    const candidates = snapTerrainSummits(surface, result.features);
    // Exact content hashes prevent reusing sightlines after a terrain rebuild,
    // elevation change, geometry update or gazetteer update. Saved results also
    // avoid starting an offline module worker (unsupported in some WebKit builds).
    const geometry = await Promise.all(surface.meshes.map(async m => [await hash(m.positions), await hash(m.indices)]));
    const revision = await hash(new TextEncoder().encode(JSON.stringify({ geometry, eye: surface.eye, place: surface.place,
      near: surface.metrics?.nearField ?? 2, version: VISIBILITY_VERSION, features: candidates })));
    const key = new URL(`visibility-${revision}.json`, BASE).href;
    let cache = null;
    try { cache = await globalThis.caches?.open(VISIBILITY_CACHE); } catch {}
    try {
      const saved = await cache?.match(key), data = saved && await saved.json();
      if (data?.version === VISIBILITY_VERSION && Array.isArray(data.features) && data.features.every(f => typeof f.key === 'string' && Array.isArray(f.vector) && f.vector.length === 3 && f.vector.every(Number.isFinite))) {
        aborted(job.signal);
        return { features: data.features, total: result.features.length, persisted: result.persisted };
      }
    } catch { /* Recalculate if storage is unavailable or corrupt. */ }
    aborted(job.signal);
    const features = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./terrainnamesworker.js', import.meta.url), { type: 'module' });
      const finish = (fn, value) => { worker.terminate(); job.signal.removeEventListener('abort', cancel); fn(value); };
      const cancel = () => finish(reject, new DOMException('Peak names cancelled', 'AbortError'));
      job.signal.addEventListener('abort', cancel, { once: true });
      worker.onerror = e => finish(reject, new Error(e.message || 'Peak visibility calculation failed'));
      worker.onmessage = ({ data }) => data.error ? finish(reject, new Error(data.error)) : finish(resolve, data.features);
      // Copy geometry only; the much larger shading grids stay on the UI
      // thread and ownership of the renderer's mesh buffers is preserved.
      worker.postMessage({ features: candidates, surface: { place: surface.place, eye: surface.eye, profile: surface.profile,
        metrics: { nearField: surface.metrics?.nearField }, meshes: surface.meshes.map(m => ({ positions: m.positions, indices: m.indices })) } });
    });
    let persisted = result.persisted && Boolean(cache);
    aborted(job.signal);
    try {
      if (cache) {
        await cache.put(key, new Response(JSON.stringify({ version: VISIBILITY_VERSION, features }), { headers: { 'content-type': 'application/json' } }));
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - 12))) await cache.delete(old);
      }
    } catch { persisted = false; }
    return { features, total: result.features.length, persisted };
  };
  let interrupt;
  try {
    const interrupted = new Promise((_, reject) => {
      interrupt = () => reject(new DOMException('Peak name download interrupted', 'AbortError'));
      job.signal.addEventListener('abort', interrupt, { once: true });
      if (job.signal.aborted) interrupt();
    });
    return await Promise.race([work(), interrupted]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); job.signal.removeEventListener('abort', interrupt); }
}
