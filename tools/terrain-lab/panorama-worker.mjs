import { providers, tilesFor, tileSampler, hgtTile } from './model.mjs';
import { loadWaterMask } from '../../js/terrainwater.js';
import { PANORAMA_RINGS, makeRing, stitchRings } from './panorama-model.mjs';
self.onmessage = async ({ data }) => {
  try {
    const started = performance.now(), { lat, lon, eye, quality, proxy, files } = data;
    const place = [lat, lon, eye], radius = 64000, tiles = new Map();
    let bytes = 0, errors = [], sample, requested = 0;
    const provenance = files?.length ? { source: 'https://sonny.4lima.de/', license: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Sonny', version: 'Unverified user-supplied HGT', files: files.map(f => f.name) } : { source: 'https://mapterhorn.com/', attribution: 'https://mapterhorn.com/attribution/', tileEndpoint: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp', version: 'Unversioned endpoint; saved surface preserves sampled geometry' };
    if (files?.length) {
      const hgt = files.map((f) => hgtTile(f.buffer, f.name));
      sample = (la, lo) => { for (const t of hgt) { const h = t.at(la, lo); if (h !== null) return h; } return null; };
      bytes = files.reduce((s, f) => s + f.buffer.byteLength, 0);
    } else {
      // A full square is required for geometry and off-camera shadow casters.
      const jobs = tilesFor(place, PANORAMA_RINGS, radius); requested = jobs.length;
      let done = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (jobs.length) {
          const [z, x, y] = jobs.shift();
          try {
            const response = await fetch(proxy ? `/tile/mapterhorn/${z}/${x}/${y}` : providers.mapterhorn.url(z, x, y));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob(); bytes += blob.size;
            const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
            if (bitmap.width !== 512 || bitmap.height !== 512) { bitmap.close(); throw new Error('Unexpected tile dimensions'); }
            const c = new OffscreenCanvas(512, 512), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bitmap, 0, 0); bitmap.close();
            const p = g.getImageData(0, 0, 512, 512).data, h = new Float32Array(512 * 512);
            for (let i = 0; i < h.length; i++) h[i] = p[i * 4 + 3] ? p[i * 4] * 256 + p[i * 4 + 1] + p[i * 4 + 2] / 256 - 32768 : NaN;
            tiles.set(`${z}/${x}/${y}`, { size: 512, h });
          } catch (e) { errors.push({ z, x, y, message: e.message }); }
          self.postMessage({ type: 'progress', text: `Downloading Mapterhorn · ${++done}/${requested} tiles · ${(bytes / 1e6).toFixed(1)} MB · ${errors.length} unavailable` });
        }
      }));
      if (errors.length > requested / 4) throw new Error('Too many elevation tiles unavailable; check connectivity');
      sample = tileSampler(tiles, false, true);
    }
    const pointGround = sample(lat, lon, 14);
    if (pointGround === null) throw new Error('Observer terrain unavailable');
    let water=null,waterMetrics=null;
    if(data.water){const result=await loadWaterMask(place,{radius,progress:text=>self.postMessage({type:'progress',text})});water=result.mask;waterMetrics={...result.metrics,observer:water.at(lat,lon,pointGround)};}
    const loadMs = performance.now() - started, meshes = [];
    let inner = 0;
    for (const [zoom, extent] of PANORAMA_RINGS) {
      self.postMessage({ type: 'progress', text: `Building terrain surfaces · ${extent / 1000} km ring` });
      meshes.push(makeRing({ place, sample, zoom, extent, inner, divisions: quality, water })); inner = extent;
    }
    stitchRings(meshes);
    const metrics = { provenance, water: waterMetrics, source: files?.length ? 'Sonny · imported HGT (version supplied by user)' : 'Mapterhorn', pointGround, eye, bytes, tiles: tiles.size || files.length, requested, errors, loadMs, buildMs: performance.now() - started - loadMs, triangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0), missingVertices: meshes.reduce((n, m) => n + m.missing, 0), samplingCoverage: sample.stats ?? null, ringSpacing: meshes.map((m) => m.step) };
    self.postMessage({ type: 'ready', meshes, metrics }, meshes.flatMap((m) => [m.positions.buffer, m.normals.buffer, m.waterMask.buffer, m.indices.buffer]));
  } catch (e) { self.postMessage({ type: 'error', text: e.message }); }
};
