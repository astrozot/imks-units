import { createGlobeGL } from './globegl.js';
import { mountMap } from './eventview.js';
import { linesPath } from './eclipsemap.js';
import { canonicalTimezone, timezoneBoundaries, loadTimezoneBoundaries, timezoneAt, timezonesAt } from './timezoneboundaries.js';
import { skyTimeZone } from './coelumtime.js';
const symbol = path => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
export function mountTimezoneMap(root, { apply, close }) {
  root.innerHTML = `<div class="coelum-zone-map-head"><h3>Local timezone</h3><button type="button" class="coelum-btn coelum-wheel-action" data-zone-cancel aria-label="Cancel" title="Cancel">${symbol('m6 6 12 12M18 6 6 18')}</button></div><div class="coelum-zone-map-content"><div class="coelum-zone-map-wrap"><div class="coelum-timezone-globe" data-timezone-map></div><div class="coelum-zone-map-zoom"><button type="button" class="coelum-btn" data-zone-zoom="2" aria-label="Zoom in">+</button><button type="button" class="coelum-btn" data-zone-zoom="0.5" aria-label="Zoom out">−</button><button type="button" class="coelum-btn" data-zone-reset aria-label="Reset globe">↺</button></div></div><div class="coelum-zone-map-overlap" hidden><p>This area has overlapping timezone boundaries. Choose a zone:</p><div role="group" aria-label="Timezones at selected point" data-zone-candidates></div></div><p class="coelum-zone-map-credit"><a href="https://github.com/evansiroky/timezone-boundary-builder" target="_blank" rel="noopener">Timezone Boundary Builder</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · <a href="${new URL('../data/timezones-LICENSE.txt', import.meta.url).href}" target="_blank" rel="noopener">ODbL</a></p></div><div class="coelum-zone-map-actions"><p class="coelum-zone-map-selected" role="status"></p><button type="button" class="coelum-chip" data-reset-place-zone title="Use the observing location’s timezone">Auto</button></div>`;
  const mapRoot = root.querySelector('[data-timezone-map]');
  const preview = root.querySelector('[role="status"]');
  let time, detected, automaticZone, selected, point, observer, globe = null, generation = 0;
  const overlap = root.querySelector('.coelum-zone-map-overlap'), candidates = root.querySelector('[data-zone-candidates]');
  const clearOverlap = () => { overlap.hidden = true; candidates.replaceChildren(); };
  const automatic = root.querySelector('[data-reset-place-zone]');
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
    preview.textContent = skyTimeZone(time, selected);
    preview.title = `${preview.textContent}${automaticZone ? ' · Automatic for the observing location' : ''}`;
    automatic.setAttribute('aria-pressed', String(automaticZone));
    globe?.redraw();
  };
  const select = zone => {
    automaticZone = zone === null;
    selected = zone || detected;
    update(); apply(zone);
  };
  const choose = (p, pickedZones = null) => {
    point = p; clearOverlap();
    const zones = pickedZones ?? timezonesAt(...point);
    if (!zones.length) { preview.textContent = 'No timezone polygon found at this point.'; return; }
    if (zones.length > 1) {
      preview.textContent = 'Choose a timezone for this point.';
      overlap.hidden = false;
      for (const zone of zones) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'coelum-chip';
        button.textContent = zone; button.dataset.zoneCandidate = zone; button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
          select(zone);
          for (const option of candidates.children) option.setAttribute('aria-pressed', String(option === button));
        });
        candidates.append(button);
      }
      globe?.redraw();
      overlap.scrollIntoView({ block: 'nearest' });
      return;
    }
    select(zones[0]);
  };
  for (const button of root.querySelectorAll('[data-zone-zoom]')) button.addEventListener('click', () => globe?.zoom(Number(button.dataset.zoneZoom)));
  root.querySelector('[data-zone-reset]').addEventListener('click', () => globe?.reset());
  automatic.addEventListener('click', () => { clearOverlap(); select(null); point = observer; globe?.setPlace(point, { center: true }); });
  root.querySelector('[data-zone-cancel]').addEventListener('click', close);
  root.addEventListener('cancel', event => { event.preventDefault(); close(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  return {
    async open(options) {
      const request = ++generation; clearOverlap();
      globe?.destroy(); globe = null;
      automatic.disabled = true;
      mapRoot.innerHTML = '<p class="coelum-panel-note">Loading timezone boundaries…</p>';
      ({ time, detected } = options); automaticZone = !options.override;
      observer = options.place.slice(0, 2); selected = options.override || detected; update();
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
      if (automaticZone) selected = detected;
      update(); point = zonePoint();
      automatic.disabled = false;
      globe = mountMap(mapRoot, { place: point || observer, penN: [], penS: [], band: [], center: [] }, {
        store: { get: (_, fallback) => fallback, set: () => {} }, toast: message => { preview.textContent = message; },
      }, { globeOnly: true, pickerDetails: false, onPickPlace: choose, overlay, pickHint: 'tap a place to choose its timezone', immediatePick: true, rendererFactory: (svg, onLost) => createGlobeGL(svg, { boundaries: timezoneBoundaries(), selected: () => canonicalTimezone(selected), onLost }) });
      const svg = mapRoot.querySelector('svg'); svg.tabIndex = 0;
      svg.setAttribute('aria-label', 'Timezone globe. Drag to rotate; pinch or scroll to zoom. Tap a place to choose its timezone.');
      svg.focus({ preventScroll: true });
    },
    destroy() { generation++; globe?.destroy(); globe = null; },
  };
}
