// The Events panel of the sky explorer (coelumui.js), shared by Coelum and
// iMKS: the events after the time of the sky. From its place, the visible
// passes of the satellites (satellites.js) in the next day; the
// occultations by the Moon in the next month (occultations.js) and the
// next solar and lunar eclipses, seen from there or anywhere on the Earth.
// Moon phases, planetary conjunctions and oppositions use geocentric
// times in either scope; a tap frames the body or pair in the local sky.
// Equinoxes and solstices are worldwide events and frame the Sun.
// A pass tapped is shown in the sky; the other events go to the app,
// host.open(kind, event, place or null, explorer): Coelum draws them in a
// sheet, iMKS computes them. host: { store, utc, formatTime, open, opens
// (what a tap on those gives, for the note) }.
import { solarEclipse, solarLocal, lunarEclipse, horizontal, satellitePasses, nextPhase, moonPhase, conjunction, opposition, season } from "./astro.js";
import { satelliteList, satelliteMagnitude, satelliteStatus, onSatellites } from "./satellites.js";
import { OCC_MAG, lunarOccultations } from "./occultations.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const DAY = 86400;
let host = null;

// The passes seen (satellitePasses: sunlit, the Sun 6° or more below the
// horizon), at least PASS_ALT high and as bright as PASS_MAG at their best,
// within hours of u: the satellite, the pass, when it is seen (sunlit and
// PASS_ALT or higher, every 10 s, as in the usual predictions), where, and
// its best magnitude. The
// search yields to the page every few satellites; job.stop ends it.
const PASS_ALT = 10, PASS_MAG = 4.5;
async function satellitePassesSeen(u, place, hours, job) {
  const list = [];
  const sats = satelliteList().filter((s) => !s.docked && Math.abs(u - s.epoch) < 30 * DAY);
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i];
    for (const p of satellitePasses(s, u, place, hours / 24)) {
      if (!p.visible || p.max.alt < PASS_ALT || p.rise.t < u - 600) continue;
      let from = null, to = null, mag = Infinity;
      for (let y = p.rise.t; y <= p.set.t; y += 10) {
        const m = satelliteMagnitude(s, y, place);
        if (!m.lit || horizontal(s, y, place).alt < PASS_ALT) continue;
        from ??= y;
        to = y;
        mag = Math.min(mag, m.mag);
      }
      if (from === null || mag > PASS_MAG) continue;
      // it ends in the Earth's shadow, still high
      const shadow = !satelliteMagnitude(s, to + 10, place).lit && horizontal(s, to + 10, place).alt >= PASS_ALT;
      list.push({ s, p, from, to, mag, shadow, at: [horizontal(s, from, place), horizontal(s, to, place)] });
    }
    job.done = (i + 1) / sats.length;
    if (i % 6 === 5) {
      job.progress?.();
      await new Promise((r) => setTimeout(r, 0));
      if (job.stop) return null;
    }
  }
  return list.sort((a, b) => a.from - b.from);
}
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (az) => COMPASS[Math.round(az / 22.5) % 16];
const clock = (t) => (host.utc ? new Date(t * 1000).toISOString().slice(11, 16) : new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
function passRow(x, i) {
  const shadow = x.shadow ? " into the shadow" : "";
  const how = `${compass(x.at[0].az)} → ${compass(x.at[1].az)}${shadow} · highest ${Math.round(x.p.max.alt)}° · magnitude ${x.mag.toFixed(1).replace("-", "−")}`;
  return `<button type="button" class="coelum-event" data-event="passes" data-index="${i}"><b>${esc(x.s.name)}</b><span>${esc(host.formatTime(x.from))} – ${esc(clock(x.to))}</span><small>${esc(how)}</small></button>`;
}

// An occultation: what, when (in and out, or the greatest), and how: from
// the place, the limbs (dark or bright), how high, the contact not seen;
// the Moon's lit part
const magText = (m) => m.toFixed(1).replace("-", "−");
function occultationRow(x, i) {
  const limb = (lit) => (lit ? "bright" : "dark");
  const sky = (c) => (c.alt <= 0 ? "below the horizon" : c.sun > -0.8 ? "in daylight" : "in twilight");
  const how = x.e
    ? [`magnitude ${magText(x.mag)}`, `in at the ${limb(x.e.litIn)} limb, out at the ${limb(x.e.litOut)}`, `${Math.round((x.in.seen ? x.in : x.out).alt)}° high`,
      !x.in.seen && `disappears ${sky(x.in)}`, !x.out.seen && `reappears ${sky(x.out)}`, `Moon ${Math.round(x.lit * 100)}% lit`].filter(Boolean).join(" · ")
    : `magnitude ${magText(x.mag)} · seen from part of the Earth · Moon ${Math.round(x.lit * 100)}% lit`;
  const when = x.e ? `${host.formatTime(x.e.first)} – ${clock(x.e.last)}` : host.formatTime(x.t);
  return `<button type="button" class="coelum-event" data-event="occultations" data-index="${i}"><b>${esc(x.name)} behind the Moon</b><span>${esc(when)}</span><small>${esc(how)}</small></button>`;
}

// From a place, only the eclipses seen there: the Sun up during some of it
// (its center above −0.833°, with refraction), and for the Moon at some of
// the contacts or in between (−0.8°)
const sunUp = (a) => a !== null && a > -0.833;
function solarEclipses(u, place, n) {
  const list = [];
  for (let k = 0; list.length < n && k < 80; k++) {
    const e = solarEclipse(u);
    if (!e) break;
    u = e.max + DAY;
    if (!place) { list.push({ e, t: e.max }); continue; }
    const l = solarLocal(e.max, place);
    if (l && (sunUp(l.altC1) || sunUp(l.altMax) || sunUp(l.altC4))) list.push({ e, l, t: l.max });
  }
  return { list, next: u };
}
function lunarEclipses(u, place, n) {
  const list = [];
  for (let k = 0; list.length < n && k < 80; k++) {
    const e = lunarEclipse(u);
    if (!e) break;
    u = e.max + DAY;
    if (!place) { list.push({ e, t: e.max }); continue; }
    // the Moon's altitude at the maximum, and whether it is up at some time
    // from P1 to P4 (every 10 minutes and at the contacts)
    const alt = (x) => horizontal("moon", x, place).alt;
    const times = [e.P1, e.U1, e.U2, e.max, e.U3, e.U4, e.P4].filter((x) => x !== null);
    for (let x = e.P1; x < e.P4; x += 600) times.push(x);
    if (times.some((x) => alt(x) > -0.8)) list.push({ e, t: e.max, alt: alt(e.max) });
  }
  return { list, next: u };
}

const KIND = (k) => k[0].toUpperCase() + k.slice(1);
const PLANETS = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];
const PHASES = ["New Moon", "First quarter Moon", "Full Moon", "Last quarter Moon"];
const SEASONS = ["March equinox", "June solstice", "September equinox", "December solstice"];
function equinoxesSolstices(u, place, n) {
  const list = [];
  for (let year = Math.max(-1000, new Date(u * 1000).getUTCFullYear()); year <= 3000 && list.length < n; year++) {
    for (let k = 0; k < SEASONS.length && list.length < n; k++) {
      const t = season(year, k);
      if (t > u) list.push({ name: SEASONS[k], body: "sun", t });
    }
  }
  return { list, next: list.length ? list.at(-1).t + 1 : u };
}
function moonPhases(u, place, n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const next = PHASES.map((name, k) => ({ name, body: "moon", t: nextPhase(u, k * 90) })).sort((a, b) => a.t - b.t)[0];
    list.push(next);
    u = next.t + 1;
  }
  return { list, next: u };
}
function planetOppositions(u, place, n) {
  const list = [];
  // Inner planets never reach opposition. Three years covers Mars's
  // synodic period as well as those of the other outer planets.
  while (list.length < n) {
    const next = PLANETS.slice(2).map((body) => {
      const e = opposition(body, "sun", u, null, 3);
      return e && { body, name: `${KIND(body)} at opposition`, t: e.t };
    }).filter(Boolean).sort((a, b) => a.t - b.t)[0];
    if (!next) break;
    list.push(next);
    u = next.t + 1;
  }
  return { list, next: u };
}
async function planetConjunctions(u, span, place, job) {
  const bodies = ["moon", ...PLANETS], pairs = [];
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) pairs.push([bodies[i], bodies[j]]);
  const list = [], end = u + span;
  for (let i = 0; i < pairs.length; i++) {
    const [body, other] = pairs[i];
    let start = u;
    while (start < end) {
      const e = conjunction(body, other, start, null, (end - start) / 31557600);
      if (!e || e.t >= end) break;
      const heights = place && [body, other].map((b) => horizontal(b, e.t, place).alt);
      // Keep the global event time, but require both centers above the
      // local geometric horizon for the "From here" list.
      if (!heights || heights.every((alt) => alt >= 0)) {
        list.push({ body, other, name: `${KIND(body)}–${KIND(other)} conjunction`, t: e.t, sep: Math.abs(e.sep),
          ...(heights && { alt: (heights[0] + heights[1]) / 2 }),
          ...((body === "moon" || other === "moon") && { lit: moonPhase(e.t).fraction }) });
      }
      start = e.t + 1;
    }
    job.done = (i + 1) / pairs.length;
    job.progress?.();
    await new Promise((r) => setTimeout(r, 0));
    if (job.stop) return null;
  }
  return list.sort((a, b) => a.t - b.t);
}
function skyEventRow(kind, x, i) {
  const at = found.at;
  const altitude = (body) => {
    const alt = horizontal(body, x.t, at).alt;
    return `${KIND(body)} ${alt > 0 ? `${Math.round(alt)}° high` : "below the horizon"}`;
  };
  const how = (kind === "conjunctions"
    ? [`${x.sep.toFixed(2)}° apart (geocentric)`, at && `${Math.round(x.alt)}° high`, x.lit !== undefined && `Moon ${Math.round(x.lit * 100)}% lit`]
    : [at && altitude(x.body)]).filter(Boolean).join(" · ");
  return `<button type="button" class="coelum-event" data-event="${kind}" data-index="${i}"><b>${esc(x.name)}</b><span>${esc(host.formatTime(x.t))}</span>${how ? `<small>${esc(how)}</small>` : ""}</button>`;
}
const percent = (x) => `${(x * 100).toFixed(x > 0.995 && x < 1 ? 1 : 0)}%`;
// a line of the list: what, when (the maximum), and how it is seen
function solarRow(x, i) {
  const { e, l } = x;
  const title = l ? `${KIND(l.kind)} solar eclipse${l.kind !== e.kind ? ` (${e.kind})` : ""}` : `${KIND(e.kind)} solar eclipse`;
  const how = l
    ? `${percent(l.obscuration)} of the Sun covered · ${sunUp(l.altMax) ? `Sun ${Math.round(l.altMax)}° high` : "at sunrise or sunset"}`
    : `magnitude ${e.magnitude.toFixed(3)}`;
  return `<button type="button" class="coelum-event" data-event="solar" data-index="${i}"><b>${esc(title)}</b><span>${esc(host.formatTime(x.t))}</span><small>${esc(how)}</small></button>`;
}
function lunarRow(x, i) {
  const { e } = x;
  const mag = e.umbral > 0 ? `umbral magnitude ${e.umbral.toFixed(3)}` : `penumbral magnitude ${e.penumbral.toFixed(3)}`;
  const how = x.alt === undefined ? mag : `${mag} · ${x.alt > -0.8 ? `Moon ${Math.round(x.alt)}° high` : "the Moon rises or sets during it"}`;
  return `<button type="button" class="coelum-event" data-event="lunar" data-index="${i}"><b>${esc(KIND(e.kind))} lunar eclipse</b><span>${esc(host.formatTime(x.t))}</span><small>${esc(how)}</small></button>`;
}

