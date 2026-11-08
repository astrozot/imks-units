// Stars, deep-sky objects, minor planets, comets, artificial satellites and
// places by name: first the built-in ones (catalog.js, minorplanets.js),
// then those found online before and kept (env.lookups); otherwise a
// LookupError, which the app answers by looking the name up (fetchObject,
// fetchPlace) and evaluating again. Online: comets from the Minor Planet
// Center's file of their orbits, minor planets from its orbit search,
// satellites from CelesTrak, stars and other objects from SIMBAD through
// Sesame (CDS), places from OpenStreetMap (Nominatim) with their elevation
// from Open-Meteo.

import { UnitError } from "./units.js";
import { STARS, DEEP, CITIES } from "./catalog.js";
import { CHART_STARS } from "./stardata.js";
import { EPOCHS, MINOR_PLANETS } from "./minorplanets.js";
import { sgp4init } from "./sgp4.js";
import { findSatellite } from "./satellites.js";

// A name not known yet, or a satellite whose elements are old (refresh):
// kind "object" or "place"
class LookupError extends UnitError {
  constructor(kind, name, message, refresh = false) {
    super(message);
    this.lookup = { kind, name, ...(refresh && { refresh }) };
  }
}

const plain = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// names compared without case, accents, spaces and leading zeros of
// numbers: "M 31" = "m31", "NGC 0224" = "ngc224", "São Paulo" = "sao paulo"
const key = (s) => plain(s).replace(/[\s_'’.()-]+/g, "").replace(/(^|[a-z/])0+(?=\d)/g, "$1");
const placeKey = (s) => plain(s).replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();

// Satellites known by a common name: their NORAD numbers (the elements
// always come from CelesTrak)
const SATELLITES = { iss: 25544, zarya: 25544, hubble: 20580, hst: 20580, tiangong: 48274, css: 48274, tianhe: 48274 };

// Greek letters spelled out and as the IAU abbreviates them
const GREEK = { α: ["alpha", "alf"], β: ["beta", "bet"], γ: ["gamma", "gam"], δ: ["delta", "del"], ε: ["epsilon", "eps"], ζ: ["zeta", "zet"], η: ["eta"], θ: ["theta", "tet"], ι: ["iota", "iot"], κ: ["kappa", "kap"], λ: ["lambda", "lam"], μ: ["mu"], ν: ["nu"], ξ: ["xi", "ksi"], ο: ["omicron", "omi"], π: ["pi"], ρ: ["rho"], σ: ["sigma", "sig"], τ: ["tau"], υ: ["upsilon", "ups"], φ: ["phi"], χ: ["chi"], ψ: ["psi"], ω: ["omega", "ome"] };

// objects: stars { name, ra, dec, pmra, pmdec, plx, rv, mag, kind },
// minor planets { name, kind, H, G, orbits }
let objects = null;
function objectTable() {
  if (objects) return objects;
  objects = new Map();
  for (const [name, ra, dec, pmra, pmdec, plx, rv, mag] of STARS) objects.set(key(name), { name, ra, dec, pmra, pmdec, plx, rv, mag, kind: "star" });
  for (const [names, ra, dec, mag, kind] of DEEP) {
    const o = { name: names.length > 2 ? `${names[0]} (${names[2]})` : names[0], ra, dec, pmra: 0, pmdec: 0, plx: 0, rv: 0, mag, kind };
    for (const n of names) if (!objects.has(key(n))) objects.set(key(n), o);
  }
  // the stars of the sky chart (stardata.js), to about magnitude 6.5, by
  // their designations (Bayer, Flamsteed, HIP, HD, HR), a Bayer letter
  // also spelled out or abbreviated (φ Sgr, phi Sgr; α Sco, alf Sco) and without
  // its superscript; named by the first, as in the chart
  for (const [hip, ra, dec, mag, , , pmra, pmdec, plx, proper, names] of CHART_STARS) {
    const designations = [...names ? names.split("|") : [], ...hip ? [`HIP ${hip}`] : []];
    const o = { name: proper || designations[0], ra, dec, pmra, pmdec, plx, rv: 0, mag, kind: "star" };
    for (const d of [proper, ...designations]) {
      if (!d) continue;
      const bare = d.replace(/[⁰-⁹¹²³]+/g, "");
      const spelled = /^[α-ω]/.test(bare) ? GREEK[bare[0]].map((g) => g + bare.slice(1)) : [];
      for (const n of [d, bare, ...spelled]) if (!objects.has(key(n))) objects.set(key(n), o);
    }
  }
  // by name, number and both; a star keeps its name
  for (const [n, name, H, G, rows] of MINOR_PLANETS) {
    const orbits = rows.map(([q, e, i, node, peri, tp], k) => [EPOCHS[k], q, e, i, node, peri, EPOCHS[k] + tp]);
    const o = { name: name ? `${n} ${name}` : `(${n})`, kind: "minor planet", H, G, orbits };
    for (const k of [String(n), `(${n})`, `${n} ${name}`, name]) if (k && !objects.has(key(k))) objects.set(key(k), o);
  }
  return objects;
}

// places: { name, lat, lon, h }, by name and by "name, country"
let places = null;
function placeTable() {
  if (places) return places;
  places = new Map();
  for (const line of CITIES.trim().split("\n")) {
    const [name, ascii, cc, lat, lon, h] = line.split("|");
    const p = { name: `${name}, ${cc}`, lat: Number(lat), lon: Number(lon), h: Number(h) };
    // the largest city first: it keeps the bare name
    for (const n of new Set([name, ascii || name])) {
      if (!places.has(placeKey(n))) places.set(placeKey(n), p);
      places.set(placeKey(`${n}, ${cc}`), p);
    }
  }
  return places;
}

// Places whose names begin with (then contain) the query: the cities and
// the places found online before (extra: {key: place})
function searchPlaces(query, extra = {}, limit = 12) {
  const q = placeKey(query);
  if (!q) return [];
  const seen = new Set(), out = [];
  for (const [k, p] of [...Object.entries(extra), ...placeTable()]) {
    if (seen.has(p) || !k.includes(q)) continue;
    seen.add(p);
    out.push({ ...p, rank: k.startsWith(q) ? 0 : 1 });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

// the key of a satellite by its NORAD number: "NORAD 25544", a name of
// the catalog with it ("SL-16 R/B #22285"), or a common name; null for
// other names
function satelliteKey(name) {
  const m = /(?:^(?:norad|catnr)\s*#?\s*|#\s*)(\d+)$/i.exec(name.trim());
  const n = m ? Number(m[1]) : SATELLITES[key(name)];
  return n ? `norad${n}` : null;
}

// A satellite kept: its elements (OMM), when they were fetched; the body
// for astro.js, made once
const satBodies = new WeakMap();
function satelliteBody(r) {
  if (!satBodies.has(r)) {
    let sgp4;
    try { sgp4 = sgp4init(r.omm); } catch (e) { throw new UnitError(`${r.name}: ${e.message}`); }
    satBodies.set(r, { name: r.name, kind: "satellite", norad: r.omm.NORAD_CAT_ID, sgp4, epoch: Date.parse(r.omm.EPOCH + "Z") / 1000 });
  }
  return satBodies.get(r);
}

// env.lookups: { objects: {key: object}, places: {key: place} }, kept by
// the app; env.refresh, while the app evaluates a line typed: the
// elements of a satellite older than a day and fetched over two hours ago
// are fetched again. The built-in objects first, then the satellites of
// the catalog (satellites.js, updated daily), then those found online.
function findObject(env, name) {
  const k = satelliteKey(name) || key(name);
  const builtin = objectTable().get(k);
  if (builtin) return builtin;
  const sat = findSatellite(name);
  if (sat) return sat;
  const o = env.lookups?.objects?.[k];
  if (o?.omm) {
    const now = Date.now();
    if (env.refresh && now - Date.parse(o.omm.EPOCH + "Z") > 86400e3 && now - o.fetched > 7200e3) {
      throw new LookupError("object", name, `Old elements of ${o.name}: press = to update them`, true);
    }
    return satelliteBody(o);
  }
  if (o) return o;
  throw new LookupError("object", name, `Unknown object "${name}": press = to look it up online`);
}

function findPlace(env, name) {
  const k = placeKey(name);
  const p = placeTable().get(k) || env.lookups?.places?.[k];
  if (p) return p;
  throw new LookupError("place", name, `Unknown place "${name}": press = to look it up online (OpenStreetMap)`);
}

// ---------------------------------------------------------------------
// Online (the app only)

// (as Aladin Lite, in the browser: CDS allows other origins)
const SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?";
const COMETS = "https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt";
const MPC = "https://minorplanetcenter.net/web_service/search_orbits?json=1&";
const CELESTRAK = "https://celestrak.org/NORAD/elements/gp.php?FORMAT=json&";

async function fetchText(url, ms = 10000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "timed out" : e.message);
  } finally {
    clearTimeout(timer);
  }
}
// a service that cannot be reached
const unreachable = (service, e) => new Error(`Could not reach ${service} (${e.message})`);

// From Sesame's XML: the first resolver with a position; the proper
// motion, parallax and radial velocity where SIMBAD has them. Its plain
// text has the position only, on a line %J ra dec
function parseSesame(xml, name) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const res = [...doc.getElementsByTagName("Resolver")].find((r) => r.getElementsByTagName("jradeg").length);
  if (!res) {
    const j = /^%J\s+([-+\d.]+)\s+([-+\d.]+)/m.exec(xml);
    return j && { name, ra: Number(j[1]), dec: Number(j[2]), pmra: 0, pmdec: 0, plx: 0, rv: 0, mag: null, kind: "object" };
  }
  const get = (tag, inner) => {
    const e = res.getElementsByTagName(tag)[0];
    const x = e && (inner ? e.getElementsByTagName(inner)[0] : e);
    const v = x ? Number(x.textContent) : NaN;
    return Number.isFinite(v) ? v : 0;
  };
  const vmag = [...res.getElementsByTagName("mag")].find((m) => m.getAttribute("band") === "V");
  const v = vmag?.getElementsByTagName("v")[0];
  const oname = res.getElementsByTagName("oname")[0]?.textContent.replace(/\s+/g, " ").trim();
  return {
    name: oname && key(oname) !== key(name) ? `${name} (${oname})` : name,
    ra: get("jradeg"), dec: get("jdedeg"), pmra: get("pmRA"), pmdec: get("pmDE"), plx: get("plx", "v"), rv: get("Vel", "v"),
    mag: v ? Number(v.textContent) : null, kind: res.getElementsByTagName("otype")[0]?.textContent || "object",
  };
}

async function simbad(name) {
  let text;
  try { text = await fetchText(SESAME + encodeURIComponent(name), 15000); } catch (e) { throw unreachable("SIMBAD", e); }
  return parseSesame(text, name);
}

// The comets of the MPC's file (fixed columns), read once:
// { name, keys, kind, M1, K, orbits }
const jdOf = (y, m, d) => {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045.5;
};
let comets = null;
async function cometList() {
  if (comets) return comets;
  let text;
  try { text = await fetchText(COMETS, 20000); } catch (e) { throw unreachable("the Minor Planet Center", e); }
  comets = [];
  for (const line of text.split("\n")) {
    if (line.length < 103) continue;
    const col = (a, b) => line.slice(a - 1, b).trim();
    const tp = jdOf(+col(15, 18), +col(20, 21), Math.floor(+col(23, 29))) + (+col(23, 29) % 1);
    const ep = col(82, 89), epoch = ep ? jdOf(+ep.slice(0, 4), +ep.slice(4, 6), +ep.slice(6, 8)) : tp;
    const name = col(103, 158);
    // "1P/Halley": 1P, Halley; "C/2023 A3 (Tsuchinshan-ATLAS)": C/2023 A3,
    // Tsuchinshan-ATLAS
    const m = /^([^/(]+\/[^(]*?)\s*(?:\((.*)\))?$/.exec(name), keys = [name];
    if (m) {
      const [, des, paren] = m;
      keys.push(des);
      if (paren) keys.push(paren);
      const p = /^(\d+[PDI])\/(.+)$/.exec(des);
      if (p) keys.push(p[1], p[2]);
    }
    comets.push({
      name, keys: keys.map(key), kind: "comet", M1: +col(92, 95), K: 2.5 * +col(97, 100),
      orbits: [[epoch, +col(31, 39), +col(42, 49), +col(72, 79), +col(62, 69), +col(52, 59), tp]],
    });
  }
  return comets;
}
// a comet by designation or name; of those with the name, the one whose
// perihelion is nearest to now
async function comet(name) {
  const k = key(name), now = Date.now() / 86400000 + 2440587.5;
  const found = (await cometList()).filter((c) => c.keys.includes(k));
  found.sort((a, b) => Math.abs(a.orbits[0][6] - now) - Math.abs(b.orbits[0][6] - now));
  if (!found.length) return null;
  const { keys, ...c } = found[0];
  return c;
}

// A minor planet from the MPC's orbit search: by number, designation or
// name
async function minorPlanet(name) {
  const n = name.trim().replace(/^\((\d+)\)$/, "$1");
  const q = /^\d+$/.test(n) ? `number=${n}` : /^\d{4}\s*[A-Z]{2}\d*$/i.test(n) ? `designation=${encodeURIComponent(n.replace(/^(\d{4})\s*/, "$1 ").toUpperCase())}` : `name=${encodeURIComponent(n)}`;
  let list;
  try { list = JSON.parse(await fetchText(MPC + q)); } catch (e) { throw unreachable("the Minor Planet Center", e); }
  if (!Array.isArray(list) || !list.length) return null;
  const o = list.find((x) => x.name && key(x.name) === key(n)) || list[0];
  const num = Number(o.number), H = Number(o.absolute_magnitude), G = o.phase_slope === null || o.phase_slope === undefined ? 0.15 : Number(o.phase_slope);
  return {
    name: num ? `${num} ${o.name || o.designation || ""}`.trim() : o.designation || n, kind: "minor planet", H: Number.isFinite(H) ? H : 99, G,
    orbits: [[Number(o.epoch_jd), Number(o.perihelion_distance), Number(o.eccentricity), Number(o.inclination), Number(o.ascending_node),
      Number(o.argument_of_perihelion), Number(o.perihelion_date_jd)]],
  };
}

// A satellite from CelesTrak, by NORAD number or name: the name itself,
// before or inside its parentheses ("ISS (ZARYA)")
async function satellite(name, catnr = null) {
  let text;
  try { text = await fetchText(CELESTRAK + (catnr ? `CATNR=${catnr}` : `NAME=${encodeURIComponent(name.trim())}`)); } catch (e) {
    // "No GP data found"
    if (e.message === "HTTP 404") return null;
    throw unreachable("CelesTrak", e);
  }
  let list;
  try { list = JSON.parse(text); } catch { return null; }
  const k = key(name);
  const omm = catnr ? list[0] : list.find((s) => {
    const m = /^(.*?)\s*(?:\((.*)\))?$/.exec(s.OBJECT_NAME);
    return [s.OBJECT_NAME, m[1], m[2] || ""].some((x) => key(x) === k);
  });
  if (!omm) return null;
  // its period: SGP4 here follows the near-Earth orbits only
  if (1440 / omm.MEAN_MOTION >= 225) throw new Error(`${omm.OBJECT_NAME} is in a deep-space orbit (period of 225 minutes or more), not followed here`);
  return { name: omm.OBJECT_NAME, kind: "satellite", omm, fetched: Date.now() };
}

// -> [[key, object]…], the keys of the name asked and of the name found;
// throws an Error with a message for the user. Comets by designation (1P,
// C/2023 A3), minor planets by number or designation (433, 2004 MN4),
// satellites by NORAD number (NORAD 25544); other names in turn in the
// comets, the minor planets, the satellites and SIMBAD
async function fetchObject(name) {
  const n = name.trim();
  const sk = satelliteKey(n);
  const keys = (o) => [...new Set([sk || key(n), o.omm ? `norad${o.omm.NORAD_CAT_ID}` : key(o.name)])].map((k) => [k, o]);
  let o;
  if (sk) {
    o = await satellite(n, Number(sk.slice(5)));
    if (!o) throw new Error(`No satellite ${sk.slice(5)} at CelesTrak`);
    return keys(o);
  }
  if (/^(\d+[PDI](\/|$)|[PCDXI]\/\d{4})/i.test(n)) {
    o = await comet(n);
    if (!o) throw new Error(`No comet "${n}" at the Minor Planet Center`);
    return keys(o);
  }
  if (/^\(?\d+\)?$|^\d{4}\s*[A-Z]{2}\d*$/i.test(n)) {
    o = await minorPlanet(n);
    if (!o) throw new Error(`No minor planet "${n}" at the Minor Planet Center`);
    return keys(o);
  }
  // a service that fails is skipped; its error is told if nothing is found
  let failed = null;
  for (const find of [comet, minorPlanet, satellite, simbad]) {
    try {
      o = await find(n);
      if (o) return keys(o);
    } catch (e) {
      if (/deep-space/.test(e.message)) throw e;
      failed ??= e;
    }
  }
  throw failed || new Error(`"${n}" was not found (comets, minor planets, satellites, SIMBAD)`);
}

// -> [key, place]
async function fetchPlace(name) {
  let found;
  try {
    found = JSON.parse(await fetchText(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`));
  } catch (e) {
    throw unreachable("OpenStreetMap", e);
  }
  if (!found.length) throw new Error(`"${name}" is not known to OpenStreetMap`);
  const lat = Number(found[0].lat), lon = Number(found[0].lon);
  return [placeKey(name), { name: found[0].display_name, lat, lon, h: await fetchElevation(lat, lon) }];
}

// the elevation of the terrain (m), from the Copernicus model (90 m)
async function fetchElevation(lat, lon) {
  try {
    const j = JSON.parse(await fetchText(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`));
    const h = j.elevation?.[0];
    return Number.isFinite(h) ? Math.max(h, 0) : 0;
  } catch (e) {
    throw new Error(`Could not get the elevation (${e.message})`);
  }
}

export { LookupError, SATELLITES, findObject, findPlace, searchPlaces, fetchObject, fetchPlace, fetchElevation };
