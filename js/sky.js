// The Sun and the Moon: positions, rising and setting, phases and sidereal
// time, after Meeus, "Astronomical Algorithms" (the Sun of chapter 25, the
// Moon of chapter 47 with its largest terms). Times are Unix seconds (UT),
// angles degrees, places [latitude, longitude] in degrees, east positive.

import { Q, UnitError } from "./units.js";
import { UNum } from "./unum.js";
import { isDate, dateQ } from "./dates.js";

const RAD = Math.PI / 180;
const sin = (x) => Math.sin(x * RAD), cos = (x) => Math.cos(x * RAD);
const mod360 = (x) => x - 360 * Math.floor(x / 360);

// ---------------------------------------------------------------------
// Time

const jdOf = (t) => t / 86400 + 2440587.5;

// TT − UT in seconds: measured values to 2026, then the parabola of
// Morrison and Stephenson, joined to them
const DELTA_T = [[1900, -2.8], [1910, 10.4], [1920, 21.2], [1930, 24.0], [1940, 24.3], [1950, 29.1], [1960, 33.2],
  [1970, 40.2], [1980, 50.5], [1990, 56.9], [2000, 63.8], [2010, 66.1], [2020, 69.4], [2026, 69.2], [2050, 75]];
const parabola = (y) => -20 + 32 * ((y - 1820) / 100) ** 2;

function deltaT(y) {
  const first = DELTA_T[0], last = DELTA_T.at(-1);
  if (y < first[0]) return parabola(y) - parabola(first[0]) + first[1];
  if (y >= last[0]) return parabola(y) - parabola(last[0]) + last[1];
  const i = DELTA_T.findIndex(([x]) => x > y);
  const [x0, d0] = DELTA_T[i - 1], [x1, d1] = DELTA_T[i];
  return d0 + (d1 - d0) * (y - x0) / (x1 - x0);
}

// Julian centuries of TT since J2000.0
function centuries(t) {
  const jd = jdOf(t);
  return (jd + deltaT(2000 + (jd - 2451545) / 365.25) / 86400 - 2451545) / 36525;
}

// Nutation in longitude and obliquity, and the true obliquity (degrees)
function nutation(T) {
  const om = 125.04452 - 1934.136261 * T, ls = 280.4665 + 36000.7698 * T, lm = 218.3165 + 481267.8813 * T;
  const dpsi = (-17.2 * sin(om) - 1.32 * sin(2 * ls) - 0.23 * sin(2 * lm) + 0.21 * sin(2 * om)) / 3600;
  const deps = (9.2 * cos(om) + 0.57 * cos(2 * ls) + 0.1 * cos(2 * lm) - 0.09 * cos(2 * om)) / 3600;
  const eps0 = 23.439291111 - 0.013004167 * T - 1.639e-7 * T * T + 5.036e-7 * T ** 3;
  return { dpsi, eps: eps0 + deps };
}

// ---------------------------------------------------------------------
// The Sun: apparent ecliptic longitude (degrees) and distance (km)

function sunEcliptic(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  const R = 1.000001018 * (1 - e * e) / (1 + e * cos(M + C));
  // aberration (−20.4955″/R) and nutation
  const lon = L0 + C - 20.4955 / 3600 / R + nutation(T).dpsi;
  return { lon: mod360(lon), lat: 0, dist: R * 149597870.7 };
}

// ---------------------------------------------------------------------
// The Moon: apparent ecliptic longitude and latitude (degrees), distance
// (km). Terms: multiples of D, M, M′, F and the coefficient (10⁻⁶ degree
// for longitude and latitude, m for distance)

const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
];

const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

function moonEcliptic(T) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  // the terms with M shrink with the eccentricity of the Earth's orbit
  const ecc = (m) => (m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E);
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    sl += l * ecc(m) * sin(arg);
    sr += r * ecc(m) * cos(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) sb += b * ecc(m) * sin(d * D + m * M + mp * Mp + f * F);
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
  return { lon: mod360(Lp + sl / 1e6 + nutation(T).dpsi), lat: sb / 1e6, dist: 385000.56 + sr / 1000 };
}

// ---------------------------------------------------------------------
// Coordinates

// Greenwich mean sidereal time (degrees) at the Unix time t (UT)
function gmst(t) {
  const d = jdOf(t) - 2451545, T = d / 36525;
  return mod360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - T ** 3 / 38710000);
}

// Altitude and azimuth (from north, through east) of a body seen from a
// place; the Moon with its parallax. Without refraction.
function horizontal(body, t, [lat, lon]) {
  const T = centuries(t);
  const p = body === "moon" ? moonEcliptic(T) : sunEcliptic(T);
  const eps = nutation(T).eps;
  const ra = Math.atan2(sin(p.lon) * cos(eps) - Math.tan(p.lat * RAD) * sin(eps), cos(p.lon)) / RAD;
  const dec = Math.asin(sin(p.lat) * cos(eps) + cos(p.lat) * sin(eps) * sin(p.lon)) / RAD;
  // apparent sidereal time: with the equation of the equinoxes
  const H = gmst(t) + nutation(T).dpsi * cos(eps) + lon - ra;
  let alt = Math.asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H)) / RAD;
  const az = mod360(Math.atan2(-cos(dec) * sin(H), sin(dec) * cos(lat) - cos(dec) * sin(lat) * cos(H)) / RAD);
  if (body === "moon") alt -= Math.asin(6378.14 / p.dist) / RAD * cos(alt);
  return { alt, az, dist: p.dist };
}

// ---------------------------------------------------------------------
// Events

