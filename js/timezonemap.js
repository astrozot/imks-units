import { createGlobeGL } from './globegl.js';
import { mountMap } from './eventview.js';
import { linesPath } from './eclipsemap.js';
import { canonicalTimezone, timezoneBoundaries, loadTimezoneBoundaries, timezoneAt, timezonesAt } from './timezoneboundaries.js';
import { skyTimeZone, validSkyZone } from './coelumtime.js';
const symbol = path => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
export function mountTimezoneMap(root, { apply, close }) {
  root.innerHTML = `<div class="coelum-zone-map-head"><h3>Local timezone</h3></div><div class="coelum-zone-map-content"><div class="coelum-zone-map-wrap"><div class="coelum-timezone-globe" data-timezone-map></div><div class="coelum-zone-map-zoom"><button type="button" class="coelum-btn" data-zone-zoom="2" aria-label="Zoom in">+</button><button type="button" class="coelum-btn" data-zone-zoom="0.5" aria-label="Zoom out">−</button><button type="button" class="coelum-btn" data-zone-reset aria-label="Reset globe">↺</button></div></div><p class="coelum-zone-map-hint">Drag to turn the Earth; pinch or scroll to zoom. Tap a place, then use ✓ to apply or × to cancel.</p><div class="coelum-zone-map-overlap" hidden><p>This area has overlapping timezone boundaries. Choose a zone:</p><div role="group" aria-label="Timezones at selected point" data-zone-candidates></div></div><label class="coelum-time-zone" data-place-zone-row><span>Timezone</span><span class="coelum-location-zone-controls"><input type="text" data-place-zone aria-label="Location timezone" autocomplete="off" spellcheck="false" placeholder="Europe/Rome or UTC+02:00"><button type="button" class="coelum-chip" data-reset-place-zone>Automatic</button></span></label><datalist></datalist><p class="coelum-zone-map-credit"><a href="https://github.com/evansiroky/timezone-boundary-builder" target="_blank" rel="noopener">Timezone Boundary Builder</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · <a href="${new URL('../data/timezones-LICENSE.txt', import.meta.url).href}" target="_blank" rel="noopener">ODbL</a></p></div><div class="coelum-zone-map-actions"><p class="coelum-zone-map-selected" role="status"></p><div class="coelum-zone-map-buttons"><button type="button" class="coelum-btn coelum-wheel-action" data-zone-cancel aria-label="Cancel" title="Cancel">${symbol('m6 6 12 12M18 6 6 18')}</button><button type="button" class="coelum-btn coelum-wheel-action coelum-wheel-confirm" data-zone-done aria-label="Done" title="Done">${symbol('m5 12 4 4L19 6')}</button></div></div>`;
  const mapRoot = root.querySelector('[data-timezone-map]');
  const input = root.querySelector('[data-place-zone]'), list = root.querySelector('datalist'), preview = root.querySelector('[role="status"]');
  list.id = `${root.id}-zones`; input.setAttribute('list', list.id);
  for (const zone of Intl.supportedValuesOf?.('timeZone') || ['Europe/Rome', 'America/New_York', 'Asia/Tokyo']) {
    const option = document.createElement('option'); option.value = zone; list.append(option);
  }
  let time, detected, draft, selected, point, observer, globe = null, generation = 0, ready = false;
  const overlap = root.querySelector('.coelum-zone-map-overlap'), candidates = root.querySelector('[data-zone-candidates]');
  const clearOverlap = () => { overlap.hidden = true; candidates.replaceChildren(); };
  const done = root.querySelector('[data-zone-done]'), automatic = root.querySelector('[data-reset-place-zone]');
  const overlay = (P, view, width, height) => {
    const data = timezoneBoundaries();
    if (!data) return '';
    const { lines, byZone } = data;
    return `<path class="map-timezones" d="${linesPath(lines, P, false, [width, height])}"/><path class="map-timezone-selected" d="${linesPath(byZone.get(canonicalTimezone(selected)) || [], P, false, [width, height])}"/>`;
  };
  const zonePoint = () => {
    const observed = timezoneAt(observer[0], observer[1]);
    return observed && canonicalTimezone(observed) === canonicalTimezone(selected) ? observer : timezoneBoundaries()?.points.get(canonicalTimezone(selected)) || null;
  };
  const update = () => {
    selected = input.value.trim();
    if (!validSkyZone(selected)) return false;
    input.setCustomValidity('');
    preview.textContent = `${skyTimeZone(time, selected)}${draft === null ? ' · Automatic for the observing location' : ''}`;
    globe?.redraw(); return true;
  };
  const choose = (p, pickedZones = null) => {
    point = p; clearOverlap();
    const zones = pickedZones ?? timezonesAt(...point);
    if (!zones.length) { preview.textContent = 'No timezone polygon found at this point.'; return; }
    if (zones.length > 1) {
      input.value = ''; selected = ''; draft = ''; done.disabled = true;
      preview.textContent = 'Choose a timezone for this point.';
      overlap.hidden = false;
      for (const zone of zones) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'coelum-chip';
        button.textContent = zone; button.dataset.zoneCandidate = zone; button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
          input.value = zone; draft = zone; update(); done.disabled = false;
          for (const option of candidates.children) option.setAttribute('aria-pressed', String(option === button));
        });
        candidates.append(button);
      }
      globe?.redraw();
      overlap.scrollIntoView({ block: 'nearest' });
      return;
    }
    input.value = zones[0]; draft = zones[0]; done.disabled = false; update();
  };
  for (const button of root.querySelectorAll('[data-zone-zoom]')) button.addEventListener('click', () => globe?.zoom(Number(button.dataset.zoneZoom)));
  root.querySelector('[data-zone-reset]').addEventListener('click', () => globe?.reset());
  input.addEventListener('input', () => { input.setCustomValidity(''); draft = input.value.trim(); clearOverlap(); if (ready) done.disabled = false; });
  input.addEventListener('change', () => { if (update()) { point = zonePoint(); globe?.setPlace(point, { center: true }); } });
  root.querySelector('[data-reset-place-zone]').addEventListener('click', () => { clearOverlap(); done.disabled = false; draft = null; input.value = detected; update(); point = observer; globe?.setPlace(point, { center: true }); });
  root.querySelector('[data-zone-cancel]').addEventListener('click', close);
  root.querySelector('[data-zone-done]').addEventListener('click', () => {
    if (!update()) { input.setCustomValidity('Enter an IANA timezone such as Europe/Rome, or UTC+02:00.'); input.reportValidity(); return; }
    apply(draft === null ? null : selected); close();
  });
  root.addEventListener('cancel', event => { event.preventDefault(); close(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  return {
    async open(options) {
      const request = ++generation; ready = false; clearOverlap();
      globe?.destroy(); globe = null;
      done.disabled = input.disabled = automatic.disabled = true;
      mapRoot.innerHTML = '<p class="coelum-panel-note">Loading timezone boundaries…</p>';
      ({ time, detected } = options); draft = options.override || null;
      observer = options.place.slice(0, 2); input.value = draft || detected; update();
      try { await loadTimezoneBoundaries(); }
      catch {
        if (request === generation && !root.hidden) {
          mapRoot.innerHTML = '<p class="coelum-panel-note">Unable to load timezone boundaries. Close and reopen to try again.</p>';
          preview.textContent = '';
        }
        return;
      }
      if (request !== generation || root.hidden) return;
      detected = timezoneAt(...observer) || detected;
      input.value = draft || detected; update(); point = zonePoint();
      ready = true; done.disabled = input.disabled = automatic.disabled = false;
      globe = mountMap(mapRoot, { place: point || observer, penN: [], penS: [], band: [], center: [] }, {
        store: { get: (_, fallback) => fallback, set: () => {} }, toast: message => { preview.textContent = message; },
      }, { globeOnly: true, pickerDetails: false, onPickPlace: choose, overlay, pickHint: 'tap a place to choose its timezone', immediatePick: true, rendererFactory: (svg, onLost) => createGlobeGL(svg, { boundaries: timezoneBoundaries(), selected: () => canonicalTimezone(selected), onLost }) });
      const svg = mapRoot.querySelector('svg'); svg.tabIndex = 0;
      svg.setAttribute('aria-label', 'Timezone globe. Drag to rotate; pinch or scroll to zoom. Tap a place to choose its timezone.');
      svg.focus({ preventScroll: true });
    },
    destroy() { ready = false; generation++; globe?.destroy(); globe = null; },
  };
}
