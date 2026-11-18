import { providers, currentRings, detailedRings, tilesFor, tileSampler, profile, hgtTile, difference, at, spacing } from './model.mjs';
export const sites = {
  riva: { name: 'Riva · supplied viewpoint', lat: 45.89615, lon: 10.84330 },
  chamonix: { name: 'Chamonix · town test point', lat: 45.9237, lon: 6.8694 },
  innsbruck: { name: 'Innsbruck · town test point', lat: 47.2692, lon: 11.4041 },
  granada: { name: 'Granada · town test point', lat: 37.176, lon: -3.5881 },
  queenstown: { name: 'Queenstown NZ · town test point', lat: -45.0312, lon: 168.6626 },
  atacama: { name: 'San Pedro de Atacama Chile · global-baseline test', lat: -22.911, lon: -68.201 },
};
const $ = (id) => document.getElementById(id), colours = ['#f0a263', '#bfa5ff', '#73b6ff', '#7ee2ac', '#ffee91', '#f4a4cd'];
let result = null;
let lastLog = 0;
const status = (s) => { $('status').textContent = s; if (performance.now() - lastLog > 10000) { console.log(`Terrain: ${s}`); lastLog = performance.now(); } };
async function load(source, place, rings, radius) {
  const started = performance.now(), tiles = new Map(), jobs = tilesFor(place, rings, radius), errors = [];
  let done = 0, bytes = 0;
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const [z, x, y] = queue.shift();
      try {
        const url = new URLSearchParams(location.search).has('proxy') ? `/tile/${source}/${z}/${x}/${y}` : providers[source].url(z, x, y);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob(); bytes += blob.size;
        const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        if (bitmap.width !== providers[source].size || bitmap.height !== bitmap.width) throw new Error('Unexpected tile dimensions');
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0); bitmap.close();
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, h = new Float32Array(canvas.width * canvas.height);
        for (let i = 0; i < h.length; i++) h[i] = pixels[i * 4 + 3] === 0 ? NaN : pixels[i * 4] * 256 + pixels[i * 4 + 1] + pixels[i * 4 + 2] / 256 - 32768;
        tiles.set(`${z}/${x}/${y}`, { size: canvas.width, h });
      } catch (error) { errors.push({ z, x, y, error: error.message }); }
      status(`${source}: ${++done}/${jobs.length} tiles · ${(bytes / 1e6).toFixed(1)} MB · ${errors.length} failed`);
    }
  }));
  if (errors.length > jobs.length / 4) throw new Error(`${source}: ${errors.length}/${jobs.length} tiles failed`);
  return { tiles, metrics: { tiles: tiles.size, requested: jobs.length, bytes, loadMs: performance.now() - started, errors } };
}
export async function compare(config) {
  const { lat, lon, radius = 60000 } = config;
  if (!Number.isFinite(lat) || Math.abs(lat) > 80 || !Number.isFinite(lon) || Math.abs(lon) > 180 || ![60000, 150000].includes(radius)) throw new Error('Use a latitude between −80 and 80, longitude between −180 and 180, and a supported radius');
  const methods = [], place = [lat, lon, config.height ?? null];
  let terrain = await load('mapterhorn', place, detailedRings, radius);
  if (place[2] === null) {
    place[2] = tileSampler(terrain.tiles, false, true)(lat, lon, detailedRings[0][0]);
    if (place[2] === null) throw new Error('Mapterhorn observer elevation is missing; enter a known ground elevation');
  }
  const progress = (name) => (fraction) => status(`${name}: tracing ${(fraction * 100).toFixed(0)}%`);
  const detailed = await profile({ place, sample: tileSampler(terrain.tiles, false, true), rings: detailedRings, radius, depth: true, onProgress: progress('Mapterhorn detailed') });
  const mapMethod = { name: 'Mapterhorn · detailed', source: 'mapterhorn', ...detailed, ...terrain.metrics };
  const convergence = config.convergence ? { name: 'Mapterhorn · convergence check', source: 'mapterhorn', ...await profile({ place, sample: tileSampler(terrain.tiles, false, true), rings: detailedRings, radius, step: 0.025, distanceFraction: 0.375, onProgress: progress('Convergence check') }), ...terrain.metrics, reusedTiles: true } : null;
  terrain = null;
  terrain = await load('mapzen', place, currentRings, radius);
  methods.push({ name: 'Current algorithm · Mapzen', source: 'mapzen', ...await profile({ place, sample: tileSampler(terrain.tiles, true), rings: currentRings, radius, legacy: true, size: 256, step: 0.5, onProgress: progress('Current') }), ...terrain.metrics });
  methods.push({ name: 'Mapzen · sampling corrected', source: 'mapzen', ...await profile({ place, sample: tileSampler(terrain.tiles), rings: currentRings, radius, size: 256, onProgress: progress('Mapzen corrected') }), ...terrain.metrics, reusedTiles: true });
  terrain = null;
  if (config.detailedMapzen !== false) {
    const mapzenRings = detailedRings.map(([z, d]) => [z + 1, d]);
    terrain = await load('mapzen', place, mapzenRings, radius);
    methods.push({ name: 'Mapzen · detailed tiles', source: 'mapzen', ...await profile({ place, sample: tileSampler(terrain.tiles), rings: mapzenRings, radius, size: 256, onProgress: progress('Mapzen detailed') }), ...terrain.metrics });
  }
  methods.push(mapMethod);
  if (convergence) methods.push(convergence);
  result = { version: 1, created: new Date().toISOString(), config: { ...config, radius, height: place[2], heightSource: config.height == null ? 'Mapterhorn point terrain; unverified vertical datum' : 'User supplied ground elevation' }, methods,
    ringSpacing: detailedRings.filter((_, i) => !i || detailedRings[i - 1][1] < radius).map(([z, end]) => ({ z, end: Math.min(end, radius), metres: spacing(lat, z, 512) })),
    reference: 'No surveyed/photo reference. Model differences do not establish absolute accuracy.',
    sources: ['https://github.com/tilezen/joerd/blob/master/docs/attribution.md', 'https://mapterhorn.com/attribution/', 'https://sonny.4lima.de/'] };
  render(); status('Comparison complete. Absolute accuracy still needs a matched PeakFinder export or photograph.');
  return result;
}
function render() {
  if (!result) return;
  const { config, methods } = result;
  $('lat').value = config.lat; $('lon').value = config.lon; $('radius').value = config.radius;
  $('height').value = config.heightSource?.startsWith('User') ? config.height : '';
  $('site').value = Object.entries(sites).find(([, site]) => site.lat === config.lat && site.lon === config.lon)?.[0] ?? 'custom';
  const buried = methods.filter((m) => m.eye < m.pointGround);
  $('viewpoint').textContent = `${config.name ?? 'Test point'} · ${config.lat.toFixed(5)}, ${config.lon.toFixed(5)} · ground ${config.height.toFixed(2)} m · ${config.heightSource} · radius ${config.radius / 1000} km` + (buried.length ? ` · Height warning: the common eye lies below the point terrain in ${buried.map((m) => m.name).join(', ')}. Nearby apparent obstructions can reflect source height bias or surface objects; vertical references are not harmonised.` : '');
  $('peakfinder').href = `https://www.peakfinder.com/?lat=${config.lat}&lng=${config.lon}&ele=${Math.round(config.height + 2)}`;
  $('legend').replaceChildren(...methods.map((m, i) => {
    const label = document.createElement('span'), swatch = document.createElement('span');
    swatch.className = 'swatch'; swatch.style.background = colours[i % colours.length]; label.append(swatch, m.name); return label;
  }));
  $('metrics').replaceChildren(...methods.map((m) => {
    const tr = document.createElement('tr');
    for (const text of [m.name, m.pointGround?.toFixed(2) ?? '—', m.eye.toFixed(2), m.tiles == null ? '—' : `${m.tiles}${m.requested ? '/' + m.requested : ''}`, m.bytes == null ? '—' : (m.bytes / 1e6).toFixed(2) + (m.source === 'sonny-user-files' ? ' local' : ''), m.loadMs == null ? '—' : (m.loadMs / 1000).toFixed(2), (m.computeMs / 1000).toFixed(2), `${m.missing.filter((x) => x > 0).length}/${m.alt.length}`]) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    } return tr;
  }));
  $('differences').textContent = methods.slice(0, -1).map((m) => {
    const d = difference(m, methods.at(-1)); return `${m.name} vs ${methods.at(-1).name}: mean |Δ| ${d.mean?.toFixed(3) ?? '—'}°, p95 ${d.p95?.toFixed(3) ?? '—'}°, max ${d.max?.toFixed(3) ?? '—'}° (${d.directions} complete directions).`;
  }).join(' ') + methods.filter((m) => m.samplingCoverage?.fallbackSamples).map((m) => ` ${m.name}: ${m.samplingCoverage.fallbackSamples.toLocaleString()} samples used lower zooms (${Object.keys(m.samplingCoverage.fallbackZooms).join(', ')}); these areas have coarser source coverage.`).join('');
  const canvas = $('plot'), ctx = canvas.getContext('2d'), scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * scale); canvas.height = Math.round(canvas.clientHeight * scale);
  const W = canvas.width, H = canvas.height, L = 44 * scale, B = 30 * scale, top = 18 * scale, right = 20 * scale;
  canvas.plotGeometry = { L, right };
  const all = methods.flatMap((m) => m.alt.filter((x) => x !== null));
  const lo = Math.min(-2, Math.floor(Math.min(...all))), hi = Math.min(90, Math.max(10, Math.ceil(Math.max(...all) / 5) * 5));
  ctx.clearRect(0, 0, W, H); ctx.font = `${12 * scale}px system-ui`;
  for (let az = 0; az <= 360; az += canvas.clientWidth < 700 ? 90 : 30) {
    const x = L + (W - L - right) * az / 360; ctx.strokeStyle = '#30434e'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, H - B); ctx.stroke(); ctx.fillStyle = '#b0c4ce'; ctx.fillText(`${az}°`, x - 12 * scale, H - 10 * scale);
  }
  for (let alt = Math.ceil(lo / 5) * 5; alt <= hi; alt += 5) {
    const y = H - B - (H - B - top) * (alt - lo) / (hi - lo); ctx.strokeStyle = '#30434e'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - right, y); ctx.stroke(); ctx.fillStyle = '#b0c4ce'; ctx.fillText(`${alt}°`, 5 * scale, y + 4 * scale);
  }
  methods.forEach((m, j) => {
    ctx.strokeStyle = colours[j % colours.length]; ctx.lineWidth = 1.2 * scale; ctx.beginPath(); let pen = false;
    for (let i = 0; i <= m.alt.length; i++) {
      const a = m.alt[i % m.alt.length];
      if (a === null) { pen = false; continue; }
      const x = L + (W - L - right) * i / m.alt.length, y = H - B - (H - B - top) * (a - lo) / (hi - lo);
      if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true;
    } ctx.stroke();
  });
  const depth = methods.find((m) => m.depthRaster || m.bands), c = $('depth'), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  if (depth) {
    const pixels = g.createImageData(c.width, c.height);
    for (let x = 0; x < c.width; x++) {
      const bands = depth.bands?.[Math.floor(x / c.width * depth.bands.length)]; let b = 0;
      const column = depth.depthRaster?.columns[Math.floor(x / c.width * depth.depthRaster.width)];
      for (let y = c.height - 1; y >= 0; y--) {
        const alt = 45 - y / c.height * 50;
        let d;
        if (column) d = column[Math.min(299, Math.round((alt + 5) / 50 * 300))];
        else { while (b < bands.length && bands[b][0] < alt) b++; if (b === bands.length) continue; d = bands[b][1]; }
        if (!d) continue;
        const haze = 1 - Math.exp(-d / 22000), i = (y * c.width + x) * 4;
        pixels.data.set([Math.round(38 + haze * 96), Math.round(75 + haze * 82), Math.round(72 + haze * 108), 255], i);
      }
    } g.putImageData(pixels, 0, 0);
  }
}
$('plot').onpointermove = (event) => {
  if (!result) return;
  const box = $('plot').getBoundingClientRect(), x = (event.clientX - box.left) / box.width * $('plot').width;
  const { L, right } = $('plot').plotGeometry;
  const az = Math.max(0, Math.min(360, (x - L) / ($('plot').width - L - right) * 360));
  $('inspect').textContent = `${az.toFixed(2)}° · ` + result.methods.map((m) => `${m.name}: ${at(m, az)?.toFixed(3) ?? 'missing'}°`).join(' · ');
};
$('site').onchange = () => { const site = sites[$('site').value]; if (site) { $('lat').value = site.lat; $('lon').value = site.lon; $('height').value = ''; } };
async function busy(fn) {
  $('run').disabled = $('sonny').disabled = true;
  try { await fn(); } catch (e) { status(`Failed: ${e.message}`); console.error(e); } finally { $('run').disabled = $('sonny').disabled = false; }
}
$('run').onclick = () => busy(() => compare({ name: sites[$('site').value]?.name ?? 'Custom', lat: Number($('lat').value), lon: Number($('lon').value), height: $('height').value === '' ? null : Number($('height').value), radius: Number($('radius').value) }));
$('export').onclick = () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: 'application/json' })), a = document.createElement('a');
  a.href = url; a.download = 'terrain-comparison.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('import').onchange = () => busy(async () => {
  const data = JSON.parse(await $('import').files[0].text());
  if (data.version !== 1 || !Array.isArray(data.methods) || !data.methods.every((m) => Array.isArray(m.alt) && m.alt.length <= 100000 && m.alt.every((a) => a === null || Number.isFinite(a)))) throw new Error('Unsupported comparison file');
  result = data; render(); status('Saved comparison loaded; no tiles downloaded.');
});
$('sonny').onclick = () => busy(async () => {
  if (!result) throw new Error('Compute or import a comparison first');
  const files = [...$('hgt').files]; if (!files.length) throw new Error('Select unzipped Sonny HGT files first');
  const tiles = await Promise.all(files.map(async (f) => hgtTile(await f.arrayBuffer(), f.name)));
  const sample = (lat, lon) => { for (const t of tiles) { const h = t.at(lat, lon); if (h !== null) return h; } return null; };
  const p = await profile({ place: [result.config.lat, result.config.lon, result.config.height], sample, rings: [[12, result.config.radius]], size: 256, radius: result.config.radius, onProgress: (v) => status(`Sonny reference: ${(v * 100).toFixed(0)}%`) });
  result.methods.push({ name: 'Sonny · imported HGT reference', source: 'sonny-user-files', ...p, tiles: files.length, bytes: files.reduce((n, f) => n + f.size, 0), filenames: files.map((f) => f.name) }); render(); status('Sonny reference added. Missing coverage remains explicit.');
});
$('reference').onchange = () => busy(async () => {
  if (!result) throw new Error('Compute or import a comparison first');
  const pairs = (await $('reference').files[0].text()).split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim().split(/[\s,;]+/).map(Number)).filter((v) => v.length === 2 && v.every(Number.isFinite));
  if (pairs.length < 3 || pairs.some(([az, alt]) => az < 0 || az > 360 || Math.abs(alt) > 90)) throw new Error('Expected azimuth/elevation pairs in degrees, azimuth north=0 east=90');
  pairs.sort((a, b) => a[0] - b[0]); if (pairs.at(-1)[0] === 360) pairs.pop();
  const cyclic = [...pairs, [pairs[0][0] + 360, pairs[0][1]]], alt = []; let j = 0;
  for (let i = 0; i < 7200; i++) { let az = i / 20; if (az < pairs[0][0]) az += 360; j = 0; while (j + 1 < cyclic.length - 1 && cyclic[j + 1][0] < az) j++; const [a, h] = cyclic[j], [b, k] = cyclic[j + 1]; alt.push(h + (k - h) * (az - a) / (b - a)); }
  result.methods.push({ name: 'PeakFinder · imported horizon (alignment unverified)', source: 'user-export', alt, step: 0.05, missing: alt.map(() => 0), eye: result.config.height + 2, computeMs: 0 }); render(); status('Reference imported. Viewpoint, height and azimuth convention must match before treating differences as errors.');
});
window.terrainLab = { compare, sites, getResult: () => result, setResult(data) { result = data; render(); } };
let resizeFrame;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render); });
const savedResult = new URLSearchParams(location.search).get('result');
if (savedResult && /^[a-z]+(?:-150)?$/.test(savedResult)) busy(async () => {
  const response = await fetch(`/results/${savedResult}.json`); if (!response.ok) throw new Error('Saved result is unavailable');
  result = await response.json(); render(); status('Saved comparison loaded; no tiles downloaded.');
});
