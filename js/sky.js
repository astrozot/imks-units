// The Sun, the Moon and the planets in the interpreter: sun(t, place),
// sunrise(t, place), altaz("Mars", t, place)…, where the place is
// (latitude, longitude), or the location of the settings (env.location).
// The astronomy is in astro.js.

import { Q, UnitError, dimEq } from "./units.js";
import { UNum, ufuncs, atan2 } from "./unum.js";
import { isDate, dateQ, yearArg } from "./dates.js";
import { horizontal, equatorial, topocentric, ecliptic, centuries, nutation, aspect, magnitude, diameter, transit, moons, moonEvents, planetOf, lunarEclipse, solarEclipse, solarLocal, eclipseTrack, riseSet, nextPhase, moonPhase, siderealTime, season } from "./astro.js";

const RAD = Math.PI / 180;
// the functions that take a place, (latitude, longitude): their lists
// are not taken elementwise
const SKY_FNS = ["sun", "moon", "sunrise", "sunset", "noon", "moonrise", "moonset", "lst", "altaz", "radec", "dist", "diam", "rising", "setting", "transit", "solareclipse", "lunareclipse"];
// the coordinate functions, whose points are lists (lon, lat)
const COORD_FNS = ["eq2hor", "hor2eq", "eq2ecl", "ecl2eq", "eq2gal", "gal2eq", "precess", "sep", "pa"];
// the functions whose first argument is the name of a body
const BODY_FNS = ["altaz", "radec", "ecl", "dist", "mag", "illum", "elong", "diam", "rising", "setting", "transit", "moons", "moonpos", "moonevents"];
const BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];
// the planets with moons in moons.js
const MOON_PLANETS = ["mars", "jupiter", "saturn", "uranus", "neptune"];

// Errors of the apparent geocentric positions (arcseconds), from the
// comparison with JPL Horizons over 1600 to 2400 (VSOP87 itself drifts for
// Uranus and Neptune; the Moon 3″ near 1600, 10″ outside), and of the
// distances (relative)
const POS_ERR = { sun: 0.3, moon: 1.5, mercury: 1, venus: 1, mars: 1.5, jupiter: 1, saturn: 1.5, uranus: 4, neptune: 6 };
const DIST_ERR = { moon: 1e-5 };
// Errors of the magnitudes: of the formulas against observations, and for
// Mars its seasons and the face it shows (not modeled)
const MAG_ERR = { sun: 0.01, moon: 0.1, mercury: 0.05, venus: 0.02, mars: 0.15, jupiter: 0.02, saturn: 0.03, uranus: 0.03, neptune: 0.02 };

// The error of UT (s): UT1 − UTC, up to 0.9 s, and the unknown ΔT far
// from the present (roughly). The Earth turns 15″ in a second, and the
// Moon moves 0.55″ (the planets less than 0.04″).
const utError = (t) => Math.hypot(0.9, 0.8 * ((t / 31557600 - 30) / 100) ** 2);
const posError = (body, t) => Math.hypot(POS_ERR[body], (body === "moon" ? 0.55 : 0.04) * utError(t)) / 3600;
const skyError = (body, t) => Math.hypot(posError(body, t), 15 * utError(t) / 3600);

// what a moon is doing
const doing = (o) => ["transit", "occulted", "eclipsed", "shadow"].filter((k) => o[k]);

// The moons of a planet at the time t for drawing (skyview.js), kept with
// the history: in planet radii, the planet's radius in arcseconds, and t
function skyView(planet, t, m = moons(planet, t)) {
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  return {
    planet, t, radius: r5(m.radius * 3600), pole: m.pole.map(r5), sun: m.sun.map(r5),
    moons: m.moons.map((o) => ({ name: o.name, x: r5(o.view.x), y: r5(o.view.y), z: r5(o.view.z), r: r5(o.view.r), doing: doing(o) })),
  };
}

// ---------------------------------------------------------------------
// Coordinates, with errors: angles are UNum in radians

const { sin, cos, tan, asin } = ufuncs;
const num = (x) => UNum.of(x);
const TAU = 2 * Math.PI;
// an angle in [0, 2π)
const wrap = (x) => (x.n < 0 ? x.add(num(TAU)) : x.n >= TAU ? x.sub(num(TAU)) : x);