// The lists found, kept while the time (to the hour), the place, the
// scope and the satellites stay the same; More extends them. The passes
// and the occultations are searched while the panel is open, a span at a
// time (SLOW: the search, its rows, ten shown at a time, More for ten
// more or the next span); the eclipses at once (SEARCHES)
let found = null, renders = 0;
const jobs = {};
const SEARCHES = { solar: [solarEclipses, solarRow, "Solar eclipses"], lunar: [lunarEclipses, lunarRow, "Lunar eclipses"],
  phases: [moonPhases, (x, i) => skyEventRow("phases", x, i), "Moon phases"],
  oppositions: [planetOppositions, (x, i) => skyEventRow("oppositions", x, i), "Planetary oppositions"],
  seasons: [equinoxesSolstices, (x, i) => skyEventRow("seasons", x, i), "Equinoxes and solstices"] };
const SLOW = {
  conjunctions: {
    head: "Conjunctions", span: 30 * DAY, row: (x, i) => skyEventRow("conjunctions", x, i),
    search: planetConjunctions, missing: () => null,
    none: (days) => `None within ${days} days.`,
    note: "Planets with each other and with the Moon, at equal ecliptic longitude as seen from Earth's center. From here: both bodies above the horizon; height is their average. Tap one to see the sky then.",
  },
  passes: {
    head: "Satellite passes", span: DAY, here: true, row: passRow,
    search: (u, span, place, job) => satellitePassesSeen(u, place, span / 3600, job),
    missing: () => (satelliteList().length ? null : satelliteStatus().busy ? "Getting the satellites from CelesTrak…" : "No satellites yet: they come from CelesTrak when online (Layers, Satellites)."),
    none: (days) => `No bright passes seen here within ${days === 1 ? "a day" : `${days} days`}.`,
    note: `Sunlit passes in a dark sky, ${PASS_ALT}° or higher and of magnitude ${PASS_MAG} or brighter (estimated).`,
  },
  occultations: {
    head: "Occultations by the Moon", span: 30 * DAY, row: occultationRow,
    search: (u, span, place, job) => lunarOccultations(u, span / DAY, place, job),
    missing: () => null,
    none: (days) => `None within ${days} days.`,
    note: `Of the planets and of the stars to magnitude ${OCC_MAG}; tap one for its map (where it is seen), and to see it in the sky.`,
  },
};
function renderEvents(body, explorer) {
  const scope = host.store.get("coelumScope", "here");
  const place = explorer.place, from = explorer.time;
  const key = `${scope}|${Math.floor(from / 3600)}|${place.join(",")}|${satelliteStatus().fetched}|${satelliteList().length}`;
  const at = scope === "here" ? place : null, render = ++renders;
  const slow = Object.entries(SLOW).filter(([, k]) => at || !k.here);
  body.innerHTML = `<div class="coelum-seg coelum-event-scope" role="group" aria-label="Where">${[["here", "From here"], ["anywhere", "Anywhere"]].map(([s, label]) => `<button type="button" data-scope="${s}" aria-pressed="${s === scope}">${label}</button>`).join("")}</div>
    <p class="coelum-panel-note">${scope === "here" ? `Seen from ${esc(explorer.placeLabel)}` : "Anywhere on the Earth"}, after ${esc(host.formatTime(from))}. Tap one to see it in the sky, or an eclipse or occultation for ${host.opens}. Moon phases, conjunctions and oppositions use Earth-centered times; local visibility may vary.</p>
    ${[...slow.map(([kind, k]) => [kind, k.head]), ...Object.entries(SEARCHES).map(([kind, [, , head]]) => [kind, head])].map(([kind, head]) => `<h3 class="coelum-events-head">${head}</h3><div class="coelum-event-list" data-list="${kind}"><p class="coelum-panel-note">Searching…</p></div>`).join("")}`;
  const fillSlow = (kind) => {
    const box = body.querySelector(`[data-list="${kind}"]`), x = found?.[kind], k = SLOW[kind];
    if (!box || !x) return;
    const missing = k.missing();
    if (missing) { box.innerHTML = `<p class="coelum-panel-note">${missing}</p>`; return; }
    const rows = x.list.slice(0, x.shown).map(k.row).join("");
    box.innerHTML = (rows || (x.busy ? "" : `<p class="coelum-panel-note">${k.none(x.span / DAY)}</p>`))
      + (x.busy ? `<p class="coelum-panel-note">Searching… ${Math.round(100 * (jobs[kind]?.done || 0))}%</p>` : `<button type="button" class="coelum-chip" data-more="${kind}">More</button>`)
      + (x.busy || !x.list.length ? "" : `<p class="coelum-panel-note">${k.note}</p>`);
  };
  // the next span of a slow list, from start
  const searchSlow = async (kind, start) => {
    jobs[kind] && (jobs[kind].stop = true);
    const x = found[kind], job = jobs[kind] = { done: 0, progress: () => { if (found[kind] === x && body.isConnected) fillSlow(kind); } };
    x.busy = true;
    fillSlow(kind);
    const list = await SLOW[kind].search(start, SLOW[kind].span, at, job);
    if (!list || found[kind] !== x) return;
    x.list.push(...list);
    x.span += SLOW[kind].span;
    x.busy = false;
    if (jobs[kind] === job) jobs[kind] = null;
    if (body.isConnected) fillSlow(kind);
  };
  // (a later rendering replaces this one's lists)
  const fill = () => {
    if (render !== renders) return;
    if (found?.key !== key) {
      for (const j of Object.values(jobs)) if (j) j.stop = true;
      found = { key, at };
      for (const [kind, [search]] of Object.entries(SEARCHES)) found[kind] = search(from, at, 4);
      for (const [kind] of slow) { found[kind] = { list: [], span: 0, busy: false, shown: 10 }; searchSlow(kind, from); }
    }
    for (const [kind] of slow) fillSlow(kind);
    for (const kind of Object.keys(SEARCHES)) {
      const box = body.querySelector(`[data-list="${kind}"]`), rows = found[kind].list.map(SEARCHES[kind][1]).join("");
      if (box) box.innerHTML = (rows || `<p class="coelum-panel-note">None seen here in the next decades.</p>`) + (found[kind].list.length ? `<button type="button" class="coelum-chip" data-more="${kind}">More</button>` : "");
    }
  };
  // the search after the panel is drawn
  if (found?.key === key) fill(); else requestAnimationFrame(() => setTimeout(fill, 0));
  body.onclick = (ev) => {
    const s = ev.target.closest("[data-scope]")?.dataset.scope;
    if (s) { host.store.set("coelumScope", s); renderEvents(body, explorer); return; }
    const more = ev.target.closest("[data-more]")?.dataset.more;
    if (more in SLOW) {
      // ten more of those found, or the next span
      const x = found[more];
      x.shown += 10;
      if (x.shown - 10 < x.list.length) fillSlow(more); else searchSlow(more, from + x.span);
      return;
    }
    if (more) {
      const [search] = SEARCHES[more], next = search(found[more].next, found.at, 4);
      found[more] = { list: [...found[more].list, ...next.list], next: next.next };
      fill();
      return;
    }
    const row = ev.target.closest("[data-event]"), kind = row?.dataset.event, x = row && found[kind].list[Number(row.dataset.index)];
    if (kind === "passes") showPass(x, explorer);
    else if (["phases", "conjunctions", "oppositions", "seasons"].includes(kind)) {
      explorer.closePanel();
      explorer.setTime(x.t);
      if (kind === "conjunctions") explorer.focusPair(KIND(x.body), KIND(x.other));
      else explorer.focus(KIND(x.body), { fit: true });
    }
    else if (kind) host.open(kind, x, found.at, explorer);
  };
}

// A pass in the sky: from when it is seen, the satellite selected and
// centered, the time at its own pace (press play to follow it)
function showPass(x, explorer) {
  explorer.closePanel();
  explorer.setSpeed(1);
  explorer.setTime(x.from);
  explorer.focus(x.s.name);
}

const EVENTS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17 5 8.5 0 0 0 0-17z" fill="currentColor"/></svg>';

// The panel, for mountCoelum's panels; a new catalog of satellites draws
// the passes again, if the panel is open
let shown = null;
function eventsPanel(h) {
  host = h;
  return { key: "events", label: "Events", icon: EVENTS_ICON, render: (body, explorer) => { shown = { body, explorer }; renderEvents(body, explorer); } };
}
onSatellites(() => {
  const panel = shown?.body.closest("[data-panel]");
  if (shown?.body.isConnected && panel && !panel.hidden && !jobs.passes) renderEvents(shown.body, shown.explorer);
});

export { eventsPanel, moonPhases, planetConjunctions, planetOppositions, equinoxesSolstices };
