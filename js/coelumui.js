// The coelum explorer: two views of the same sky (a map-like chart and a
// realistic sky), search, layers, legend, time controls and a full-screen
// mode whose controls fade away while the sky is left alone.
import { skyFrame, createSkyAnimator, skyChart, unprojectSky, rotateSky, chartRadius, objectDetails, chartLegend, searchSky, findObject, limitTime, pointVector, unit3, dot3, esc, R, SKY_IDENTITY, DEFAULT_LAYERS, lookAt, projectVector, refractVector, refraction, setFaintStars, faintCount } from './coelum.js';
import { skyScene, SKY_LAYERS, defaultSkyView, skyRadius, moonTexture } from './coelumsky.js';
import { storedHorizon, computeHorizon, forgetHorizon, horizonAt } from './skyhorizon.js';
import { CHART_STARS } from './skydata.js';

// Optional fainter stars: d3-celestial's Hipparcos files, downloaded when
// asked, kept compact in a cache that app updates leave alone.
const STAR_FILES = {
  8: { url: 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.8.json', label: 'to magnitude 8', size: '5 MB' },
  all: { url: 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.14.json', label: 'all Hipparcos stars', size: '15 MB' },
};
const STAR_CACHE = 'imks-data-stars', STAR_KEY = new URL('coelum-faint-stars.bin', location.href).href;
let faintVariant = null, faintLoading = null;
function loadFaintStars() {
  if (!faintLoading) faintLoading = (async () => {
    try {
      const res = await (await caches.open(STAR_CACHE)).match(STAR_KEY);
      if (!res) return;
      faintVariant = res.headers.get('x-variant');
      setFaintStars(new Float32Array(await res.arrayBuffer()));
    } catch { /* no Cache Storage (private mode): nothing stored */ }
  })();
  return faintLoading;
}
async function downloadFaintStars(variant, progress) {
  const res = await fetch(STAR_FILES[variant].url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0, reader = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (total) progress(got / total);
  }
  const json = JSON.parse(await new Blob(parts).text()), known = new Set(CHART_STARS.map((s) => s[0]));
  const stars = json.features.filter((f) => !known.has(f.id) && Number.isFinite(f.properties.mag)).sort((a, b) => a.properties.mag - b.properties.mag);
  const data = new Float32Array(stars.length * 5);
  stars.forEach((f, i) => data.set([((f.geometry.coordinates[0] % 360) + 360) % 360, f.geometry.coordinates[1], f.properties.mag, Number(f.properties.bv) || 0.6, f.id], i * 5));
  try { await (await caches.open(STAR_CACHE)).put(STAR_KEY, new Response(data.buffer, { headers: { 'x-variant': variant } })); } catch { /* kept for this session */ }
  faintVariant = variant;
  setFaintStars(data);
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

const icon = (d, extra = '') => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
const ICONS = {
  search: icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>'),
  chart: icon('<circle cx="12" cy="12" r="9"/><path d="M7 15l4-6 3 4 3-5"/><circle cx="7" cy="15" r=".6" fill="currentColor"/><circle cx="11" cy="9" r=".6" fill="currentColor"/><circle cx="14" cy="13" r=".6" fill="currentColor"/><circle cx="17" cy="8" r=".6" fill="currentColor"/>'),
  sky: icon('<path d="M2 19l5.5-6.5 3.5 4 3-3 8 5.5"/><path d="M2 19h20"/><path d="M16.5 4.5a3.2 3.2 0 1 0 3 4.6 2.6 2.6 0 0 1-3-4.6z"/><path d="M7 5.5v2M6 6.5h2"/>'),
  expand: icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  shrink: icon('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  fit: icon('<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  layers: icon('<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12.5 9.5 5 9.5-5"/><path d="m2.5 16.5 9.5 5 9.5-5"/>'),
  legend: icon('<circle cx="5" cy="6" r="1.6"/><path d="M10 6h10"/><path d="M3.4 12h3.2"/><path d="M10 12h10"/><rect x="3.4" y="16.4" width="3.2" height="3.2"/><path d="M10 18h10"/>'),
  play: icon('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  pause: icon('<path d="M8 5v14M16 5v14" stroke-width="3.2"/>'),
  back: icon('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 3.5V8h4.5"/><path d="M12 8v4l2.5 2"/>'),
  forward: icon('<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M21 3.5V8h-4.5"/><path d="M12 8v4l2.5 2"/>'),
  reverse: icon('<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>'),
  reset: icon('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'),
  close: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
};
const LAYERS = [
  ['ground', 'Ground', 'chart sky'], ['atmosphere', 'Atmosphere', 'sky'], ['milkyway', 'Milky Way', 'chart sky'],
  ['constellations', 'Constellations', 'chart sky'], ['boundaries', 'Boundaries', 'chart sky'], ['ecliptic', 'Ecliptic', 'chart sky'],
  ['horizontal', 'Alt / Az grid', 'chart sky'], ['equatorial', 'RA / Dec grid', 'chart sky'], ['deep', 'Deep sky', 'chart sky'], ['labels', 'Labels', 'chart sky'],
];
const MODES = { chart: 'Chart', sky: 'Sky' };
const TYPE_ORDER = { star: 'Star', planet: 'Planet', moon: 'Moon', constellation: 'Constellation' };
let explorers = 0;

// Kept separate from calculator state: exploring never changes the saved
// calculation. Timers end automatically when the sheet's root is removed.
export function mountCoelum(root, model, formatTime) {
  const id = `coelum-${++explorers}`;
  let mode = 'chart';
  try { if (localStorage.getItem('imks-coelum-mode') === 'sky') mode = 'sky'; } catch { /* private mode */ }
  root.dataset.mode = mode;
  root.innerHTML = `<div class="coelum-topbar coelum-hud">
      <div class="coelum-search">${ICONS.search}<input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="Search" aria-label="Search stars, planets and deep-sky objects" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-results"><ul class="coelum-results" id="${id}-results" role="listbox" aria-label="Matches" hidden></ul></div>
      <div class="coelum-seg" role="group" aria-label="View">${Object.entries(MODES).map(([m, label]) => `<button type="button" data-view="${m}" aria-pressed="${m === mode}" title="${m === 'chart' ? 'Map-like star chart' : 'Realistic sky'}">${ICONS[m]}<span>${label}</span></button>`).join('')}</div>
      <button type="button" class="coelum-btn" data-action="fullscreen" aria-pressed="false" aria-label="Full screen" title="Full screen">${ICONS.expand}</button>
    </div>
    <div class="coelum-viewport">
      <canvas class="coelum-back" aria-hidden="true"></canvas><svg class="coelum-full" viewBox="0 0 600 600" role="img" tabindex="0" aria-label="Interactive sky; drag to look around, pinch or scroll to zoom"></svg><canvas class="coelum-motion" aria-hidden="true"></canvas>
      <div class="coelum-rail coelum-hud" role="toolbar" aria-label="View" aria-orientation="vertical">
        <button type="button" class="coelum-btn" data-action="in" aria-label="Zoom in" title="Zoom in">${ICONS.plus}</button>
        <button type="button" class="coelum-btn" data-action="out" aria-label="Zoom out" title="Zoom out">${ICONS.minus}</button>
        <button type="button" class="coelum-btn" data-action="fit" aria-label="Reset view" title="Reset view">${ICONS.fit}</button>
        <span class="coelum-rail-gap" aria-hidden="true"></span>
        <button type="button" class="coelum-btn" data-action="layers" aria-expanded="false" aria-controls="${id}-layers" aria-label="Layers and labels" title="Layers and labels">${ICONS.layers}</button>
        <button type="button" class="coelum-btn" data-action="legend" data-modes="chart" aria-expanded="false" aria-controls="${id}-legend" aria-label="Legend" title="Legend">${ICONS.legend}</button>
      </div>
      <div class="coelum-panel coelum-toolbar" id="${id}-layers" role="group" aria-label="Sky layers" hidden>
        <div class="coelum-panel-head"><h3>Layers</h3><button type="button" class="coelum-btn coelum-btn-small" data-action="close-panel" aria-label="Close layers">${ICONS.close}</button></div>
        <div class="coelum-switches">${LAYERS.map(([key, label, modes]) => `<label data-modes="${modes}"><input type="checkbox" role="switch" data-layer="${key}"><span>${label}</span></label>`).join('')}</div>
        <div class="coelum-selects"><label data-modes="chart">Stars to magnitude <select data-limit>${[3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}" ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>Horizon <select data-horizon><option value="landscape">Landscape</option><option value="terrain">Local terrain</option><option value="flat">Flat</option></select></label><label>Text size <select data-label-size><option value="14">Normal</option><option value="17">Large</option><option value="20">Larger</option></select></label></div>
        <p class="coelum-panel-note coelum-terrain-note" hidden></p>
        <p class="coelum-panel-note" data-modes="sky">Stars fade with twilight, moonlight and toward the horizon; zoom in to see fainter ones. With the atmosphere, positions include refraction.</p>
        <div class="coelum-downloads"><h3>Fainter stars</h3><p class="coelum-panel-note coelum-faint-note"></p>
          <div class="coelum-download-buttons">${Object.entries(STAR_FILES).map(([k, f]) => `<button type="button" class="coelum-chip" data-download="${k}">${f.label[0].toUpperCase() + f.label.slice(1)} · ${f.size}</button>`).join('')}<button type="button" class="coelum-chip" data-download="remove">Remove</button></div></div>
      </div>
      <div class="coelum-panel coelum-legend" id="${id}-legend" role="group" aria-label="Legend" hidden>
        <button type="button" class="coelum-btn coelum-btn-small coelum-panel-close" data-action="close-panel" aria-label="Close legend">${ICONS.close}</button>${chartLegend()}
      </div>
    </div>
    <div class="coelum-timebar coelum-hud">
      <div class="coelum-clock"><p class="coelum-status" aria-live="polite"></p><output class="coelum-speed" data-speed data-rate="60" aria-live="polite" title="Simulated seconds per real second">60×</output></div>
      <div class="coelum-controls" role="toolbar" aria-label="Time">
        <button type="button" class="coelum-btn coelum-btn-text" data-action="back" aria-label="One hour earlier" title="One hour earlier">−1 h</button>
        <button type="button" class="coelum-btn coelum-btn-text" data-action="slower" aria-label="Halve playback speed" title="Halve playback speed">÷2</button>
        <button type="button" class="coelum-btn coelum-play" data-action="play" aria-label="Play" title="Play">${ICONS.play}</button>
        <button type="button" class="coelum-btn coelum-btn-text" data-action="faster" aria-label="Double playback speed" title="Double playback speed">×2</button>
        <button type="button" class="coelum-btn coelum-btn-text" data-action="forward" aria-label="One hour later" title="One hour later">+1 h</button>
        <button type="button" class="coelum-btn" data-action="reverse" aria-pressed="false" aria-label="Reverse playback direction" title="Reverse playback direction">${ICONS.reverse}</button>
        <button type="button" class="coelum-btn" data-action="reset" aria-label="Back to the original time and view" title="Back to the original time and view">${ICONS.reset}</button>
      </div>
    </div>
    <section class="coelum-detail" aria-label="Selected object" aria-live="polite"><button type="button" class="coelum-btn coelum-btn-small coelum-panel-close" data-action="deselect" aria-label="Clear selection">${ICONS.close}</button><div class="coelum-detail-body"><p>Tap an object or its label, or search for it, to see its characteristics.</p></div></section>
    <p class="sky-hint">Drag to look around · pinch or scroll to zoom · double-tap to reset the view. <span data-modes="chart">Symbol sizes are exaggerated; deep-sky symbols mark catalog positions, not naked-eye visibility.</span><span data-modes="sky">Stars, planets and the Milky Way appear as the sky darkens; with the atmosphere, positions include refraction.</span> <span data-modes="chart">Geometric positions, without refraction.</span></p>
    <details class="coelum-credit"><summary>Chart data</summary><p>Stars: XHIP (Anderson &amp; Francis, 2012), via <a href="https://github.com/ofrohn/d3-celestial" target="_blank" rel="noopener">d3-celestial</a>; double and variable stars from the Hipparcos catalogue (ESA, 1997). Constellation figures, boundaries and Milky Way outlines: Olaf Frohn (BSD-3-Clause). Named stars and deep-sky objects: the app’s IAU / HYG / OpenNGC catalogs. The Moon: NASA LRO. Local horizon: AWS Terrain Tiles (Mapzen; SRTM, Copernicus and other elevation models). Background stars include precession and nutation; named stars include proper motion. Clouds and light pollution are not modeled.</p></details>`;
  const $ = (s) => root.querySelector(s);
  const svg = $('.coelum-full'), status = $('.coelum-status'), detail = $('.coelum-detail-body'), viewport = $('.coelum-viewport');
  const canvas = $('.coelum-motion'), ctx = canvas.getContext('2d'), back = $('.coelum-back'), backCtx = back.getContext('2d'), input = $('.coelum-search input'), results = $('.coelum-results');
  const layers = { chart: { ...DEFAULT_LAYERS }, sky: { ...SKY_LAYERS } };
  const views = { chart: { scale: 1, rotation: [...SKY_IDENTITY] }, sky: null };
  let size = 360, height = 360;
  let t = model.t, frame = skyFrame(t, model.place), drawn, playing = false, last = 0, selected = null;
  let animator = null, animation = 0, lastUI = -Infinity, frameNumber = 0, speed = 60, flight = 0, interacting = false, settleTimer = 0;
  // The horizon (shared by both views): the terrain's profile, if computed.
  let horizon = 'landscape', terrain = null;
  try { horizon = localStorage.getItem('imks-coelum-horizon') || 'landscape'; } catch { /* private mode */ }
  const setTerrain = (profile) => { terrain = profile ? horizonAt(profile) : null; };
  setTerrain(storedHorizon(model.place));
  if (horizon === 'terrain' && !terrain) horizon = 'landscape';
  const applyHorizon = () => {
    layers.sky.horizon = horizon; layers.sky.terrain = terrain;
    layers.chart.terrain = horizon === 'terrain' ? terrain : null;
  };
  applyHorizon();
  const skyView = () => views.sky || (views.sky = defaultSkyView(frame, size, height));

  const setSpeed = (value) => {
    speed = value; last = performance.now();
    const output = $('[data-speed]');
    output.dataset.rate = String(speed);
    output.textContent = `${speed < 0 ? '−' : ''}${Number(Math.abs(speed).toFixed(6))}×`;
    output.title = `${Number(Math.abs(speed).toFixed(6))} simulated seconds per second, ${speed < 0 ? 'backward' : 'forward'}`;
    $('[data-action="reverse"]').setAttribute('aria-pressed', String(speed < 0));
  };
  const updateUI = (force = false) => {
    const now = performance.now();
    if (!force && now - lastUI < 200) return;
    lastUI = now;
    root.classList.toggle('coelum-has-selection', Boolean(selected));
    const sun = frame.bodies[0].alt, condition = sun >= 0 ? 'Daylight' : sun >= -6 ? 'Civil twilight' : sun >= -12 ? 'Nautical twilight' : sun >= -18 ? 'Astronomical twilight' : 'Night';
    status.innerHTML = `<b>${esc(formatTime(t))}</b> · ${esc(model.label)} · ${condition} · Sun ${sun.toFixed(1)}°`;
    if (selected) {
      const o = findObject(frame, selected);
      if (o) detail.innerHTML = objectDetails(mode === 'sky' && layers.sky.atmosphere ? { ...o, apparentAlt: o.alt + refraction(o.alt, model.place[2] || 0) } : o);
    }
  };
  const draw = (recompute = false) => {
    if (recompute) { animator = null; frame = skyFrame(t, model.place); }
    svg.setAttribute('viewBox', `0 0 ${size} ${height}`);
    const view = mode === 'sky' ? skyView() : views.chart;
    svg.dataset.rotation = (view.rotation || []).join(','); svg.dataset.scale = String(view.scale);
    if (mode === 'sky') { svg.dataset.az = view.az.toFixed(3); svg.dataset.alt = view.alt.toFixed(3); }
    svg.dataset.time = String(t);
    if (playing) {
      if (!animator) animator = createSkyAnimator(t, model.place, layers[mode]);
      frame = animator(t);
    }
    // The chart moves on the canvas (playback, drags, flights) and settles
    // as SVG; its sky and Milky Way then go on the backdrop canvas.
    const onCanvas = playing || mode === 'sky' || interacting;
    if (onCanvas) {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(size * dpr), h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawn = mode === 'sky' ? skyScene(frame, size, height, layers.sky, { ...view, selected }, ctx) : skyChart(frame, size, height, layers.chart, { ...view, selected }, ctx);
      canvas.dataset.frame = String(++frameNumber);
      if (mode === 'sky' && svg.childElementCount) svg.innerHTML = '';
    } else {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(size * dpr), h = Math.round(height * dpr);
      if (back.width !== w || back.height !== h) { back.width = w; back.height = h; }
      backCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawn = skyChart(frame, size, height, layers.chart, { ...view, selected, backdrop: backCtx });
      svg.innerHTML = drawn.svg;
    }
    canvas.hidden = !onCanvas;
    updateUI(!playing && !interacting);
  };
  const tick = (now) => {
    animation = 0;
    if (!root.isConnected || !playing) return;
    if (!document.hidden) {
      t = limitTime(t + Math.min(0.1, Math.max(0, (now - last) / 1000)) * speed);
      draw();
    }
    last = now;
    animation = requestAnimationFrame(tick);
  };
  const setPlay = (on) => {
    const button = $('[data-action="play"]');
    button.innerHTML = on ? ICONS.pause : ICONS.play;
    button.setAttribute('aria-label', on ? 'Pause' : 'Play'); button.title = on ? 'Pause' : 'Play';
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
  const settle = () => { clearTimeout(settleTimer); if (!interacting) return; interacting = false; if (root.isConnected) draw(); };
  const scaleLimits = () => (mode === 'sky' ? [0.6, 80] : [1, 16]);
  const zoom = (factor) => { const v = mode === 'sky' ? skyView() : views.chart, [lo, hi] = scaleLimits(); v.auto = false; v.scale = Math.min(hi, Math.max(lo, v.scale * factor)); draw(); };
  const fit = () => {
    cancelAnimationFrame(flight); flight = 0;
    if (mode === 'sky') views.sky = defaultSkyView(frame, size, height);
    else Object.assign(views.chart, { scale: 1, rotation: [...SKY_IDENTITY] });
    draw();
  };
  // Fly to an object: the chart turns along a great circle, the sky view
  // pans in azimuth and altitude; both zoom in a little.
  const goTo = (o) => {
    cancelAnimationFrame(flight);
    const start = performance.now(), duration = 650, ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    let step;
    if (mode === 'sky') {
      const v = skyView(), from = { ...v }; v.auto = false;
      const a = layers.sky.atmosphere ? refractVector(pointVector(o), model.place[2] || 0) : pointVector(o), oAz = Math.atan2(a[0], a[1]) / R, oAlt = Math.asin(Math.max(-1, Math.min(1, a[2]))) / R;
      const daz = ((oAz - v.az + 540) % 360) - 180, alt = Math.max(-30, Math.min(80, oAlt)), scale = Math.max(v.scale, 2.5);
      step = (e) => Object.assign(v, { az: (from.az + daz * e + 360) % 360, alt: from.alt + (alt - from.alt) * e, scale: from.scale + (scale - from.scale) * e });
    } else {
      const v = views.chart, rotation = [...v.rotation], fromScale = v.scale, scale = Math.max(v.scale, 2.5);
      const w = pointVector(o), p = [0, 1, 2].map((i) => dot3(rotation.slice(i * 3, i * 3 + 3), w));
      const angle = Math.acos(Math.max(-1, Math.min(1, p[2])));
      step = (e) => {
        const a = angle * (1 - e), axis = unit3(p[0] || p[1] ? [p[0], p[1], 0] : [1, 0, 0]);
        const target = [axis[0] * Math.sin(a), axis[1] * Math.sin(a), Math.cos(a)];
        v.rotation = e === 0 ? rotation : rotateSky(rotation, p, target);
        v.scale = fromScale + (scale - fromScale) * e;
      };
    }
    const frameStep = (now) => {
      const u = Math.min(1, (now - start) / duration);
      if (u < 1) interact();
      step(ease(u));
      if (u < 1) draw(); else { interacting = true; settle(); }
      flight = u < 1 && root.isConnected ? requestAnimationFrame(frameStep) : 0;
    };
    flight = requestAnimationFrame(frameStep);
  };
  const select = (name) => {
    selected = name;
    if (!selected) detail.innerHTML = '<p>Tap an object or its label, or search for it, to see its characteristics.</p>';
    lastUI = -Infinity;
  };

  // Panels: one at a time; they keep the full-screen controls awake.
  const panels = { layers: $('.coelum-toolbar'), legend: $('.coelum-legend') };
  const showPanel = (name) => {
    for (const [key, panel] of Object.entries(panels)) {
      const on = key === name && panel.hidden;
      panel.hidden = !on;
      $(`[data-action="${key}"]`).setAttribute('aria-expanded', String(on));
    }
    root.classList.toggle('coelum-show-options', !panels.layers.hidden);
    wake();
  };
  const syncLayers = () => {
    for (const box of root.querySelectorAll('[data-layer]')) box.checked = Boolean(layers[mode][box.dataset.layer]);
    $('[data-label-size]').value = String(layers[mode].labelSize);
    $('[data-horizon]').value = horizon;
    for (const o of $('[data-limit]').options) o.disabled = Number(o.value) > 6 && !faintCount();
  };
  // Fainter stars: what is stored, and the buttons to change it.
  const faintNote = $('.coelum-faint-note');
  const showFaint = (text) => {
    const n = faintCount();
    faintNote.textContent = text || (n ? `${n.toLocaleString('en')} more stars stored on this device (${STAR_FILES[faintVariant]?.label || 'downloaded'}); they appear as you zoom in.` : 'Only stars to magnitude 6 are built in. Download more to see fainter ones when zoomed in; they stay on this device for offline use.');
    for (const b of root.querySelectorAll('[data-download]')) b.hidden = b.dataset.download === 'remove' ? !n : b.dataset.download === faintVariant;
    syncLayers();
  };
  // The local horizon: computed from terrain tiles when first chosen.
  const terrainNote = $('.coelum-terrain-note');
  const showTerrain = (text) => {
    terrainNote.hidden = horizon !== 'terrain' && !text;
    terrainNote.innerHTML = text || (terrain ? 'The terrain around this place, from elevation models out to 150 km (buildings and trees are not included). <button type="button" class="coelum-chip" data-terrain="refresh">Compute again</button> <button type="button" class="coelum-chip" data-terrain="forget">Forget</button>' : '');
  };
  let terrainJob = null;
  const chooseHorizon = async (value, refresh = false) => {
    if (value === 'terrain' && (!terrain || refresh)) {
      if (terrainJob) return;
      showTerrain('Downloading the terrain around this place…');
      terrainJob = computeHorizon(model.place, (f) => showTerrain(`Downloading the terrain around this place… ${Math.round(f * 100)}%`));
      try { setTerrain(await terrainJob); }
      catch (e) { terrainJob = null; if (!terrain) { horizon = horizon === 'terrain' ? 'landscape' : horizon; syncLayers(); } showTerrain(`${esc(e.message)}. The local horizon needs a connection the first time.`); return; }
      terrainJob = null;
    }
    horizon = value;
    try { localStorage.setItem('imks-coelum-horizon', value); } catch { /* private mode */ }
    applyHorizon(); syncLayers(); showTerrain(); draw();
  };
  const setMode = (m) => {
    if (m === mode) return;
    // Keep the two views roughly in step: the same direction at the center
    // and the same scale there (unless the one left is at its default).
    const chart = views.chart, chartMoved = chart.scale !== 1 || chart.rotation.some((x, i) => Math.abs(x - SKY_IDENTITY[i]) > 1e-9);
    if (m === 'sky' && chartMoved) {
      const d = unprojectSky(0, 0, chart.rotation), v = skyView(), alt = Math.asin(Math.max(-1, Math.min(1, d[2]))) / R;
      Object.assign(v, { az: alt > 89.5 ? v.az : (Math.atan2(d[0], d[1]) / R + 360) % 360, alt, scale: Math.max(0.6, Math.min(80, chartRadius(size, height, chart.scale) * 4 / Math.PI / skyRadius(size, height, 1))), auto: false });
    } else if (m === 'chart' && views.sky && !views.sky.auto) {
      const v = views.sky;
      views.chart = { rotation: lookAt(v.az, v.alt), scale: Math.max(1, Math.min(16, skyRadius(size, height, v.scale) * Math.PI / 4 / chartRadius(size, height, 1))) };
    }
    mode = m; root.dataset.mode = m; animator = null;
    try { localStorage.setItem('imks-coelum-mode', m); } catch { /* private mode */ }
    for (const b of root.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === m));
    if (m === 'sky' && !panels.legend.hidden) showPanel(null);
    cancelAnimationFrame(flight); flight = 0;
    syncLayers(); draw();
  };
  const immersive = () => root.classList.contains('coelum-immersive');
  const fullscreen = (on) => {
    root.classList.toggle('coelum-immersive', on);
    const button = $('[data-action="fullscreen"]');
    button.innerHTML = on ? ICONS.shrink : ICONS.expand;
    button.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); button.title = on ? 'Exit full screen' : 'Full screen';
    button.setAttribute('aria-pressed', String(on));
    svg.focus({ preventScroll: true });
    wake();
  };

  // Full-screen controls fade after a few quiet seconds, as in planetarium
  // programs; any movement, touch or key brings them back.
  let idleTimer = 0, hudHover = false;
  const wake = () => {
    root.classList.remove('coelum-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const busy = hudHover || !panels.layers.hidden || !panels.legend.hidden || document.activeElement === input || !results.hidden;
      if (immersive() && !busy && root.isConnected) root.classList.add('coelum-idle');
    }, 3500);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin']) root.addEventListener(ev, wake, { passive: true });
  for (const hud of root.querySelectorAll('.coelum-hud')) {
    hud.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') hudHover = true; });
    hud.addEventListener('pointerleave', () => { hudHover = false; wake(); });
  }

  // Search: matches as you type; Enter or a tap flies to the object.
  let matches = [], active = -1;
  const showResults = () => {
    results.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(!results.hidden));
    results.innerHTML = matches.map((m, i) => `<li role="option" id="${id}-r${i}" data-index="${i}" aria-selected="${i === active}"><span class="coelum-result-dot coelum-type-${esc(m.type.split(' ').at(-1))}"></span><span class="coelum-result-name">${esc(m.name)}${m.alias ? ` <small>${esc(m.alias)}</small>` : ''}</span><span class="coelum-result-meta">${esc(TYPE_ORDER[m.type] || m.type)}${m.alt < 0 ? ' · below horizon' : ''}</span></li>`).join('');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-r${active}`); else input.removeAttribute('aria-activedescendant');
  };
  const choose = (i) => {
    const m = matches[i];
    if (!m) return;
    const o = findObject(frame, m.name);
    input.value = m.name; matches = []; active = -1; showResults();
    input.blur();
    select(o.name); goTo(o);
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
  results.addEventListener('click', (ev) => { const li = ev.target.closest('[data-index]'); if (li) choose(Number(li.dataset.index)); });

  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!panels.layers.hidden || !panels.legend.hidden) { ev.preventDefault(); ev.stopPropagation(); showPanel(null); }
    else if (immersive()) { ev.preventDefault(); ev.stopPropagation(); fullscreen(false); }
  });
  root.addEventListener('change', (ev) => {
    const L = layers[mode];
    if (ev.target.dataset.layer) L[ev.target.dataset.layer] = ev.target.checked;
    if (ev.target.matches('[data-limit]')) layers.chart.magnitude = Number(ev.target.value);
    if (ev.target.matches('[data-label-size]')) layers.chart.labelSize = layers.sky.labelSize = Number(ev.target.value);
    if (ev.target.matches('[data-horizon]')) { chooseHorizon(ev.target.value); return; }
    draw();
  });
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
    const terrainAction = ev.target.closest('[data-terrain]')?.dataset.terrain;
    if (terrainAction === 'refresh') { chooseHorizon('terrain', true); return; }
    if (terrainAction === 'forget') { forgetHorizon(model.place); setTerrain(null); chooseHorizon('landscape'); return; }
    const viewButton = ev.target.closest('[data-view]');
    if (viewButton) { setMode(viewButton.dataset.view); return; }
    const button = ev.target.closest('[data-action]'), action = button?.dataset.action;
    if (!action) return;
    if (action === 'fullscreen') fullscreen(!immersive());
    else if (action === 'layers' || action === 'legend') showPanel(action);
    else if (action === 'close-panel') showPanel(null);
    else if (action === 'deselect') { select(null); draw(); }
    else if (action === 'in' || action === 'out') zoom(action === 'in' ? 1.5 : 1 / 1.5);
    else if (action === 'fit') fit();
    else if (action === 'slower' || action === 'faster') setSpeed(Math.sign(speed) * Math.max(1 / 64, Math.min(1048576, Math.abs(speed) * (action === 'faster' ? 2 : 0.5))));
    else if (action === 'reverse') setSpeed(-speed);
    else if (action === 'play') {
      if (playing) pause();
      else { playing = true; last = performance.now(); lastUI = -Infinity; setPlay(true); draw(); animation = requestAnimationFrame(tick); }
    } else {
      if (action === 'reset') { t = model.t; setSpeed(60); pause(); fit(); }
      else t = limitTime(t + (action === 'back' ? -3600 : 3600));
      draw(true);
    }
  });
  svg.addEventListener('wheel', (ev) => { ev.preventDefault(); if (mode === 'chart') interact(200); zoom(Math.exp(-ev.deltaY * 0.002)); }, { passive: false });
  svg.addEventListener('dblclick', fit);

  // Gestures: in the chart, the grabbed point of the sphere follows the
  // finger; in the sky view, dragging pans in azimuth and altitude so the
  // horizon stays level. Two fingers also zoom.
  const pointers = new Map();
  let gesture = null, lastTap = null;
  const point = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const centroid = () => {
    const p = [...pointers.values()];
    return { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length, distance: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0 };
  };
  const baseline = () => {
    if (!pointers.size) return null;
    const v = mode === 'sky' ? skyView() : views.chart;
    return { ...centroid(), scale: v.scale, rotation: v.rotation && [...v.rotation], az: v.az, alt: v.alt, moved: pointers.size > 1 };
  };
  svg.addEventListener('pointerdown', (ev) => { cancelAnimationFrame(flight); flight = 0; pointers.set(ev.pointerId, point(ev)); svg.setPointerCapture(ev.pointerId); gesture = baseline(); });
  svg.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId) || !gesture) return;
    pointers.set(ev.pointerId, point(ev));
    const { x, y, distance } = centroid();
    if (Math.hypot(x - gesture.x, y - gesture.y) > 4 || distance) gesture.moved = true;
    if (!gesture.moved) return;
    lastTap = null;
    const [lo, hi] = scaleLimits(), scale = Math.max(lo, Math.min(hi, gesture.scale * (gesture.distance ? distance / gesture.distance : 1)));
    if (mode === 'sky') {
      // The sky point grabbed at the start stays under the finger(s).
      const v = skyView(), r0 = skyRadius(size, height, gesture.scale), r1 = skyRadius(size, height, scale);
      gesture.grab ||= unprojectSky((gesture.x - size / 2) / r0, (gesture.y - height / 2) / r0, lookAt(gesture.az, gesture.alt), true);
      v.scale = scale; v.auto = false;
      Object.assign(v, solveLook(gesture.grab, (x - size / 2) / r1, (y - height / 2) / r1, v.az, v.alt));
    } else {
      interact();
      views.chart.scale = scale;
      const oldRadius = chartRadius(size, height, gesture.scale), newRadius = chartRadius(size, height, scale);
      const from = unprojectSky((gesture.x - size / 2) / oldRadius, (gesture.y - height / 2) / oldRadius);
      const to = unprojectSky((x - size / 2) / newRadius, (y - height / 2) / newRadius);
      views.chart.rotation = rotateSky(gesture.rotation, from, to);
    }
    draw();
  });
  const up = (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    const moved = gesture?.moved, p = point(ev);
    pointers.delete(ev.pointerId);
    if (ev.type !== 'pointercancel' && !moved && !pointers.size) {
      if (lastTap && performance.now() - lastTap.time < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 18) { fit(); lastTap = null; }
      else {
        // Choose the nearest rendered symbol, using the same projection.
        const nearby = drawn.objects.map((o) => ({ o, d: Math.hypot(o.x - p.x, o.y - p.y) })).filter(({ o, d }) => d < Math.max(14, o.radius + 4)).sort((a, b) => a.d - b.d);
        const label = drawn.hitLabels.find(({ box }) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3]);
        select(label?.name || nearby[0]?.o.name || null);
        lastTap = { time: performance.now(), x: p.x, y: p.y };
        draw();
      }
    }
    gesture = baseline();
    if (gesture) gesture.moved = true;
    else settle();
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === '+' || ev.key === '=') zoom(1.5);
    else if (ev.key === '-') zoom(1 / 1.5);
    else if (ev.key === 'Home') fit();
    else if (ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      const dx = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0, dy = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
      if (mode === 'sky') {
        const v = skyView(), step = 5 / v.scale;
        v.auto = false;
        v.az = ((v.az + dx * step / Math.max(0.25, Math.cos(v.alt * R))) % 360 + 360) % 360;
        v.alt = Math.max(-90, Math.min(90, v.alt - dy * step));
      } else {
        const amount = 0.12 / views.chart.scale;
        views.chart.rotation = rotateSky(views.chart.rotation, [0, 0, 1], unprojectSky(-dx * amount, -dy * amount));
      }
      draw();
    }
  });
  syncLayers();
  showFaint(); showTerrain();
  draw();
  loadFaintStars().then(() => { if (root.isConnected) { showFaint(); if (faintCount() && !playing) draw(true); } });
  moonTexture.then(() => { if (root.isConnected && mode === 'sky' && !playing) draw(); });
  const resize = new ResizeObserver(() => {
    root.style.setProperty('--coelum-controls-height', `${Math.ceil($('.coelum-timebar').getBoundingClientRect().height) + 16}px`);
    const box = svg.getBoundingClientRect(), width = Math.round(box.width), high = Math.round(box.height);
    if (width > 0 && high > 0 && (width !== size || high !== height)) {
      // A fresh realistic view keeps its horizon low in the new shape.
      if (views.sky?.auto) views.sky = null;
      size = width; height = high; draw();
    }
  });
  resize.observe(svg);
  resize.observe($('.coelum-timebar'));
  const lifetime = new MutationObserver(() => {
    if (!root.isConnected) { cancelAnimationFrame(animation); cancelAnimationFrame(flight); clearTimeout(idleTimer); resize.disconnect(); lifetime.disconnect(); }
  });
  lifetime.observe(root.closest('.sheet') || document.body, { childList: true, subtree: true });
  return {
    // Center an object on opening (an eclipse's Sun, an occultation's Moon).
    focus(name) { const o = findObject(frame, name); if (o) { select(o.name); goTo(o); } return Boolean(o); },
    snapshot() {
      // Export the current frame as SVG even while the canvas is moving;
      // the realistic view is a picture of its canvas.
      if (mode === 'sky') svg.innerHTML = `<image href="${canvas.toDataURL('image/png')}" width="${size}" height="${height}"/>`;
      else svg.innerHTML = skyChart(frame, size, height, layers.chart, { ...views.chart, selected }).svg;
      updateUI(true);
      return svg;
    },
  };
}