// The first time after t when f crosses zero upwards (rising) or
// downwards, within two days, or null
function crossing(f, t, rising, span = 2 * 86400, step = 600) {
  let a = t, fa = f(a);
  for (let b = t + step; b <= t + span; b += step) {
    const fb = f(b);
    if (rising ? fa < 0 && fb >= 0 : fa > 0 && fb <= 0) {
      let lo = a, hi = b;
      while (hi - lo > 0.05) {
        const m = (lo + hi) / 2;
        if ((f(m) < 0) === rising) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    }
    a = b;
    fa = fb;
  }
  return null;
}

// Rising or setting of the upper limb, with the standard refraction of
// 34′: the Sun at −0.833° (or at h0, for twilights), the Moon at −34′
// minus its semidiameter
function riseSet(body, t, place, rising, h0 = null) {
  const f = body === "moon"
    ? (x) => { const h = horizontal("moon", x, place); return h.alt + 0.5667 + Math.asin(1737.4 / h.dist) / RAD; }
    : (x) => horizontal("sun", x, place).alt - (h0 === null ? -0.8333 : h0);
  const e = crossing(f, t, rising);
  if (e === null) return null;
  // how fast the altitude changes, for the uncertainty
  return { t: e, rate: Math.abs(f(e + 30) - f(e - 30)) / 60 };
}

// The elongation of the Moon from the Sun in longitude (degrees)
function elongation(t) {
  const T = centuries(t);
  return mod360(moonEcliptic(T).lon - sunEcliptic(T).lon);
}

// The next time after t at which the elongation is target (0 new moon,
// 90 first quarter, 180 full moon, 270 last quarter)
function nextPhase(t, target) {
  const rate = 360 / 29.530589 / 86400;   // degrees per second, on average
  let x = t + (360 - mod360(elongation(t) - target)) / rate;
  for (let i = 0; i < 30; i++) {
    const d = mod360(elongation(x) - target + 180) - 180;
    x -= d / rate;
    if (Math.abs(d) < 1e-7) break;
  }
  return x < t ? nextPhase(t + 86400, target) : x;
}

// Illuminated fraction of the Moon's disk, and its age (days since the
// last new moon)
function moonPhase(t) {
  const T = centuries(t);
  const m = moonEcliptic(T), s = sunEcliptic(T);
  const psi = Math.acos(cos(m.lat) * cos(m.lon - s.lon));
  const i = Math.atan2(s.dist * Math.sin(psi), m.dist - s.dist * Math.cos(psi));
  let n = nextPhase(t - 31 * 86400, 0);
  for (let k = nextPhase(n + 86400, 0); k <= t; k = nextPhase(n + 86400, 0)) n = k;
  return { fraction: (1 + Math.cos(i)) / 2, age: (t - n) / 86400 };
}

// Local sidereal time in degrees (apparent)
function siderealTime(t, lon) {
  const T = centuries(t);
  const n = nutation(T);
  return mod360(gmst(t) + n.dpsi * cos(n.eps) + lon);
}


// ---------------------------------------------------------------------
// For the interpreter: sun(t, place), sunrise(t, place)…; the place is
// (latitude, longitude), or the location of the settings (env.location)

const SKY_FNS = ["sun", "moon", "sunrise", "sunset", "moonrise", "moonset", "phase", "newmoon", "fullmoon", "lst"];

function skyBuiltins(env, b) {
  const when = (name, t) => {
    if (!isDate(env, t)) throw new UnitError(`${name}: the first argument is a date, as in ${name}(today)`);
    return t.relative().x.n;
  };
  const where = (name, p) => {
    if (p === undefined) {
      if (env.location) return env.location;
      throw new UnitError(`${name}: give the place, as in ${name}(today, (45.46, 9.19)[deg]), or set a location in Settings`);
    }
    if (!Array.isArray(p) || p.length < 2 || !p.every((q) => q instanceof Q)) throw new UnitError(`${name}: the place is (latitude, longitude)`);
    return [p[0], p[1]].map((q) => env.checkPure(q, name).n / RAD);
  };
  const deg = (x, err) => env.convert(new Q(UNum.uncertain(x * RAD, err * RAD)), ["deg"]);
  const days = (x) => env.convert(env.mul(new Q(x), env.unitValue("day")), ["day"]);

  for (const body of ["sun", "moon"]) {
    // errors from the comparison with precise ephemerides (95 %)
    const err = body === "sun" ? 0.005 : 0.01;
    b[body] = (t, p) => {
      const h = horizontal(body, when(body, t), where(body, p));
      return [deg(h.alt, err), deg(h.az, err)];
    };
    for (const rising of [true, false]) {
      const name = body + (rising ? "rise" : "set");
      b[name] = (t, p, h0) => {
        const e = riseSet(body, when(name, t), where(name, p), rising, h0 === undefined ? null : env.checkPure(h0, name).n / RAD);
        if (!e) throw new UnitError(`${name}: the ${body === "sun" ? "Sun" : "Moon"} does not ${rising ? "rise" : "set"} here within two days`);
        // refraction near the horizon varies by about 0.15°
        return dateQ(env, UNum.uncertain(e.t, Math.min(0.15 / e.rate, 3600)));
      };
    }
  }
  // the phases agree with precise ephemerides to about a minute
  b.newmoon = (t) => dateQ(env, UNum.uncertain(nextPhase(when("newmoon", t), 0), 60));
  b.fullmoon = (t) => dateQ(env, UNum.uncertain(nextPhase(when("fullmoon", t), 180), 60));
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

export { SKY_FNS, skyBuiltins, horizontal, riseSet, nextPhase, moonPhase, siderealTime, deltaT };
