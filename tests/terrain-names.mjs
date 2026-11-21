import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { destination } from '../js/terrainmodel.js';
import { terrainFeaturePosition, visibleTerrainFeatures, terrainFeatureDetails, snapTerrainSummits } from '../js/terrainfeatures.js';
import { makeRing, meshHorizon } from '../js/terrainmesh.js';
import { terrainNameTiles, fetchTerrainNames } from '../js/terrainnames.js';

const place = [0, 0, 0];
const peak = (distance, az = 0, id = distance) => { const [lat, lon] = destination(0, 0, az, distance); return { key: `terrain:geonames:${id}`, id, name: 'Summit', lat, lon, elevation: null, code: 'PK' }; };
// Two triangles per strip. Foreground and background are independently
// adjustable; bearings straddle north (the wrapped angular interval).
function landscape(heights) {
  const positions = [], indices = [];
  for (const [i, h] of heights.entries()) for (const x of [-1000, 1000]) positions.push(x, 10 + i * 1000, h);
  for (let i = 0; i < heights.length - 1; i++) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  return { place, eye: 2, meshes: [{ positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }] };
}
const frontPeak = peak(2010);
let visible = visibleTerrainFeatures(landscape([-2, 50, 200, 1000, 2000]), [frontPeak]);
assert.equal(visible.length, 1, 'A higher skyline behind a summit must not hide it');
assert.ok(Math.abs(visible[0].alt - Math.atan2(200, 2010) * 180 / Math.PI) < 1e-7);
assert.equal(visibleTerrainFeatures(landscape([-2, 300, 200, 1000, 2000]), [frontPeak]).length, 0, 'Nearer ridge hides the summit');
assert.equal(visibleTerrainFeatures(landscape([-2, 50, 200]), [peak(4000)]).length, 0, 'Missing target geometry is omitted');
assert.equal(visibleTerrainFeatures(landscape([-2, 50, 200, 300]), [peak(2500, 359), peak(2500, 1)]).length, 2, 'Rays on both sides of north are tested');
assert.equal(visibleTerrainFeatures(landscape([-2, 50, 200, 300]), [peak(151000)]).length, 0);
assert.ok(Math.abs(terrainFeaturePosition([0, 179.99], 0, -179.99).distance - 2223.90160467) < 1e-5);

// A slightly hidden summit is still named (what a person would do): within
// the mesh tolerance, or hidden only by its own slope in front of it.
visible = visibleTerrainFeatures(landscape([-2, 102, 200, 300, 2000]), [peak(2010)]);
assert.equal(visible.length, 1, 'Hidden by 3 m: still named');
assert.ok(Math.abs(visible[0].alt - Math.atan2(102 * 2010 / 1010, 2010) * 180 / Math.PI) < 1e-6, 'The label sits on the visible crest in front, not inside the hill');
assert.equal(visibleTerrainFeatures(landscape([-2, 131, 200, 300, 2000]), [peak(2010)]).length, 0, 'Hidden by 60 m behind a ridge 1 km nearer');
{
  const own = landscape([-2, 50, 200, 2000]);
  own.meshes[0].positions = Float32Array.from([...own.meshes[0].positions, -1000, 1910, 205, 1000, 1910, 205]);
  // Re-triangulate the last strip through a front crest 100 m before the summit.
  const p = own.meshes[0].positions, n = p.length / 3, idx = [...own.meshes[0].indices];
  idx.splice(6, 6, 2, 3, n - 2, 3, n - 1, n - 2, n - 2, n - 1, 4, n - 1, 5, 4);
  own.meshes[0].indices = Uint32Array.from(idx);
  const [f] = visibleTerrainFeatures(own, [peak(2010)]);
  assert.ok(f, 'Own slope in front of the summit (100 m) does not hide it');
  assert.ok(Math.abs(f.alt - Math.atan2(200, 2010) * 180 / Math.PI) < .02, 'Anchored at the summit');
}
// Gazetteer points on a slope climb to the summit; records reaching the same
// summit merge (peak/mountain over hill, then the nearest record).
{
  const top = [0.03, 0.002], cone = (lat, lon) => Math.max(0, 1500 - Math.hypot((lat - top[0]) * 111195, (lon - top[1]) * 111195) * .5);
  const mesh = makeRing({ place: [0, 0, 2], sample: cone, extent: 8000, divisions: 128, zoom: 14, gridSize: 512 });
  const surface = { place: [0, 0, 0], eye: 2, meshes: [mesh], metrics: { nearField: 2 }, profile: meshHorizon([mesh]) };
  const off = { ...peak(0), key: 'terrain:geonames:7', id: 7, name: 'Cone', code: 'HLL', lat: top[0] - .0015, lon: top[1] + .001 };
  const osm = { ...off, key: 'terrain:osm:8', id: 8, code: 'PK', lat: top[0] + .0008, lon: top[1] };
  const far = { ...off, key: 'terrain:geonames:9', id: 9, lat: top[0] - .01, lon: top[1] };
  const snapped = snapTerrainSummits(surface, [off, osm, far]);
  const summit = terrainFeaturePosition(surface.place, ...top), cone7 = snapped.find(f => f.name === 'Cone' && f.id !== 9);
  assert.equal(snapped.length, 2, 'Two records on one summit merge; a distant one does not');
  assert.equal(cone7.id, 8, 'The peak record wins over the hill record');
  assert.ok(Math.hypot(cone7.x - summit.x, cone7.y - summit.y) < 40, `Snapped to the summit (${Math.hypot(cone7.x - summit.x, cone7.y - summit.y).toFixed(0)} m)`);
  const lone = snapped.find(f => f.id === 9);
  assert.ok(lone.snap <= 250 + 32, 'Climbing stops at the snap radius');
  const [shown] = visibleTerrainFeatures(surface, [cone7]);
  assert.ok(shown?.skyline, `A lone summit is on the skyline ${JSON.stringify(shown && { alt: shown.alt, az: shown.az, snap: cone7.snap, x: cone7.x, y: cone7.y })} ${surface.profile[Math.round(cone7.az * 10)]}`);
}
assert.ok(terrainNameTiles([0, 179.99]).includes('9-0') && terrainNameTiles([0, 179.99]).includes('9-35'), 'Date line wraps tiles');
assert.ok(terrainNameTiles([89.99, 0]).length >= 36, 'Pole cap covers all longitudes');
assert.ok(terrainNameTiles([45.89617, 10.84333]).includes('13-19'));
assert.match(terrainFeatureDetails({ ...visible[0], name: '<script>&', elevation: null }), /&lt;script&gt;&amp;/);
assert.match(terrainFeatureDetails(visible[0]), /Unknown/);

