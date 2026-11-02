// Stars, deep-sky objects and places by name: first the built-in ones
// (catalog.js), then those found online before and kept (env.lookups);
// otherwise a LookupError, which the app answers by looking the name up
// (fetchObject, fetchPlace) and evaluating again. Objects come from SIMBAD
// through Sesame (CDS), places from OpenStreetMap (Nominatim) with their
// elevation from Open-Meteo.

import { UnitError } from "./units.js";
import { STARS, DEEP, CITIES } from "./catalog.js";

// A name not known yet: kind "object" or "place"
class LookupError extends UnitError {
  constructor(kind, name, message) {
    super(message);
    this.lookup = { kind, name };
  }
}

// names compared without case, accents, spaces and leading zeros of
// numbers: "M 31" = "m31", "NGC 0224" = "ngc224", "São Paulo" = "sao paulo"
const key = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[\s_'’.-]+/g, "").replace(/(^|[a-z])0+(?=\d)/g, "$1");
const placeKey = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();

// objects: { name, ra, dec, pmra, pmdec, plx, rv, mag, kind }
let objects = null;
function objectTable() {
  if (objects) return objects;
  objects = new Map();
  for (const [name, ra, dec, pmra, pmdec, plx, rv, mag] of STARS) objects.set(key(name), { name, ra, dec, pmra, pmdec, plx, rv, mag, kind: "star" });
  for (const [names, ra, dec, mag, kind] of DEEP) {
    const o = { name: names.length > 2 ? `${names[0]} (${names[2]})` : names[0], ra, dec, pmra: 0, pmdec: 0, plx: 0, rv: 0, mag, kind };
    for (const n of names) if (!objects.has(key(n))) objects.set(key(n), o);
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

// env.lookups: { objects: {key: object}, places: {key: place} }, kept by
// the app
function findObject(env, name) {
  const k = key(name);
  const o = objectTable().get(k) || env.lookups?.objects?.[k];
  if (o) return o;
  throw new LookupError("object", name, `Unknown object "${name}": press = to look it up online (SIMBAD)`);
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

async function fetchText(url, ms = 10000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

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

// -> [key, object]; throws an Error with a message for the user
async function fetchObject(name) {
  let text;
  try {
    text = await fetchText(SESAME + encodeURIComponent(name), 15000);
  } catch (e) {
    throw new Error(`Could not reach SIMBAD (${e.name === "AbortError" ? "timed out" : e.message})`);
  }
  const o = parseSesame(text, name);
  if (!o) throw new Error(`"${name}" is not known to SIMBAD`);
  return [key(name), o];
}

// -> [key, place]
async function fetchPlace(name) {
  let found;
  try {
    found = JSON.parse(await fetchText(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`));
  } catch (e) {
    throw new Error(`Could not reach OpenStreetMap (${e.name === "AbortError" ? "timed out" : e.message})`);
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
    throw new Error(`Could not get the elevation (${e.name === "AbortError" ? "timed out" : e.message})`);
  }
}

export { LookupError, findObject, findPlace, fetchObject, fetchPlace, fetchElevation };
