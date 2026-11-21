// Source tiles of local terrain (Mapterhorn elevation, WorldCover land cover)
// kept in Cache Storage, so that a nearby viewpoint or a new eye height
// downloads only the tiles it lacks (a 1 km move needs ~6 of ~325 elevation
// tiles). The tiles of the last KEEP builds stay; older ones are pruned, and
// any tile older than MAX_AGE is fetched again. Caches named imks-data…
// survive app updates (sw.js). Without Cache Storage (private modes), plain
// fetches.
const CACHE = 'imks-data-terrain-tiles', INDEX = 'https://imks.invalid/terrain-tile-builds', KEEP = 3, MAX_AGE = 60 * 864e5;

export function terrainTileStore({ cacheStorage = globalThis.caches, fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  const used = new Set(), stats = { cached: 0, fetched: 0, bytes: 0 };
  let opened = null;
  const open = () => opened ??= (async () => { try { return cacheStorage ? await cacheStorage.open(CACHE) : null; } catch { return null; } })();
  async function get(url) {
    used.add(url);
    const cache = await open();
    if (cache) try {
      const hit = await cache.match(url);
      if (hit && now() - Number(hit.headers.get('x-imks-stored')) < MAX_AGE) { stats.cached++; return hit; }
    } catch { /* storage unavailable: download */ }
    const response = await fetchImpl(url);
    if (!cache) { stats.fetched++; stats.bytes += Number(response.headers.get('content-length')) || 0; return response; }
    // Missing land-cover items (open sea) answer 404: remember those too.
    if (!(response.ok || response.status === 404)) return response;
    const body = response.ok ? await response.blob() : null;
    const headers = { 'x-imks-stored': String(now()), 'content-type': response.headers.get('content-type') || '' };
    stats.fetched++; stats.bytes += body?.size || 0;
    try { await cache.put(url, new Response(body, { status: response.status, headers })); } catch { /* full: still usable */ }
    return new Response(body, { status: response.status, headers });
  }
  // After a successful build: remember its tiles, drop those of older builds.
  async function commit() {
    const cache = await open();
    if (!cache) return;
    try {
      let builds = [];
      try { builds = (await (await cache.match(INDEX))?.json()) || []; } catch { builds = []; }
      builds = [...builds.filter(Array.isArray), [...used]].slice(-KEEP);
      await cache.put(INDEX, new Response(JSON.stringify(builds), { headers: { 'content-type': 'application/json' } }));
      const keep = new Set(builds.flat());
      for (const request of await cache.keys()) if (request.url !== INDEX && !keep.has(request.url)) await cache.delete(request);
    } catch { /* pruning is best effort */ }
  }
  return { fetch: get, commit, stats };
}

