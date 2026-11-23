// Civil-day almanac, computed locally with the same ephemerides as the sky.
import { moonDisk, topocentric, riseSet, horizontal, horizonRefraction, transit, moonPhase, elongation, nextPhase, season, solarEclipse, lunarEclipse, opposition, greatestElongation } from './astro.js';
import { skyDayBounds, skyTimeInput, skyTimeZone, skyClock, parseSkyInput } from './coelumtime.js';
import { planetConjunctions } from './eventspanel.js';
import { mountSkyDateWheels } from './skydatewheel.js';
import { refraction } from './coelum.js';
import { drawPlanet, planetMap } from './skyview.js';
import { meteorShowers } from './meteors.js';
export { meteorShowers } from './meteors.js';

const YEAR = 31557600;
let datePickerId = 0;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const title = (s) => s[0].toUpperCase() + s.slice(1);
const PHASES = ['New Moon', 'First quarter Moon', 'Full Moon', 'Last quarter Moon'];
const SEASONS = ['March equinox', 'June solstice', 'September equinox', 'December solstice'];
// Include every crossing in the civil day, including 25-hour days and cases
// where the Moon sets before rising. Never borrow an event from tomorrow.
function crossings(body, start, end, place, rising, altitude) {
  const list = [];
  for (let from = start - 0.1; from < end;) {
    const event = riseSet(body, from, place, rising, altitude);
    if (!event || event.t >= end) break;
    if (event.t >= start) list.push(event.t);
    from = event.t + 1;
  }
  return list;
}
export function dailyAlmanac(time, place, zone) {
  const [start, end] = skyDayBounds(time, zone);
  const noonTime = parseSkyInput(`${skyTimeInput(time, zone).split(' ')[0]} 12:00`, zone);
  const mid = Number.isFinite(noonTime) ? noonTime : (start + end) / 2;
  const pair = (body, altitude) => ({ rise: crossings(body, start, end, place, true, altitude), set: crossings(body, start, end, place, false, altitude) });
  const sun = pair('sun'), moon = pair('moon');
  const up = horizontal('sun', start, place).alt > -0.2666 - horizonRefraction(place[2]);
  let daylight = 0, last = start, lit = up;
  for (const e of [...sun.rise.map((t) => ({ t, up: true })), ...sun.set.map((t) => ({ t, up: false }))].sort((a, b) => a.t - b.t)) {
    if (lit) daylight += e.t - last;
    last = e.t; lit = e.up;
  }
  if (lit) daylight += end - last;
  const noon = transit('sun', start - 0.1, place[1]);
  const phase = moonPhase(mid), angle = elongation(mid);
  const phaseName = phase.fraction < 0.005 ? 'New Moon' : phase.fraction > 0.995 ? 'Full Moon'
    : Math.abs(phase.fraction - 0.5) < 0.015 ? (angle < 180 ? 'First quarter' : 'Last quarter')
    : `${angle < 180 ? 'Waxing' : 'Waning'} ${phase.fraction < 0.5 ? 'crescent' : 'gibbous'}`;
  return { start, end, mid, sun, moon, daylight, noon: noon !== null && noon < end ? noon : null,
    civil: pair('sun', -6), nautical: pair('sun', -12), astronomical: pair('sun', -18), phase, phaseName };
}

