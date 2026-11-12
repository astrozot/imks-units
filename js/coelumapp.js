// Coelum, the sky of iMKS as an app of its own (coelum/index.html): the
// explorer (coelumui.js) over the whole screen, now, at the place last
// chosen, with the events of the sky in a panel of its own; their maps and
// drawings (eventview.js) open in a sheet. It shares iMKS's modules, and on
// the same site its storage: the places and objects looked up, the
// location and the UTC setting, the views chosen in the sheets.
import tzlookup from "./tzlookup.js";
import { formatSkyTime, skyClock, skyTimeZone, deviceTimeZone, validSkyZone } from "./coelumtime.js";
import { mountCoelum } from "./coelumui.js";
import { eclipseTrack, lunarDiagram, occultationTrack } from "./astro.js";
import { mountLunar, mountMap } from "./eventview.js";
import { eventsPanel } from "./eventspanel.js";
import { snapshot } from "./snapshot.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Storage, as iMKS keeps it (keys under "imks."), so the two apps share it
const store = {
  get(key, def) {
    try {
      const v = localStorage.getItem("imks." + key);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, value) {
    try { localStorage.setItem("imks." + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};
const settings = store.get("settings", {});
let timeMode = store.get('coelumTimeZone', 'device');
if (!['device', 'utc', 'location'].includes(timeMode)) timeMode = 'device';
let clockPlace = [51.4769, -0.0005];
const zoneOverrides = store.get('coelumPlaceZones', {});
const placeZoneKey = (p = clockPlace) => p.slice(0, 2).map((x) => x.toFixed(4)).join(',');
const inferredZone = (p = clockPlace) => { const zone = tzlookup(p[0], p[1]); return validSkyZone(zone) ? zone : 'UTC'; };
const clockZone = (p = clockPlace) => timeMode === 'utc' ? 'UTC' : timeMode === 'device' ? deviceTimeZone() : zoneOverrides[placeZoneKey(p)] || inferredZone(p);
const clockWithZone = (t, p = clockPlace, seconds = false) => `${skyClock(t, clockZone(p), seconds)} ${skyTimeZone(t, clockZone(p))}`;
// The stars, objects and places found online (lookup.js), read anew before
// each change, as iMKS may have added some
const lookups = () => {
  const l = store.get("lookups", {});
  return { objects: l.objects || {}, places: l.places || {} };
};

// One saved time convention for the sky, entry, event lists and sheets.
const formatTime = (t) => formatSkyTime(t, clockZone());

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------------------------------------------------------------------
// The sheet, over the sky: the drawings of the events

const sheet = $("#sheet");
let sheetBody = $("#sheet-body"), sheetShare = null, onResize = null;
function openSheet(title, render, share = null) {
  $("#sheet-title").textContent = title;
  sheetShare = share;
  onResize = null;
  $("#sheet-share").hidden = !share;
  // a fresh element, so that listeners added by earlier sheets go away
  const fresh = sheetBody.cloneNode(false);
  sheetBody.replaceWith(fresh);
  sheetBody = fresh;
  sheet.hidden = false;
  render(sheetBody);
}
function closeSheet() {
  sheet.hidden = true;
  sheetBody.innerHTML = "";
  onResize = null;
}
sheet.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-close]")) closeSheet();
  else if (ev.target.closest("#sheet-share")) shareSheet();
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !sheet.hidden) { ev.stopPropagation(); closeSheet(); } }, true);
window.addEventListener("resize", () => { if (onResize && !sheet.hidden) onResize(); });

