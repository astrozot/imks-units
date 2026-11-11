// The coelum explorer: two views of the same sky (a map-like chart and a
// realistic sky), search, layers, legend, time controls and a full-screen
// mode whose controls fade away while the sky is left alone.
import { PhoneOrientation } from './phoneorientation.js';
import { moonEventsPanel } from './mooneventspanel.js';
import { SAT_GROUPS, chosenGroups, chooseGroups, loadSatellites, onSatellites, satelliteList, satelliteStatus } from './satellites.js';
import { stepPlaybackSpeed, formatPlaybackSpeed, setSatellites, skyFrame, createSkyAnimator, skyChart, unprojectSky, rotateSky, chartRadius, objectDetails, chartLegend, placeLabels, searchSky, searchAngularField, findObject, limitTime, pointVector, unit3, dot3, esc, R, SKY_IDENTITY, DEFAULT_LAYERS, lookAt, projectVector, refractVector, refraction, setFaintStars, faintCount, faintDepth, setMinorBodies, hasMoons, horizontalVector, diskRadius } from './coelum.js';
import { riseSet, planetOf, siderealTime } from './astro.js';
import { searchPlaces, fetchPlace, fetchElevation } from './lookup.js';
import { skyScene, SKY_LAYERS, defaultSkyView, skyRadius, moonTexture } from './coelumsky.js';
import { storedHorizon, computeHorizon, forgetHorizon, horizonAt } from './skyhorizon.js';
import { skyView as moonSystem } from './sky.js';
import { moonsView, planetMap } from './skyview.js';
import { pickLunarFeature, lunarFeatureDetails, findLunarFeature, lunarFeatureTarget, LUNAR_MIN_RADIUS } from './lunarfeatures.js';
import { pickMarsFeature, marsFeatureDetails, findMarsFeature, marsFeatureState, projectMarsFeatures, MARS_MIN_RADIUS } from './marsfeatures.js';

// Optional fainter stars, from AT-HYG like the built-in ones
// (tools/stars.mjs): files of the app downloaded when asked, kept in a
// cache that app updates leave alone; one set at a time. A set of an
// older version is forgotten. The files and the key of the cache are
// next to iMKS's page, whichever app (iMKS or Coelum) downloads them.
const appFile = (name) => new URL(`../${name}`, import.meta.url).href;
const STAR_FILES = {
  8: { url: appFile('data/stars-8.bin'), label: 'to magnitude 8', size: '1.3 MB' },
  10: { url: appFile('data/stars-10.bin'), label: 'to magnitude 10', size: '8.3 MB' },
  11: { url: appFile('data/stars-11.bin'), label: 'to magnitude 11', size: '18.4 MB' },
};
const STAR_CACHE = 'imks-data-stars', STAR_KEY = appFile('coelum-faint-stars.bin');
let faintVariant = null, faintLoading = null;
function loadFaintStars() {
  if (!faintLoading) faintLoading = (async () => {
    try {
      const res = await (await caches.open(STAR_CACHE)).match(STAR_KEY);
      if (!res) return;
      try {
        setFaintStars(await res.arrayBuffer());
        faintVariant = res.headers.get('x-variant');
      } catch { await removeFaintStars(); }
    } catch { /* no Cache Storage (private mode): nothing stored */ }
  })();
  return faintLoading;
}
async function downloadFaintStars(variant, progress) {
  // no-store: past the service worker, which would keep a second copy
  const res = await fetch(STAR_FILES[variant].url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0, reader = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (total) progress(got / total);
  }
  const data = await new Blob(parts).arrayBuffer();
  setFaintStars(data);
  faintVariant = variant;
  try { await (await caches.open(STAR_CACHE)).put(STAR_KEY, new Response(data, { headers: { 'x-variant': variant } })); } catch { /* kept for this session */ }
}
async function removeFaintStars() {
  try { await caches.delete(STAR_CACHE); } catch { /* nothing stored */ }
  faintVariant = null;
  setFaintStars(null);
}

// The sky view's camera that puts the direction d at (x, y) (in units of
// the radius): Newton's method on azimuth and altitude, from the current
// ones, so a dragged point follows the finger, even across the zenith.
function solveLook(d, x, y, az, alt) {
  const err = (a, h) => { const p = projectVector(d, lookAt(a, h), true); return [p.x - x, p.y - y]; };
  for (let k = 0; k < 8; k++) {
    const e = err(az, alt);
    if (Math.hypot(e[0], e[1]) < 1e-9) break;
    const s = 1e-3, sh = alt + s > 90 ? -s : s, ea = err(az + s, alt), eh = err(az, alt + sh);
    const j = [(ea[0] - e[0]) / s, (eh[0] - e[0]) / sh, (ea[1] - e[1]) / s, (eh[1] - e[1]) / sh], det = j[0] * j[3] - j[1] * j[2];
    if (Math.abs(det) < 1e-12) break;
    let da = -(j[3] * e[0] - j[1] * e[1]) / det, dh = -(-j[2] * e[0] + j[0] * e[1]) / det;
    const m = Math.max(Math.abs(da), Math.abs(dh));
    if (m > 20) { da *= 20 / m; dh *= 20 / m; }
    az = ((az + da) % 360 + 360) % 360; alt = Math.max(-90, Math.min(90, alt + dh));
  }
  return { az, alt };
}

// The chart turns freely near the zenith, where the horizon is a circle
// around the center; further away it keeps the horizon level, with the
// zenith up or, once tilted past it, down (side 1 or −1), so it never flips
// over during a gesture. It turns about the direction under the finger
// (axis, in camera coordinates; the center for keys and flights), so the
// grabbed point stays there; the angle comes from a few secant steps. When
// no such turn levels it (a high star held near the edge), the view then
// rolls about its center: the horizon wins over the finger.
const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const zenithSide = (r) => (Math.hypot(r[2], r[5]) < 0.05 ? 0 : r[5] >= 0 ? 1 : -1);
function turnAbout(r, u, t) {
  const c = Math.cos(t), s = Math.sin(t), k = 1 - c;
  const q = [c + u[0] * u[0] * k, u[0] * u[1] * k - u[2] * s, u[0] * u[2] * k + u[1] * s, u[1] * u[0] * k + u[2] * s, c + u[1] * u[1] * k, u[1] * u[2] * k - u[0] * s, u[2] * u[0] * k - u[1] * s, u[2] * u[1] * k + u[0] * s, c + u[2] * u[2] * k];
  return [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => q[3 * i] * r[j] + q[3 * i + 1] * r[3 + j] + q[3 * i + 2] * r[6 + j]));
}
function levelChart(r, side, axis = null, t0 = null) {
  if (!side) return r;
  const tilt = (m) => Math.atan2(side * m[2], side * m[5]), free = (m) => smooth(50, 80, Math.abs(Math.asin(Math.max(-1, Math.min(1, m[8])))) / R);
  t0 ??= tilt(r);
  const miss = (m) => tilt(m) - free(m) * t0;
  // About the finger, only small turns: a large one would swing the view
  // away; then the view rolls about its center instead, from where it was.
  const limit = axis ? 0.35 : Infinity;
  let a = 0, fa = miss(r), b = Math.max(-limit, Math.min(limit, -fa)), best = r, bestMiss = Math.abs(fa);
  for (let k = 0; k < 8 && Math.abs(fa) > 1e-7; k++) {
    const m = turnAbout(r, axis || [0, 0, 1], b), fb = miss(m);
    if (Math.abs(fb) < bestMiss) { best = m; bestMiss = Math.abs(fb); }
    if (Math.abs(fb - fa) < 1e-12) break;
    [a, fa, b] = [b, fb, Math.max(-limit, Math.min(limit, b - fb * (b - a) / (fb - fa)))];
  }
  return axis && bestMiss > 1e-4 ? levelChart(r, side, null, t0) : best;
}

const orientationSupported = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && matchMedia('(any-pointer: coarse)').matches;

