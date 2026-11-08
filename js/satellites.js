// Artificial satellites of CelesTrak's groups, shared by iMKS and Coelum:
// the space stations and the brightest satellites by default, others on
// request (SAT_GROUPS). The elements (OMM, as JSON) of each group are
// fetched once a day and kept in Cache Storage (imks-data-satellites, left
// alone by the apps' updates), so the sky works offline with the last
// ones; SGP4 (sgp4.js) follows the near-Earth orbits only. Brightness is
// estimated from the standard magnitudes of satmags.js (at 1000 km, half
// lit), or a default of the group.
import { sgp4init } from "./sgp4.js";
import { SAT_MAGS } from "./satmags.js";
import { satellitePosition, equatorial, topocentric } from "./astro.js";

// [key, label, chosen by default, standard magnitude where unknown]; in
// the stations' group, crewed and cargo craft flying alone are bright,
// the small satellites released from the stations faint
const SAT_GROUPS = [
  ["stations", "Space stations", true, 6.5],
  ["visual", "Brightest", true, 4],
  ["science", "Science", false, 6],
  ["amateur", "Amateur radio", false, 6.5],
  ["weather", "Weather", false, 5.5],
];
const groupURL = (g) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=json`;
const CACHE = "imks-data-satellites";
const DAY = 86400e3, HOURS2 = 7200e3;
const CRAFT = /PROGRESS|SOYUZ|DRAGON|CYGNUS|STARLINER|TIANZHOU|SHENZHOU|HTV|MENGZHOU/i;
// common names (CelesTrak's are "ISS (ZARYA)", "CSS (TIANHE)", "HST")
const ALIASES = { iss: 25544, zarya: 25544, tiangong: 48274, css: 48274, tianhe: 48274, hubble: 20580, hst: 20580 };

// names compared as lookup.js does: without case, accents, spaces and
// punctuation
const nameKey = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_'’.()#-]+/g, "").replace(/(^|[a-z/])0+(?=\d)/g, "$1");

// The groups chosen (on this device, for both apps)
function chosenGroups() {
  try {
    const v = JSON.parse(localStorage.getItem("imks.satelliteGroups"));
    if (Array.isArray(v)) return SAT_GROUPS.map(([g]) => g).filter((g) => v.includes(g));
  } catch { /* none stored */ }
  return SAT_GROUPS.filter((g) => g[2]).map(([g]) => g);
}
function chooseGroups(groups) {
  try { localStorage.setItem("imks.satelliteGroups", JSON.stringify(groups)); } catch { /* storage unavailable */ }
  rebuild();
  return loadSatellites();
}

// group → { records, fetched (ms) }; the satellites made of them; the
// state of the last update
const data = new Map();
let list = [], index = new Map(), loading = null, tried = new Set();
const status = { busy: false, error: null };
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(list); };
const onSatellites = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

async function readCache(g) {
  try {
    const r = await (await caches.open(CACHE)).match(groupURL(g));
    return r ? { records: await r.json(), fetched: Number(r.headers.get("x-fetched")) || 0 } : null;
  } catch { return null; }
}
async function fetchGroup(g) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  let records;
  try {
    const res = await fetch(groupURL(g), { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    records = await res.json();
    if (!Array.isArray(records)) throw new Error("no elements");
  } catch (e) {
    throw new Error(`Could not reach CelesTrak (${e.name === "AbortError" ? "timed out" : e.message})`);
  } finally { clearTimeout(timer); }
  const fetched = Date.now();
  try { await (await caches.open(CACHE)).put(groupURL(g), new Response(JSON.stringify(records), { headers: { "content-type": "application/json", "x-fetched": String(fetched) } })); } catch { /* kept for this session */ }
  return { records, fetched };
}

// The satellites of the groups chosen, each once (in the order of the
// groups), for astro.js and the sky: { name (unique: "SL-16 R/B #22285"
// when others have the name), objectName, norad, group, kind, sgp4, epoch,
// std, stdKnown, keys, docked }. Those docked to a station (within 10 km of
// one listed before, now) keep the station's name in docked.
const bodies = new Map();
function rebuild() {
  const seen = new Set(), made = [];
  for (const [g, , , fallback] of SAT_GROUPS) {
    if (!chosenGroups().includes(g) || !data.has(g)) continue;
    for (const omm of data.get(g).records) {
      const n = omm.NORAD_CAT_ID;
      if (seen.has(n) || !(omm.MEAN_MOTION > 1440 / 225)) continue;
      seen.add(n);
      const id = `${n}|${omm.EPOCH}`;
      if (!bodies.has(id)) {
        let sgp4;
        try { sgp4 = sgp4init(omm); } catch { continue; }
        const name = omm.OBJECT_NAME.trim(), parts = /^(.*?)\s*(?:\((.*)\))?$/.exec(name);
        bodies.set(id, {
          objectName: name, norad: n, kind: "satellite", sgp4, epoch: Date.parse(omm.EPOCH + "Z") / 1000,
          std: SAT_MAGS[n] ?? (CRAFT.test(name) ? 3.5 : fallback), stdKnown: n in SAT_MAGS, keys: [name, parts[1], parts[2], `NORAD ${n}`].filter(Boolean),
        });
      }
      made.push({ ...bodies.get(id), group: g });
    }
  }
  const count = new Map();
  for (const s of made) count.set(s.objectName, (count.get(s.objectName) || 0) + 1);
  for (const s of made) s.name = count.get(s.objectName) > 1 ? `${s.objectName} #${s.norad}` : s.objectName;
  // docked: near one before it, now
  const now = Date.now() / 1000, at = made.map((s) => satellitePosition(s, now));
  made.forEach((s, i) => {
    if (s.group !== "stations" || !at[i]) return;
    const host = made.findIndex((o, j) => j < i && at[j] && Math.hypot(...at[j].map((x, k) => x - at[i][k])) < 10);
    if (host >= 0) s.docked = made[host].name;
  });
  list = made;
  index = new Map();
  for (const s of made) for (const k of [s.name, ...s.keys]) if (!index.has(nameKey(k))) index.set(nameKey(k), s);
  for (const [a, n] of Object.entries(ALIASES)) { const s = made.find((o) => o.norad === n); if (s && !index.has(a)) index.set(a, s); }
  notify();
}

