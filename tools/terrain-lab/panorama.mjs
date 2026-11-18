import { horizontal, aspect } from '../../js/astro.js';
import { terrainExposure } from '../../js/terrainlighting.js';
import { moonFlux } from './panorama-model.mjs';
import { createRenderer } from './panorama-gl.mjs';
import { packSurface, unpackSurface } from './surface-io.mjs';
const $ = (id) => document.getElementById(id), canvas = $('panorama');
let renderer, worker, geometry, config, metrics, renderMetrics, animation, buildID = 0, lighting;
const view = { az: 204, alt: 15, fov: 100 };
const status = (text) => { $('status').textContent = text; };
const appearanceDefaults = { style: 'natural', waterColor: true, shadows: true, outlines: false, exposure: 0, nightExposure: 0 };
const appearanceKey = 'imks-terrain-lab-appearance-v2';
const exposurePercent = (value) => `${Math.round((Number(value) + 2) * 25)}%`;
function setAppearance(values) {
  for (const [key, fallback] of Object.entries(appearanceDefaults)) {
    let value = values[key] ?? fallback;
    if (key === 'style' && !['natural', 'paper'].includes(value) || typeof fallback === 'boolean' && typeof value !== 'boolean' || typeof fallback === 'number' && (!Number.isFinite(value) || value < -2 || value > 2)) value = fallback;
    if (typeof fallback === 'boolean') $(key).checked = value; else $(key).value = value;
  }
  updateExposureLabels();
}
function updateExposureLabels() {
  $('exposureValue').value = exposurePercent($('exposure').value);
  $('nightExposureValue').value = exposurePercent($('nightExposure').value);
}
function saveAppearance() {
  const values = Object.fromEntries(Object.entries(appearanceDefaults).map(([key, fallback]) => [key, typeof fallback === 'boolean' ? $(key).checked : typeof fallback === 'number' ? Number($(key).value) : $(key).value]));
  try { localStorage.setItem(appearanceKey, JSON.stringify(values)); } catch { /* Session preferences still work. */ }
}
try {
  const current=localStorage.getItem(appearanceKey);
  const old=JSON.parse(localStorage.getItem('imks-terrain-lab-appearance-v1')||'null');
  setAppearance(current?JSON.parse(current):old?{...old,exposure:Math.max(-2,Math.min(2,(old.exposure??.7)-.7)),nightExposure:Math.max(-2,Math.min(2,(old.nightExposure??2)-2))}:{});
} catch { setAppearance({}); }
$('appearanceButton').onclick = () => $('appearancePanel').showModal();
$('closeAppearance').onclick = () => $('appearancePanel').close();
$('appearancePanel').onclick = (event) => {
  if (event.target !== $('appearancePanel')) return;
  const rect = $('appearancePanel').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('appearancePanel').close();
};
$('resetAppearance').onclick = () => { setAppearance({}); saveAppearance(); draw(); };
function syncHour() { const hh = $('time').value.slice(11, 16); $('hourLabel').value = hh; $('hour').value = Number(hh.slice(0, 2)) * 60 + Number(hh.slice(3)); }
function conditions() {
  const t = Date.parse($('time').value + 'Z') / 1000;
  if (!Number.isFinite(t)) throw new Error('Choose a valid UTC date and time');
  const place = [config.lat, config.lon, config.eye], sun = horizontal('sun', t, place), moon = horizontal('moon', t, place), phase = aspect('moon', t).phase;
  // Extinction of direct light along the lunar path; unit transmission at zenith.
  const airmass = 1 / (Math.max(0, Math.sin(moon.alt * Math.PI / 180)) + 0.025 * Math.exp(-11 * Math.max(0, Math.sin(moon.alt * Math.PI / 180))));
  const flux = moonFlux(phase, moon.dist) * 10 ** (-0.4 * 0.22 * Math.max(0, airmass - 1));
  return { sun, moon, phase, flux, utc: new Date(t * 1000).toISOString(), ...view, paper: $('style').value === 'paper', waterColor: $('waterColor').checked, observerWater: !!metrics.water?.observer, shadows: $('shadows').checked, outlines: $('outlines').checked, nearField: Math.max(20, Math.min(300, Number($('nearField').value) || 100)), exposure: terrainExposure(Number($(sun.alt < -6 ? 'nightExposure' : 'exposure').value),sun.alt < -6) };
}
function draw() {
  cancelAnimationFrame(animation);
  animation = requestAnimationFrame(() => {
    if (!renderer || !geometry) return;
    try {
      lighting = conditions(); renderMetrics = renderer.draw(lighting);
      const { sun, moon, phase } = lighting;
      $('lighting').textContent = `Bearing ${((view.az % 360 + 360) % 360).toFixed(1)}° · view ${view.fov.toFixed(0)}° · Sun ${sun.alt.toFixed(1)}° / ${sun.az.toFixed(1)}° · Moon ${moon.alt.toFixed(1)}° / ${moon.az.toFixed(1)}° · illuminated ${((1 + Math.cos(phase * Math.PI / 180)) * 50).toFixed(1)}% · ${sun.alt < -6 ? 'Moon' : 'Sun'} lighting · ${sun.alt < -6 ? 'night' : 'daylight'} exposure ${exposurePercent($(sun.alt < -6 ? 'nightExposure' : 'exposure').value)}`;
      $('metrics').textContent = `${metrics.source} · ${(metrics.bytes / 1e6).toFixed(2)} MB ${config.source === 'sonny' ? 'local files' : 'tile payload'} · ${metrics.tiles} tiles/files\nNear field omitted ${lighting.nearField} m · ground at observer ${metrics.pointGround.toFixed(2)} m · eye ${metrics.eye.toFixed(2)} m${metrics.eye < metrics.pointGround ? ' · WARNING: eye below model terrain' : ''}\n${metrics.triangles.toLocaleString()} triangles · grid steps ${metrics.ringSpacing.map((x) => x.toFixed(1)).join(' / ')} m · missing vertices ${metrics.missingVertices} · lower-zoom samples ${metrics.samplingCoverage?.fallbackSamples ?? 0}\nLoad ${(metrics.loadMs / 1000).toFixed(2)} s · build ${(metrics.buildMs / 1000).toFixed(2)} s · render submission ${renderMetrics.submitMs.toFixed(1)} ms (not GPU frame time) · ${renderMetrics.width} × ${renderMetrics.height} · shadows ${renderMetrics.shadowSize}px`;
      window.panoramaLab.lastDraw = { ...renderMetrics, lighting };
    } catch (e) { status(`Failed: ${e.message}`); }
  });
}
function stop() { buildID++; worker?.terminate(); worker = null; $('build').disabled = false; $('cancel').disabled = true; }
async function build() {
  stop(); const id = buildID; window.panoramaLab.ready = false;
  const next = { lat: Number($('lat').value), lon: Number($('lon').value), eye: Number($('eye').value), quality: Number($('quality').value), source: $('source').value, water: $('water').checked };
  if (!Number.isFinite(next.lat) || Math.abs(next.lat) > 80 || !Number.isFinite(next.lon) || Math.abs(next.lon) > 180 || !Number.isFinite(next.eye) || !$('eye').value) { status('Enter valid coordinates and an explicit viewpoint elevation'); return; }
  if (next.source === 'sonny' && !$('hgt').files.length) { status('Select unzipped Sonny HGT files covering the area first'); return; }
  $('build').disabled = true; $('cancel').disabled = false; status('Preparing terrain…');
  try {
    const files = next.source === 'sonny' ? await Promise.all([...$('hgt').files].map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() }))) : null;
    if (buildID !== id) return;
    worker = new Worker(new URL('./panorama-worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (buildID !== id) return;
      if (data.type === 'progress') status(data.text);
      else if (data.type === 'error') { status(`Failed: ${data.text}`); stop(); }
      else if (data.type === 'ready') {
        try {
          renderer ??= createRenderer(canvas);
          renderer.setMeshes(data.meshes); geometry = data.meshes; config = next; metrics = data.metrics;
          stop(); draw(); status(`Surface ready. Lighting changes reuse this terrain.${metrics.missingVertices ? ' Coverage gaps are present.' : ''}`);
          window.panoramaLab.ready = true;
        } catch (e) { stop(); status(`Failed: ${e.message}`); }
      }
    };
    worker.onerror = (e) => { status(`Failed: ${e.message}`); stop(); };
    worker.postMessage({ ...next, proxy: new URLSearchParams(location.search).has('proxy'), files }, files?.map((f) => f.buffer) ?? []);
  } catch (e) { stop(); status(`Failed: ${e.message}`); }
}
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('build').onclick = build;
$('cancel').onclick = () => { stop(); window.panoramaLab.ready = !!geometry; status('Build cancelled. Existing surface remains available.'); };
for (const name of ['time', 'nearField']) $(name).addEventListener('input', () => { syncHour(); draw(); });
for (const name of Object.keys(appearanceDefaults)) $(name).addEventListener('input', () => { updateExposureLabels(); saveAppearance(); draw(); });
$('hour').oninput = () => { const m = Number($('hour').value), hh = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; $('time').value = `${$('time').value.slice(0, 10)}T${hh}`; $('hourLabel').value = hh; draw(); };
$('preset').onchange = () => { if ($('preset').value) { $('time').value = $('preset').value; syncHour(); draw(); } };
$('reset').onclick = () => { Object.assign(view, { az: 204, alt: 15, fov: 100 }); draw(); };
let pointer;
canvas.onpointerdown = (e) => { canvas.setPointerCapture(e.pointerId); pointer = [e.clientX, e.clientY]; };
canvas.onpointermove = (e) => { if (!pointer) return; view.az -= (e.clientX - pointer[0]) / canvas.clientWidth * view.fov; view.alt = Math.max(-40, Math.min(80, view.alt + (e.clientY - pointer[1]) / canvas.clientWidth * view.fov)); pointer = [e.clientX, e.clientY]; draw(); };
canvas.onpointerup = canvas.onpointercancel = () => { pointer = null; };
canvas.onwheel = (e) => { e.preventDefault(); view.fov = Math.max(15, Math.min(130, view.fov * Math.exp(e.deltaY * 0.001))); draw(); };
window.addEventListener('resize', draw);
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); status('Graphics context lost. Waiting for restoration…'); });
canvas.addEventListener('webglcontextrestored', () => { renderer?.destroy(); renderer = createRenderer(canvas); if (geometry) renderer.setMeshes(geometry); draw(); status('Graphics context restored.'); });
$('save').onclick = () => { if (geometry) canvas.toBlob((blob) => { if (blob) download(blob, 'terrain-panorama.png'); }); };
$('report').onclick = () => { if (geometry) download(new Blob([JSON.stringify({ version: 1, config, metrics, renderMetrics, lighting, created: new Date().toISOString(), limits: 'Experimental geometry and illumination; see panorama.html. Submission timing is not GPU frame time.' }, null, 2)], { type: 'application/json' }), 'terrain-panorama-metrics.json'); };
$('saveSurface').onclick = () => {
  if (!geometry) return;
  status('Saving surface for offline inspection…');
  download(new Blob([JSON.stringify(packSurface(config, metrics, geometry))], { type: 'application/json' }), 'terrain-surface.json'); status('Surface saved. Restore it here without downloading elevation tiles.');
};
function restoreSurface(data) {
  const d = unpackSurface(data);
  renderer ??= createRenderer(canvas);
  renderer.setMeshes(d.meshes);
  stop(); geometry = d.meshes; config = d.config; metrics = d.metrics;
  $('water').checked = config.water ?? false;
  for (const k of ['lat', 'lon', 'eye', 'quality', 'source']) $(k).value = config[k];
  window.panoramaLab.ready = true; draw(); status('Saved surface restored; no terrain downloads needed.');
}
$('restore').onchange = async () => {
  try {
    const file = $('restore').files[0]; if (!file) return;
    if (file.size > 250e6) throw new Error('Surface file exceeds 250 MB limit');
    restoreSurface(JSON.parse(await file.text()));
  } catch (e) { status(`Failed: ${e.message}`); }
};
async function loadSurface(url) {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) throw new Error('Prepared surfaces must be hosted with this page');
  status('Loading prepared panorama…');
  const response = await fetch(target);
  if (!response.ok) throw new Error(`Surface download failed: HTTP ${response.status}`);
  restoreSurface(await response.json());
}

window.panoramaLab = { ready: false, build, draw, loadSurface, view, getState: () => ({ config, metrics, lighting, renderMetrics }), setView(v) { Object.assign(view, v); draw(); } };

if (innerWidth < 600) $('quality').value = '256';