const tileRows = [[1, 'Near peak', .01, .01, null, 'PK', 'G'], [2, 'Far peak', 5, 5, 1000, 'MT', 'G'], [3, 'Mapped peak', .02, .01, 812, 'PK', 'O']];
const body = JSON.stringify(tileRows) + '\n', sha256 = createHash('sha256').update(body).digest('hex');
const index = { version: 2, tileDegrees: 10, tiles: { '9-18': { count: 3, sha256 } } };
const storage = new Map(), cache = {
  match: async url => storage.get(url)?.clone(),
  put: async (url, response) => storage.set(url, response.clone()),
  delete: async request => storage.delete(typeof request === 'string' ? request : request.url),
  keys: async () => [...storage.keys()].map(url => ({ url })),
};
let requests = 0;
const fetchImpl = async url => { requests++; return new Response(url.endsWith('index.json') ? JSON.stringify(index) : gzipSync(body)); };
const opts = { fetchImpl, cacheStorage: { open: async () => cache } };
let result = await fetchTerrainNames(place, opts);
assert.equal(result.features.length, 2, 'Only candidates inside the terrain radius are retained');
assert.equal(result.features[0].key, 'terrain:geonames:1');
assert.equal(result.features[1].key, 'terrain:osm:3');
assert.equal(result.features[1].source, 'OpenStreetMap');
assert.match(terrainFeatureDetails({ ...visible[0], ...result.features[1] }), /openstreetmap\.org\/node\/3/);
assert.equal(result.features[0].elevation, null);
assert.equal(result.persisted, true);
assert.equal(requests, 2);
result = await fetchTerrainNames(place, { ...opts, fetchImpl: () => { throw new Error('Offline'); } });
assert.equal(result.features.length, 2, 'Names restore entirely offline');
await fetchTerrainNames(place, opts);
assert.equal(requests, 2, 'Viewpoint reuse makes no network requests');
await fetchTerrainNames(place, { ...opts, refresh: true });
assert.equal(requests, 3, 'Refresh checks the index but reuses immutable matching tiles');
await assert.rejects(fetchTerrainNames(place, { ...opts, signal: AbortSignal.abort() }), { name: 'AbortError' });
assert.equal((await fetchTerrainNames(place, { fetchImpl, cacheStorage: null })).persisted, false);
await assert.rejects(fetchTerrainNames(place, { cacheStorage: null, fetchImpl: async url => new Response(url.endsWith('index.json') ? JSON.stringify(index) : body.replace('Near peak', 'Different peak')) }), /catalog changed/);

// A real catalog sanity check: the release includes global summit files and
// correct hashes, not just synthetic development fixtures.
const manifest = JSON.parse(readFileSync(new URL('../data/terrain-names/index.json', import.meta.url)));
assert.ok(manifest.count > 100000);
assert.ok(Object.keys(manifest.tiles).length > 100);
const nearby = [];
for (const key of terrainNameTiles([45.89617, 10.84333])) {
  if (!manifest.tiles[key]) continue;
  const bytes = gunzipSync(readFileSync(new URL(`../data/terrain-names/${key}.json.gz`, import.meta.url)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.tiles[key].sha256);
  nearby.push(...JSON.parse(bytes));
}
assert.ok(nearby.some(r => /Brione/i.test(r[1])), 'Riva has real named summit coverage');
assert.ok(nearby.every(r => r.length === 7 && ['O', 'G'].includes(r[6])), 'Every record names its source');
console.log(`Peak geometry, occlusion, wrapped bounds, catalog integrity and offline checks passed (${manifest.count.toLocaleString()} global features)`);