// Reads the groups kept, then fetches those a day old (or two hours, when
// asked), each at most once a session unless asked. Resolves to the list.
function loadSatellites({ force = false } = {}) {
  if (loading) return loading;
  loading = (async () => {
    const groups = chosenGroups();
    for (const g of groups) if (!data.has(g)) { const c = await readCache(g); if (c) data.set(g, c); }
    rebuild();
    const stale = groups.filter((g) => {
      const d = data.get(g);
      return (!d || Date.now() - d.fetched > (force ? HOURS2 : DAY)) && (force || !tried.has(g));
    });
    if (stale.length && (typeof navigator === "undefined" || navigator.onLine !== false)) {
      status.busy = true;
      notify();
      for (const g of stale) {
        tried.add(g);
        try { data.set(g, await fetchGroup(g)); status.error = null; } catch (e) { status.error = e.message; }
      }
      status.busy = false;
      rebuild();
    }
    return list;
  })().finally(() => { loading = null; });
  return loading;
}

// The satellites, the one of a name (any of its keys, "NORAD 25544",
// "… #22285" or a common name), and the state of the catalog: the count,
// the oldest fetch of the groups chosen, an update under way, an error
const satelliteList = () => list;
function findSatellite(name) {
  const m = /(?:^(?:norad|catnr)\s*|#\s*)(\d+)\s*$/i.exec(name.trim());
  if (m) return list.find((s) => s.norad === Number(m[1])) || null;
  return index.get(nameKey(name)) || null;
}
function satelliteStatus() {
  const fetched = chosenGroups().map((g) => data.get(g)?.fetched).filter(Boolean);
  return { count: list.filter((s) => !s.docked).length, fetched: fetched.length ? Math.min(...fetched) : null, busy: status.busy, error: status.error };
}

// Sunlit (outside the Earth's shadow, a cylinder, as astro.js's passes)
// and the magnitude then: the standard one at 1000 km and a phase angle of
// 90°, for the distance and the phase of a diffusing sphere. p: the
// geocentric position (km), v: from the place (km), s: toward the Sun
// (unit vectors, equatorial).
function satelliteLight(std, p, v, s) {
  const along = p[0] * s[0] + p[1] * s[1] + p[2] * s[2];
  const lit = along > 0 || Math.hypot(p[0] - along * s[0], p[1] - along * s[1], p[2] - along * s[2]) > 6378.137;
  if (!lit) return { lit, mag: null };
  const d = Math.hypot(...v), phase = Math.acos(Math.max(-1, Math.min(1, -(v[0] * s[0] + v[1] * s[1] + v[2] * s[2]) / d)));
  const f = Math.max(1e-4, Math.sin(phase) + (Math.PI - phase) * Math.cos(phase));
  return { lit, mag: std + 5 * Math.log10(d / 1000) - 2.5 * Math.log10(f) };
}
const RAD = Math.PI / 180;
const unitOf = (ra, dec) => [Math.cos(dec * RAD) * Math.cos(ra * RAD), Math.cos(dec * RAD) * Math.sin(ra * RAD), Math.sin(dec * RAD)];
// the same, of a satellite at the time t from a place
function satelliteMagnitude(body, t, place) {
  const p = satellitePosition(body, t);
  if (!p) return { lit: false, mag: null };
  const sun = equatorial("sun", t), o = topocentric(body, t, place);
  return satelliteLight(body.std, p, unitOf(o.ra, o.dec).map((x) => x * o.dist), unitOf(sun.ra, sun.dec));
}

export { SAT_GROUPS, chosenGroups, chooseGroups, loadSatellites, onSatellites, satelliteList, findSatellite, satelliteStatus, satelliteLight, satelliteMagnitude };