const icon = (d, extra = '') => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
const ICONS = {
  search: icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>'),
  chart: icon('<circle cx="12" cy="12" r="9"/><path d="M7 15l4-6 3 4 3-5"/><circle cx="7" cy="15" r=".6" fill="currentColor"/><circle cx="11" cy="9" r=".6" fill="currentColor"/><circle cx="14" cy="13" r=".6" fill="currentColor"/><circle cx="17" cy="8" r=".6" fill="currentColor"/>'),
  sky: icon('<path d="M2 19l5.5-6.5 3.5 4 3-3 8 5.5"/><path d="M2 19h20"/><path d="M16.5 4.5a3.2 3.2 0 1 0 3 4.6 2.6 2.6 0 0 1-3-4.6z"/><path d="M7 5.5v2M6 6.5h2"/>'),
  expand: icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  shrink: icon('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  layers: icon('<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12.5 9.5 5 9.5-5"/><path d="m2.5 16.5 9.5 5 9.5-5"/>'),
  legend: icon('<circle cx="5" cy="6" r="1.6"/><path d="M10 6h10"/><path d="M3.4 12h3.2"/><path d="M10 12h10"/><rect x="3.4" y="16.4" width="3.2" height="3.2"/><path d="M10 18h10"/>'),
  play: icon('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  pause: icon('<path d="M8 5v14M16 5v14" stroke-width="3.2"/>'),
  back: icon('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 3.5V8h4.5"/><path d="M12 8v4l2.5 2"/>'),
  forward: icon('<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M21 3.5V8h-4.5"/><path d="M12 8v4l2.5 2"/>'),
  reverse: icon('<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>'),
  reset: icon('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'),
  close: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
  orient: icon('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.5 18.5h3"/><path d="M12 6.5l2 4.5h-4z" fill="currentColor"/>'),
  lock: icon('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>'),
  unlock: icon('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.8"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>'),
};
const LAYERS = [
  ['ground', 'Ground', 'chart sky'], ['atmosphere', 'Atmosphere', 'sky'], ['milkyway', 'Milky Way', 'chart sky'],
  ['constellations', 'Constellations', 'chart sky'], ['boundaries', 'Boundaries', 'chart sky'], ['ecliptic', 'Ecliptic', 'chart sky'],
  ['horizontal', 'Alt / Az grid', 'chart sky'], ['equatorial', 'RA / Dec grid', 'chart sky'], ['deep', 'Deep sky', 'chart sky'], ['minor', 'Minor planets', 'chart sky'], ['satellites', 'Satellites', 'chart sky'], ['labels', 'Labels', 'chart sky'],
];
const MODES = { chart: 'Chart', sky: 'Sky' };
// Match the chart and Sky limits, with enough magnification for mapped
// moons; the separate planet view remains available for their systems.
const SKY_MAX = 4000000;
const TYPE_ORDER = { 'lunar feature': 'Moon feature', 'Mars feature': 'Mars feature', star: 'Star', planet: 'Planet', moon: 'Moon', constellation: 'Constellation' };
// Search status symbols share their shapes with the key and tap/hover hints.
const searchIcon = (body) => `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SEARCH_ICONS = {
  moon: searchIcon('<path fill="currentColor" stroke="none" d="M10 2A8 8 0 0 1 10 18A4.5 8 0 0 0 10 2Z"/>'),
  mars: searchIcon('<circle cx="8" cy="12" r="5"/><path d="m11.5 8.5 6-6M12 2h6v6"/>'),
  unlit: searchIcon('<circle cx="10" cy="10" r="4"/><path d="M10 1v2m0 14v2M1 10h2m14 0h2M3 3l2 2m10 10 2 2M3 17 17 3"/>'),
  far: searchIcon('<circle cx="10" cy="10" r="8"/><path fill="currentColor" stroke="none" d="M10 2a8 8 0 0 0 0 16Z"/>'),
  below: searchIcon('<path d="M2 14h16M10 2v9m-4-4 4 4 4-4m-7 11h6"/>'),
};
const searchStatus = (m) => [
  ...(m.key?.startsWith('lunar:') ? [['moon', 'Moon feature']] : m.key?.startsWith('mars:') ? [['mars', 'Mars feature']] : []),
  ...(m.availability ? [[m.availability === 'not sunlit' ? 'unlit' : 'far', m.availability === 'not sunlit' ? 'Not sunlit' : m.availability === 'beyond limb' ? 'Beyond limb' : 'Far side']] : []),
  ...(m.alt < 0 ? [['below', 'Below horizon']] : []),
];
let explorers = 0;

// Ask the controlling worker, rather than guessing from old cache names.
const workerVersion = (worker) => new Promise((resolve) => {
  if (!worker) return resolve(null);
  const channel = new MessageChannel();
  const finish = (version) => { clearTimeout(timer); channel.port1.close(); resolve(version); };
  const timer = setTimeout(() => finish(null), 1500);
  channel.port1.onmessage = (event) => finish(event.data);
  worker.postMessage('version', [channel.port2]);
});
const updateReceipt = 'imks-coelum-app-update';

// The worker installs the complete new shell atomically, preserving user data
// and downloaded catalogs. An unchanged version needs no cache writes/reload.
export async function forceAppUpdate(reload = () => location.reload(), report = () => {}) {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) throw new Error('App updates are unavailable in this browser.');
  const current = await workerVersion(navigator.serviceWorker.controller || registration.active);
  report(`Current version: ${current || 'unknown'}. Checking for updates…`);
  const response = await fetch(registration.active?.scriptURL || registration.installing?.scriptURL, { cache: 'no-store' });
  if (!response.ok) throw new Error('Cannot check for updates. Try again when online.');
  const source = await response.text();
  // The shared worker derives its cache name from its registration scope.
  const build = /const CACHE = `\$\{APP\}-v(\d+)`/.exec(source)?.[1];
  if (!build || !current) throw new Error('Cannot determine the app version. Try again when online.');
  const prefix = new URL(registration.scope).pathname.endsWith('/coelum/') ? 'coelum-v' : 'imks-v';
  const latest = prefix + build;
  if (latest === current) {
    report(`Current version: ${current}. Up to date; no update required.`);
    return;
  }
  report(`Current version: ${current}. Update required: ${latest}. Downloading…`);
  // Keep the result across a reload, including hosts that reload on activation.
  try { sessionStorage.setItem(updateReceipt, JSON.stringify({ current, latest })); } catch { /* private mode */ }
  try {
    await registration.update();
    const worker = registration.installing || registration.waiting;
    if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer); worker.removeEventListener('statechange', check);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (worker.state === 'activated') finish();
        else if (worker.state === 'redundant') finish(new Error('App update failed.'));
      };
      const timer = setTimeout(() => finish(new Error('App update timed out.')), 60000);
      worker.addEventListener('statechange', check); check();
    });
    const installed = await workerVersion(registration.active);
    if (installed !== latest) throw new Error('App update did not install. Try again when online.');
    report(`Updated from ${current}. New version: ${installed}. Restarting…`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    reload();
  } catch (error) {
    try { sessionStorage.removeItem(updateReceipt); } catch { /* private mode */ }
    throw error;
  }
}

// Kept separate from calculator state: exploring never changes the saved
// calculation. Timers end automatically when the sheet's root is removed.
// options (from the app): places() and rememberPlace(key, place), the
// places found online; minorBodies(), the minor planets and comets looked
// up; standalone, always in full screen (the Coelum app); onPlace(place,
// label), a place chosen; panels, more panels of the app, [{ key, label,
// icon, render(body, explorer) }], each with its button on the rail and
// drawn anew on opening.
export function mountCoelum(root, model, formatTime, options = {}) {
  const id = `coelum-${++explorers}`, extra = options.panels || [];
  let mode = 'chart';
  try { if (localStorage.getItem('imks-coelum-mode') === 'sky') mode = 'sky'; } catch { /* private mode */ }
  root.dataset.mode = mode;
  root.innerHTML = `<div class="coelum-topbar coelum-hud">
      <div class="coelum-search">${ICONS.search}<input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="Search" aria-label="Search stars, planets, deep-sky objects and surface features" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-results"><div class="coelum-search-dropdown" hidden><ul class="coelum-results" id="${id}-results" role="listbox" aria-label="Matches" hidden></ul><div class="coelum-search-key"></div><div class="coelum-search-hint" role="status" hidden></div></div></div>
      <div class="coelum-seg" role="group" aria-label="View">${Object.entries(MODES).map(([m, label]) => `<button type="button" data-view="${m}" aria-pressed="${m === mode}" title="${m === 'chart' ? 'Map-like star chart' : 'Realistic sky'}">${ICONS[m]}<span>${label}</span></button>`).join('')}</div>
      ${options.standalone ? '' : `<button type="button" class="coelum-btn" data-action="fullscreen" aria-pressed="false" aria-label="Full screen" title="Full screen">${ICONS.expand}</button>`}
    </div>
    <div class="coelum-viewport">
      <canvas class="coelum-canvas" aria-hidden="true"></canvas><svg class="coelum-full" viewBox="0 0 600 600" role="img" tabindex="0" aria-label="Interactive sky; drag to look around, pinch or scroll to zoom"></svg>
      <div class="coelum-rail coelum-hud" role="toolbar" aria-label="View" aria-orientation="vertical">
        <button type="button" class="coelum-btn" data-action="in" aria-label="Zoom in" title="Zoom in">${ICONS.plus}</button>
        <button type="button" class="coelum-btn" data-action="out" aria-label="Zoom out" title="Zoom out">${ICONS.minus}</button>
        <button type="button" class="coelum-btn" data-action="lock" aria-pressed="false" aria-label="Lock the selected object in place" title="Lock the selected object in place">${ICONS.unlock}</button>
        <button type="button" class="coelum-btn coelum-btn-text coelum-mount" data-action="mount" aria-pressed="false" aria-label="Equatorial mount" title="Alt-az: the horizon level (tap for equatorial)">AZ</button>
        <span class="coelum-rail-gap" aria-hidden="true"></span>
        ${extra.map((p) => `<button type="button" class="coelum-btn" data-action="${p.key}" aria-expanded="false" aria-controls="${id}-${p.key}" aria-label="${esc(p.label)}" title="${esc(p.label)}">${p.icon}</button>`).join('')}
        <button type="button" class="coelum-btn" data-action="layers" aria-expanded="false" aria-controls="${id}-layers" aria-label="Layers and labels" title="Layers and labels">${ICONS.layers}</button>
        <button type="button" class="coelum-btn" data-action="legend" data-modes="chart" aria-expanded="false" aria-controls="${id}-legend" aria-label="Legend" title="Legend">${ICONS.legend}</button>
      </div>
      <div class="coelum-panel coelum-toolbar" id="${id}-layers" role="group" aria-label="Sky layers" hidden>
        <div class="coelum-panel-head"><h3>Layers</h3><button type="button" class="coelum-btn coelum-btn-small" data-action="close-panel" aria-label="Close layers">${ICONS.close}</button></div>
        <div class="coelum-switches">${LAYERS.map(([key, label, modes]) => `<label data-modes="${modes}"><input type="checkbox" role="switch" data-layer="${key}"><span>${label}</span></label>`).join('')}</div>
        <div class="coelum-selects"><label data-modes="chart">Stars to magnitude <select data-limit>${[3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => `<option value="${n}" ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>Horizon <select data-horizon><option value="landscape">Landscape</option><option value="terrain">Local terrain</option><option value="flat">Flat</option></select></label><label>Text size <select data-label-size><option value="14">Normal</option><option value="17">Large</option><option value="20">Larger</option></select></label></div>
        <div class="coelum-downloads" data-phone-options${orientationSupported() ? '' : ' hidden'}><h3>Phone orientation</h3>
          <p class="coelum-panel-note" data-orient-quality>Turn on following with the phone button. Pan to align the sky; pinch to zoom.</p>
          <div class="coelum-switches"><label><input type="checkbox" role="switch" data-orient-level><span>Keep the horizon level</span></label></div>
          <p class="coelum-panel-note">For accurate pointing, select a known star or planet, point the back of the phone at it, then align. This also corrects magnetic north to the sky’s geographic north. Avoid objects near the zenith.</p>
          <button type="button" class="coelum-chip" data-action="orient-align" disabled>Align with selected object</button>
        </div>
        <p class="coelum-panel-note coelum-terrain-note" hidden></p>
        <p class="coelum-panel-note" data-modes="sky">Stars fade with twilight, moonlight and toward the horizon; zoom in to see fainter ones. With the atmosphere, positions include refraction.</p>
        <div class="coelum-downloads coelum-satellites"><h3>Satellites</h3>
          <div class="coelum-switches">${SAT_GROUPS.map(([g, label]) => `<label><input type="checkbox" role="switch" data-satellite-group="${g}"><span>${label}</span></label>`).join('')}</div>
          <p class="coelum-panel-note coelum-satellite-note"></p><button type="button" class="coelum-chip" data-satellites="update">Update now</button></div>
        <div class="coelum-downloads"><h3>Fainter stars</h3><p class="coelum-panel-note coelum-faint-note"></p>
          <div class="coelum-download-buttons">${Object.entries(STAR_FILES).map(([k, f]) => `<button type="button" class="coelum-chip" data-download="${k}">${f.label[0].toUpperCase() + f.label.slice(1)} · ${f.size}</button>`).join('')}<button type="button" class="coelum-chip" data-download="remove">Remove</button></div></div>
      </div>
      ${extra.map((p) => `<div class="coelum-panel coelum-extra" id="${id}-${p.key}" data-panel="${p.key}" role="group" aria-label="${esc(p.label)}" hidden>
        <div class="coelum-panel-head"><h3>${esc(p.label)}</h3><button type="button" class="coelum-btn coelum-btn-small" data-action="close-panel" aria-label="Close ${esc(p.label.toLowerCase())}">${ICONS.close}</button></div>
        <div class="coelum-panel-body"></div></div>`).join('')}
      <div class="coelum-panel coelum-timepanel" id="${id}-time" role="group" aria-label="Date and time" hidden>
        <div class="coelum-panel-head"><h3>Date and time</h3><button type="button" class="coelum-btn coelum-btn-small" data-action="close-panel" aria-label="Close date and time">${ICONS.close}</button></div>
        <div class="coelum-time-row"><input type="datetime-local" step="60" data-time-input aria-label="Date and time on this device's clock"><button type="button" class="coelum-chip" data-set-time="now">Now</button></div>
        <p class="coelum-panel-note coelum-zone-note"></p>
        <h3 class="coelum-events-head">Events of the day</h3>
        <div class="coelum-events"></div>
        <div class="coelum-chips"><button type="button" class="coelum-chip" data-time-step="-86400">−1 day</button><button type="button" class="coelum-chip" data-time-step="86400">+1 day</button><button type="button" class="coelum-chip" data-set-time="original">Original time</button></div>
      </div>
      <div class="coelum-panel coelum-placepanel" id="${id}-place" role="group" aria-label="Place" hidden>
        <div class="coelum-panel-head"><h3>Place</h3><button type="button" class="coelum-btn coelum-btn-small" data-action="close-panel" aria-label="Close place">${ICONS.close}</button></div>
        <form class="coelum-place-form"><input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="City, or latitude, longitude" aria-label="Search places"><button type="submit" class="coelum-chip">Search online</button></form>
        <div class="coelum-place-results" role="list"></div>
        <p class="coelum-panel-note coelum-place-status" role="status" aria-live="polite"></p>
        <div class="coelum-chips"><button type="button" class="coelum-chip" data-place="here">Current location</button><button type="button" class="coelum-chip" data-place="original">Original place</button></div>
      </div>
      <div class="coelum-moonsview" role="group" aria-label="Moons" hidden>
        <div class="sky-stage coelum-moons-stage"></div>
        <div class="coelum-moons-head"><div><h3 class="coelum-moons-title">Moons</h3><p class="coelum-moons-data"></p></div><button type="button" class="coelum-chip" data-action="moon-events" aria-expanded="false" aria-controls="${id}-moon-events" hidden>Events</button><button type="button" class="coelum-btn coelum-btn-small" data-action="close-moons" aria-label="Close the moons">${ICONS.close}</button></div>
        <div class="coelum-moon-events" id="${id}-moon-events" role="group" aria-label="Events of planetary moons" hidden></div>
        <div class="coelum-mars-detail" hidden></div>
        <p class="coelum-moons-note">As in a telescope (north up, east left), at the chart's time. Drag, pinch or double-tap to fit<span class="coelum-mars-tap" hidden>; zoom in and tap a surface feature for details</span><span class="coelum-moons-tap" hidden>; tap a moon to find it in the sky</span>.</p>
      </div>
      <p class="coelum-toast" role="status" aria-live="polite" hidden></p>
      <div class="coelum-panel coelum-legend" id="${id}-legend" role="group" aria-label="Legend" hidden>
        <button type="button" class="coelum-btn coelum-btn-small coelum-panel-close" data-action="close-panel" aria-label="Close legend">${ICONS.close}</button>${chartLegend()}
      </div>
    </div>
    <div class="coelum-timebar coelum-hud">
      <div class="coelum-clock"><p class="coelum-status" aria-live="polite"><button type="button" class="coelum-link" data-action="time" aria-expanded="false" aria-controls="${id}-time" title="Set the date and time"><b></b></button> · <button type="button" class="coelum-link" data-action="place" aria-expanded="false" aria-controls="${id}-place" title="Choose the place"></button><span class="coelum-condition"></span></p><span class="coelum-clock-side"><output class="coelum-speed" data-speed data-rate="60" aria-live="polite" title="Simulated seconds per real second">60×</output><span class="coelum-ruler" title="Angular scale at the center of the view"><i></i><b></b></span></span></div>
      <div class="coelum-controls" role="toolbar" aria-label="Time">
        <button type="button" class="coelum-btn coelum-btn-text" data-action="back" aria-label="One hour earlier" title="One hour earlier">−1 h</button>
        <button type="button" class="coelum-btn coelum-btn-text" data-action="slower" aria-label="Decrease playback speed (about half)" title="Decrease playback speed (about half)">÷2</button>
        <button type="button" class="coelum-btn coelum-play" data-action="play" aria-label="Play" title="Play">${ICONS.play}</button>
        <button type="button" class="coelum-btn coelum-btn-text" data-action="faster" aria-label="Increase playback speed (about double)" title="Increase playback speed (about double)">×2</button>
        <button type="button" class="coelum-btn coelum-btn-text" data-action="forward" aria-label="One hour later" title="One hour later">+1 h</button>
        <button type="button" class="coelum-btn" data-action="reverse" aria-pressed="false" aria-label="Reverse playback direction" title="Reverse playback direction">${ICONS.reverse}</button>
        <button type="button" class="coelum-btn" data-action="reset" aria-label="Back to the original time, place and view" title="Back to the original time, place and view · Hold to check for app updates">${ICONS.reset}</button>
        <button type="button" class="coelum-btn" data-action="orient" aria-pressed="false" aria-label="Follow the phone's orientation" title="Follow the phone's orientation"${orientationSupported() ? '' : ' hidden'}>${ICONS.orient}</button>
      </div>
    </div>
    <section class="coelum-detail" aria-label="Selected object" aria-live="polite"><button type="button" class="coelum-btn coelum-btn-small coelum-panel-close" data-action="deselect" aria-label="Clear selection">${ICONS.close}</button><div class="coelum-detail-body"><p>Tap an object or its label, or search for it, to see its characteristics.</p></div></section>
    <p class="sky-hint">Drag to look around · pinch or scroll to zoom · double-tap to reset the view. <span data-modes="chart">Symbol sizes are exaggerated; deep-sky symbols mark catalog positions, not naked-eye visibility.</span><span data-modes="sky">Stars, planets and the Milky Way appear as the sky darkens; with the atmosphere, positions include refraction.</span> <span data-modes="chart">Geometric positions, without refraction.</span></p>
    <details class="coelum-credit"><summary>Chart data</summary><p>Stars: <a href="https://codeberg.org/astronexus/athyg" target="_blank" rel="noopener">AT-HYG</a> v4.0 (David Nash, CC BY-SA 4.0), from Tycho-2, Hipparcos, the Yale Bright Star and Gliese catalogs, Gaia DR3 distances and proper motions, and the IAU star names; V, B−V, double and variable stars from the Hipparcos catalogue (ESA, 1997). Constellation figures, boundaries and Milky Way outlines: Olaf Frohn (BSD-3-Clause). Named stars and deep-sky objects: the app’s IAU / HYG / OpenNGC catalogs. The Moon: NASA LRO. Planets: Solar System Scope (CC BY 4.0, from NASA’s missions); Saturn, its rings and the Galilean moons created by <a href="https://bjj.mmedia.is/data/planetary_maps.html" target="_blank" rel="noopener">Björn Jónsson</a> (NASA Voyager, Galileo and Cassini images). Local horizon: AWS Terrain Tiles (Mapzen; SRTM, Copernicus and other elevation models). Star positions include precession, nutation and proper motion. Clouds and light pollution are not modeled.</p></details>`;
  const $ = (s) => root.querySelector(s);
  const svg = $('.coelum-full'), statusTime = $('[data-action="time"] b'), statusPlace = $('[data-action="place"]'), statusCondition = $('.coelum-condition'), detail = $('.coelum-detail-body'), viewport = $('.coelum-viewport');
  const canvas = $('.coelum-canvas'), ctx = canvas.getContext('2d'), input = $('.coelum-search input'), results = $('.coelum-results'), searchDropdown = $('.coelum-search-dropdown'), searchKey = $('.coelum-search-key'), searchHint = $('.coelum-search-hint');
  const layers = { chart: { ...DEFAULT_LAYERS }, sky: { ...SKY_LAYERS } };
  const views = { chart: { scale: 1, rotation: [...SKY_IDENTITY] }, sky: null };
  const labelHistory = { chart: new Map(), sky: new Map() }, gridHistory = { chart: new Map(), sky: new Map() };
  let size = 360, height = 360;
  let place = [...model.place], placeLabel = model.label;
  setMinorBodies(options.minorBodies?.() || []);
  setSatellites(satelliteList());
  let t = model.t, frame = skyFrame(t, place), drawn, playing = false, last = 0, selected = null, unlitLunar = null, detailHTML = '';
  let animator = null, animation = 0, lastUI = -Infinity, frameNumber = 0, speed = 60, flight = 0, interacting = false, settleTimer = 0;
  // Suppress daylight and refraction once a day passes in a real second,
  // without changing the atmosphere preference saved in the layer controls.
  const atmosphereOn = () => layers.sky.atmosphere && (!playing || Math.abs(speed) < 86400);
  // The horizon (shared by both views): the terrain's profile, if computed.
  let horizon = 'landscape', terrain = null;
  try { horizon = localStorage.getItem('imks-coelum-horizon') || 'landscape'; } catch { /* private mode */ }
  const setTerrain = (profile) => { terrain = profile ? horizonAt(profile) : null; };
  setTerrain(storedHorizon(place));
  if (horizon === 'terrain' && !terrain) horizon = 'landscape';
  const applyHorizon = () => {
    layers.sky.horizon = horizon; layers.sky.terrain = terrain;
    layers.chart.terrain = horizon === 'terrain' ? terrain : null;
  };
  applyHorizon();
  // The mount: alt-az (the horizon's frame: the zenith up) or equatorial
  // (RA and Dec of date: the pole up, the stars fixed on the screen). The
  // views keep their cameras in the mount's frame, and gestures, flights
  // and levelling work there; the drawing turns them to the horizon's.
  let mount = 'altaz';
  try { if (localStorage.getItem('imks-coelum-mount') === 'equatorial') mount = 'equatorial'; } catch { /* private mode */ }
  // From horizontal [east, north, up] to the mount's frame, F[3k + j]
  const mountMatrix = () => {
    if (mount !== 'equatorial') return null;
    const lst = siderealTime(frame.t, place[1]) * R, lat = place[0] * R, sl = Math.sin(lst), cl = Math.cos(lst), sp = Math.sin(lat), cp = Math.cos(lat);
    return [-sl, -sp * cl, cp * cl, cl, -sp * sl, cp * sl, 0, cp, sp];
  };
  const toMount = (h, F = mountMatrix()) => (F ? [0, 1, 2].map((k) => F[3 * k] * h[0] + F[3 * k + 1] * h[1] + F[3 * k + 2] * h[2]) : h);
  const fromMount = (m, F = mountMatrix()) => (F ? [0, 1, 2].map((j) => F[j] * m[0] + F[3 + j] * m[1] + F[6 + j] * m[2]) : m);
  // a camera (rows: its axes) of the mount's frame in the horizon's, and back
  const horizonCamera = (r, F = mountMatrix()) => (F ? [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => r[3 * i] * F[j] + r[3 * i + 1] * F[3 + j] + r[3 * i + 2] * F[6 + j])) : r);
  const mountCamera = (r, F = mountMatrix()) => (F ? [0, 1, 2].flatMap((i) => [0, 1, 2].map((k) => r[3 * i] * F[3 * k] + r[3 * i + 1] * F[3 * k + 1] + r[3 * i + 2] * F[3 * k + 2])) : r);
  const lookOf = (d) => ({ az: (Math.atan2(d[0], d[1]) / R + 360) % 360, alt: Math.asin(Math.max(-1, Math.min(1, d[2]))) / R });
  // the chart's home: the zenith at the center
  const chartHome = () => (mount === 'equatorial' ? (({ az, alt }) => lookAt(az, alt))(lookOf(toMount([0, 0, 1]))) : [...SKY_IDENTITY]);
  if (mount === 'equatorial') views.chart.rotation = chartHome();
  const skyView = () => {
    if (!views.sky) { const v = defaultSkyView(frame, size, height); views.sky = { ...v, ...lookOf(toMount(horizontalVector(v.alt, v.az))) }; }
    return views.sky;
  };

  const setSpeed = (value) => {
    speed = value; last = performance.now(); animator = null;
    const output = $('[data-speed]');
    output.dataset.rate = String(speed);
    output.textContent = formatPlaybackSpeed(speed);
    output.title = `${Number(Math.abs(speed).toFixed(6))} simulated seconds per second, ${speed < 0 ? 'backward' : 'forward'}`;
    $('[data-action="reverse"]').setAttribute('aria-pressed', String(speed < 0));
    setPlay(playing);
  };
  const updateUI = (force = false) => {
    const now = performance.now();
    syncOrientationUI();
    if (!force && now - lastUI < 200) return;
    lastUI = now;
    // Retire selections that leave the projected layer (search may allow unlit).
    const feature = drawn?.lunarFeatures?.find((f) => f.key === selected);
    if (selected?.startsWith('lunar:') && !feature) { selected = null; unlitLunar = null; detailHTML = ''; detail.innerHTML = '<p>Tap an object or its label, or search for it, to see its characteristics.</p>'; }
    root.classList.toggle('coelum-has-selection', Boolean(selected));
    const sun = frame.bodies[0].alt, condition = sun >= 0 ? 'Daylight' : sun >= -6 ? 'Civil twilight' : sun >= -12 ? 'Nautical twilight' : sun >= -18 ? 'Astr. twilight' : 'Night';
    statusTime.textContent = formatTime(t); statusPlace.textContent = placeLabel; statusCondition.textContent = ` · ${condition} · Sun ${sun.toFixed(1)}°`;
    if (selected) {
      const o = findObject(frame, selected);
      const html = feature ? lunarFeatureDetails(feature) : o && objectDetails(mode === 'sky' && atmosphereOn() ? { ...o, apparentAlt: o.alt + refraction(o.alt, place[2] || 0) } : o);
      // unchanged, the card stays (a tap on its button is not lost)
      if (html && html !== detailHTML) detail.innerHTML = detailHTML = html;
    }
  };
  const currentView = () => (mode === 'sky' ? skyView() : views.chart);
  // The view's state, also as attributes (for tests and snapshots).
  const mark = () => {
    const view = currentView();
    svg.dataset.rotation = (orient?.tracker.filtered ? phoneCamera() : view.rotation || []).join(','); svg.dataset.scale = String(view.scale);
    if (mode === 'sky') { svg.dataset.az = view.az.toFixed(7); svg.dataset.alt = view.alt.toFixed(7); }
    return view;
  };
  let pending = 0;
  const surfaceMapsWatched = new Set();
  // The lock: the object stays where it is on the screen as time runs (the
  // view turns with it); drags and flights move it, and it stays where they
  // leave it (its place in the camera's frame, or on the sky view's
  // projection: spot, null to take it again); zooms keep it in place.
  let lock = null;
  const applyLock = () => {
    const o = lock && findObject(frame, lock.name);
    if (!o) return;
    const v = currentView(), m = toMount(mode === 'sky' && atmosphereOn() ? refractVector(pointVector(o), place[2] || 0) : pointVector(o));
    const renew = !lock.spot || lock.spot.mode !== mode;
    if (mode === 'sky') {
      if (renew) { const q = projectVector(m, lookAt(v.az, v.alt), true); lock.spot = { mode, x: q.x, y: q.y }; return; }
      const look = solveLook(m, lock.spot.x, lock.spot.y, v.az, v.alt);
      if (Number.isFinite(look.az) && Number.isFinite(look.alt)) Object.assign(v, look, { auto: false });
    } else {
      const now = [0, 1, 2].map((i) => dot3(v.rotation.slice(3 * i, 3 * i + 3), m));
      if (renew) { lock.spot = { mode, c: now }; return; }
      const r = rotateSky(v.rotation, now, lock.spot.c), rotation = levelChart(r, zenithSide(v.rotation) || zenithSide(r), lock.spot.c);
      if (rotation.every(Number.isFinite)) v.rotation = rotation;
    }
  };
  const setLock = (name) => {
    lock = name ? { name, spot: null } : null;
    const b = $('[data-action="lock"]'), label = lock ? `Unlock ${name}` : 'Lock the selected object in place';
    b.innerHTML = lock ? ICONS.lock : ICONS.unlock; b.setAttribute('aria-pressed', String(Boolean(lock)));
    b.setAttribute('aria-label', label); b.title = label;
  };
  // The ruler: a round angle (arcseconds) 90 px long or less, at the center
  // of the view, or of the planet's close-up
  const RULER = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000, 72000, 108000, 162000, 324000];
  const ruler = $('.coelum-ruler');
  const showRuler = (perPixel) => {
    const a = [...RULER].reverse().find((x) => x / perPixel <= 90) ?? RULER[0], text = a < 60 ? `${a}″` : a < 3600 ? `${a / 60}′` : `${a / 3600}°`;
    ruler.firstChild.style.width = `${Math.round(a / perPixel)}px`;
    if (ruler.lastChild.textContent !== text) ruler.lastChild.textContent = text;
  };
  const draw = (recompute = false) => {
    const drawStart = performance.now();
    cancelAnimationFrame(pending); pending = 0;
    if (recompute) { animator = null; frame = skyFrame(t, place); }
    svg.setAttribute('viewBox', `0 0 ${size} ${height}`);
    svg.dataset.time = String(t);
    if (playing) {
      if (!animator) animator = createSkyAnimator(t, place, layers[mode], speed);
      frame = animator(t);
    }
    // the planet's close-up covers the view: the sky is not drawn
    if (moons) { followMoons(); updateUI(!playing); return; }
    applyLock();
    const view = mark(), F = mountMatrix();
    // the camera in the horizon's frame, for drawing
    const shown = { ...view, selected, unlitLunar, labelHistory: labelHistory[mode], gridHistory: gridHistory[mode], rotation: orient?.tracker.filtered ? phoneCamera() : mode === 'sky' ? F && horizonCamera(lookAt(view.az, view.alt), F) : horizonCamera(view.rotation, F) };
    if (orient?.tracker.filtered) svg.dataset.rotation = shown.rotation.join(',');
    showRuler(3600 / (mode === 'sky' ? skyRadius(size, height, view.scale) * R / 2 : chartRadius(size, height, view.scale) / 90));
    // One canvas under the SVG. The chart moves on it (playback, drags,
    // flights) and settles as SVG over its sky and Milky Way.
    const onCanvas = playing || mode === 'sky' || interacting;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(size * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (onCanvas) {
      drawn = mode === 'sky' ? skyScene(frame, size, height, { ...layers.sky, atmosphere: atmosphereOn() }, { ...shown, moving: interacting }, ctx) : skyChart(frame, size, height, layers.chart, shown, ctx);
      canvas.dataset.frame = String(++frameNumber);
      if (svg.childElementCount) svg.innerHTML = '';
    } else {
      drawn = skyChart(frame, size, height, layers.chart, { ...shown, backdrop: ctx });
      svg.innerHTML = drawn.svg;
    }
    if (mode === 'sky') for (const body of drawn.surfaceBodies) {
      if (surfaceMapsWatched.has(body)) continue;
      surfaceMapsWatched.add(body);
      planetMap(body)?.ready.then(() => { if (root.isConnected && mode === 'sky' && !playing) draw(); });
    }
    canvas.dataset.content = onCanvas ? 'scene' : 'backdrop';
    canvas.dataset.atmosphere = String(mode === 'sky' && atmosphereOn());
    updateUI(!playing && !interacting);
    orient?.tracker.drawn(performance.now() - drawStart);
  };
  // Gestures redraw at most once per display frame (two fingers send twice
  // the events); the state is already up to date.
  const requestDraw = () => {
    mark();
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; if (root.isConnected) draw(); });
  };
  const tick = (now) => {
    animation = 0;
    if (!root.isConnected || !playing) return;
    if (!document.hidden) {
      const next = t + Math.min(0.1, Math.max(0, (now - last) / 1000)) * speed;
      t = limitTime(next);
      if (t !== next) { pause(); return; }
      draw();
    }
    last = now;
    animation = requestAnimationFrame(tick);
  };
  // the play button points the way time runs
  const setPlay = (on) => {
    const button = $('[data-action="play"]'), label = on ? 'Pause' : speed < 0 ? 'Play backward' : 'Play';
    button.innerHTML = on ? ICONS.pause : ICONS.play;
    button.classList.toggle('coelum-backward', speed < 0);
    button.setAttribute('aria-label', label); button.title = label;
    button.setAttribute('aria-pressed', String(on));
  };
  const pause = () => {
    playing = false;
    cancelAnimationFrame(animation); animation = 0;
    setPlay(false);
    draw(true);
  };
  const interact = (settleAfter = 0) => {
    interacting = true; clearTimeout(settleTimer);
    if (settleAfter) settleTimer = setTimeout(settle, settleAfter);
  };
  // A flight cut short (reset, another view) leaves nothing moving.
  const stopFlight = () => { if (flight) { cancelAnimationFrame(flight); flight = 0; interacting = false; clearTimeout(settleTimer); } };
  const settle = () => { clearTimeout(settleTimer); if (!interacting) return; interacting = false; if (root.isConnected) draw(); };
  // The same largest magnification (pixels per degree at the center) in
  // both views.
  const chartMax = () => SKY_MAX * skyRadius(size, height, 1) * Math.PI / 4 / chartRadius(size, height, 1);
  const scaleLimits = () => (mode === 'sky' ? [0.6, SKY_MAX] : [1, chartMax()]);
  // the locked object's offset from the center, in pixels, kept from the
  // scale s0 to s1
  const zoomLock = (s0, s1) => {
    if (!lock?.spot) return;
    if (mode === 'sky') { const k = skyRadius(size, height, s0) / skyRadius(size, height, s1); lock.spot.x *= k; lock.spot.y *= k; return; }
    const k = chartRadius(size, height, s0) / chartRadius(size, height, s1), p = projectVector(lock.spot.c, SKY_IDENTITY);
    lock.spot.c = unprojectSky(p.x * k, p.y * k);
  };
  const zoom = (factor, later = false) => {
    const v = currentView(), [lo, hi] = scaleLimits(), s0 = v.scale;
    v.auto = false; v.scale = Math.min(hi, Math.max(lo, v.scale * factor));
    zoomLock(s0, v.scale);
    if (later) requestDraw(); else draw();
  };
  const fit = () => {
    stopFlight();
    if (mode === 'sky') { views.sky = null; skyView(); }
    else Object.assign(views.chart, { scale: 1, rotation: chartHome() });
    if (lock) lock.spot = null;
    draw();
  };
  // Fly to an object: the chart turns along a great circle (levelling its
  // horizon), the sky view pans in azimuth and altitude; both zoom in a
  // little.
  const goTo = (o, { fit = false, field = null, apparent = false, onArrival = null } = {}) => {
    stopOrientation();
    cancelAnimationFrame(flight);
    const start = performance.now(), duration = 650, ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    let step;
    const [lo, hi] = scaleLimits();
    const searchScale = () => {
      if (o.feature) {
        // Resolve the feature while keeping the Moon's feature layer active.
        const pixels = Math.min(130, Math.min(size, height) * 0.22);
        const radius = Math.max(LUNAR_MIN_RADIUS * 1.3, pixels * 1737.4 / Math.max(0.01, o.feature.diameter) / Math.sqrt(Math.max(0.06, o.lunarState.v[2])));
        return Math.max(lo, Math.min(hi, radius / (o.moonRadius * skyRadius(size, height, 1) / 2 * R)));
      }
      const angularField = field ?? searchAngularField(o), span = Math.min(size, height);
      const scale = mode === 'sky' ? span / (2 * skyRadius(size, height, 1) * Math.tan(angularField * R / 4)) : span / (chartRadius(size, height, 1) * angularField / 90);
      return Math.max(lo, Math.min(hi, scale));
    };
    if (mode === 'sky') {
      const v = skyView(), from = { ...v }; v.auto = false;
      const a = toMount(atmosphereOn() && !apparent ? refractVector(pointVector(o), place[2] || 0) : pointVector(o)), oAz = Math.atan2(a[0], a[1]) / R, oAlt = Math.asin(Math.max(-1, Math.min(1, a[2]))) / R;
      const daz = ((oAz - v.az + 540) % 360) - 180, alt = Math.max(-89.9, Math.min(89.9, oAlt)), scale = fit ? searchScale() : Math.min(SKY_MAX, Math.max(v.scale, o.planet ? 80 / (o.separation * skyRadius(size, height, 1) / 2 * R) : 2.5));
      step = (e) => Object.assign(v, { az: (from.az + daz * e + 360) % 360, alt: from.alt + (alt - from.alt) * e, scale: from.scale + (scale - from.scale) * e });
    } else {
      const v = views.chart, rotation = [...v.rotation], fromScale = v.scale, scale = fit ? searchScale() : Math.min(chartMax(), Math.max(v.scale, o.planet ? 80 / (o.separation * chartRadius(size, height, 1) / 90) : 2.5));
      const w = toMount(pointVector(o)), p = [0, 1, 2].map((i) => dot3(rotation.slice(i * 3, i * 3 + 3), w)), angle = Math.acos(Math.max(-1, Math.min(1, p[2])));
      const axis = unit3(p[0] || p[1] ? [p[0], p[1], 0] : [1, 0, 0]);
      const side = zenithSide(rotation) || zenithSide(rotateSky(rotation, p, [0, 0, 1])) || 1;
      step = (e) => {
        const a = angle * (1 - e), target = [axis[0] * Math.sin(a), axis[1] * Math.sin(a), Math.cos(a)];
        v.rotation = levelChart(e === 0 ? rotation : rotateSky(rotation, p, target), side);
        v.scale = fromScale + (scale - fromScale) * e;
      };
    }
    const frameStep = (now) => {
      const u = Math.min(1, (now - start) / duration);
      if (u < 1) interact();
      step(ease(u));
      if (lock) lock.spot = null;
      if (u < 1) draw(); else { onArrival?.(); interacting = true; settle(); }
      flight = u < 1 && root.isConnected ? requestAnimationFrame(frameStep) : 0;
    };
    flight = requestAnimationFrame(frameStep);
  };
  const select = (name, { allowUnlit } = {}) => {
    if (name !== selected || allowUnlit !== undefined) unlitLunar = allowUnlit ? name : null;
    selected = name;
    if (!selected) { detail.innerHTML = '<p>Tap an object or its label, or search for it, to see its characteristics.</p>'; detailHTML = ''; }
    // the moons' view, open, turns to the system of the object chosen
    const o = moons && findObject(frame, name), system = o && (hasMoons(o) ? o.body : o.planet && planetOf(o.name));
    if (system && system !== moons.planet) showMoons(system);
    lastUI = -Infinity;
  };

  // Panels: one at a time; they keep the full-screen controls awake.
  const panels = { layers: $('.coelum-toolbar'), legend: $('.coelum-legend'), time: $('.coelum-timepanel'), place: $('.coelum-placepanel') };
  for (const p of extra) panels[p.key] = $(`[data-panel="${p.key}"]`);
  const panelOpen = () => Object.values(panels).some((panel) => !panel.hidden);
  const showPanel = (name) => {
    for (const [key, panel] of Object.entries(panels)) {
      const on = key === name && panel.hidden;
      panel.hidden = !on;
      $(`[data-action="${key}"]`)?.setAttribute('aria-expanded', String(on));
    }
    root.classList.toggle('coelum-show-options', panelOpen() && panels.legend.hidden);
    if (name === 'time' && !panels.time.hidden) showTime();
    if (name === 'place' && !panels.place.hidden) { placeInput.value = ''; showPlaces(''); }
    const more = extra.find((p) => p.key === name);
    if (more && !panels[name].hidden) more.render(panels[name].querySelector('.coelum-panel-body'), explorer);
    wake();
  };
  // A planet and its moons as in the moons() view (Mercury and Venus
  // alone), at the chart's time, over the whole view (in full screen, left
  // as it was on closing), with the planet's phase, size, magnitude and
  // distance; the ruler gives its scale. A fresh stage for each planet. A
  // moon tapped is found in the sky.
  let moons = null;
  const moonsLayer = $('.coelum-moonsview');
  const moonEventsList = moonEventsPanel($('.coelum-moon-events'), {
    formatTime,
    onClose: () => $('[data-action="moon-events"]').setAttribute('aria-expanded', 'false'),
    onSelect: (event) => { setTime(event.t); moons?.view.fit(); },
  });
  const positionMoonEvents = () => {
    const head = $('.coelum-moons-head');
    $('.coelum-moon-events').style.top = `${head.offsetTop + head.offsetHeight + 8}px`;
  };
  const sizeMoons = () => { if (moons) moons.view.size(Math.max(200, viewport.clientWidth), Math.max(200, viewport.clientHeight)); };
  const closeMoons = () => {
    if (!moons) return;
    moonEventsList.close();
    const restore = !moons.wasImmersive;
    moons = null; moonsLayer.hidden = true; root.classList.remove('coelum-moons-open');
    if (restore) fullscreen(false);
    draw();
  };
  const moonsData = () => {
    const o = frame.bodies.find((b) => b.body === moons.planet);
    if (!o) return;
    const lit = (1 + Math.cos(o.phase * R)) * 50, diameter = 2 * diskRadius(o) * 3600;
    $('.coelum-moons-data').textContent = `${lit.toFixed(0)} % lit · ${diameter.toFixed(1)}″ · mag ${o.mag.toFixed(1).replace('-', '−')} · ${(o.dist / 149597870.7).toFixed(2)} au`;
  };
  // Mars surface interaction belongs to the telescope view, not the sky.
  const marsSurface = () => {
    let features = [], labels = [], chosen = null, html = '';
    const card = $('.coelum-mars-detail');
    const clear = () => { chosen = null; card.hidden = true; moons?.view.redraw(); };
    return {
      clear,
      overlay({ sky, W, H, cx, cy, s, gpu }) {
        features = gpu && planetMap('mars')?.img ? projectMarsFeatures(sky, { x: W / 2 - cx * s, y: H / 2 + cy * s }, s, 0, W, H, chosen) : [];
        const selected = features.find((f) => f.key === chosen);
        if (!selected) { chosen = null; card.hidden = true; }
        else {
          const next = `<button type="button" class="coelum-btn coelum-btn-small coelum-panel-close" data-action="close-mars-feature" aria-label="Close feature details">${ICONS.close}</button>${marsFeatureDetails(selected)}`;
          if (next !== html) card.innerHTML = html = next;
          card.hidden = false;
        }
        let svg = '';
        if (selected?.outline) {
          let path = '', previous = null;
          for (const p of selected.outline) {
            if (p.visible) path += `${previous?.visible ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
            previous = p;
          }
          svg += `<path class="coelum-mars-outline" d="${path}"/>`;
        } else if (selected) svg += `<circle class="coelum-mars-outline" cx="${selected.x}" cy="${selected.y}" r="7"/>`;
        labels = placeLabels(features.filter((f) => f.label || f.key === chosen).sort((a, b) => Number(b.key === chosen)-Number(a.key === chosen) || Number(b.major)-Number(a.major) || b.size-a.size).slice(0, 28).map((f) => ({ ...f, size: 14, r: 2, priority: f.key === chosen ? -1 : f.major ? 1 : 2 })), {
          W, H, size: 14, symbols: [],
          draw: (f, x, y) => { svg += `<text class="coelum-mars-label" data-mars-feature="${f.key}" x="${x}" y="${y}">${esc(f.name)}</text>`; },
        });
        return svg;
      },
      pick(p) {
        const label = labels.find(({ box }) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3]);
        const feature = label ? features.find((f) => f.key === label.name) : pickMarsFeature(features, p.x, p.y);
        if (!feature) return false;
        chosen = feature.key; moons.view.redraw(); return true;
      },
      focus(feature) {
        const state = marsFeatureState(moons.view.sky, feature), span = Math.min(viewport.clientWidth, viewport.clientHeight);
        const radius = Math.max(MARS_MIN_RADIUS * 1.3, Math.min(span*0.15, 90)*3396.19/Math.max(1, feature.extent || 3396.19));
        if (state.visible && state.sunlit) {
          chosen = feature.key; moons.view.focus(state.v[0], state.v[1], radius);
        } else {
          moons.view.focus(0, 0, radius);
          say(!state.visible ? `${feature.name} is on the far side of Mars.` : `${feature.name} is not currently illuminated.`);
        }
      },
    };
  };
  const showMoons = (planet, feature = null) => {
    moonEventsList.close();
    const stage = $('.coelum-moons-stage');
    stage.innerHTML = '<canvas class="sky-canvas"></canvas><svg class="sky-svg sky-full" role="img"></svg>';
    const sky = moonSystem(planet, t), name = planet[0].toUpperCase() + planet.slice(1);
    $('.coelum-moons-tap').hidden = !sky.moons.length;
    $('[data-action="moon-events"]').hidden = !sky.moons.length;
    $('.coelum-mars-tap').hidden = planet !== 'mars';
    const surface = planet === 'mars' ? marsSurface() : null;
    $('.coelum-mars-detail').hidden = true;
    stage.querySelector('svg').setAttribute('aria-label', `${name} and its moons`);
    $('.coelum-moons-title').textContent = hasMoons({ body: planet }) ? `Moons of ${name}` : name;
    showPanel(null);
    const wasImmersive = moons ? moons.wasImmersive : immersive();
    if (!immersive()) fullscreen(true);
    moonsLayer.hidden = false; root.classList.add('coelum-moons-open');
    moons = { planet, t, wasImmersive, view: moonsView(stage, sky, { onTap: (m) => { closeMoons(); select(m.name); const o = findObject(frame, m.name); if (o) goTo(o); draw(); }, bar: false, onScale: showRuler, top: 64, onOverlay: surface?.overlay, onPoint: surface?.pick }), surface };
    sizeMoons(); moonsData();
    if (feature) surface?.focus(feature);
  };
  const followMoons = () => {
    if (!moons || moons.t === t) return;
    moonEventsList.close();
    moons.t = t;
    moons.view.set(moonSystem(moons.planet, t), playing);
    moonsData();
  };
  const syncLayers = () => {
    for (const box of root.querySelectorAll('[data-layer]')) box.checked = Boolean(layers[mode][box.dataset.layer]);
    $('[data-label-size]').value = String(layers[mode].labelSize);
    $('[data-horizon]').value = horizon;
    for (const o of $('[data-limit]').options) o.disabled = Number(o.value) > Math.max(6, Math.round(faintDepth()));
  };
  // Fainter stars: what is stored, and the buttons to change it.
  const faintNote = $('.coelum-faint-note');
  const showFaint = (text) => {
    const n = faintCount();
    faintNote.textContent = text || (n ? `${n.toLocaleString('en')} more stars stored on this device (${STAR_FILES[faintVariant]?.label || 'downloaded'}); they appear as you zoom in.` : 'Only stars to magnitude 6 are built in. Download more to see fainter ones when zoomed in; they stay on this device for offline use.');
    for (const b of root.querySelectorAll('[data-download]')) b.hidden = b.dataset.download === 'remove' ? !n : b.dataset.download === faintVariant;
    syncLayers();
  };
  // Satellites: the groups chosen, how many, how old their elements are;
  // a new catalog redraws the sky.
  const satelliteNote = $('.coelum-satellite-note');
  const showSatellites = () => {
    const st = satelliteStatus(), groups = chosenGroups();
    for (const box of root.querySelectorAll('[data-satellite-group]')) box.checked = groups.includes(box.dataset.satelliteGroup);
    const age = st.fetched && (Date.now() - st.fetched) / 3600e3;
    satelliteNote.textContent = st.busy ? 'Getting the elements from CelesTrak…'
      : !groups.length ? 'No satellites chosen.'
      : `${st.count} satellites${age !== null && age !== undefined ? `, from CelesTrak ${age < 1 ? 'under an hour' : age < 48 ? `${Math.round(age)} hours` : `${Math.round(age / 24)} days`} ago` : ''}; updated once a day when online, kept for offline use.${st.error ? ` ${st.error}.` : ''}`;
    $('[data-satellites="update"]').disabled = st.busy;
  };
  const stopSatellites = onSatellites((list) => {
    setSatellites(list); animator = null;
    if (root.isConnected) { showSatellites(); if (!playing) draw(true); }
  });

  // The local horizon: computed from terrain tiles when first chosen.
  const terrainNote = $('.coelum-terrain-note');
  const showTerrain = (text) => {
    terrainNote.hidden = horizon !== 'terrain' && !text;
    terrainNote.innerHTML = text || (terrain ? 'The terrain around this place, from elevation models out to 150 km (buildings and trees are not included).<span class="coelum-chips"><button type="button" class="coelum-chip" data-terrain="refresh">Compute again</button><button type="button" class="coelum-chip" data-terrain="forget">Forget</button></span>' : '');
  };
  let terrainJob = null;
  const chooseHorizon = async (value, refresh = false) => {
    if (value === 'terrain' && (!terrain || refresh)) {
      if (terrainJob) return;
      showTerrain('Downloading the terrain around this place…');
      terrainJob = computeHorizon(place, (f) => showTerrain(`Downloading the terrain around this place… ${Math.round(f * 100)}%`));
      try { setTerrain(await terrainJob); }
      catch (e) { terrainJob = null; if (!terrain) { horizon = horizon === 'terrain' ? 'landscape' : horizon; syncLayers(); } showTerrain(`${esc(e.message)}. The local horizon needs a connection the first time.`); return; }
      terrainJob = null;
    }
    horizon = value;
    try { localStorage.setItem('imks-coelum-horizon', value); } catch { /* private mode */ }
    applyHorizon(); syncLayers(); showTerrain(); draw();
  };
  // Date and time: a field on the device's clock, and the day's events of
  // the Sun (with twilights) and the Moon at the place.
  const timeInput = $('[data-time-input]'), events = $('.coelum-events');
  const pad = (n) => String(n).padStart(2, '0');
  const localInput = (time) => { const d = new Date(time * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const clock = (time) => new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const EVENTS = [
    ['Astronomical dawn', 'sun', true, -18], ['Nautical dawn', 'sun', true, -12], ['Civil dawn', 'sun', true, -6], ['Sunrise', 'sun', true, null],
    ['Sunset', 'sun', false, null], ['Civil dusk', 'sun', false, -6], ['Nautical dusk', 'sun', false, -12], ['Astronomical dusk', 'sun', false, -18],
    ['Moonrise', 'moon', true, null], ['Moonset', 'moon', false, null],
  ];
  let eventsDay = null;
  const showTime = () => {
    if (document.activeElement !== timeInput) timeInput.value = localInput(t);
    const offset = -new Date(t * 1000).getTimezoneOffset(), zone = `UTC${offset < 0 ? '−' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    $('.coelum-zone-note').textContent = `On this device's clock (${zone}).${options.standalone ? '' : " The status line shows the calculator's time format."}`;
    const d = new Date(t * 1000), start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000, key = `${start},${place.join(',')}`;
    if (key === eventsDay) return;
    eventsDay = key;
    const found = EVENTS.map(([label, body, rising, h0]) => {
      const e = riseSet(body, start, place, rising, h0);
      return e && e.t < start + 86400 ? { label, t: e.t } : { label, t: null };
    });
    events.innerHTML = found.filter((e) => e.t !== null).sort((a, b) => a.t - b.t).map((e) => `<button type="button" class="coelum-chip" data-time-event="${e.t}"><span>${esc(e.label)}</span> ${esc(clock(e.t))}</button>`).join('')
      + (found.some((e) => e.t === null) ? `<p class="coelum-panel-note">Not on this day: ${found.filter((e) => e.t === null).map((e) => esc(e.label.toLowerCase())).join(', ')}.</p>` : '');
  };
  const setTime = (time) => {
    t = limitTime(time);
    if (playing) pause(); else draw(true);
    if (!panels.time.hidden) showTime();
  };
  timeInput.addEventListener('change', () => { const ms = new Date(timeInput.value).getTime(); if (Number.isFinite(ms)) setTime(ms / 1000); });

  // The place: the calculator's cities and places found before, typed
  // coordinates, a search online (OpenStreetMap) or the device's position.
  const placeInput = $('.coelum-place-form input'), placeResults = $('.coelum-place-results'), placeStatus = $('.coelum-place-status');
  let placeMatches = [];
  const coordinates = (text) => {
    const m = /^\s*([+−-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+−-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(text);
    if (!m) return null;
    const lat = Number(m[1].replace('−', '-')) * (/s/i.test(m[2] || '') ? -1 : 1), lon = Number(m[3].replace('−', '-')) * (/w/i.test(m[4] || '') ? -1 : 1);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon, h: null, name: `${lat.toFixed(3)}°, ${lon.toFixed(3)}°` } : null;
  };
  const renderPlaces = () => {
    placeResults.innerHTML = placeMatches.map((p, i) => `<button type="button" class="coelum-place" data-place-index="${i}" role="listitem"><span>${esc(p.name)}</span><small>${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°${Number.isFinite(p.h) ? ` · ${Math.round(p.h)} m` : ''}</small></button>`).join('');
  };
  const showPlaces = (query) => {
    const typed = coordinates(query);
    placeMatches = typed ? [typed] : searchPlaces(query, options.places?.() || {});
    renderPlaces();
    placeStatus.textContent = query.trim() && !placeMatches.length ? 'No saved matches: search online.' : '';
  };
  const setPlace = async (p) => {
    let h = p.h;
    if (!Number.isFinite(h)) { placeStatus.textContent = 'Getting the elevation…'; try { h = await fetchElevation(p.lat, p.lon); } catch { h = 0; } }
    place = [p.lat, p.lon, h]; placeLabel = p.name.split(',').slice(0, 2).join(',');
    setTerrain(storedHorizon(place));
    if (horizon === 'terrain' && !terrain) horizon = 'landscape';
    applyHorizon(); syncLayers(); showTerrain();
    if (views.sky?.auto) views.sky = null;
    eventsDay = null; placeStatus.textContent = '';
    options.onPlace?.([...place], placeLabel);
    showPanel(null);
    if (playing) pause(); else draw(true);
  };
  placeInput.addEventListener('input', () => showPlaces(placeInput.value));
  $('.coelum-place-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const query = placeInput.value.trim();
    if (!query || coordinates(query)) return;
    placeStatus.textContent = 'Looking it up…';
    try {
      const [key, found] = await fetchPlace(query);
      options.rememberPlace?.(key, found);
      placeMatches = [found, ...placeMatches.filter((p) => p.name !== found.name)];
      renderPlaces();
      placeStatus.textContent = 'Tap a place to use it.';
    } catch (e) { placeStatus.textContent = e.message; }
  });
  const here = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('No location on this device')); return; }
    navigator.geolocation.getCurrentPosition((pos) => resolve(pos.coords), (e) => reject(new Error(e.message || 'Location not available')), { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });

  // Phone following belongs to the explorer, shared by both apps. Sensor
  // updates only change attitude; rendering stays on requestAnimationFrame.
  const toast = $('.coelum-toast');
  let toastTimer = 0;
  const say = (text, ms = 4000) => { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => { toast.hidden = true; }, ms); };
  try {
    const receipt = JSON.parse(sessionStorage.getItem(updateReceipt) || 'null');
    if (receipt) {
      sessionStorage.removeItem(updateReceipt);
      workerVersion(navigator.serviceWorker?.controller).then((version) => {
        if (version === receipt.latest) say(`Updated from ${receipt.current}. New version: ${version}.`, 10000);
      });
    }
  } catch { /* storage unavailable */ }
  let orient = null, orientationRequest = 0, phoneLevel = false;
  try { phoneLevel = localStorage.getItem('imks-phone-level') === 'true'; } catch { /* private mode */ }
  $('[data-orient-level]').checked = phoneLevel;
  const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;
  const syncOrientationUI = () => {
    const b = $('[data-action="orient-align"]');
    const disabled = !orient?.tracker.filtered || !selected, label = selected ? `Align with ${selected}` : 'Align with selected object';
    if (b.disabled !== disabled) b.disabled = disabled;
    if (b.textContent !== label) b.textContent = label;
    const status = orient?.tracker.filtered && performance.now()-orient.tracker.last > 2500 ? 'Waiting for sensor updates · holding the view' : orient?.tracker.quality;
    const note = $('[data-orient-quality]'), text = orient ? `${status}. Pan to align; pinch to zoom.` : 'Turn on following with the phone button. Pan to align the sky; pinch to zoom.';
    if (note.textContent !== text) note.textContent = text;
  };
  const phoneCamera = () => {
    let r = orient.tracker.rotation(screenAngle());
    if (phoneLevel) {
      // Fade levelling out near the zenith/nadir rather than choosing an
      // arbitrary azimuth there; the full attitude remains continuous.
      const side = zenithSide(r);
      r = levelChart(r, side);
    }
    return r;
  };
  const applyPhone = () => {
    if (!orient?.tracker.filtered) return;
    const r = phoneCamera(), m = mountCamera(r, mountMatrix()), d = r.slice(6);
    if (mode === 'sky') Object.assign(skyView(), lookOf(toMount(d)), { auto: false });
    else views.chart.rotation = m;
    interact(500); requestDraw();
  };
  const stopOrientation = (message) => {
    orientationRequest++;
    if (!orient) return;
    // Keep the last complete camera when following stops. Manual sky gestures
    // use az/alt again, so the sky view returns to its level mount.
    for (const [target,event,on] of orient.listeners) target.removeEventListener(event,on);
    clearInterval(orient.timer); orient = null;
    $('[data-action="orient"]').setAttribute('aria-pressed', 'false');
    syncOrientationUI();
    if (message) say(message);
    settle();
  };
  const startOrientation = async () => {
    const request = ++orientationRequest, E = window.DeviceOrientationEvent, M = window.DeviceMotionEvent;
    // Both permission requests must originate in the same user gesture on iOS.
    try {
      const orientationPermission = typeof E?.requestPermission === 'function' ? E.requestPermission() : Promise.resolve('granted');
      const motionPermission = typeof M?.requestPermission === 'function' ? M.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
      const [allowed] = await Promise.all([orientationPermission, motionPermission]);
      if (request !== orientationRequest || !root.isConnected) return;
      if (allowed !== 'granted') { say('Motion and orientation access was not allowed.'); return; }
    } catch { say('Motion and orientation access is not available.'); return; }
    stopFlight(); setLock(null);
    const state = { tracker: new PhoneOrientation(), listeners: [], started: performance.now() };
    const on = (event, fn, target = window) => { state.listeners.push([target,event,fn]); target.addEventListener(event,fn); };
    for (const event of ['deviceorientation', 'deviceorientationabsolute']) on(event, (ev) => {
      if (document.hidden || orient !== state) return;
      if (state.tracker.update(ev,performance.now(),event === 'deviceorientationabsolute')) applyPhone();
    });
    on('devicemotion', (ev) => { if (!document.hidden) state.tracker.motion(ev,performance.now()); });
    const screenChanged = () => { if (orient === state) applyPhone(); };
    on('orientationchange', screenChanged);
    if (screen.orientation?.addEventListener) on('change',screenChanged,screen.orientation);
    state.timer = setInterval(() => {
      if (orient !== state || document.hidden) return;
      const age = performance.now() - (state.tracker.filtered ? state.tracker.last : state.started);
      if (age > 2500 && !state.tracker.filtered) stopOrientation('No orientation data from this device.');
      else if (age > 2500) syncOrientationUI();
    }, 1000);
    orient = state;
    $('[data-action="orient"]').setAttribute('aria-pressed', 'true'); syncOrientationUI();
    say('The sky follows the phone. Pan to align; pinch to zoom.');
  };
  const alignPhone = () => {
    const o = selected && findObject(frame,selected);
    if (!orient || !o) return;
    const direction = mode === 'sky' && atmosphereOn() ? refractVector(pointVector(o),place[2] || 0) : pointVector(o);
    if (!orient.tracker.align(direction)) { say('Choose an object farther from the zenith, and point the phone at it.'); return; }
    applyPhone(); syncOrientationUI(); say(`Heading aligned with ${selected}.`);
  };

  // Another mount keeps the direction at the center; the chart then levels
  // its new up (the zenith or the pole).
  const mountButton = $('[data-action="mount"]');
  const showMount = () => {
    const eq = mount === 'equatorial';
    mountButton.textContent = eq ? 'EQ' : 'AZ'; mountButton.setAttribute('aria-pressed', String(eq));
    mountButton.title = eq ? 'Equatorial: RA and Dec fixed, the pole up (tap for alt-az)' : 'Alt-az: the horizon level (tap for equatorial)';
  };
  const setMount = (m) => {
    const F0 = mountMatrix(), chart = horizonCamera(views.chart.rotation, F0), sky = views.sky && fromMount(horizontalVector(views.sky.alt, views.sky.az), F0);
    mount = m;
    try { localStorage.setItem('imks-coelum-mount', m); } catch { /* private mode */ }
    const F1 = mountMatrix(), r = mountCamera(chart, F1);
    views.chart.rotation = levelChart(r, zenithSide(r) || 1);
    if (sky) Object.assign(views.sky, lookOf(toMount(sky, F1)));
    if (lock) lock.spot = null;
    stopFlight(); showMount(); draw();
    say(m === 'equatorial' ? 'Equatorial mount: the stars stay fixed, the celestial pole up.' : 'Alt-az mount: the horizon stays level, the zenith up.');
  };
  showMount();
  const setMode = (m) => {
    if (m === mode) return;
    // Keep the two views roughly in step: the same direction at the center
    // and the same scale there (unless the one left is at its default).
    const chart = views.chart, chartMoved = chart.scale !== 1 || chart.rotation.some((x, i) => Math.abs(x - SKY_IDENTITY[i]) > 1e-9);
    if (m === 'sky' && chartMoved) {
      const d = unprojectSky(0, 0, chart.rotation), v = skyView(), alt = Math.asin(Math.max(-1, Math.min(1, d[2]))) / R;
      Object.assign(v, { az: alt > 89.5 ? v.az : (Math.atan2(d[0], d[1]) / R + 360) % 360, alt, scale: Math.max(0.6, Math.min(SKY_MAX, chartRadius(size, height, chart.scale) * 4 / Math.PI / skyRadius(size, height, 1))), auto: false });
    } else if (m === 'chart' && views.sky && !views.sky.auto) {
      const v = views.sky;
      views.chart = { rotation: lookAt(v.az, v.alt), scale: Math.max(1, Math.min(chartMax(), skyRadius(size, height, v.scale) * Math.PI / 4 / chartRadius(size, height, 1))) };
    }
    mode = m; root.dataset.mode = m; animator = null;
    try { localStorage.setItem('imks-coelum-mode', m); } catch { /* private mode */ }
    for (const b of root.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === m));
    if (m === 'sky' && !panels.legend.hidden) showPanel(null);
    stopFlight();
    syncLayers(); draw();
  };
  const immersive = () => root.classList.contains('coelum-immersive');
  const fullscreen = (on, focus = true) => {
    root.classList.toggle('coelum-immersive', on);
    const button = $('[data-action="fullscreen"]');
    if (button) {
      button.innerHTML = on ? ICONS.shrink : ICONS.expand;
      button.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); button.title = on ? 'Exit full screen' : 'Full screen';
      button.setAttribute('aria-pressed', String(on));
    }
    if (focus) svg.focus({ preventScroll: true });
    wake();
  };

  // Full-screen controls fade after a few quiet seconds, as in planetarium
  // programs; any movement, touch or key brings them back.
  let idleTimer = 0, hudHover = false;
  const wake = () => {
    root.classList.remove('coelum-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const busy = hudHover || panelOpen() || document.activeElement === input || !results.hidden;
      if (immersive() && !busy && root.isConnected) root.classList.add('coelum-idle');
    }, 3500);
  };
  // Capture before wake() or the sky's pointer handler clears the idle flag.
  const wakePointers = new Set();
  root.addEventListener('pointerdown', (ev) => {
    if (ev.isPrimary) wakePointers.clear();
    if (root.classList.contains('coelum-idle') || wakePointers.size) {
      wakePointers.add(ev.pointerId); lastTap = null;
      wake(); ev.preventDefault(); ev.stopPropagation();
    }
  }, { capture: true });
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) root.addEventListener(type, (ev) => {
    if (!wakePointers.has(ev.pointerId)) return;
    if (type !== 'pointermove') wakePointers.delete(ev.pointerId);
    wake(); ev.preventDefault(); ev.stopPropagation();
  }, { capture: true });
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin']) root.addEventListener(ev, (event) => {
    // Touch devices can send a hover-like move immediately before down.
    if (event.type === 'pointermove' && event.pointerType === 'touch' && !event.buttons) return;
    wake();
  }, { passive: true });
  for (const hud of root.querySelectorAll('.coelum-hud')) {
    hud.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') hudHover = true; });
    hud.addEventListener('pointerleave', () => { hudHover = false; wake(); });
  }

  // Search: matches as you type; Enter or a tap flies to the object.
  let matches = [], active = -1;
  const showResults = () => {
    results.hidden = searchDropdown.hidden = !matches.length;
    searchHint.hidden = true;
    input.setAttribute('aria-expanded', String(!results.hidden));
    results.innerHTML = matches.map((m, i) => {
      const type = TYPE_ORDER[m.type] || m.type, statuses = searchStatus(m);
      const label = [m.name, m.alias, type, m.availability, m.alt < 0 && 'below horizon'].filter(Boolean).join(' · ');
      const symbols = statuses.map(([key, text]) => `<span class="coelum-search-symbol" title="${esc(text)}" data-search-hint="${esc(text)}">${SEARCH_ICONS[key]}</span>`).join('');
      return `<li role="option" id="${id}-r${i}" data-index="${i}" aria-label="${esc(label)}" aria-selected="${i === active}"><span class="coelum-result-dot coelum-type-${m.key?.startsWith('mars:') ? 'mars-feature' : esc(m.type.split(' ').at(-1))}" aria-hidden="true"></span><span class="coelum-result-name">${esc(m.name)}${m.alias ? ` <small>${esc(m.alias)}</small>` : ''}</span><span class="coelum-result-meta" aria-hidden="true">${m.key ? '' : `<span class="coelum-result-type" title="${esc(type)}">${esc(type)}</span>`}${symbols}</span></li>`;
    }).join('');
    const used = new Set(matches.flatMap((m) => searchStatus(m).map(([symbol]) => symbol)));
    const farSide = matches.some((m) => m.availability === 'far side'), limb = matches.some((m) => m.availability === 'beyond limb');
    const key = [['moon', 'Moon'], ['mars', 'Mars'], ['unlit', 'Unlit'],
      ['far', farSide && limb ? 'Far side / beyond limb' : limb ? 'Beyond limb' : 'Far side'], ['below', 'Below horizon']]
      .filter(([symbol]) => used.has(symbol));
    searchKey.hidden = !key.length;
    searchKey.innerHTML = key.map(([symbol, text]) => `<span>${SEARCH_ICONS[symbol]}${text}</span>`).join('');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-r${active}`); else input.removeAttribute('aria-activedescendant');
  };
  let searchChoice = 0;
  const choose = async (i) => {
    const m = matches[i];
    if (!m) return;
    const ticket = ++searchChoice, feature = m.key && (findLunarFeature(m.key) || findMarsFeature(m.key));
    input.value = m.name; matches = []; active = -1; showResults();
    input.blur(); pause(); setLock(null);
    if (moons) closeMoons();
    if (feature?.key.startsWith('mars:')) {
      await planetMap('mars')?.ready;
      if (ticket !== searchChoice || !root.isConnected) return;
      select('Mars');
      showMoons('mars', feature);
    } else if (feature) {
      if (mode !== 'sky') setMode('sky');
      select(null);
      await planetMap('moon')?.ready;
      if (ticket !== searchChoice || !root.isConnected) return;
      const target = lunarFeatureTarget(frame, feature), state = target.lunarState, available = state.visible && state.sunlit;
      goTo(available ? target : findObject(frame, 'Moon'), { fit: true, onArrival: () => {
        select(state.visible ? feature.key : 'Moon', { allowUnlit: state.visible && !state.sunlit });
        if (!state.visible) say(`${feature.name} is currently beyond the Moon's visible limb.`);
        else if (!state.sunlit) say(`${feature.name} is not currently illuminated.`);
      } });
    } else {
      const o = findObject(frame, m.name);
      if (o) { select(o.name); goTo(o, { fit: true }); }
    }
  };
  input.addEventListener('input', () => { matches = searchSky(frame, input.value); active = matches.length ? 0 : -1; showResults(); });
  input.addEventListener('focus', () => { if (input.value) { matches = searchSky(frame, input.value); active = matches.length ? 0 : -1; showResults(); } });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) { matches = []; showResults(); } }, 150));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (matches.length) { active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; showResults(); }
    } else if (ev.key === 'Enter') { ev.preventDefault(); choose(Math.max(0, active)); }
    else if (ev.key === 'Escape' && (input.value || matches.length)) { ev.preventDefault(); ev.stopPropagation(); input.value = ''; matches = []; showResults(); }
  });
  results.addEventListener('pointerdown', (ev) => ev.preventDefault());
  const searchSymbolHint = (symbol) => {
    searchHint.textContent = symbol.dataset.searchHint; searchHint.hidden = false;
  };
  results.addEventListener('pointerover', (ev) => {
    const symbol = ev.target.closest('[data-search-hint]');
    if (symbol) searchSymbolHint(symbol);
  });
  results.addEventListener('click', (ev) => {
    const symbol = ev.target.closest('[data-search-hint]');
    if (symbol) { searchSymbolHint(symbol); return; }
    const li = ev.target.closest('[data-index]'); if (li) choose(Number(li.dataset.index));
  });

  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (moonEventsList.isOpen) { ev.preventDefault(); ev.stopPropagation(); moonEventsList.close(); $('[data-action="moon-events"]').focus(); }
    else if (moons) { ev.preventDefault(); ev.stopPropagation(); closeMoons(); }
    else if (panelOpen()) { ev.preventDefault(); ev.stopPropagation(); showPanel(null); }
    else if (immersive() && !options.standalone) { ev.preventDefault(); ev.stopPropagation(); fullscreen(false); }
  });
  root.addEventListener('change', (ev) => {
    const L = layers[mode];
    if (ev.target.matches('[data-orient-level]')) { phoneLevel = ev.target.checked; try { localStorage.setItem('imks-phone-level', String(phoneLevel)); } catch { /* private mode */ } if (orient) applyPhone(); }
    if (ev.target.dataset.layer) L[ev.target.dataset.layer] = ev.target.checked;
    if (ev.target.matches('[data-limit]')) layers.chart.magnitude = Number(ev.target.value);
    if (ev.target.matches('[data-label-size]')) layers.chart.labelSize = layers.sky.labelSize = Number(ev.target.value);
    if (ev.target.matches('[data-horizon]')) { chooseHorizon(ev.target.value); return; }
    if (ev.target.matches('[data-satellite-group]')) { chooseGroups([...root.querySelectorAll('[data-satellite-group]:checked')].map((b) => b.dataset.satelliteGroup)); return; }
    draw();
  });
  const resetButton = $('[data-action="reset"]');
  let resetTimer = 0, resetPointer = null, resetStart = null, resetHeld = false, updating = false;
  const cancelResetHold = () => { clearTimeout(resetTimer); resetTimer = 0; resetPointer = null; };
  resetButton.addEventListener('pointerdown', (ev) => {
    if (!ev.isPrimary || ev.button !== 0) return;
    cancelResetHold(); resetHeld = false; resetPointer = ev.pointerId;
    resetStart = { x: ev.clientX, y: ev.clientY };
    resetTimer = setTimeout(async () => {
      resetHeld = true; cancelResetHold();
      if (updating || !root.isConnected) return;
      updating = true; say('Checking for app updates…', 0);
      try { await (options.updateApp || forceAppUpdate)(undefined, (message) => say(message, /Checking|Downloading/.test(message) ? 0 : 10000)); }
      catch (error) { say(error.message || 'Cannot update the app. Try again when online.'); }
      finally { updating = false; }
    }, 800);
  });
  resetButton.addEventListener('pointermove', (ev) => {
    if (ev.pointerId === resetPointer && Math.hypot(ev.clientX - resetStart.x, ev.clientY - resetStart.y) > 10) cancelResetHold();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) resetButton.addEventListener(type, cancelResetHold);
  resetButton.addEventListener('contextmenu', (ev) => { ev.preventDefault(); });
  root.addEventListener('click', async (ev) => {
    const download = ev.target.closest('[data-download]')?.dataset.download;
    if (download) {
      for (const b of root.querySelectorAll('[data-download]')) b.disabled = true;
      try {
        if (download === 'remove') await removeFaintStars();
        else await downloadFaintStars(download, (f) => showFaint(`Downloading ${STAR_FILES[download].label}… ${Math.round(f * 100)}%`));
        showFaint();
      } catch (e) { showFaint(`${e.message}. Try again when online.`); }
      for (const b of root.querySelectorAll('[data-download]')) b.disabled = false;
      animator = null; draw(true);
      return;
    }
    const timeEvent = ev.target.closest('[data-time-event]')?.dataset.timeEvent;
    if (timeEvent) { setTime(Number(timeEvent)); return; }
    const timeStep = ev.target.closest('[data-time-step]')?.dataset.timeStep;
    if (timeStep) { setTime(t + Number(timeStep)); return; }
    const timeChoice = ev.target.closest('[data-set-time]')?.dataset.setTime;
    if (timeChoice) { setTime(timeChoice === 'now' ? Date.now() / 1000 : model.t); return; }
    const placeIndex = ev.target.closest('[data-place-index]')?.dataset.placeIndex;
    if (placeIndex !== undefined) { setPlace(placeMatches[Number(placeIndex)]); return; }
    const placeChoice = ev.target.closest('[data-place]')?.dataset.place;
    if (placeChoice === 'original') { setPlace({ lat: model.place[0], lon: model.place[1], h: model.place[2] || 0, name: model.label }); return; }
    if (placeChoice === 'here') {
      placeStatus.textContent = 'Finding your position…';
      try {
        const c = await here();
        await setPlace({ lat: c.latitude, lon: c.longitude, h: null, name: `${c.latitude.toFixed(3)}°, ${c.longitude.toFixed(3)}°` });
      } catch (e) { placeStatus.textContent = e.message; }
      return;
    }
    if (ev.target.closest('[data-satellites="update"]')) { loadSatellites({ force: true }); showSatellites(); return; }
    const terrainAction = ev.target.closest('[data-terrain]')?.dataset.terrain;
    if (terrainAction === 'refresh') { chooseHorizon('terrain', true); return; }
    if (terrainAction === 'forget') { forgetHorizon(place); setTerrain(null); chooseHorizon('landscape'); return; }
    const viewButton = ev.target.closest('[data-view]');
    if (viewButton) { setMode(viewButton.dataset.view); return; }
    const button = ev.target.closest('[data-action]'), action = button?.dataset.action;
    if (!action) return;
    if (action === 'reset' && resetHeld) { resetHeld = false; ev.preventDefault(); return; }
    if (action === 'fullscreen') fullscreen(!immersive());
    else if (action === 'layers' || action === 'legend' || action === 'time' || action === 'place' || action in panels) showPanel(action);
    else if (action === 'moons') showMoons(button.dataset.planet);
    else if (action === 'moon-events' && moons) {
      if (moonEventsList.isOpen) moonEventsList.close();
      else { if (playing) pause(); moonEventsList.open(moons.planet, t); positionMoonEvents(); button.setAttribute('aria-expanded', 'true'); }
    }
    else if (action === 'close-moons') closeMoons();
    else if (action === 'close-mars-feature') moons?.surface?.clear();
    else if (action === 'lock') {
      if (lock) setLock(null);
      else if (selected && findObject(frame, selected)) { stopOrientation(); setLock(selected); say(`${selected} stays in place on the screen.`); }
      else say('Select an object to lock it in place.');
      draw();
    } else if (action === 'mount') setMount(mount === 'equatorial' ? 'altaz' : 'equatorial');
    else if (action === 'orient-align') alignPhone();
    else if (action === 'orient') { if (orient) stopOrientation(); else startOrientation(); }
    else if (action === 'close-panel') showPanel(null);
    else if (action === 'deselect') { select(null); draw(); }
    else if (action === 'in' || action === 'out') zoom(action === 'in' ? 1.5 : 1 / 1.5);
    else if (action === 'slower' || action === 'faster') setSpeed(stepPlaybackSpeed(speed, action === 'faster'));
    else if (action === 'reverse') setSpeed(-speed);
    else if (action === 'play') {
      if (playing) pause();
      else { playing = true; last = performance.now(); lastUI = -Infinity; setPlay(true); draw(); animation = requestAnimationFrame(tick); }
    } else {
      if (action === 'reset') {
        stopOrientation(); setLock(null); closeMoons();
        if (place.some((x, i) => x !== (model.place[i] ?? 0))) await setPlace({ lat: model.place[0], lon: model.place[1], h: model.place[2] || 0, name: model.label });
        t = model.t; setSpeed(60); pause(); fit();
      }
      else t = limitTime(t + (action === 'back' ? -3600 : 3600));
      draw(true);
    }
  });
  // Wheels and trackpads: a pinch arrives as a wheel with Ctrl (smaller
  // steps), or in Safari as gesture events. A pinch over the controls
  // zooms the sky too, not the page; over a panel, nothing.
  svg.addEventListener('wheel', (ev) => { ev.preventDefault(); interact(200); zoom(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.002)), true); }, { passive: false });
  const overPanel = (ev) => ev.target.closest('.coelum-panel');
  for (const el of [viewport, $('.coelum-topbar'), $('.coelum-timebar')]) {
    el.addEventListener('gesturestart', (ev) => { ev.preventDefault(); pinchScale = pointers.size || overPanel(ev) ? 0 : currentView().scale; });
    el.addEventListener('gesturechange', (ev) => { ev.preventDefault(); if (!pinchScale || pointers.size) return; interact(200); zoom(pinchScale * ev.scale / currentView().scale, true); });
    el.addEventListener('gestureend', (ev) => { ev.preventDefault(); pinchScale = 0; });
    el.addEventListener('touchmove', (ev) => { if (ev.touches.length > 1) ev.preventDefault(); }, { passive: false });
  }
  svg.addEventListener('dblclick', fit);

  // Gestures: the grabbed point of the sky follows the finger, with the
  // horizon level (the chart may tilt over the zenith); two fingers zoom
  // about their middle.
  const pointers = new Map();
  let gesture = null, lastTap = null, pinchScale = 0;
  const point = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const centroid = () => {
    const p = [...pointers.values()];
    return { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length, distance: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0 };
  };
  const baseline = () => {
    if (!pointers.size) return null;
    const v = currentView();
    return { ...centroid(), scale: v.scale, rotation: v.rotation && [...v.rotation], side: v.rotation ? zenithSide(v.rotation) : 0, az: v.az, alt: v.alt, moved: pointers.size > 1 };
  };
  // A new first touch means any finger still listed has left without a
  // pointerup (a system gesture, the app sent to the background): forget
  // it, or one-finger drags would zoom and taps would never select.
  const forgetPointers = () => { pointers.clear(); gesture = null; pinchScale = 0; settle(); };
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.isPrimary && pointers.size) pointers.clear();
    cancelAnimationFrame(flight); flight = 0; pointers.set(ev.pointerId, point(ev));
    try { svg.setPointerCapture(ev.pointerId); } catch { /* already gone */ }
    gesture = baseline();
  });
  document.addEventListener('visibilitychange', () => { if (!root.isConnected) return; if (document.hidden) forgetPointers(); else if (!playing) draw(); });
  // Pages would scroll under a finger on an empty part of the SVG (WebKit).
  svg.addEventListener('touchmove', (ev) => ev.preventDefault(), { passive: false });
  svg.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId) || !gesture) return;
    pointers.set(ev.pointerId, point(ev));
    const { x, y, distance } = centroid();
    if (Math.hypot(x - gesture.x, y - gesture.y) > 4 || distance) gesture.moved = true;
    if (!gesture.moved) return;
    lastTap = null;
    const [lo, hi] = scaleLimits(), scale = Math.max(lo, Math.min(hi, gesture.scale * (gesture.distance ? distance / gesture.distance : 1)));
    // The sky point grabbed at the start stays under the finger(s); while
    // following, drags calibrate the attitude and two fingers zoom.
    interact();
    if (orient?.tracker.filtered) {
      currentView().scale = scale;
      if (pointers.size < 2) {
        const radius = mode === 'sky' ? skyRadius(size,height,gesture.scale) : chartRadius(size,height,gesture.scale);
        const from = unprojectSky((gesture.x-size/2)/radius,(gesture.y-height/2)/radius,SKY_IDENTITY,mode === 'sky');
        const to = unprojectSky((x-size/2)/radius,(y-height/2)/radius,SKY_IDENTITY,mode === 'sky');
        const current = phoneCamera(), target = rotateSky(current,from,to);
        orient.tracker.calibrate(current,target);
        // Rebase after each move so sensor motion between pointer events is
        // preserved and repeated drags do not compound an old calibration.
        applyPhone();
        gesture = { ...baseline(), moved: true };
      } else requestDraw();
      return;
    }
    // Locked, the view follows the object: one finger moves the object's
    // place on the screen (and the sky with it), which it keeps as time
    // runs; two fingers only zoom, leaving it where it is.
    if (lock) {
      const v = currentView(), prev = gesture.lockPrev || gesture;
      if (distance) { zoomLock(v.scale, scale); v.scale = scale; v.auto = false; }
      else if (lock.spot?.mode === mode) {
        const dx = x - prev.x, dy = y - prev.y;
        if (mode === 'sky') { const r = skyRadius(size, height, v.scale); lock.spot.x += dx / r; lock.spot.y += dy / r; }
        else {
          const r = chartRadius(size, height, v.scale), p = projectVector(lock.spot.c, SKY_IDENTITY), u = p.x + dx / r, w = p.y + dy / r, k = Math.min(1, 1.6 / Math.hypot(u, w));
          lock.spot.c = unprojectSky(u * k, w * k);
        }
      }
      gesture.lockPrev = { x, y };
      requestDraw();
      return;
    }
    if (mode === 'sky') {
      const v = skyView(), r0 = skyRadius(size, height, gesture.scale), r1 = skyRadius(size, height, scale);
      gesture.grab ||= unprojectSky((gesture.x - size / 2) / r0, (gesture.y - height / 2) / r0, lookAt(gesture.az, gesture.alt), true);
      const look = solveLook(gesture.grab, (x - size / 2) / r1, (y - height / 2) / r1, v.az, v.alt);
      v.scale = scale; v.auto = false;
      if (Number.isFinite(look.az) && Number.isFinite(look.alt)) Object.assign(v, look);
    } else {
      // In small steps from the last position, each within 144° of the
      // center: a point dragged toward the projection's edge (its antipode)
      // would otherwise ask for a half turn about an undefined axis.
      const prev = gesture.prev || gesture, r0 = chartRadius(size, height, prev.scale), r1 = chartRadius(size, height, scale);
      const within = (u, v) => { const k = Math.min(1, 1.6 / Math.hypot(u, v)); return unprojectSky(u * k, v * k); };
      const from = within((prev.x - size / 2) / r0, (prev.y - height / 2) / r0), to = within((x - size / 2) / r1, (y - height / 2) / r1);
      const r = rotateSky(views.chart.rotation, from, to);
      gesture.side ||= zenithSide(r);
      const rotation = levelChart(r, gesture.side, to);
      views.chart.scale = scale;
      if (rotation.every(Number.isFinite)) views.chart.rotation = rotation;
      gesture.prev = { x, y, scale };
    }
    requestDraw();
  });
  const up = (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    const moved = gesture?.moved, p = point(ev);
    pointers.delete(ev.pointerId);
    if (ev.type === 'pointerup' && !moved && !pointers.size) {
      if (lastTap && performance.now() - lastTap.time < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 18) { fit(); lastTap = null; }
      else {
        // Choose the nearest rendered symbol, using the same projection.
        const nearby = drawn.objects.map((o) => ({ o, d: Math.hypot(o.x - p.x, o.y - p.y) })).filter(({ o, d }) => d < Math.max(14, o.radius + 4)).sort((a, b) => a.d - b.d);
        const label = drawn.hitLabels.find(({ box }) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3]);
        // A symbol right under the finger wins over a label lying on it.
        const direct = nearby[0] && nearby[0].d <= nearby[0].o.radius + 2 ? nearby[0].o.name : null;
        const lunarDisk = drawn.objects.find((o) => o.body === 'moon');
        const onMoon = lunarDisk && Math.hypot(p.x - lunarDisk.x, p.y - lunarDisk.y) <= lunarDisk.radius;
        const feature = label?.name.startsWith('lunar:') ? label.name : onMoon && pickLunarFeature(drawn.lunarFeatures, p.x, p.y)?.key;
        select(feature || direct || label?.name || nearby[0]?.o.name || null);
        lastTap = { time: performance.now(), x: p.x, y: p.y };
        draw();
      }
    }
    gesture = baseline();
    if (gesture) gesture.moved = true;
    else settle();
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('lostpointercapture', up);
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === '+' || ev.key === '=') zoom(1.5);
    else if (ev.key === '-') zoom(1 / 1.5);
    else if (ev.key === 'Home') fit();
    else if (ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      const dx = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0, dy = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
      if (orient?.tracker.filtered) {
        const r = phoneCamera(), amount = .08 / currentView().scale;
        orient.tracker.calibrate(r,rotateSky(r,[0,0,1],unprojectSky(-dx*amount,-dy*amount)));
        applyPhone(); return;
      }
      if (mode === 'sky') {
        const v = skyView(), step = 5 / v.scale;
        v.auto = false;
        v.az = ((v.az + dx * step / Math.max(0.25, Math.cos(v.alt * R))) % 360 + 360) % 360;
        v.alt = Math.max(-90, Math.min(90, v.alt - dy * step));
      } else {
        const v = views.chart, amount = 0.12 / v.scale, r = rotateSky(v.rotation, [0, 0, 1], unprojectSky(-dx * amount, -dy * amount));
        v.rotation = levelChart(r, zenithSide(v.rotation) || zenithSide(r));
      }
      if (lock) lock.spot = null;
      draw();
    }
  });
  syncLayers();
  showFaint(); showTerrain(); showSatellites();
  loadSatellites();
  if (options.standalone) { root.classList.add('coelum-standalone'); fullscreen(true, false); }
  draw();
  loadFaintStars().then(() => { if (root.isConnected) { showFaint(); if (faintCount() && !playing) draw(true); } });
  moonTexture.then(() => { if (root.isConnected && mode === 'sky' && !playing) draw(); });
  const resize = new ResizeObserver(() => {
    root.style.setProperty('--coelum-controls-height', `${Math.ceil($('.coelum-timebar').getBoundingClientRect().height) + 16}px`);
    const box = svg.getBoundingClientRect(), width = Math.round(box.width), high = Math.round(box.height);
    sizeMoons();
    if (moonEventsList.isOpen) positionMoonEvents();
    if (width > 0 && high > 0 && (width !== size || high !== height)) {
      // A fresh realistic view keeps its horizon low in the new shape.
      if (views.sky?.auto) views.sky = null;
      size = width; height = high; draw();
    }
  });
  resize.observe(svg);
  resize.observe($('.coelum-timebar'));
  const lifetime = new MutationObserver(() => {
    if (!root.isConnected) { moonEventsList.close(); stopSatellites(); stopOrientation(); cancelAnimationFrame(animation); cancelAnimationFrame(flight); cancelAnimationFrame(pending); clearTimeout(idleTimer); cancelResetHold(); resize.disconnect(); lifetime.disconnect(); }
  });
  lifetime.observe(root.closest('.sheet') || document.body, { childList: true, subtree: true });
  const explorer = {
    // Center an object on opening (an eclipse's Sun, an occultation's Moon).
    focus(name, options) { const o = findObject(frame, name); if (o) { select(o.name); goTo(o, options); } return Boolean(o); },
    // Frame a conjunction around the spherical midpoint, with room for
    // both disks and their labels, independently of the previous zoom.
    focusPair(first, second) {
      const objects = [first, second].map((name) => findObject(frame, name));
      if (objects.some((o) => !o)) return false;
      const apparent = mode === 'sky' && atmosphereOn();
      const vectors = objects.map((o) => apparent ? refractVector(pointVector(o), place[2] || 0) : pointVector(o));
      const vector = unit3(vectors[0].map((x, i) => x + vectors[1][i]));
      const separation = Math.acos(Math.max(-1, Math.min(1, dot3(...vectors)))) / R;
      const field = Math.max(1, separation * 1.6 + Math.max(...objects.map((o) => diskRadius(o) || 0)) * 4);
      setLock(null);
      select(null);
      goTo({ vector }, { fit: true, field, apparent });
      return true;
    },
    // the time and the place shown, and to change them (the app's panels)
    get orientationDiagnostics() { return orient?.tracker.diagnostics(performance.now()) || null; },
    get time() { return t; },
    get place() { return [...place]; },
    get placeLabel() { return placeLabel; },
    setTime,
    setPlace: (p) => setPlace(p),
    setSpeed: (v) => setSpeed(v),
    select: (name) => { select(name); draw(); },
    closePanel: () => showPanel(null),
    snapshot() {
      // Export the current frame as SVG even while the canvas is moving;
      // the realistic view is a picture of its canvas.
      if (mode === 'sky') svg.innerHTML = `<image href="${canvas.toDataURL('image/png')}" width="${size}" height="${height}"/>`;
      else svg.innerHTML = skyChart(frame, size, height, layers.chart, { ...views.chart, rotation: horizonCamera(views.chart.rotation), selected }).svg;
      updateUI(true);
      return svg;
    },
  };
  return explorer;
}