// Sample the entire interval, then refine every detected crossing to <0.1 s.
// Unlike a single rise/set pair this preserves occultations by separate ridges.
export function visibilityIntervals(body, start, end, place, terrain = null) {
  const r = horizonRefraction(place[2]);
  const clearance = (t) => {
    const h = horizontal(body, t, place);
    const limb = body === 'sun' ? 0.2666 : body === 'moon' ? Math.asin(1737.4 / h.dist) * 180 / Math.PI : 0;
    return h.alt + (terrain ? refraction(h.alt, place[2]) : r) + limb - (terrain ? terrain(h.az) : 0);
  };
  const rise = [], set = [], intervals = [];
  let a = start, fa = clearance(a), from = fa >= 0 ? start : null;
  while (a < end) {
    const b = Math.min(a + 30, end), fb = clearance(b);
    if ((fa >= 0) !== (fb >= 0)) {
      let lo = a, hi = b;
      while (hi - lo > 0.05) {
        const mid = (lo + hi) / 2;
        if ((clearance(mid) >= 0) === (fa >= 0)) lo = mid; else hi = mid;
      }
      const t = (lo + hi) / 2;
      if (fb >= 0) { if (t < end) rise.push(t); from = t; }
      else { if (t < end) set.push(t); if (from !== null) intervals.push([from, t]); from = null; }
    }
    a = b; fa = fb;
  }
  if (from !== null) intervals.push([from, end]);
  return { rise, set, intervals };
}