// The share button: a picture of the drawing, to the system's share menu,
// or saved where there is none
async function shareSheet() {
  const s = sheetShare?.();
  if (!s) return;
  let blob;
  try { blob = await snapshot(s.root, s); } catch { toast("The picture could not be made"); return; }
  const file = new File([blob], `${s.name}.png`, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The host of the sheets (eventview.js): Show in the sky goes to the time
// and the place, centered on the bodies of the event
const sheetHost = (explorer) => ({
  store, get utc() { return clockZone() === 'UTC'; }, toast,
  formatClock: clockWithZone,
  onResize: (fn) => { onResize = fn; },
  sky: async (t, p, focus) => {
    closeSheet();
    explorer.closePanel();
    const here = explorer.place;
    if (Math.abs(p[0] - here[0]) > 1e-4 || Math.abs(p[1] - here[1]) > 1e-4) {
      await explorer.setPlace({ lat: p[0], lon: p[1], h: Number.isFinite(p[2]) ? p[2] : null, name: `${p[0].toFixed(3)}°, ${p[1].toFixed(3)}°` });
    }
    explorer.setTime(t);
    for (const name of focus) if (explorer.focus(name)) break;
  },
});

// An occultation in the sheet: its map, where on the Earth it is seen (as
// occultation() in iMKS), the place's contacts; computed after the sheet
// opens
function openOccultation(x, place, explorer) {
  const head = `<p class="coelum-sheet-when">${esc(formatTime(x.t))}${place ? ` · from ${esc(explorer.placeLabel)}` : ""}</p>`, caption = [`${x.name} behind the Moon, ${formatTime(x.t)}`];
  let view = null;
  openSheet("Occultation", (root) => {
    root.innerHTML = `${head}<p class="coelum-panel-note">Drawing the map…</p>`;
    requestAnimationFrame(() => setTimeout(() => {
      if (!root.isConnected) return;
      const occ = { target: x.target, front: "moon", names: [x.name, "Moon"], covers: x.e ? x.e.covers : x.covers };
      view = mountMap(root, { ...occultationTrack(x.target, "moon", x.e ? x.e.max : x.max), ...(place && { place: place.slice(0, 2) }), occ }, sheetHost(explorer), { head, caption });
    }, 0));
  }, () => view?.share());
}

const KIND = (k) => k[0].toUpperCase() + k.slice(1);
// An eclipse in the sheet: the map of a solar eclipse (computed after the
// sheet opens: it takes a moment), the drawing of a lunar one
function openEvent(kind, x, place, explorer) {
  const host = sheetHost(explorer);
  const title = `${KIND(kind === "solar" && x.l ? x.l.kind : x.e.kind)} ${kind} eclipse`;
  const head = `<p class="coelum-sheet-when">${esc(formatTime(x.t))}${place ? ` · from ${esc(explorer.placeLabel)}` : ""}</p>`, caption = [`${title}, ${formatTime(x.t)}`];
  let view = null;
  openSheet(KIND(title), (root) => {
    if (kind === "lunar") { view = mountLunar(root, lunarDiagram(x.e, place), host, { head, caption }); return; }
    root.innerHTML = `${head}<p class="coelum-panel-note">Drawing the map…</p>`;
    requestAnimationFrame(() => setTimeout(() => {
      if (!root.isConnected) return;
      view = mountMap(root, { ...eclipseTrack(x.e.max), ...(place && { place: place.slice(0, 2) }) }, host, { head, caption });
    }, 0));
  }, () => view?.share());
}

// ---------------------------------------------------------------------
// The sky: now, at the place last chosen here, or else iMKS's location, or
// else Greenwich (then the place panel opens to choose one)

const saved = store.get("coelumPlace", null) || settings.location || null;
const start = saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon) ? saved : null;
const placeOf = (p) => [p.lat, p.lon, Number.isFinite(p.h) ? p.h : 0];
const model = start
  ? { t: Math.round(Date.now() / 1000), place: placeOf(start), label: start.name || `${start.lat.toFixed(3)}°, ${start.lon.toFixed(3)}°` }
  : { t: Math.round(Date.now() / 1000), place: [51.4769, -0.0005, 46], label: "Greenwich" };
const root = $("#coelum");
clockPlace = [...model.place];
const explorer = mountCoelum(root, model, formatTime, {
  standalone: true,
  formatStatusTime: (t) => formatSkyTime(t, clockZone(), false),
  timeMode: () => timeMode,
  timeZone: clockZone,
  onTimeZone: (value) => { timeMode = value; store.set('coelumTimeZone', value); },
  placeTimeZone: () => ({ detected: inferredZone(), override: zoneOverrides[placeZoneKey()] || null }),
  onPlaceTimeZone: (value) => {
    if (value) zoneOverrides[placeZoneKey()] = value; else delete zoneOverrides[placeZoneKey()];
    store.set('coelumPlaceZones', zoneOverrides);
  },
  places: () => lookups().places,
  rememberPlace: (key, place) => { const l = lookups(); l.places[key] = place; store.set("lookups", l); },
  minorBodies: () => Object.values(lookups().objects).filter((o) => o.orbits || o.orbit),
  onPlace: (p, label) => { clockPlace = [...p]; store.set("coelumPlace", { lat: p[0], lon: p[1], h: p[2], name: label }); },
  panels: [eventsPanel({ store, get utc() { return clockZone() === 'UTC'; }, formatTime, formatClock: clockWithZone, opens: "its map or drawing", open: (kind, ...a) => (kind === "occultations" ? openOccultation(...a) : openEvent(kind, ...a)) })],
});
if (!start) $('[data-action="place"]', root).click();

// ---------------------------------------------------------------------
// Offline: the worker of iMKS (sw.js), for this folder. A new version is
// fetched in full before it replaces the cached one; the page reloads to
// it once out of sight. Updates are looked for at most once an hour.

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  const sws = navigator.serviceWorker, hadController = Boolean(sws.controller);
  let pending = false;
  sws.addEventListener("controllerchange", () => {
    if (!hadController) return;
    pending = true;
    if (document.hidden) location.reload();
  });
  sws.register("../sw.js", { scope: "./", updateViaCache: "none" }).then((reg) => {
    const check = () => {
      if (Date.now() - store.get("coelumUpdateCheck", 0) < 3600e3) return;
      reg.update().then(() => store.set("coelumUpdateCheck", Date.now())).catch(() => {});
    };
    check();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && pending) location.reload();
      else if (!document.hidden) check();
    });
  }).catch(() => {});
}
