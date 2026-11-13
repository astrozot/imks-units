// Events of a planet's moons, using the same limb-contact calculation
// as iMKS's moonevents(). Search a day at a time, yielding between moons.
import { moonEvents } from "./astro.js";
import { MOONS } from "./moons.js";

const DAY = 86400;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LABEL = { transit: "transit", shadow: "shadow transit", eclipsed: "eclipse", occulted: "occultation" };
const FULL = { transit: "Fully on disk", occulted: "Fully hidden", eclipsed: "Total eclipse", shadow: "Umbra fully on disk" };

async function planetMoonEvents(planet, from, days = 1, job = {}) {
  const names = Object.keys(MOONS[planet]?.moons || {}), list = [];
  for (let i = 0; i < names.length; i++) {
    if (job.stop) return null;
    const moon = names[i];
    for (const event of moonEvents(moon, from, days)) {
      const [kind, begin, end] = event;
      list.push({ moon, kind, begin, end, contacts: event.contacts, errors: event.errors, t: (begin + end) / 2 });
    }
    job.done = (i + 1) / names.length;
    job.progress?.();
    await new Promise((r) => setTimeout(r, 0));
  }
  return job.stop ? null : list.sort((a, b) => a.begin - b.begin || a.moon.localeCompare(b.moon) || a.kind.localeCompare(b.kind));
}

function moonEventsPanel(body, { formatTime, onSelect, onClose }) {
  let state = null, job = null;
  const close = () => {
    if (job) job.stop = true;
    state = job = null;
    body.hidden = true;
    onClose();
  };
  const render = () => {
    if (!state) return;
    const s = state;
    const full = (e) => e.contacts.C2 === null ? '' : `<small>${FULL[e.kind]}: ${esc(formatTime(e.contacts.C2))} – ${esc(formatTime(e.contacts.C3))}</small>`;
    body.innerHTML = `<button type="button" class="coelum-btn coelum-btn-small coelum-panel-close" data-moon-events-close aria-label="Close moon events">×</button>
      <h3>Events of ${esc(s.planet[0].toUpperCase() + s.planet.slice(1))}'s moons</h3>
      <p class="coelum-panel-note">After ${esc(formatTime(s.from))}. First to last contact, as seen from Earth's center. Eclipses and shadows include the penumbra. Tap an event to show the system at its midpoint.</p>
      <div class="coelum-event-list">${s.list.slice(0, s.shown).map((e, i) => `<button type="button" class="coelum-event" data-moon-event="${i}"><b>${esc(e.moon)} ${LABEL[e.kind]}</b><span>${esc(formatTime(e.begin))} – ${esc(formatTime(e.end))}</span>${e.begin < s.from ? '<small>Already in progress</small>' : ''}${full(e)}</button>`).join("")}
      ${s.busy ? `<p class="coelum-panel-note" role="status">Searching… ${Math.round(100 * (job?.done || 0))}%</p>` : s.error ? `<p class="coelum-panel-note" role="status">${esc(s.error)}</p>` : `${s.list.length ? '' : `<p class="coelum-panel-note">None within ${s.days === 1 ? 'a day' : `${s.days} days`}.</p>`}<button type="button" class="coelum-chip" data-moon-events-more>More</button>`}</div>`;
  };
  const search = async () => {
    const s = state, current = job = { done: 0, progress: render };
    s.busy = true;
    render();
    let list;
    try { list = await planetMoonEvents(s.planet, s.from + s.days * DAY, 1, current); }
    catch (error) {
      if (state === s && job === current) { s.error = error.message; s.busy = false; job = null; render(); }
      return;
    }
    if (!list || state !== s || job !== current) return;
    // A long event can appear in consecutive daily searches.
    for (const e of list) if (!s.list.some((p) => p.moon === e.moon && p.kind === e.kind && Math.abs(p.begin - e.begin) < 1)) s.list.push(e);
    s.list.sort((a, b) => a.begin - b.begin || a.moon.localeCompare(b.moon) || a.kind.localeCompare(b.kind));
    s.days++;
    s.busy = false;
    job = null;
    render();
  };
  body.onclick = (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('[data-moon-events-close]')) { close(); return; }
    if (ev.target.closest('[data-moon-events-more]')) {
      if (!state || state.busy) return;
      const loaded = state.shown < state.list.length;
      state.shown += 10;
      if (loaded) render(); else search();
      return;
    }
    const row = ev.target.closest('[data-moon-event]'), event = row && state?.list[Number(row.dataset.moonEvent)];
    if (event) { close(); onSelect(event); }
  };
  return {
    close,
    get isOpen() { return !body.hidden; },
    open(planet, from) {
      close();
      state = { planet, from, days: 0, list: [], shown: 10, busy: false };
      body.hidden = false;
      search();
    },
  };
}

export { planetMoonEvents, moonEventsPanel };