// From (longitude, latitude) to (longitude, latitude) in a frame turned by
// ε about the x axis (ε > 0: from equatorial to ecliptic). The same
// formulas, with the latitude of the place, go from (hour angle,
// declination) to (azimuth, altitude) and back, the azimuth from the north
function turn([lon, lat], eps) {
  const lat1 = asin(sin(lat).mul(cos(eps)).sub(cos(lat).mul(sin(eps)).mul(sin(lon))));
  const lon1 = atan2(sin(lon).mul(cos(eps)).add(tan(lat).mul(sin(eps))), cos(lon));
  return [wrap(lon1), lat1];
}
function horizon([h, dec], lat) {
  const alt = asin(sin(lat).mul(sin(dec)).add(cos(lat).mul(cos(dec)).mul(cos(h))));
  const az = atan2(cos(dec).mul(sin(h)).neg(), sin(dec).mul(cos(lat)).sub(cos(dec).mul(sin(lat)).mul(cos(h))));
  return [wrap(az), alt];
}

// From J2000 to galactic (IAU 1958 system, ICRS: the Hipparcos matrix)
const GAL = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
];
function rotate([lon, lat], M) {
  const v = [cos(lat).mul(cos(lon)), cos(lat).mul(sin(lon)), sin(lat)];
  const [x, y, z] = M.map((r) => r.reduce((s, m, i) => s.add(v[i].scale(m)), num(0)));
  return [wrap(atan2(y, x)), asin(z)];
}

// Precession of mean places (IAU 1976, Meeus 21.2) between epochs in
// Julian centuries from J2000
function precess([ra, dec], T, t1) {
  const t = t1 - T, as = Math.PI / 180 / 3600;
  const zeta = ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (0.30188 - 0.000344 * T) * t * t + 0.017998 * t ** 3) * as;
  const z = ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (1.09468 + 0.000066 * T) * t * t + 0.018203 * t ** 3) * as;
  const th = ((2004.3109 - 0.8533 * T - 0.000217 * T * T) * t - (0.42665 + 0.000217 * T) * t * t - 0.041833 * t ** 3) * as;
  const a = ra.add(num(zeta));
  const A = cos(dec).mul(sin(a));
  const B = cos(dec).mul(cos(a)).scale(Math.cos(th)).sub(sin(dec).scale(Math.sin(th)));
  const C = cos(dec).mul(cos(a)).scale(Math.sin(th)).add(sin(dec).scale(Math.cos(th)));
  return [wrap(atan2(A, B).add(num(z))), asin(C)];
}

// Angular distance (Vincenty, good at every angle) and position angle of
// the second point from the first, from the north through the east
function separation([a1, d1], [a2, d2]) {
  const da = a2.sub(a1);
  const x = sin(d1).mul(sin(d2)).add(cos(d1).mul(cos(d2)).mul(cos(da)));
  const p = cos(d2).mul(sin(da)), q = cos(d1).mul(sin(d2)).sub(sin(d1).mul(cos(d2)).mul(cos(da)));
  return atan2(ufuncs.sqrt(p.mul(p).add(q.mul(q))), x);
}
const positionAngle = ([a1, d1], [a2, d2]) => {
  const da = a2.sub(a1);
  return wrap(atan2(sin(da), cos(d1).mul(tan(d2)).sub(sin(d1).mul(cos(da)))));
};

