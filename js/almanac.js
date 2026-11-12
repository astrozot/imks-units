// Civil-day almanac, computed locally with the same ephemerides as the sky.
import { riseSet, horizontal, horizonRefraction, transit, moonPhase, elongation, nextPhase, season, solarEclipse, lunarEclipse, opposition, greatestElongation } from './astro.js';
import { skyDayBounds, skyTimeInput, skyTimeZone, skyClock, parseSkyInput } from './coelumtime.js';
import { planetConjunctions } from './eventspanel.js';
import { setSkyDateInput, openSkyDatePicker, calendarSkyTime } from './skydateinput.js';
import { meteorShowers } from './meteors.js';
export { meteorShowers } from './meteors.js';

const YEAR = 31557600;
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
  let date = Date.now() / 1000, job, extendedDate = false;
  const render = () => {
    // Native date controls may commit a pending change when detached. Stop
    // that blur from recursively replacing the same page during rendering.
    const previousInput = root.querySelector('[data-almanac-date]');
    if (previousInput) previousInput.onchange = null;
    if (job) job.stop = true;
    job = {};
    const currentJob = job, d = dailyAlmanac(date, explorer.place, zone);
    const clock = (t) => skyClock(t, zone), times = (a) => a.length ? a.map(clock).join(' / ') : 'None this day';
    const row = (label, value) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
    const duration = Math.round(d.daylight / 60);
    root.innerHTML = `<div class="almanac-wrap"><nav class="almanac-nav" aria-label="Almanac date"><button type="button" class="coelum-chip" data-almanac-step="-1" aria-label="Previous day">‹</button><input type="date" data-almanac-date aria-label="Almanac date" value="${esc(skyTimeInput(date, zone).split(' ')[0])}" spellcheck="false"><button type="button" class="coelum-chip" data-almanac-step="1" aria-label="Next day">›</button><button type="button" class="coelum-chip" data-almanac-today>Today</button></nav><button type="button" class="coelum-chip coelum-date-mode" data-almanac-date-mode>B.C. / signed year</button>
      <p class="almanac-place">${esc(explorer.placeLabel)}<span>${esc(skyTimeZone(d.mid, zone))}</span></p>
      <div class="almanac-cards"><section class="almanac-card almanac-sun"><h4>Sun</h4><p class="almanac-big">${Math.floor(duration / 60)}h ${String(duration % 60).padStart(2, '0')}m <small>of daylight</small></p><dl>${row('Sunrise', times(d.sun.rise))}${row('Sunset', times(d.sun.set))}${row('Solar noon', d.noon === null ? 'None this day' : clock(d.noon))}</dl>${!d.sun.rise.length && !d.sun.set.length ? `<p class="coelum-panel-note">${d.daylight > 0 ? 'Sun above the horizon all day.' : 'Sun below the horizon all day.'}</p>` : ''}</section>
      <section class="almanac-card almanac-moon"><h4>Moon</h4><p class="almanac-big">${(d.phase.fraction * 100).toFixed(1)}% <small>illuminated</small></p><p class="almanac-phase">${esc(d.phaseName)} · ${d.phase.age.toFixed(1)} days old</p><dl>${row('Moonrise', times(d.moon.rise))}${row('Moonset', times(d.moon.set))}</dl><p class="coelum-panel-note">Phase and age at midday in the selected timezone.</p></section></div>
      <section class="almanac-card"><h4>Twilight</h4><dl>${[['Civil (−6°)', d.civil], ['Nautical (−12°)', d.nautical], ['Astronomical (−18°)', d.astronomical]].map(([label, p]) => row(label, `${times(p.rise)} / ${times(p.set)}`)).join('')}</dl><p class="coelum-panel-note">Morning dawn / evening dusk. Astronomical dusk marks the start of a fully dark sky.</p></section>
      <section class="almanac-card"><h4>On this day</h4><div data-almanac-highlights role="status"><p class="coelum-panel-note">Finding today’s highlights…</p></div></section>
      <section class="almanac-card"><h4>Meteor showers</h4>${meteorShowers(d.mid, zone).map((s) => {
        const peakDay = skyDayBounds(s.peak, zone)[0] === d.start;
        const when = skyTimeInput(Math.round(s.peak / 3600) * 3600, zone).replace(' ', ' · about ');
        return `<p class="almanac-shower"><b>${esc(s.name)}${peakDay ? ' · Peaks today' : ''}</b><span>${s.broad ? 'Broad maximum near' : 'Expected peak'} ${esc(when)}</span><span>Moon ${(moonPhase(s.peak).fraction * 100).toFixed(0)}% illuminated at maximum</span></p>`;
      }).join('') || `<p class="coelum-panel-note">${new Date(d.mid * 1000).getUTCFullYear() < 2000 || new Date(d.mid * 1000).getUTCFullYear() > 2100 ? 'Meteor peak estimates are available for 2000–2100.' : 'No major shower active in this guide.'}</p>`}<p class="coelum-panel-note">Peaks calculated for the selected year from the Sun’s J2000 longitude at each stream’s maximum. Times are approximate: real peaks can shift by hours or days; dust-trail outbursts require separate predictions. Activity windows are approximate. <a href="https://www.imo.net/files/meteor-shower/cal2027.pdf" target="_blank" rel="noopener noreferrer">Source: IMO 2027 calendar ↗</a></p></section>
      <p class="coelum-panel-note">Times use the selected sky timezone and an unobstructed horizon with standard refraction. Terrain and weather can shift observed rise and set times. Highlights cover Moon phases, seasons, eclipses, planetary conjunctions, oppositions and greatest elongations; event times are Earth-centered.</p></div>`;
    const input = root.querySelector('[data-almanac-date]');
    const signed = setSkyDateInput(input, date, zone, { dateOnly: true, extended: extendedDate });
    root.querySelector('[data-almanac-date-mode]').textContent = signed ? 'Use calendar' : 'B.C. / signed year';
    input.onclick = () => openSkyDatePicker(input);
    root.onclick = (ev) => {
      const step = ev.target.closest('[data-almanac-step]')?.dataset.almanacStep;
      if (step) {
        const next = Number(step) > 0 ? d.end + 1 : d.start - 1;
        if (validTime(next)) { date = next; render(); root.querySelector(`[data-almanac-step="${step}"]`).focus(); }
      } else if (ev.target.closest('[data-almanac-today]')) { date = Date.now() / 1000; render(); root.querySelector('[data-almanac-today]').focus(); }
      if (ev.target.closest('[data-almanac-date-mode]')) {
        extendedDate = input.type !== 'text';
        setSkyDateInput(input, extendedDate ? date : calendarSkyTime(date, zone), zone, { dateOnly: true, extended: extendedDate });
        root.querySelector('[data-almanac-date-mode]').textContent = extendedDate ? 'Use calendar' : 'B.C. / signed year';
      }
      const event = ev.target.closest('[data-almanac-time]');
      if (event) { explorer.closePanel(); explorer.setTime(Number(event.dataset.almanacTime)); explorer.focus(title(event.dataset.body), { fit: true }); }
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
        const events = await dailyHighlights(d.start, d.end, currentJob);
        if (!events || currentJob.stop || !root.isConnected) return;
        root.querySelector('[data-almanac-highlights]').innerHTML = events.map((e) => `<button type="button" class="coelum-event" data-almanac-time="${e.t}" data-body="${e.body}"><b>${esc(e.name)}</b><span>${clock(e.t)} · Show in sky</span>${e.note ? `<small>${esc(e.note)}</small>` : ''}</button>`).join('') || '<p class="coelum-panel-note">No events in the categories covered today.</p>';
      } catch { if (!currentJob.stop && root.isConnected) root.querySelector('[data-almanac-highlights]').textContent = 'Highlights could not be calculated for this date.'; }
    }, 0);
  };
  render();
  root.closest('[data-panel]')?.querySelector('[data-action="close-panel"]')?.focus({ preventScroll: true });
  return () => { if (job) job.stop = true; };
}