const BODIES = ['moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const COLORS = ['#e4eaf4', '#adb6c5', '#f6dfb3', '#e79d87', '#d2b4ac', '#dfc99a', '#78c5d3', '#809fdf'];
// A night belongs to the selected civil date: local noon to next local noon.
export function almanacNight(time, zone) {
  const [, end] = skyDayBounds(time, zone);
  return [time, end + 1].map(t => parseSkyInput(`${skyTimeInput(t, zone).split(' ')[0]} 12:00`, zone));
}

function visibilityChart(start, end, rows, sun, zone, terrain) {
  const pct = t => (100 * (t - start) / (end - start)).toFixed(5);
  const band = (a, b, cls, extra = '') => `<i class="${cls}" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%" ${extra}></i>`;
  const shades = [];
  // Solar altitude defines the background; terrain does not change twilight.
  for (let t = start; t < end; t += 600) {
    const alt = sun(t + 300);
    shades.push(band(t, Math.min(t + 600, end), 'almanac-shade', `data-light="${alt >= -0.833 ? 'day' : alt >= -6 ? 'civil' : alt >= -12 ? 'nautical' : alt >= -18 ? 'astro' : 'night'}"`));
  }
  const ticks = [];
  for (let t = start; t <= end; t += 7200) {
    const label = skyClock(t, zone).replace(/:00$/, '');
    ticks.push(`<span style="left:${pct(t)}%" title="${esc(`${skyTimeInput(t, zone)} ${skyTimeZone(t, zone)}`)}">${label}</span>`);
  }
  const times = a => a.length ? a.map(t => skyClock(Math.round(t), zone, true)).join(' / ') : 'None in this interval';
  const date = t => skyTimeInput(t, zone).split(' ')[0];
  const crossingRow = (label, events, kind) => `<tr class="almanac-time-${kind}"><th scope="row">${label}</th><td>${events ? times(events.rise) : 'Unavailable'}</td><td>${events ? times(events.set) : 'Unavailable'}</td></tr>`;
  const planetRows = rows.map((row, i) => {
    const name = title(row.body);
    const bars = (events, kind) => events.intervals.map(([a, b]) => band(a, b, `almanac-bar almanac-bar-${kind}`)).join('');
    const terrainLabels = row.terrain ? ['rise', 'set'].flatMap(kind => row.terrain[kind].map(t => {
      const rounded = skyClock(Math.round(t / 60) * 60, zone);
      const position = kind === 'rise' ? `left:clamp(0%, ${pct(t)}%, calc(100% - 5ch))` : `right:clamp(0%, ${100 - pct(t)}%, calc(100% - 5ch))`;
      return `<span class="almanac-crossing-time" data-crossing="${kind}" data-crossing-time="${t}" style="${position}" title="${kind === 'rise' ? 'Rise / reappear' : 'Set / disappear'} above local terrain · ${esc(skyTimeInput(Math.round(t / 60) * 60, zone))}">${rounded}</span>`;
    })).join('') : '';
    const interval = (row.terrain || row.flat).intervals[0] || [start, end];
    const viewTime = (interval[0] + interval[1]) / 2;
    return `<button type="button" class="almanac-planet" data-almanac-planet="${row.body}" style="--planet-color:${COLORS[i]}" aria-haspopup="dialog" aria-label="${name} visibility details"><span class="almanac-planet-name">${name}</span>
        <span class="almanac-track">${shades.join('')}${bars(row.flat, 'flat')}${row.terrain ? bars(row.terrain, 'terrain') : ''}${terrainLabels}</span>
      </button>
      <template data-almanac-detail="${row.body}"><div class="almanac-planet-details"><table>
        <caption>${name} crossings · ${date(start)} noon to ${date(end)} noon</caption>
        <thead><tr><th scope="col">Horizon</th><th scope="col">Rise / reappear</th><th scope="col">Set / disappear</th></tr></thead>
        <tbody>${crossingRow('Local terrain', row.terrain, 'terrain')}${crossingRow('Theoretical', row.flat, 'theoretical')}</tbody>
      </table>
      <p class="coelum-panel-note">${row.flat.intervals.length ? 'Bars show time above each horizon, including daylight; brightness and observing conditions also affect visibility.' : 'Below the theoretical horizon throughout this interval.'} Crossing times before noon fall on ${date(end)}.</p>
      <button type="button" class="coelum-chip" data-body="${row.body}" data-almanac-sky-time="${viewTime}">Show ${name} in sky</button></div>
    </template>`;
  }).join('');
  return `<div class="almanac-chart-heading"><h4>Solar system visibility</h4><span>${date(start)} → ${date(end)} · noon to noon</span></div>
    <p class="almanac-legend"><span class="almanac-key-flat">Theoretical horizon</span><span class="almanac-key-terrain">Local terrain${terrain ? '' : ' · unavailable'}</span></p>
    <div class="almanac-timeline"><div class="almanac-axis"><span>Local time</span><div>${ticks.join('')}</div></div>${planetRows}</div>
    `;
}

// Keep nearby ridge crossings readable, including on narrow screens.
function layoutCrossingTimes(root) {
  for (const track of root.querySelectorAll('.almanac-track')) {
    const labels = [...track.querySelectorAll('.almanac-crossing-time')].sort((a, b) => a.offsetLeft - b.offsetLeft);
    const ends = [];
    for (const label of labels) {
      const left = label.offsetLeft;
      let lane = ends.findIndex(end => end + 4 <= left);
      if (lane < 0) lane = ends.length;
      ends[lane] = left + label.offsetWidth;
      label.style.top = `${26 + lane * 13}px`;
    }
    track.style.height = `${Math.max(42, 28 + ends.length * 13)}px`;
  }
}

export async function dailyHighlights(start, end, job = {}) {
  const list = [], add = (name, t, body, note = '') => { if (t !== null && t >= start && t < end) list.push({ name, t, body, note }); };
  PHASES.forEach((name, k) => add(name, nextPhase(start - 1, k * 90), 'moon'));
  const year = new Date(((start + end) / 2) * 1000).getUTCFullYear();
  for (let y = year - 1; y <= year + 1; y++) SEASONS.forEach((name, k) => add(name, season(y, k), 'sun'));
  for (const [kind, search, body] of [['solar', solarEclipse, 'sun'], ['lunar', lunarEclipse, 'moon']]) {
    const e = search(start - 1);
    if (e) add(`${title(e.kind)} ${kind} eclipse`, e.max, body, 'Worldwide maximum; visibility depends on location. See Events for the map or diagram.');
  }
  const span = (end - start) / YEAR;
  for (const body of ['mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const e = opposition(body, 'sun', start - 1, null, span);
    if (e) add(`${title(body)} at opposition`, e.t, body);
  }
  for (const body of ['mercury', 'venus']) {
    const e = greatestElongation(body, start - 1, span);
    if (e) add(`${title(body)} greatest ${e.elong > 0 ? 'eastern' : 'western'} elongation`, e.t, body);
  }
  const pairs = await planetConjunctions(start - 1, end - start + 1, null, job);
  if (!pairs || job.stop) return null;
  for (const e of pairs) add(e.name, e.t, e.body, `${e.sep.toFixed(2)}° apart (geocentric); local visibility varies.`);
  return list.sort((a, b) => a.t - b.t);
}

export const ALMANAC_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18M7 18h10m-8 0a3 3 0 0 1 6 0M12 12v1m-5 1 1 1m9-1-1 1"/></svg>';

export function renderAlmanac(root, explorer, zone, validTime = () => true) {
  let date = Date.now() / 1000, job, keyboardDate = false, pendingDate = null, terrainLoading = false, terrainError = '';
  const wheelRoot = document.createElement('dialog');
  wheelRoot.id = `coelum-almanac-date-${++datePickerId}`;
  wheelRoot.className = 'coelum-date-wheels';
  wheelRoot.dataset.almanacWheels = '';
  wheelRoot.setAttribute('aria-label', 'Choose almanac date');
  wheelRoot.hidden = true;
  const closeDateWheels = () => {
    const selected = pendingDate;
    pendingDate = null;
    if (wheelRoot.open) wheelRoot.close();
    wheelRoot.hidden = true;
    root.querySelector('[data-almanac-date]')?.setAttribute('aria-expanded', 'false');
    if (selected !== null && selected !== date) { date = selected; render(); }
    root.querySelector('[data-almanac-date]')?.focus({ preventScroll: true });
  };
  const dateWheels = mountSkyDateWheels(wheelRoot, {
    dateOnly: true,
    apply: value => {
      const selected = parseSkyInput(`${value} 12:00`, zone);
      if (!Number.isFinite(selected) || !validTime(selected)) return 'Choose a valid date from −1000 to 3000 in the selected timezone.';
      pendingDate = selected;
      return '';
    },
    close: closeDateWheels,
  });
  wheelRoot.addEventListener('cancel', event => { event.preventDefault(); closeDateWheels(); });
  wheelRoot.addEventListener('keydown', event => event.stopPropagation());
  const labelResize = new ResizeObserver(() => layoutCrossingTimes(root));
  labelResize.observe(root);
  const moonCanvas = document.createElement('canvas');
  moonCanvas.className = 'almanac-moon-image';
  moonCanvas.setAttribute('role', 'img');
  const closeDetails = () => root.querySelector('[data-almanac-dialog]')?.close();
  const render = () => {
    if (wheelRoot.open) wheelRoot.close();
    wheelRoot.hidden = true;
    closeDetails();
    // Date fields may commit a pending change when detached. Stop
    // that blur from recursively replacing the same page during rendering.
    const previousInput = root.querySelector('[data-almanac-date]');
    if (previousInput) previousInput.onchange = null;
    if (job) job.stop = true;
    job = {};
    const currentJob = job, d = dailyAlmanac(date, explorer.place, zone);
    const terrain = explorer.terrainHorizon;
    const clock = (t) => skyClock(Math.round(t), zone, true), times = (a) => a.length ? a.map(clock).join(' / ') : 'None this day';
    const row = (label, value) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
    const duration = Math.round(d.daylight);
    const terrainTimes = {};
    if (terrain) for (const body of ['sun', 'moon']) terrainTimes[body] = visibilityIntervals(body, d.start, d.end, explorer.place, terrain);
    const riseRows = (body, label) => `<table class="almanac-times"><thead><tr><th scope="col">Event</th><th scope="col" class="almanac-time-terrain">Local terrain</th><th scope="col" class="almanac-time-theoretical">Theoretical</th></tr></thead><tbody>${['rise', 'set'].map(event => `<tr><th scope="row">${label}${event}</th><td class="almanac-time-terrain">${terrain ? times(terrainTimes[body][event]) : '<span title="Download local terrain for these times">Unavailable</span>'}</td><td class="almanac-time-theoretical">${times(d[body][event])}</td></tr>`).join('')}</tbody></table>`;
    root.innerHTML = `<div class="almanac-wrap"><nav class="almanac-nav" aria-label="Almanac date"><button type="button" class="coelum-chip" data-almanac-step="-1" aria-label="Previous day">‹</button><div class="coelum-date-field"><input type="text" readonly data-almanac-date aria-label="Almanac date" aria-controls="${wheelRoot.id}" aria-expanded="false" aria-haspopup="dialog" placeholder="YYYY-MM-DD" value="${esc(skyTimeInput(date, zone).split(' ')[0])}" spellcheck="false" autocomplete="off"><button type="button" class="coelum-btn coelum-date-toggle" data-almanac-date-mode aria-label="Use keyboard" title="Use keyboard"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 15h8"/></svg></button></div><button type="button" class="coelum-chip" data-almanac-step="1" aria-label="Next day">›</button><button type="button" class="coelum-chip" data-almanac-today>Today</button></nav>
      <p class="almanac-place">${esc(explorer.placeLabel)}<span>${esc(skyTimeZone(d.mid, zone))}</span></p>
      <div class="almanac-cards"><section class="almanac-card almanac-sun"><h4>Sun</h4><p class="almanac-big">${Math.floor(duration / 3600)}h ${String(Math.floor(duration / 60) % 60).padStart(2, '0')}m ${String(duration % 60).padStart(2, '0')}s <small>of daylight · theoretical horizon</small></p>${riseRows('sun', 'Sun')}<dl>${row('Solar noon', d.noon === null ? 'None this day' : clock(d.noon))}</dl><h5>Twilight</h5><table class="almanac-times almanac-twilight"><thead><tr><th scope="col">Twilight</th><th scope="col" class="almanac-dawn">Dawn</th><th scope="col" class="almanac-dusk">Dusk</th></tr></thead><tbody>${[['Civil (−6°)', d.civil], ['Nautical (−12°)', d.nautical], ['Astronomical (−18°)', d.astronomical]].map(([label, p]) => `<tr><th scope="row">${label}</th><td class="almanac-dawn">${times(p.rise)}</td><td class="almanac-dusk">${times(p.set)}</td></tr>`).join('')}</tbody></table>${!d.sun.rise.length && !d.sun.set.length ? `<p class="coelum-panel-note">${d.daylight > 0 ? 'Sun above the horizon all day.' : 'Sun below the horizon all day.'}</p>` : ''}</section>
      <section class="almanac-card almanac-moon"><div class="almanac-moon-summary"><div><h4>Moon</h4><p class="almanac-big">${(d.phase.fraction * 100).toFixed(1)}% <small>illuminated</small></p><p class="almanac-phase" title="At midday in the selected timezone">${esc(d.phaseName)} · ${d.phase.age.toFixed(1)} days old</p></div><div data-almanac-moon></div></div>${riseRows('moon', 'Moon')}</section></div>
      <section class="almanac-card almanac-visibility"><div data-almanac-visibility role="status"><p class="coelum-panel-note">Calculating solar system visibility…</p></div>${!terrain ? `<p class="coelum-panel-note">${terrainLoading ? 'Preparing local terrain…' : 'Local terrain is not downloaded for this location.'} ${!terrainLoading ? '<button type="button" class="coelum-chip" data-almanac-terrain>Download local terrain</button>' : ''}<span data-almanac-terrain-error>${esc(terrainError)}</span></p>` : ''}</section>
      <div class="almanac-cards almanac-secondary">
      <section class="almanac-card"><h4>On this day</h4><div data-almanac-highlights role="status"><p class="coelum-panel-note">Finding today’s highlights…</p></div></section>
      <section class="almanac-card"><h4>Meteor showers</h4>${meteorShowers(d.mid, zone).map((s) => {
        const peakDay = skyDayBounds(s.peak, zone)[0] === d.start;
        const when = skyTimeInput(Math.round(s.peak / 3600) * 3600, zone).replace(' ', ' · about ');
        return `<p class="almanac-shower"><b>${esc(s.name)}${peakDay ? ' · Peaks today' : ''}</b><span>${s.broad ? 'Broad maximum near' : 'Expected peak'} ${esc(when)}</span><span>Moon ${(moonPhase(s.peak).fraction * 100).toFixed(0)}% illuminated at maximum</span></p>`;
      }).join('') || `<p class="coelum-panel-note">${new Date(d.mid * 1000).getUTCFullYear() < 2000 || new Date(d.mid * 1000).getUTCFullYear() > 2100 ? 'Meteor peak estimates are available for 2000–2100.' : 'No major shower active in this guide.'}</p>`}</section>
      </div><dialog class="almanac-dialog" data-almanac-dialog aria-label="Planet visibility details"><div class="almanac-dialog-head"><h4 data-almanac-dialog-title></h4><button type="button" class="coelum-btn coelum-btn-small" data-almanac-dialog-close aria-label="Close planet details">×</button></div><div data-almanac-dialog-body></div></dialog></div>`;
    root.append(wheelRoot);
    root.querySelector('[data-almanac-moon]').append(moonCanvas);
    moonCanvas.setAttribute('aria-label', `${d.phaseName}, ${(d.phase.fraction * 100).toFixed(1)}% illuminated; lunar surface at local midday`);
    moonCanvas.dataset.ready = 'false';
    const moonModel = moonDisk(d.mid, topocentric('moon', d.mid, explorer.place), explorer.place);
    // Reuse the sky's textured surface renderer, including phase and libration.
    Promise.resolve(planetMap('moon')?.ready).then(map => {
      if (currentJob.stop || !root.isConnected || !map?.img) return;
      drawPlanet(moonCanvas, { ...moonModel, terrainOutline: false }, 112, 112, 0, 0, 53, Math.min(window.devicePixelRatio || 1, 2));
      moonCanvas.dataset.ready = 'true';
    }).catch(() => {});
    const dialog = root.querySelector('[data-almanac-dialog]');
    // Native modal focus trapping and Escape must not reach the sky panel.
    dialog.onkeydown = ev => ev.stopPropagation();
    dialog.onclick = ev => {
      if (ev.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) dialog.close();
    };
    const input = root.querySelector('[data-almanac-date]');
    keyboardDate = false;
    const openDateWheels = () => {
      if (keyboardDate || wheelRoot.open) return;
      pendingDate = null;
      wheelRoot.hidden = false; wheelRoot.showModal();
      dateWheels.open(skyTimeInput(date, zone, true));
      input.setAttribute('aria-expanded', 'true');
    };
    input.onclick = openDateWheels;
    input.onblur = () => { keyboardDate = false; input.readOnly = true; };
    input.oninput = () => input.setCustomValidity('');
    input.onkeydown = event => {
      if (!keyboardDate && ['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); openDateWheels(); }
      else if (keyboardDate && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        input.setCustomValidity(''); input.value = skyTimeInput(date, zone).split(' ')[0]; input.blur();
      } else if (keyboardDate && event.key === 'Enter') {
        event.preventDefault(); input.dispatchEvent(new Event('change'));
        if (input.checkValidity()) input.blur();
      }
    };
    root.onclick = (ev) => {
      const planet = ev.target.closest('[data-almanac-planet]');
      if (planet) {
        const body = planet.dataset.almanacPlanet;
        dialog.querySelector('[data-almanac-dialog-title]').textContent = `${title(body)} · visibility`;
        dialog.querySelector('[data-almanac-dialog-body]').replaceChildren(root.querySelector(`[data-almanac-detail="${body}"]`).content.cloneNode(true));
        dialog.showModal();
        return;
      }
      if (ev.target.closest('[data-almanac-dialog-close]')) { dialog.close(); return; }
      const step = ev.target.closest('[data-almanac-step]')?.dataset.almanacStep;
      if (step) {
        const next = Number(step) > 0 ? d.end + 1 : d.start - 1;
        if (validTime(next)) { date = next; render(); root.querySelector(`[data-almanac-step="${step}"]`).focus(); }
      } else if (ev.target.closest('[data-almanac-today]')) { date = Date.now() / 1000; render(); root.querySelector('[data-almanac-today]').focus(); }
      if (ev.target.closest('[data-almanac-date-mode]')) {
        keyboardDate = true; input.readOnly = false; input.focus();
      }
      if (ev.target.closest('[data-almanac-terrain]') && !terrainLoading) {
        terrainLoading = true; terrainError = ''; render();
        Promise.resolve().then(() => explorer.loadAlmanacTerrain()).then(() => {
          if (!explorer.terrainHorizon) terrainError = 'Terrain could not be prepared. Try again from the ground controls.';
        }).catch(e => { terrainError = e.message; }).finally(() => {
          terrainLoading = false;
          if (!job.stop && root.isConnected) render();
        });
      }
      const event = ev.target.closest('[data-almanac-time], [data-almanac-sky-time]');
      if (event) { closeDetails(); explorer.closePanel(); explorer.setTime(Number(event.dataset.almanacTime ?? event.dataset.almanacSkyTime)); explorer.focus(title(event.dataset.body), { fit: true }); }
    };
    input.onchange = () => {
      const parsed = parseSkyInput(`${input.value.trim()} 12:00`, zone);
      const valid = Number.isFinite(parsed) && validTime(parsed);
      input.setCustomValidity(valid ? '' : 'Enter a valid date from −1000 to 3000.');
      if (valid) { date = parsed; render(); root.querySelector('[data-almanac-today]').focus({ preventScroll: true }); } else input.reportValidity();
    };
    // Let the summary paint before the wider event search, which yields
    // between pairs. A replaced page cannot receive stale results.
    setTimeout(async () => {
      if (currentJob.stop || !root.isConnected) return;
      try {
        const [start, end] = almanacNight(d.mid, zone), rows = [];
        for (const body of BODIES) {
          if (currentJob.stop || !root.isConnected) return;
          rows.push({ body, flat: visibilityIntervals(body, start, end, explorer.place), terrain: terrain ? visibilityIntervals(body, start, end, explorer.place, terrain) : null });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (currentJob.stop || !root.isConnected) return;
        root.querySelector('[data-almanac-visibility]').innerHTML = visibilityChart(start, end, rows, t => horizontal('sun', t, explorer.place).alt, zone, terrain);
        layoutCrossingTimes(root);
      } catch {
        if (!currentJob.stop && root.isConnected) root.querySelector('[data-almanac-visibility]').textContent = 'Visibility could not be calculated for this date.';
      }
      if (currentJob.stop || !root.isConnected) return;
      try {
        const events = await dailyHighlights(d.start, d.end, currentJob);
        if (!events || currentJob.stop || !root.isConnected) return;
        root.querySelector('[data-almanac-highlights]').innerHTML = events.map((e) => `<button type="button" class="coelum-event" data-almanac-time="${e.t}" data-body="${e.body}"><b>${esc(e.name)}</b><span>${clock(e.t)} · Show in sky</span>${e.note ? `<small>${esc(e.note)}</small>` : ''}</button>`).join('') || '<p class="coelum-panel-note">No events in the categories covered today.</p>';
      } catch { if (!currentJob.stop && root.isConnected) root.querySelector('[data-almanac-highlights]').textContent = 'Highlights could not be calculated for this date.'; }
    }, 0);
  };
  render();
  root.closest('[data-panel]')?.querySelector('[data-action="close-panel"]')?.focus({ preventScroll: true });
  return () => { if (job) job.stop = true; labelResize.disconnect(); pendingDate = null; if (wheelRoot.open) wheelRoot.close(); wheelRoot.hidden = true; closeDetails(); moonCanvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext(); };
}
