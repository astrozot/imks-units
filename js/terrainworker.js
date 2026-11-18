// Decode elevation and construct surfaces off the UI thread. Terminating this
// worker aborts fetches and computation; no app state is written here.
import { providers, tilesFor, tileSampler, profile } from './terrainmodel.js';
import { loadWaterMask } from './terrainwater.js';
import { PANORAMA_RINGS, makeRing, stitchRings } from './terrainmesh.js';
self.onmessage = async ({ data }) => {
  try {
    const started = performance.now(), { place } = data;
    const tiles = new Map(), jobs = tilesFor(place, PANORAMA_RINGS, 150000), requested = jobs.length, errors = [];
    let done = 0, bytes = 0;
    const progress = (text, fraction) => self.postMessage({ type: 'progress', text, fraction });
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (jobs.length) {
        const [z, x, y] = jobs.shift();
        try {
          const response = await fetch(providers.mapterhorn.url(z, x, y));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob(); bytes += blob.size;
          const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
          const size = bitmap.width;
          if (size !== 512 || bitmap.height !== size) { bitmap.close(); throw new Error('Unexpected tile dimensions'); }
          const c = new OffscreenCanvas(size, size), g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(bitmap, 0, 0); bitmap.close();
          const p = g.getImageData(0, 0, size, size).data, h = new Uint16Array(size * size);
          // Quarter-metre heights halve decoded DEM memory. Valid Earth terrain
          // fits [-1000,15383.5] m; 65535 is reserved for missing coverage.
          for (let i = 0; i < h.length; i++) {
            const value = p[i*4]*256+p[i*4+1]+p[i*4+2]/256-32768;
            h[i] = p[i*4+3] && value >= -1000 && value <= 15383.5 ? Math.round((value+1000)*4) : 65535;
          }
          tiles.set(`${z}/${x}/${y}`, { size, h, scale:.25, offset:-1000, noData:65535 });
        } catch (e) { errors.push({ z, x, y, message: e.message }); }
        progress(`Downloading terrain… ${++done}/${requested} tiles · ${(bytes / 1e6).toFixed(1)} MB`, done / requested * .65);
      }
    }));
    if (errors.length > requested / 4) throw new Error('Could not download enough terrain. Check your connection');
    const sample = tileSampler(tiles, false, true), pointGround = sample(place[0], place[1], 14);
    if (pointGround === null) throw new Error('Elevation at this viewpoint is unavailable');
    // A supplied altitude is the eye elevation, as in the reviewed panorama.
    // When omitted, use two metres above the model; never raise a supplied eye.
    const eye = Number.isFinite(place[2]) ? place[2] : pointGround + 2, meshes = [];
    let water = null, waterMetrics = {available:false};
    try { const result=await loadWaterMask(place,{progress:text=>progress(text,.65)}); water=result.mask;waterMetrics={...result.metrics,available:!result.metrics.missing.length,observer:water.at(place[0],place[1],pointGround)}; } catch(e) { waterMetrics.error=e.message; }
    const loadMs = performance.now() - started;
    let inner = 0;
    for (const [zoom, extent] of PANORAMA_RINGS) {
      progress(`Building terrain… ${extent / 1000} km`, .65 + .03 * meshes.length);
      meshes.push(makeRing({ place: [place[0], place[1], eye], sample, zoom, extent, inner, divisions: extent === 150000 ? 600 : 256, water }));
      inner = extent;
    }
    stitchRings(meshes);
    // The chart, hit testing and sky share this profile. Start at the same
    // 100 m near-field cutoff as the surface renderer, retaining negative hills.
    const horizon = await profile({ place: [place[0], place[1], eye - 2], sample, rings: PANORAMA_RINGS, radius: 150000, step: .1, distanceFraction: 1.5, startDistance: 100, onProgress: f => progress(`Tracing terrain horizon… ${Math.round(f * 100)}%`, .8 + .19 * f) });
    if (horizon.missing.some(f => f > 0)) throw new Error('Terrain coverage is incomplete. Try downloading again when online');
    const surface = { version: 2, place, eye, pointGround, profile: Float32Array.from(horizon.alt), meshes, metrics: { source: 'Mapterhorn', water:waterMetrics, bytes, tiles: tiles.size, requested, errors, loadMs, buildMs: performance.now() - started - loadMs, triangles: meshes.reduce((s,m)=>s+m.indices.length/3,0), missingVertices: meshes.reduce((s,m)=>s+m.missing,0), samplingCoverage: sample.stats, sourceUrl: 'https://mapterhorn.com/attribution/', heightQuantization:.25, nearField:100, radius:150000 } };
    if (surface.metrics.missingVertices) throw new Error('Terrain surface coverage is incomplete. Try again when online');
    self.postMessage({ type:'ready', surface }, [surface.profile.buffer, ...meshes.flatMap(m=>[m.positions.buffer,m.normals.buffer,m.waterMask.buffer,m.indices.buffer])]);
  } catch(e) { self.postMessage({type:'error',text:e.message}); }
};
