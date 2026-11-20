// Decode elevation and construct surfaces off the UI thread. Terminating this
// worker aborts fetches and computation; no app state is written here.
import { providers, tilesFor, tileSampler, resampleGrid } from './terrainmodel.js';
import { loadWaterMask, waterLevels, WATER_TOLERANCE } from './terrainwater.js';
import { loadLandcover } from './terrainlandcover.js';
import { PANORAMA_RINGS, TERRAIN_GEOMETRY_REVISION, TERRAIN_SURFACE_VERSION, nearFieldFor, EYE_HEIGHT, TERRAIN_GRID_SIZES, TERRAIN_DIVISIONS, makeRing, stitchRings, meshHorizon, packGrid, compactMesh } from './terrainmesh.js';
import { simplifyTerrainRTIN } from './terrainlod.js';
import { terrainDrawGroups } from './terrainlighting.js';
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
          const p = g.getImageData(0, 0, size, size).data, h = new Uint16Array(size * size), values = new Float32Array(size * size);
          // 16-bit heights halve decoded DEM memory. Each tile has its own range,
          // so steps are centimetres (at most 1/256 m, the source precision):
          // quarter-metre steps would show as terracing in per-pixel shading.
          let lo = Infinity, hi = -Infinity;
          for (let i = 0; i < h.length; i++) {
            const value = p[i*4]*256+p[i*4+1]+p[i*4+2]/256-32768;
            values[i] = p[i*4+3] && value >= -1000 && value <= 9000 ? value : NaN;
            if (values[i] < lo) lo = values[i]; if (values[i] > hi) hi = values[i];
          }
          const scale = Math.max(1/256, (hi - lo) / 65534), offset = Number.isFinite(lo) ? lo : 0;
          for (let i = 0; i < h.length; i++) h[i] = Number.isNaN(values[i]) ? 65535 : Math.round((values[i] - offset) / scale);
          tiles.set(`${z}/${x}/${y}`, { size, h, scale, offset, noData:65535 });
        } catch (e) { errors.push({ z, x, y, message: e.message }); }
        progress(`Downloading terrain… ${++done}/${requested} tiles · ${(bytes / 1e6).toFixed(1)} MB`, done / requested * .65);
      }
    }));
    if (errors.length > requested / 4) throw new Error('Could not download enough terrain. Check your connection');
    const sample = tileSampler(tiles, false, true), pointGround = sample(place[0], place[1], 14);
    if (pointGround === null) throw new Error('Elevation at this viewpoint is unavailable');
    // place[2] is the ground elevation (looked up or set by the user); the eye
    // is EYE_HEIGHT above it. Without one, use the terrain model's own ground.
    const eye = (Number.isFinite(place[2]) ? place[2] : pointGround) + EYE_HEIGHT, meshes = [];
    let water = null, waterMetrics = {available:false};
    try { const result=await loadWaterMask(place,{progress:text=>progress(text,.65)}); water=result.mask;waterMetrics={...result.metrics,available:!result.metrics.missing.length,observer:null}; } catch(e) { waterMetrics.error=e.message; }
    // Land cover chooses surface materials; without it, slope-based colours.
    let cover = null, coverMetrics = { available: false };
    try {
      const decode = async blob => { const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bitmap, 0, 0); bitmap.close(); return g.getImageData(0, 0, c.width, c.height).data; };
      const result = await loadLandcover({ place, rings: PANORAMA_RINGS, sizes: TERRAIN_GRID_SIZES.map(s => Math.min(1024, s)), decode, progress: text => progress(text, .66) });
      coverMetrics = { ...result.metrics, available: result.metrics.failed < result.metrics.tiles / 4 };
      if (coverMetrics.available) cover = result.grids;
    } catch (e) { coverMetrics.error = e.message; }
    const loadMs = performance.now() - started;
    // Experiments may override the mesh budget; the app always uses defaults.
    const divisions = data.options?.divisions ?? TERRAIN_DIVISIONS, angularError = data.options?.angularError ?? .05;
    let inner = 0;
    for (const [index, [zoom, extent]] of PANORAMA_RINGS.entries()) {
      progress(`Building terrain… ${extent / 1000} km`, .65 + .03 * meshes.length);
      const size = TERRAIN_GRID_SIZES[index], n = divisions[index] + 1;
      const values = resampleGrid({ tiles, place, zoom, extent, size: n, eye, fallback: sample, corners: true });
      const mesh = makeRing({ place: [place[0], place[1], eye], extent, inner, divisions: divisions[index], values });
      mesh.grid = packGrid(resampleGrid({ tiles, place, zoom, extent, size, eye, fallback: sample }), extent, size);
      if (cover) mesh.cover = cover[index];
      meshes.push(mesh); inner = extent;
    }
    stitchRings(meshes);
    const denseTriangles=meshes.reduce((sum,m)=>sum+m.indices.length/3,0);
    const missingVertices=meshes.reduce((s,m)=>s+m.missing,0);
    for(let i=0;i<meshes.length;i++)meshes[i]=compactMesh(simplifyTerrainRTIN(meshes[i],{angularError}));
    progress('Tracing the mountain surface horizon…',.85);
    const nearField = nearFieldFor(meshes[0].grid), horizon = meshHorizon(meshes, { nearField });
    for(const mesh of meshes){const grouped=terrainDrawGroups({vertices:mesh.positions,indices:mesh.indices},32,3);mesh.indices=grouped.indices;mesh.groups=grouped.groups;}
    // Water: each lake's DEM level, searched for near its (coarse) outline.
    if (water) { const result = waterLevels({ water, place, eye, grids: meshes.map(m => m.grid) }); meshes.forEach((m, i) => { m.water = result.maps[i]; }); waterMetrics.bodies = result.metrics;
      // Standing in water only if the DEM at the observer lies at that level.
      const centre = result.maps[0], level = centre.levels[(centre.size >> 1) * centre.size + (centre.size >> 1)] + eye;
      waterMetrics.observer = Number.isFinite(level) && Math.abs(pointGround - level) < WATER_TOLERANCE ? (Math.abs(level) < WATER_TOLERANCE ? 'ocean' : 'lake') : null; }
    const surface = { version: TERRAIN_SURFACE_VERSION, place, eye, pointGround, profile: horizon, meshes, metrics: { source: 'Mapterhorn', geometryRevision:TERRAIN_GEOMETRY_REVISION,eyeHeight:EYE_HEIGHT,gridTexels:meshes.reduce((s,m)=>s+m.grid.heights.length,0), divisions, angularError, denseTriangles, water:waterMetrics, landCover:coverMetrics, bytes, tiles: tiles.size, requested, errors, loadMs, buildMs: performance.now() - started - loadMs, triangles: meshes.reduce((s,m)=>s+m.indices.length/3,0), vertices: meshes.reduce((s,m)=>s+m.positions.length/3,0), missingVertices, samplingCoverage: sample.stats, sourceUrl: 'https://mapterhorn.com/attribution/', nearField, radius:150000 } };
    if (surface.metrics.missingVertices) throw new Error('Terrain surface coverage is incomplete. Try again when online');
    self.postMessage({ type:'ready', surface }, [surface.profile.buffer, ...meshes.flatMap(m=>[m.positions.buffer,m.indices.buffer,m.grid.heights.buffer,...(m.water?[m.water.levels.buffer]:[]),...(m.cover?[m.cover.classes.buffer]:[])])]);
  } catch(e) { self.postMessage({type:'error',text:e.message}); }
};