function skyBuiltins(env, b) {
  // pre: the arguments before the date, in the examples of the messages
  const when = (name, t, pre = "") => {
    if (!isDate(env, t)) throw new UnitError(`${name}: the ${pre ? "second" : "first"} argument is a date, as in ${name}(${pre}today)`);
    const x = t.relative().x.n;
    if (!(Math.abs(x) <= 8.64e12)) throw new UnitError(`${name}: the date is out of range`);
    return x;
  };
  const where = (name, p, pre = "") => {
    if (p === undefined) {
      if (env.location) return env.location;
      throw new UnitError(`${name}: give the place, as in ${name}(${pre}today, (45.46, 9.19)[deg]), or set a location in Settings`);
    }
    if (!Array.isArray(p) || p.length < 2 || !p.every((q) => q instanceof Q)) throw new UnitError(`${name}: the place is (latitude, longitude)`);
    return [p[0], p[1]].map((q) => env.checkPure(q, name).n / RAD);
  };
  const deg = (x, err) => env.convert(new Q(UNum.uncertain(x * RAD, err * RAD)), ["deg"]);
  const days = (x) => env.convert(env.mul(new Q(x), env.unitValue("day")), ["day"]);

  const bodyOf = (name, x) => {
    const body = typeof x === "string" ? x.trim().toLowerCase() : "";
    if (!BODIES.includes(body)) throw new UnitError(`${name}: the first argument is a body, "Sun", "Moon", "Mercury"… "Neptune", as in ${name}("Mars", now)`);
    return body;
  };
  const pre = '"Mars", ';
  const altaz = (body, x, p) => {
    const h = horizontal(body, x, p), err = skyError(body, x);
    return [deg(h.alt, err), deg(h.az, err)];
  };
  // apparent places, geocentric, or seen from a place: the place is
  // optional, the location of the settings is not used
  const seen = (name, body, t, p) => (p === undefined ? equatorial(body, t) : topocentric(body, t, where(name, p, pre)));
  b.altaz = (x, t, p) => {
    const body = bodyOf("altaz", x);
    return altaz(body, when("altaz", t, pre), where("altaz", p, pre));
  };
  // in degrees, both: radec(…).1 @ hms gives the right ascension in hours
  b.radec = (x, t, p) => {
    const body = bodyOf("radec", x), u = when("radec", t, pre);
    const e = seen("radec", body, u, p), err = p === undefined ? posError(body, u) : skyError(body, u);
    return [deg(e.ra, Math.min(err / Math.cos(e.dec * RAD), 180)), deg(e.dec, err)];
  };
  b.ecl = (x, t) => {
    const body = bodyOf("ecl", x), u = when("ecl", t, pre);
    const e = ecliptic(body, centuries(u)), err = posError(body, u);
    return [deg(e.lon, Math.min(err / Math.cos(e.lat * RAD), 180)), deg(e.lat, err)];
  };
  b.dist = (x, t, p) => {
    const body = bodyOf("dist", x), u = when("dist", t, pre);
    const d = seen("dist", body, u, p).dist;
    const q = env.mul(new Q(UNum.uncertain(d, d * (DIST_ERR[body] ?? 1e-5))), env.unitValue("km"));
    return env.convert(q, [body === "moon" ? "km" : "au"]);
  };

  b.mag = (x, t) => {
    const body = bodyOf("mag", x);
    return new Q(UNum.uncertain(magnitude(body, when("mag", t, pre)), MAG_ERR[body]));
  };
  // the illuminated fraction of the disk and the phase angle (Sun–body–Earth)
  b.illum = (x, t) => {
    const body = bodyOf("illum", x), i = aspect(body, when("illum", t, pre)).phase;
    const err = body === "moon" ? 0.003 : 0.001;
    return [new Q(UNum.uncertain((1 + Math.cos(i * RAD)) / 2, Math.sin(i * RAD) / 2 * err * RAD)), deg(i, err)];
  };
  // the angle from the Sun, positive to the east (an evening object)
  b.elong = (x, t) => {
    const body = bodyOf("elong", x), u = when("elong", t, pre);
    return deg(aspect(body, u).elong, posError(body, u));
  };
  b.diam = (x, t, p) => {
    const body = bodyOf("diam", x), u = when("diam", t, pre);
    const d = diameter(body, u, p === undefined ? undefined : where("diam", p, pre));
    return env.convert(new Q(UNum.uncertain(d * RAD, d * RAD * 2e-4)), [body === "sun" || body === "moon" ? "arcmin" : "arcsec"]);
  };
  const Name = (body) => body[0].toUpperCase() + body.slice(1);
  // rising and setting: refraction near the horizon varies by about 0.15°
  const riseOrSet = (name, body, t, p, h0, rising) => {
    const e = riseSet(body, t, p, rising, h0 === undefined ? null : env.checkPure(h0, name).n / RAD);
    if (!e) throw new UnitError(`${name}: ${body === "sun" || body === "moon" ? "the " : ""}${Name(body)} does not ${rising ? "rise" : "set"} here within two days`);
    return dateQ(env, UNum.uncertain(e.t, Math.min(0.15 / e.rate, 3600)));
  };
  for (const [name, rising] of [["rising", true], ["setting", false]]) {
    b[name] = (x, t, p, h0) => riseOrSet(name, bodyOf(name, x), when(name, t, pre), where(name, p, pre), h0, rising);
  }
  // on the meridian, to a few seconds
  b.transit = (x, t, p) => {
    const body = bodyOf("transit", x);
    const e = transit(body, when("transit", t, pre), where("transit", p, pre)[1]);
    if (e === null) throw new UnitError(`transit: no transit of ${Name(body)} within two days`);
    return dateQ(env, UNum.uncertain(e, 2));
  };

  // the moons of a planet, as a table of their offsets from it, to the
  // east and to the north; for the app, their names, what they are doing
  // and the planet (sky), to label the rows and draw them
  b.moons = (x, t) => {
    const body = bodyOf("moons", x);
    if (!MOON_PLANETS.includes(body)) throw new UnitError("moons: the planets with moons are Mars, Jupiter, Saturn, Uranus and Neptune");
    const u = when("moons", t, pre), m = moons(body, u);
    const sec = (d, e) => env.convert(new Q(UNum.uncertain(d * RAD, e * RAD)), ["arcsec"]);
    const v = [m.moons.map((o) => sec(o.east, o.err)), m.moons.map((o) => sec(o.north, o.err))];
    v.heads = ["east", "north"];
    v.rows = m.moons.map((o) => o.name + doing(o).map((k) => ` (${k === "shadow" ? "shadow on " + Name(body) : k})`).join(""));
    v.sky = skyView(body, u, m);
    return v;
  };

  // a moon by name: "Io", "titan"…
  const moonOf = (name, x) => {
    const m = typeof x === "string" ? x.trim().toLowerCase() : "";
    const moon = m && m[0].toUpperCase() + m.slice(1);
    if (!m || !planetOf(moon)) throw new UnitError(`${name}: the first argument is a moon of Mars, Jupiter, Saturn, Uranus or Neptune, as in ${name}("Io", now)`);
    return moon;
  };
  // a moon's offsets from its planet, to the east and to the north
  b.moonpos = (x, t) => {
    const moon = moonOf("moonpos", x), u = when("moonpos", t, '"Io", ');
    const o = moons(planetOf(moon), u).moons.find((m) => m.name === moon);
    return [o.east, o.north].map((d) => env.convert(new Q(UNum.uncertain(d * RAD, o.err * RAD)), ["arcsec"]));
  };
  // The next events of a moon from t on, one of each kind (within 30
  // days): a table of their beginnings and ends; with a kind ("eclipse", "occultation", "transit",
  // "shadow"), the beginning and the end of the next one. Times of the
  // moon's center, with the error of its position over its speed, and 20 s
  // for the shadow taken as a cylinder
  const KINDS = { transit: "transit", shadow: "shadow", eclipse: "eclipsed", eclipsed: "eclipsed", occultation: "occulted", occulted: "occulted" };
  const KIND_TEXT = { transit: "transit", shadow: "shadow", eclipsed: "eclipse", occulted: "occultation" };
  b.moonevents = (x, t, kind) => {
    const moon = moonOf("moonevents", x), u = when("moonevents", t, '"Io", '), planet = planetOf(moon);
    const want = kind === undefined ? null : KINDS[typeof kind === "string" ? kind.trim().toLowerCase() : ""];
    if (kind !== undefined && !want) throw new UnitError('moonevents: the kinds are "eclipse", "occultation", "transit" and "shadow"');
    // the next of each kind
    const events = moonEvents(moon, u).filter((e, i, all) => (!want || e[0] === want) && all.findIndex((f) => f[0] === e[0]) === i);
    const sigma = (time) => {
      const a = moons(planet, time - 30).moons.find((m) => m.name === moon), c = moons(planet, time + 30).moons.find((m) => m.name === moon);
      const speed = Math.hypot(c.east - a.east, c.north - a.north) / 60;
      return Math.min(3600, 20 + (speed > 0 ? a.err / speed : 3600));
    };
    const date = (time) => dateQ(env, UNum.uncertain(time, sigma(time)));
    if (want) {
      if (!events.length) throw new UnitError(`moonevents: no ${kind} of ${moon} within 30 days`);
      return [date(events[0][1]), date(events[0][2])];
    }
    if (!events.length) throw new UnitError(`moonevents: no events of ${moon} within 30 days`);
    const text = (k) => (k === "shadow" ? `shadow on ${Name(planet)}` : KIND_TEXT[k]);
    const v = [events.flatMap((e) => [date(e[1]), date(e[2])])];
    v.heads = [moon];
    v.rows = events.flatMap((e) => [`${text(e[0])} begins`, `${text(e[0])} ends`]);
    return v;
  };

  // a table of dates and numbers with named rows, under a head
  const named = (head, rows) => {
    const v = [rows.map((r) => r[1])];
    v.heads = [head];
    v.rows = rows.map((r) => r[0]);
    return v;
  };
  const at = (x, s) => dateQ(env, UNum.uncertain(x, s));
  // The next lunar eclipse after t: its contacts (the umbral ones to half a
  // minute, as the edge of the shadow is soft) and magnitudes
  // rising and setting of a body between a and b: rows [label, time, error]
  const horizonRows = (body, a, b, place) => [true, false].map((rising) => {
    const e = riseSet(body, a - 1, place, rising);
    return e && e.t <= b ? [`${body === "sun" ? "Sun" : "Moon"} ${rising ? "rises" : "sets"}`, e.t, Math.min(0.15 / e.rate, 3600)] : null;
  }).filter(Boolean);
  // rows [label, time, error] in time order, as dates
  const timed = (rows) => rows.sort((a, b) => a[1] - b[1]).map(([l, x, s]) => [l, at(x, s)]);
  // The next lunar eclipse after t: its contacts (the umbral ones to half a
  // minute, as the edge of the shadow is soft) and magnitudes; with a
  // place, the next one seen from there (the Moon up during some of it),
  // with the contacts under the horizon marked, the rising or setting of
  // the Moon during it and its altitude at the maximum
  b.lunareclipse = (t, p) => {
    let u = when("lunareclipse", t);
    const place = p === undefined ? null : where("lunareclipse", p);
    for (let n = 0; n < 40; n++) {
      const e = lunarEclipse(u);
      if (!e) break;
      const contacts = [["penumbral begins", e.P1, 60], ["partial begins", e.U1, 30], ["total begins", e.U2, 30], ["maximum", e.max, 10],
        ["total ends", e.U3, 30], ["partial ends", e.U4, 30], ["penumbral ends", e.P4, 60]].filter((r) => r[1] !== null);
      const mags = [["umbral magnitude", new Q(UNum.uncertain(e.umbral, 0.003))], ["penumbral magnitude", new Q(UNum.uncertain(e.penumbral, 0.003))]];
      if (!place) return named(`${e.kind} lunar eclipse`, [...timed(contacts), ...mags]);
      // the Moon up: its center above −0.8° (refraction and its radius)
      const alt = (x) => horizontal("moon", x, place).alt, up = (x) => alt(x) > -0.8;
      const moon = horizonRows("moon", e.P1, e.P4, place);
      if (contacts.some((r) => up(r[1])) || moon.length) {
        const rows = contacts.map(([l, x, s]) => [l + (up(x) ? "" : " (Moon down)"), x, s]);
        return named(`${e.kind} lunar eclipse`, [...timed([...rows, ...moon]), ...mags, ["Moon's altitude", deg(alt(e.max), 0.01)]]);
      }
      u = e.max + 86400;
    }
    throw new UnitError(`lunareclipse: none ${place ? "seen here " : ""}in the next 20 years`);
  };
  // The next solar eclipse after t: its greatest phase on the Earth, gamma
  // and magnitude; with a place, the next one seen from there (the Sun up
  // during some of it): its contacts, maximum, magnitude, the part of the
  // Sun covered and the Sun's altitude
  b.solareclipse = (t, p) => {
    let u = when("solareclipse", t);
    if (p === undefined) {
      const e = solarEclipse(u);
      if (!e) throw new UnitError("solareclipse: none found");
      const v = named(`${e.kind} solar eclipse`, [["greatest eclipse", at(e.max, 10)], ["gamma", new Q(UNum.uncertain(e.gamma, 0.0005))],
        ["magnitude", new Q(UNum.uncertain(e.magnitude, 0.0005))]]);
      // the map (eclipsemap.js), kept with the history
      v.eclipse = eclipseTrack(e.max);
      return v;
    }
    const place = where("solareclipse", p);
    for (let n = 0; n < 40; n++) {
      const e = solarEclipse(u);
      if (!e) break;
      const l = solarLocal(e.max, place);
      const up = (a) => a !== null && a > -0.833;
      if (l && (up(l.altC1) || up(l.altMax) || up(l.altC4))) {
        const low = (a) => (a !== null && a < -0.833 ? " (Sun down)" : "");
        const events = [["begins" + low(l.altC1), l.C1, 5], ["maximum" + low(l.altMax), l.max, 5], ["ends" + low(l.altC4), l.C4, 5],
          ...horizonRows("sun", l.C1, l.C4, place)];
        if (l.C2 !== null) events.push([`${l.kind} begins`, l.C2, 5], [`${l.kind} ends`, l.C3, 5]);
        const rows = [...timed(events), ["magnitude", new Q(UNum.uncertain(l.magnitude, 0.001))],
          ["Sun covered", new Q(UNum.uncertain(l.obscuration, 0.001))], ["Sun's altitude", deg(l.altMax, 0.01)]];
        const v = named(`${l.kind} solar eclipse${e.kind !== l.kind ? ` (${e.kind})` : ""}`, rows);
        v.eclipse = { ...eclipseTrack(e.max), place };
        return v;
      }
      u = e.max + 86400;
    }
    throw new UnitError("solareclipse: none seen here in the next 20 years");
  };

  for (const body of ["sun", "moon"]) {
    b[body] = (t, p) => altaz(body, when(body, t), where(body, p));
    for (const rising of [true, false]) {
      const name = body + (rising ? "rise" : "set");
      b[name] = (t, p, h0) => riseOrSet(name, body, when(name, t), where(name, p), h0, rising);
    }
  }
  // a point (longitude, latitude) of the sky, in radians; a time as the
  // longitude is a right ascension in hours
  const point = (name, p) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((q) => q instanceof Q)) throw new UnitError(`${name}: a point is (longitude, latitude), as (ra, dec)`);
    const ra = dimEq(p[0].d, env.unitValue("s").d) && !isDate(env, p[0]) ? p[0].relative().x.scale(Math.PI / 43200) : env.checkPure(p[0], name);
    return [ra, env.checkPure(p[1], name)];
  };
  const angle = (x) => env.convert(new Q(x), ["deg"]);
  // the local sidereal time (radians), with the error of UT
  const lstAt = (t, lon) => UNum.uncertain(siderealTime(t, lon) * RAD, 15 * utError(t) / 3600 * RAD);
  // the obliquity: true, of the date t, or mean of J2000
  const obliquity = (name, t) => num((t === undefined ? 23.4392911 : nutation(centuries(when(name, t, "(ra, dec), "))).eps) * RAD);
  // an epoch, a date or a year (Julian), in centuries from J2000
  const epoch = (name, x) => {
    if (isDate(env, x)) return (x.relative().x.n / 86400 + 2440587.5 - 2451545) / 36525;
    if (x instanceof Q && x.pure) return (x.x.n - 2000) / 100;
    throw new UnitError(`${name}: the epochs are dates or years, as in ${name}((ra, dec), 2000, today)`);
  };
  b.eq2hor = (p, t, pl) => {
    const [ra, dec] = point("eq2hor", p), u = when("eq2hor", t, "(ra, dec), "), [lat, lon] = where("eq2hor", pl, "(ra, dec), ");
    const [az, alt] = horizon([lstAt(u, lon).sub(ra), dec], num(lat * RAD));
    return [angle(alt), angle(az)];
  };
  b.hor2eq = (p, t, pl) => {
    const [alt, az] = point("hor2eq", p), u = when("hor2eq", t, "(alt, az), "), [lat, lon] = where("hor2eq", pl, "(alt, az), ");
    const [h, dec] = horizon([az, alt], num(lat * RAD));
    return [angle(wrap(lstAt(u, lon).sub(h))), angle(dec)];
  };
  b.eq2ecl = (p, t) => turn(point("eq2ecl", p), obliquity("eq2ecl", t)).map(angle);
  b.ecl2eq = (p, t) => {
    const [ra, dec] = turn(point("ecl2eq", p), obliquity("ecl2eq", t).neg());
    return [angle(ra), angle(dec)];
  };
  b.eq2gal = (p) => rotate(point("eq2gal", p), GAL).map(angle);
  b.gal2eq = (p) => {
    const [ra, dec] = rotate(point("gal2eq", p), GAL[0].map((_, i) => GAL.map((r) => r[i])));
    return [angle(ra), angle(dec)];
  };
  b.precess = (p, from, to) => {
    if (to === undefined) throw new UnitError("precess: precess((ra, dec), from, to), the epochs dates or years, as in precess((ra, dec), 2000, today)");
    const [ra, dec] = precess(point("precess", p), epoch("precess", from), epoch("precess", to));
    return [angle(ra), angle(dec)];
  };
  b.sep = (p1, p2) => angle(separation(point("sep", p1), point("sep", p2)));
  b.pa = (p1, p2) => angle(positionAngle(point("pa", p1), point("pa", p2)));
  // atmospheric refraction at a true altitude (Sæmundsson), at a pressure
  // and temperature (101 kPa and 10 °C if left out): the apparent altitude
  // is alt + refract(alt)
  b.refract = (h, P, T) => {
    const usage = "refract: refract(alt), or refract(alt, pressure, temperature)";
    let k = 1;
    try {
      if (P !== undefined) k *= env.checkPure(env.div(P, env.mul(new Q(101), env.unitValue("kPa"))), "refract").n;
      if (T !== undefined) k *= 283.15 / env.checkPure(env.div(T, env.unitValue("K")), "refract").n;
    } catch { throw new UnitError(usage); }
    if (!(k > 0)) throw new UnitError(usage);
    // in arcminutes, the altitude in degrees (not below −1.9°)
    const f = (x) => {
      const d = Math.max(x / RAD, -1.9);
      return 1.02 / Math.tan((d + 10.3 / (d + 5.11)) * RAD) / 60 * RAD * k;
    };
    return angle(env.checkPure(h, "refract").map(f, (x) => (f(x + 1e-6) - f(x - 1e-6)) / 2e-6));
  };

  // solar noon: the Sun on the meridian, to a few seconds
  b.noon = (t, p) => dateQ(env, UNum.uncertain(transit("sun", when("noon", t), where("noon", p)[1]), 2));
  // the phases agree with precise ephemerides to about a minute
  for (const [name, target] of [["newmoon", 0], ["firstquarter", 90], ["fullmoon", 180], ["lastquarter", 270]]) {
    b[name] = (t) => dateQ(env, UNum.uncertain(nextPhase(when(name, t), target), 60));
  }
  // equinoxes and solstices of a year, (March, September) and (June,
  // December), to about a minute
  for (const [name, ks] of [["equinox", [0, 2]], ["solstice", [1, 3]]]) {
    b[name] = (y) => {
      const year = yearArg(env, name, y);
      return ks.map((k) => {
        const t = season(year, k);
        if (t === null) throw new UnitError(`${name}: the years from −1000 to 3000`);
        // a minute from the formula, and the uncertainty of ΔT, which grows
        // far from the present (roughly)
        return dateQ(env, UNum.uncertain(t, Math.hypot(60, 0.8 * ((year - 2000) / 100) ** 2)));
      });
    };
  }
  b.phase = (t) => {
    const m = moonPhase(when("phase", t));
    return [new Q(UNum.uncertain(m.fraction, 0.001)), days(UNum.uncertain(m.age, 60 / 86400))];
  };
  // lst(t), lst(t, longitude) or lst(t, place)
  b.lst = (t, p) => {
    const lon = p instanceof Q ? env.checkPure(p, "lst").n / RAD : where("lst", p)[1];
    const s = siderealTime(when("lst", t), lon) / 15 * 3600;
    return env.convert(env.mul(new Q(s), env.unitValue("s")), ["hms"]);
  };
  // for the Hebrew calendar, whose days begin at sunset: whether the time
  // t is after the sunset of the day beginning at start
  env.afterSunset = (t, start) => {
    if (!env.location) return false;
    const e = riseSet("sun", start, env.location, false);
    return Boolean(e && e.t - start < 86400 + 3600 && t >= e.t);
  };
}

export { SKY_FNS, BODY_FNS, COORD_FNS, skyBuiltins, skyView };
