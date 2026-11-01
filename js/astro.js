// The Sun, the Moon and the planets: positions, rising and setting, phases
// and sidereal time, after Meeus, "Astronomical Algorithms" (the Moon of
// chapter 47 with its largest terms; the Sun and the planets from VSOP87,
// in vsop87.js). Times are Unix seconds (UT), angles degrees, places
// [latitude, longitude] in degrees, east positive. The bodies are "sun",
// "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus" and
// "neptune".

import { VSOP87 } from "./vsop87.js";
import { MOONS } from "./moons.js";
import { MOON } from "./moonseries.js";

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
// The Sun and the planets (VSOP87D)

const AU = 149597870.7;        // km
const C_AU = 173.1446327;      // the speed of light, au per day

// Heliocentric position of a planet (au, rectangular, ecliptic and equinox
// of the date); with velocity, also its velocity (au per day)
function heliocentric(planet, T, velocity = false) {
  const tau = T / 10;
  const [[L, dL], [B, dB], [R, dR]] = VSOP87[planet].map((powers) => {
    let s = 0, ds = 0;
    for (let k = powers.length - 1; k >= 0; k--) {
      const t = powers[k];
      let x = 0, dx = 0;
      for (let i = 0; i < t.length; i += 3) {
        const arg = t[i + 1] + t[i + 2] * tau;
        x += t[i] * Math.cos(arg);
        if (velocity) dx -= t[i] * t[i + 2] * Math.sin(arg);
      }
      // Horner, and its derivative
      ds = ds * tau + s + dx;
      s = s * tau + x;
    }
    return [s, ds];
  });
  const cb = Math.cos(B), sb = Math.sin(B), cl = Math.cos(L), sl = Math.sin(L);
  const pos = [R * cb * cl, R * cb * sl, R * sb];
  if (!velocity) return pos;
  // per millennium to per day
  const v = [dR * cb * cl - R * sb * dB * cl - R * cb * sl * dL, dR * cb * sl - R * sb * dB * sl + R * cb * cl * dL, dR * sb + R * cb * dB]
    .map((x) => x / 365250);
  return [pos, v];
}

// The apparent ecliptic longitude and latitude (degrees) and distance (km)
// of the Sun or a planet: the planet where it was when its light left
// (light time), seen from the moving Earth (aberration), in the FK5 frame
// and with nutation
function planetEcliptic(body, T) {
  const [E, V] = heliocentric("earth", T, true);
  let g = E.map((x) => -x);
  if (body !== "sun") {
    let tau = 0;
    for (let i = 0; i < 3; i++) {
      const P = heliocentric(body, T - tau / 36525);
      g = P.map((x, k) => x - E[k]);
      tau = Math.hypot(...g) / C_AU;
    }
  }
  const dist = Math.hypot(...g);
  const a = g.map((x, k) => x + dist * V[k] / C_AU);
  let lon = Math.atan2(a[1], a[0]) / RAD;
  const lat = Math.atan2(a[2], Math.hypot(a[0], a[1])) / RAD;
  // to FK5 (Meeus 32.3)
  const l1 = lon - 1.397 * T - 0.00031 * T * T;
  lon += (-0.09033 + 0.03916 * (cos(l1) + sin(l1)) * Math.tan(lat * RAD)) / 3600;
  return { lon: mod360(lon + nutation(T).dpsi), lat: lat + 0.03916 * (cos(l1) - sin(l1)) / 3600, dist: dist * AU };
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

// The Moon of moonseries.js (1600 to 2400): its apparent longitude (light
// time, about 0.7″, and nutation), latitude and distance
function moonSeries(T) {
  const deg = (c) => c.reduce((s, a, k) => s + a * T ** k, 0) * RAD;
  const L = deg([218.3164477, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000]);
  const D = deg([297.8501921, 445267.1114034, -0.0018819, 1 / 545868, -1 / 113065000]);
  const M = deg([357.5291092, 35999.0502909, -0.0001536, 1 / 24490000]);
  const Mp = deg([134.9633964, 477198.8675055, 0.0087414, 1 / 69699, -1 / 14712000]);
  const F = deg([93.272095, 483202.0175233, -0.0036539, -1 / 3526000, 1 / 863310000]);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T, days = T * 36525;
  const sum = ({ poly, delaunay, fixed }) => {
    let v = poly.reduce((s, a, k) => s + a * T ** k, 0);
    for (let i = 0; i < delaunay.length; i += 6) {
      const [d, m, mp, f, a, b] = delaunay.slice(i, i + 6), x = d * D + m * M + mp * Mp + f * F;
      v += (m === 0 ? 1 : Math.abs(m) === 1 ? E : E ** Math.abs(m)) * (a * Math.sin(x) + b * Math.cos(x));
    }
    for (let i = 0; i < fixed.length; i += 3) v += fixed[i + 1] * Math.sin(fixed[i] * days) + fixed[i + 2] * Math.cos(fixed[i] * days);
    return v;
  };
  const dist = sum(MOON.dist);
  // 13.176° a day, for the time the light takes
  const lon = (L + sum(MOON.lon)) / RAD - 13.176358 / 86400 * dist / 299792.458;
  return { lon: mod360(lon + nutation(T).dpsi), lat: sum(MOON.lat) / RAD, dist };
}

// The Moon of Meeus, far from the present
function moonEcliptic(T) {
  if (Math.abs(T) <= 4) return moonSeries(T);
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

// Apparent geocentric ecliptic longitude and latitude (degrees) and
// distance (km) of a body
const ecliptic = (body, T) => (body === "moon" ? moonEcliptic(T) : planetEcliptic(body, T));

// Right ascension and declination (degrees) of a body, its distance (km):
// apparent, geocentric
function equatorial(body, t) {
  const T = centuries(t);
  const p = ecliptic(body, T);
  const eps = nutation(T).eps;
  return {
    ra: mod360(Math.atan2(sin(p.lon) * cos(eps) - Math.tan(p.lat * RAD) * sin(eps), cos(p.lon)) / RAD),
    dec: Math.asin(sin(p.lat) * cos(eps) + cos(p.lat) * sin(eps) * sin(p.lon)) / RAD,
    dist: p.dist,
  };
}

// The same seen from a place on the surface (WGS 84, at sea level): the
// geocentric position minus the place
function topocentric(body, t, [lat, lon]) {
  const { ra, dec, dist } = equatorial(body, t);
  const lst = siderealTime(t, lon), u = Math.atan(0.99664719 * Math.tan(lat * RAD));
  const rc = 6378.137 * Math.cos(u), rs = 6378.137 * 0.99664719 * Math.sin(u);
  const x = dist * cos(dec) * cos(ra) - rc * cos(lst), y = dist * cos(dec) * sin(ra) - rc * sin(lst);
  const z = dist * sin(dec) - rs;
  return { ra: mod360(Math.atan2(y, x) / RAD), dec: Math.atan2(z, Math.hypot(x, y)) / RAD, dist: Math.hypot(x, y, z) };
}

// The hour angle of a body (degrees, −180 to 180), zero on the meridian
function hourAngle(body, t, lon) {
  return mod360(siderealTime(t, lon) - equatorial(body, t).ra + 180) - 180;
}

// Altitude and azimuth (from north, through east) of a body seen from a
// place, with its parallax. Without refraction.
function horizontal(body, t, place) {
  const { ra, dec, dist } = topocentric(body, t, place);
  const lat = place[0], H = siderealTime(t, place[1]) - ra;
  const alt = Math.asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H)) / RAD;
  const az = mod360(Math.atan2(-cos(dec) * sin(H), sin(dec) * cos(lat) - cos(dec) * sin(lat) * cos(H)) / RAD);
  return { alt, az, dist };
}

// ---------------------------------------------------------------------
// Events

// The first time after t when f crosses zero upwards (rising) or
// downwards, within two days, or null
function crossing(f, t, rising, span = 2 * 86400, step = 600) {
  let a = t, fa = f(a);
  for (let k = 1; k <= span / step; k++) {
    const b = t + k * step;
    const fb = f(b);
    if (rising ? fa < 0 && fb >= 0 : fa > 0 && fb <= 0) {
      let lo = a, hi = b;
      for (let i = 0; i < 60 && hi - lo > 0.05; i++) {
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
// minus its semidiameter, the planets at −34′ (or at h0)
function riseSet(body, t, place, rising, h0 = null) {
  const f = body === "moon"
    ? (x) => { const h = horizontal("moon", x, place); return h.alt + 0.5667 + Math.asin(RADIUS.moon / h.dist) / RAD; }
    : (x) => horizontal(body, x, place).alt - (h0 ?? (body === "sun" ? -0.8333 : -0.5667));
  const e = crossing(f, t, rising);
  if (e === null) return null;
  // how fast the altitude changes, for the uncertainty
  return { t: e, rate: Math.abs(f(e + 30) - f(e - 30)) / 60 };
}

// The next passage of a body on the meridian of a longitude after t
// (upper transit), or null
const transit = (body, t, lon) => crossing((x) => hourAngle(body, x, lon), t, true);

// The elongation of the Moon from the Sun in longitude (degrees)
function elongation(t) {
  const T = centuries(t);
  return mod360(moonEcliptic(T).lon - planetEcliptic("sun", T).lon);
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
  let n = nextPhase(t - 31 * 86400, 0);
  for (let k = nextPhase(n + 86400, 0); k <= t; k = nextPhase(n + 86400, 0)) n = k;
  return { fraction: (1 + cos(aspect("moon", t).phase)) / 2, age: (t - n) / 86400 };
}

// ---------------------------------------------------------------------
// Aspect and brightness

// The geometry of a body: its distances from the Sun (r) and from the
// Earth (delta), and the Earth's from the Sun (R), in km; the phase angle
// (Sun–body–Earth) and the elongation (Sun–Earth–body, positive east of the
// Sun), in degrees
function aspect(body, t) {
  const T = centuries(t);
  const s = ecliptic("sun", T);
  if (body === "sun") return { r: 0, delta: s.dist, R: s.dist, phase: 0, elong: 0 };
  const p = ecliptic(body, T), R = s.dist, D = p.dist;
  const c = Math.max(-1, Math.min(1, sin(s.lat) * sin(p.lat) + cos(s.lat) * cos(p.lat) * cos(p.lon - s.lon)));
  const E = Math.acos(c) / RAD;
  return {
    r: Math.sqrt(R * R + D * D - 2 * R * D * c), delta: D, R,
    phase: Math.atan2(R * sin(E), D - R * cos(E)) / RAD,
    elong: mod360(p.lon - s.lon) < 180 ? E : -E,
  };
}

// Equatorial radii (km, IAU 2015) and north poles (right ascension and
// declination of J2000, degrees) of the bodies
const RADIUS = { sun: 695700, moon: 1737.4, mercury: 2440.53, venus: 6051.8, mars: 3396.19, jupiter: 71492, saturn: 60268, uranus: 25559, neptune: 24764 };
const POLE = { saturn: [40.589, 83.537], uranus: [257.311, -15.175] };

// The latitudes (degrees) of the points of a planet below the Earth and
// below the Sun: for Saturn, the tilts of its rings
function subLatitudes(body, t) {
  const [a0, d0] = POLE[body];
  const vec = ({ ra, dec, dist }) => [dist * cos(dec) * cos(ra), dist * cos(dec) * sin(ra), dist * sin(dec)];
  const p = vec(equatorial(body, t)), s = vec(equatorial("sun", t)), n = [cos(d0) * cos(a0), cos(d0) * sin(a0), sin(d0)];
  const lat = (v) => -Math.asin(v.reduce((x, y, i) => x + y * n[i], 0) / Math.hypot(...v)) / RAD;
  return [lat(p), lat(p.map((x, i) => x - s[i]))];
}

// Visual magnitude: the Sun, the Moon (Allen), and the planets of Mallama
// and Hilton (2018), as in the Astronomical Almanac; Saturn with its rings
function magnitude(body, t) {
  const { r, delta, phase: a } = aspect(body, t);
  const d = 5 * Math.log10(r / AU * delta / AU);
  const poly = (cs) => cs.reduce((s, c, k) => s + c * a ** k, 0);
  switch (body) {
    case "sun": return -26.74 + 5 * Math.log10(delta / AU);
    case "moon": return 0.23 + d + 0.026 * a + 4e-9 * a ** 4;
    case "mercury": return d + poly([-0.613, 6.328e-2, -1.6336e-3, 3.3644e-5, -3.4265e-7, 1.6893e-9, -3.0334e-12]);
    case "venus": return d + (a <= 163.7 ? poly([-4.384, -1.044e-3, 3.687e-4, -2.814e-6, 8.938e-9]) : poly([236.05828, -2.81914, 8.39034e-3]));
    case "mars": return d + (a <= 50 ? poly([-1.601, 2.267e-2, -1.302e-4]) : poly([-0.367, -2.573e-2, 3.445e-4]));
    case "jupiter": {
      if (a <= 12) return d + poly([-9.395, -3.7e-4, 6.16e-4]);
      const x = a / 180;
      return d - 9.428 - 2.5 * Math.log10(1 - 1.507 * x - 0.363 * x ** 2 - 0.062 * x ** 3 + 2.809 * x ** 4 - 1.876 * x ** 5);
    }
    case "saturn": {
      // the tilt of the rings, between the Earth's and the Sun's
      const [e, h] = subLatitudes("saturn", t), b = Math.sqrt(Math.abs(sin(e) * sin(h)));
      return d - 8.914 - 1.825 * b + 0.026 * a - 0.378 * b * Math.exp(-2.25 * a);
    }
    case "uranus": {
      const [e, h] = subLatitudes("uranus", t);
      return d - 7.11 - 8.4e-4 * Math.abs(e + h) / 2 + 6.587e-3 * a + 1.045e-4 * a * a;
    }
    case "neptune": {
      // brighter by 0.11 from 1980 to 2000
      const y = 1970 + t / 31557600;
      return d + (y < 1980 ? -6.89 : y > 2000 ? -7 : -6.89 - 0.11 * (y - 1980) / 20) + 7.944e-3 * a + 9.617e-5 * a * a;
    }
  }
  return NaN;
}

// The apparent equatorial diameter (degrees), seen from the center of the
// Earth or from a place
function diameter(body, t, place) {
  const D = place ? topocentric(body, t, place).dist : equatorial(body, t).dist;
  return 2 * Math.asin(RADIUS[body] / D) / RAD;
}

// ---------------------------------------------------------------------
// The moons of the planets (moons.js)

// A vector of J2000 to the mean equator and equinox of the date (IAU 1976,
// Meeus 21.2), T in Julian centuries
function precessVector([x, y, z], T) {
  const as = RAD / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * as;
  const zz = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * as;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * as;
  const x1 = x * Math.cos(zeta) - y * Math.sin(zeta), y1 = x * Math.sin(zeta) + y * Math.cos(zeta);
  const x2 = x1 * Math.cos(th) - z * Math.sin(th), z2 = x1 * Math.sin(th) + z * Math.cos(th);
  return [x2 * Math.cos(zz) - y1 * Math.sin(zz), x2 * Math.sin(zz) + y1 * Math.cos(zz), z2];
}

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const unit = (a, d) => [cos(d) * cos(a), cos(d) * sin(a), sin(d)];

// Flattening of the planets with moons
const FLATTENING = { mars: 0.00589, jupiter: 0.06487, saturn: 0.09796, uranus: 0.02293, neptune: 0.01708 };

// A planet with moons at the time t: the direction to it (u), east and
// north on the sky there, the sunlight (l, from the Sun), its pole (of the
// date), its distance (km) and the time of its moons (days of TT from
// J2000, when their light left)
function system(planet, t) {
  const sys = MOONS[planet], T = centuries(t);
  const P = equatorial(planet, t), S = equatorial("sun", t);
  const zAxis = unit(sys.pole[0], sys.pole[1]), h = Math.hypot(zAxis[0], zAxis[1]);
  const xAxis = [-zAxis[1] / h, zAxis[0] / h, 0];
  const yAxis = [zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1], zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2], zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0]];
  const u = unit(P.ra, P.dec), east = [-sin(P.ra), cos(P.ra), 0], north = [-sin(P.dec) * cos(P.ra), -sin(P.dec) * sin(P.ra), cos(P.dec)];
  const pv = u.map((x) => x * P.dist), sv = unit(S.ra, S.dec).map((x) => x * S.dist);
  const light = pv.map((x, k) => x - sv[k]), ln = Math.hypot(...light);
  return {
    sys, T, P, u, east, north, l: light.map((x) => x / ln), axes: [xAxis, yAxis, zAxis], pole: precessVector(zAxis, T),
    days: T * 36525 - P.dist / 299792.458 / 86400, f: FLATTENING[planet],
  };
}

// The position of a moon from its planet (km, equator and equinox of the
// date)
function moonVector(g, name) {
  const [zt, wt] = g.sys.moons[name], d = g.days;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < zt.length; i += 3) {
    const c = Math.cos(zt[i] * d), s = Math.sin(zt[i] * d);
    x += zt[i + 1] * c - zt[i + 2] * s;
    y += zt[i + 1] * s + zt[i + 2] * c;
  }
  for (let i = 0; i < wt.length; i += 3) z += wt[i + 1] * Math.cos(wt[i] * d) + wt[i + 2] * Math.sin(wt[i] * d);
  const [ax, ay, az] = g.axes;
  return precessVector([0, 1, 2].map((k) => x * ax[k] + y * ay[k] + z * az[k]), g.T);
}

// How far the line through the moon at v along the direction w passes from
// the planet's center, in radii of the planet stretched along its pole to
// a sphere: below 1, the line meets the planet
function miss(g, v, w) {
  const k = 1 / (1 - g.f), pz = dot(v, g.pole), wz = dot(w, g.pole);
  const q = v.map((x, i) => (x + (k - 1) * pz * g.pole[i]) / g.sys.radius), d = w.map((x, i) => x + (k - 1) * wz * g.pole[i]);
  const dn = Math.hypot(...d), a = dot(q, d) / dn;
  return Math.sqrt(Math.max(0, dot(q, q) - a * a));
}

// What a moon at v is doing: in front of the disk or behind it (transit,
// occulted), in the planet's shadow or casting its shadow on the planet
// (eclipsed, shadow); disk and shade, below 1 then, change continuously
function moonState(g, v) {
  const behind = dot(v, g.u), along = dot(v, g.l), disk = miss(g, v, g.u), shade = miss(g, v, g.l);
  return {
    behind, disk, shade,
    transit: disk < 1 && behind < 0, occulted: disk < 1 && behind > 0, eclipsed: shade < 1 && along > 0, shadow: shade < 1 && along < 0,
  };
}

// Radii of the moons (km)
const MOON_RADIUS = {
  Phobos: 11.1, Deimos: 6.2, Io: 1821.6, Europa: 1560.8, Ganymede: 2634.1, Callisto: 2410.3, Mimas: 198.2, Enceladus: 252.1,
  Tethys: 531.1, Dione: 561.4, Rhea: 763.8, Titan: 2574.7, Hyperion: 135, Iapetus: 734.5, Miranda: 235.8, Ariel: 578.9,
  Umbriel: 584.7, Titania: 788.9, Oberon: 761.4, Triton: 1353.4,
};

// The moons of a planet seen from the center of the Earth: for each, its
// offsets from the planet to the east and to the north (degrees), its
// distance behind the planet's center (km, negative in front), what it is
// doing (moonState), and the error of its position (degrees); and the
// planet's equatorial radius (degrees). For drawing (view): in planet
// radii, on axes to the west, to the north and toward the Earth, the moons
// (x, y, z, radius), the north pole and the direction of the Sun
function moons(planet, t) {
  const g = system(planet, t), { sys, P, u, east, north } = g;
  const toView = (v) => [-dot(v, east), dot(v, north), -dot(v, u)];
  const out = Object.keys(sys.moons).map((name) => {
    const v = moonVector(g, name), st = moonState(g, v), [vx, vy, vz] = toView(v);
    return {
      ...st, name,
      // seen at its own distance, which differs from the planet's by 0.1 %
      // for Callisto
      east: Math.atan2(dot(v, east), P.dist + st.behind) / RAD, north: Math.atan2(dot(v, north), P.dist + st.behind) / RAD,
      err: sys.moons[name][2] / P.dist / RAD,
      view: { x: vx / sys.radius, y: vy / sys.radius, z: vz / sys.radius, r: (MOON_RADIUS[name] || 0) / sys.radius },
    };
  });
  return { moons: out, radius: Math.asin(sys.radius / P.dist) / RAD, pole: toView(g.pole), sun: toView(g.l.map((x) => -x)) };
}

// The planet of a moon, or undefined
const planetOf = (name) => Object.keys(MOONS).find((p) => MOONS[p].moons[name]);

// The transits, shadows on the planet, eclipses and occultations of a moon
// that end after t and begin within the next days: [kind, begin, end] in
// time order, the times of the moon's center (to a second); events under
// way at t begin before it
function moonEvents(name, t, days = 30) {
  const planet = planetOf(name), step = 300;
  const at = (x) => { const g = system(planet, x); return moonState(g, moonVector(g, name)); };
  // the time when the quantity q crosses 1, between a and b
  const edge = (q, a, b) => {
    const below = q(at(a)) < 1;
    for (let i = 0; i < 40 && b - a > 0.5; i++) {
      const m = (a + b) / 2;
      if ((q(at(m)) < 1) === below) a = m; else b = m;
    }
    return (a + b) / 2;
  };
  const open = {}, out = [];
  let prev = at(t - 86400), x0 = t - 86400;
  for (let x = x0 + step; x <= t + days * 86400 + 86400; x += step) {
    const cur = at(x);
    for (const [kinds, q] of [[["transit", "occulted"], (s) => s.disk], [["shadow", "eclipsed"], (s) => s.shade]]) {
      const was = q(prev) < 1, is = q(cur) < 1;
      if (was === is) continue;
      const e = edge(q, x - step, x);
      if (is) open[kinds.find((k) => cur[k]) || kinds[0]] = e;
      else {
        const kind = kinds.find((k) => prev[k]) || kinds[0];
        if (open[kind] !== undefined && e > t && open[kind] <= t + days * 86400) out.push([kind, open[kind], e]);
        delete open[kind];
      }
    }
    prev = cur;
    x0 = x;
  }
  return out.sort((a, b) => a[1] - b[1]);
}

// ---------------------------------------------------------------------
// Eclipses

const R_EARTH = 6378.137, R_SUN = 695700;
const vec = ({ ra, dec, dist }) => [dist * cos(dec) * cos(ra), dist * cos(dec) * sin(ra), dist * sin(dec)];
const sep = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / Math.hypot(...a) / Math.hypot(...b)))) / RAD;

// the time of the least of f within h seconds of t (golden section)
function least(f, t, h) {
  let a = t - h, b = t + h;
  for (let i = 0; i < 60 && b - a > 0.5; i++) {
    const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
    if (f(m1) < f(m2)) b = m2; else a = m1;
  }
  return (a + b) / 2;
}
// the time between a and b where f, monotonic there, is zero, or null
function zero(f, a, b) {
  let fa = f(a);
  if ((fa < 0) === (f(b) < 0)) return null;
  for (let i = 0; i < 60 && b - a > 0.2; i++) {
    const m = (a + b) / 2, fm = f(m);
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

// A lunar eclipse at the time t: the Moon's distance from the axis of the
// Earth's shadow, the radii of the umbra and penumbra (Danjon: the Earth
// larger by 1/85), and the Moon's (degrees)
function lunarAt(t) {
  const m = equatorial("moon", t), s = equatorial("sun", t);
  const pm = Math.asin(R_EARTH / m.dist) / RAD, ps = Math.asin(R_EARTH / s.dist) / RAD, ss = Math.asin(R_SUN / s.dist) / RAD;
  return {
    d: sep(vec(m), vec(s).map((x) => -x)), moon: Math.asin(1737.4 / m.dist) / RAD,
    umbra: 1.01 * pm + ps - ss, penumbra: 1.01 * pm + ps + ss,
  };
}

// The next lunar eclipse after t (by the full moons): its kind, umbral and
// penumbral magnitudes, maximum and contacts (Unix times, null when there
// is no such phase)
function lunarEclipse(t) {
  let full = nextPhase(t, 180);
  for (let n = 0; n < 60; n++, full = nextPhase(full + 86400, 180)) {
    const max = least((x) => lunarAt(x).d, full, 0.3 * 86400), g = lunarAt(max);
    const pen = (g.penumbra + g.moon - g.d) / (2 * g.moon), umb = (g.umbra + g.moon - g.d) / (2 * g.moon);
    if (pen <= 0 || max < t) continue;
    const contact = (r, sign, side) => {
      const f = (x) => { const a = lunarAt(x); return a.d - (a[r] + sign * a.moon); };
      return side < 0 ? zero(f, max - 0.4 * 86400, max) : zero(f, max, max + 0.4 * 86400);
    };
    return {
      kind: umb >= 1 ? "total" : umb > 0 ? "partial" : "penumbral", umbral: umb, penumbral: pen, max,
      P1: contact("penumbra", 1, -1), U1: umb > 0 ? contact("umbra", 1, -1) : null, U2: umb >= 1 ? contact("umbra", -1, -1) : null,
      U3: umb >= 1 ? contact("umbra", -1, 1) : null, U4: umb > 0 ? contact("umbra", 1, 1) : null, P4: contact("penumbra", 1, 1),
    };
  }
  return null;
}

// The Moon's shadow at the time t, on the Earth made a sphere (its axes
// stretched to the polar radius): the closest approach of the shadow's
// axis to the Earth's center (gamma, Earth radii, positive north) and the
// radii of the penumbra and of the umbra there and at the surface (Earth
// radii; the umbra negative past its tip, where the eclipse is annular)
function shadowAt(t) {
  const k = 1 / 0.99664719, st = (v) => [v[0], v[1], v[2] * k].map((x) => x / R_EARTH);
  const m = st(vec(equatorial("moon", t))), s = st(vec(equatorial("sun", t)));
  const ms = m.map((x, i) => x - s[i]), len = Math.hypot(...ms), d = ms.map((x) => x / len);
  // from the Moon along the axis to the plane through the Earth's center
  const along = -dot(m, d), foot = m.map((x, i) => x + along * d[i]), gamma = Math.hypot(...foot);
  const rm = 1737.4 / R_EARTH, rs = R_SUN / R_EARTH;
  const f1 = (rs + rm) / len, f2 = (rs - rm) / len;
  const surf = along - Math.sqrt(Math.max(0, 1 - gamma * gamma));
  // from the point under the axis to the Moon and to the Sun (km)
  return {
    gamma: Math.sign(foot[2]) * gamma, penumbra: rm + along * f1, umbra: rm - along * f2, umbraSurface: rm - surf * f2,
    toMoon: surf * R_EARTH, toSun: (surf + len) * R_EARTH,
  };
}

// The next solar eclipse after t (by the new moons): kind (total, annular,
// hybrid, partial), the time of greatest eclipse (the shadow's axis closest
// to the Earth's center), gamma and the magnitude there
function solarEclipse(t) {
  let nm = nextPhase(t, 0);
  for (let n = 0; n < 60; n++, nm = nextPhase(nm + 86400, 0)) {
    const max = least((x) => Math.abs(shadowAt(x).gamma), nm, 0.3 * 86400), g = shadowAt(max), a = Math.abs(g.gamma);
    if (a > 1 + g.penumbra || max < t) continue;
    // the umbra still open (positive) at the Earth: total; past its tip: annular
    let kind = "partial", magnitude = (g.penumbra - (a - 1)) / (g.penumbra - g.umbra);
    if (a < 1) {
      kind = g.umbra > 0 && g.umbraSurface > 0 ? "total" : g.umbra < 0 && g.umbraSurface < 0 ? "annular" : "hybrid";
      // the ratio of the apparent diameters, under the axis
      magnitude = (1737.4 / g.toMoon) / (R_SUN / g.toSun);
    }
    return { kind, max, gamma: g.gamma, magnitude };
  }
  return null;
}

// The Moon's shadow at t, the Earth made a sphere of radius 1 (its axes
// stretched to the polar radius): the axis d (away from the Sun), axes e1,
// e2 across it, the foot of the axis (x0, y0) on the plane through the
// Earth's center, the Moon's height zm along d, its radius rm, the slopes of
// the penumbra (f1) and of the umbra (f2), and the sidereal time (degrees)
function shadowGeometry(t) {
  const k = 1 / 0.99664719, st = (v) => [v[0], v[1], v[2] * k].map((x) => x / R_EARTH);
  const m = st(vec(equatorial("moon", t))), s = st(vec(equatorial("sun", t)));
  const ms = m.map((x, i) => x - s[i]), len = Math.hypot(...ms), d = ms.map((x) => x / len);
  const h = Math.hypot(d[0], d[1]), e1 = [-d[1] / h, d[0] / h, 0];
  const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
  const rm = 1737.4 / R_EARTH, rs = R_SUN / R_EARTH;
  return { d, e1, e2, x0: dot(m, e1), y0: dot(m, e2), zm: dot(m, d), rm, f1: (rs + rm) / len, f2: (rs - rm) / len, gast: siderealTime(t, 0) };
}

// Lines of equal value of a grid (rows of latitudes lats, columns of
// longitudes lons; NaN where there is none) at the level: [lat, lon] lines
function contour(grid, lats, lons, level) {
  const segs = [];
  // the crossing on an edge, the same from both of its cells
  const at = (i, j, i2, j2) => {
    if (i2 < i || (i2 === i && j2 < j)) [i, j, i2, j2] = [i2, j2, i, j];
    const a = grid[i][j], b = grid[i2][j2], f = (level - a) / (b - a);
    return [lats[i] + f * (lats[i2] - lats[i]), lons[j] + f * (lons[j2] - lons[j])];
  };
  for (let i = 0; i + 1 < lats.length; i++) {
    for (let j = 0; j + 1 < lons.length; j++) {
      const v = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]];
      if (v.some((x) => Number.isNaN(x))) continue;
      // the edges of the cell where the level is crossed
      const edges = [[i, j, i, j + 1], [i, j + 1, i + 1, j + 1], [i + 1, j + 1, i + 1, j], [i + 1, j, i, j]]
        .filter((e, n) => (v[n] < level) !== (v[(n + 1) % 4] < level)).map((e) => at(...e));
      if (edges.length === 2) segs.push(edges);
      else if (edges.length === 4) segs.push([edges[0], edges[1]], [edges[2], edges[3]]);
    }
  }
  // the segments joined into lines
  // −180° and 180° are the same longitude: lines go on across it
  const key = (p) => `${p[0].toFixed(4)},${(p[1] === -180 ? 180 : p[1]).toFixed(4)}`, ends = new Map(), used = new Set(), lines = [];
  segs.forEach((sg, n) => sg.forEach((p) => { const k = key(p); ends.set(k, [...(ends.get(k) || []), n]); }));
  segs.forEach((sg, n) => {
    if (used.has(n)) return;
    used.add(n);
    const line = [...sg];
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? line[line.length - 1] : line[0];
        const next = (ends.get(key(tip)) || []).find((m) => !used.has(m));
        if (next === undefined) break;
        used.add(next);
        const [a, b] = segs[next], p = key(a) === key(tip) ? b : a;
        if (forward) line.push(p); else line.unshift(p);
      }
    }
    lines.push(line.map((p) => p.map((x) => Math.round(x * 10) / 10)));
  });
  return lines;
}

// The value of a grid at a point, between its nodes (bilinear)
function sample(grid, lats, lons, [la, lo]) {
  const di = lats[1] - lats[0], dj = lons[1] - lons[0];
  const i = Math.min(lats.length - 2, Math.max(0, Math.floor((la - lats[0]) / di)));
  const j = Math.min(lons.length - 2, Math.max(0, Math.floor((lo - lons[0]) / dj)));
  const u = (la - lats[i]) / di, v = (lo - lons[j]) / dj;
  return (1 - u) * ((1 - v) * grid[i][j] + v * grid[i][j + 1]) + u * ((1 - v) * grid[i + 1][j] + v * grid[i + 1][j + 1]);
}

// The parts of lines where all the grids are positive, cut where one of
// them changes sign
function clip(lines, grids, lats, lons) {
  const out = [];
  for (const line of lines) {
    let cur = [];
    const vals = line.map((p) => grids.map((g) => sample(g, lats, lons, p)));
    const ok = (k) => vals[k].every((x) => x > 0);
    for (let k = 0; k < line.length; k++) {
      if (k > 0 && ok(k) !== ok(k - 1)) {
        // where the first grid that changes sign crosses zero
        let f = 0.5;
        vals[k].forEach((x, n) => {
          const y = vals[k - 1][n];
          if ((x > 0) !== (y > 0)) f = y / (y - x);
        });
        const p = line[k - 1].map((c, n) => Math.round((c + f * (line[k][n] - c)) * 10) / 10);
        cur.push(p);
        if (!ok(k)) { if (cur.length > 1) out.push(cur); cur = []; } else cur = [p];
      }
      if (ok(k)) cur.push(line[k]);
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

// For a solar eclipse with its greatest phase at tmax, on a grid of 1.5° of
// the Earth, every minute: lines of the UTC hours (from 0h of the day of
// tmax) when the partial eclipse begins and ends where the Sun is up then
// (begin, end: [hour, lines]); the outline of where some of it is seen;
// and the lines where it begins, is greatest and ends at sunrise or sunset
// (rise: { begin, max, end })
function eclipseContours(tmax) {
  const day = Math.floor(tmax / 86400) * 86400, ts = [];
  for (let t = tmax - 4 * 3600; t <= tmax + 4 * 3600; t += 60) ts.push(t);
  const G = ts.map(shadowGeometry);
  const cg = G.map((g) => Math.cos(g.gast * RAD)), sg = G.map((g) => Math.sin(g.gast * RAD));
  const lats = [], lons = [];
  for (let la = -90; la <= 90; la += 1.5) lats.push(la);
  for (let lo = -180; lo <= 180; lo += 1.5) lons.push(lo);
  // for each place: how deep in the penumbra at most (deep), whether some of
  // the eclipse is seen with the Sun up (seen), the hours of its beginning
  // and end (else of the closest approach) and the height of the Sun then
  // (zeta, negative when it is up)
  const F = { deep: [], seen: [], begin: [], end: [], zBegin: [], zEnd: [], zMax: [] };
  for (const la of lats) {
    const u = Math.atan(0.99664719 * Math.tan(la * RAD)), cu = Math.cos(u), su = Math.sin(u);
    const row = Object.fromEntries(Object.keys(F).map((k) => [k, []]));
    for (const lo of lons) {
      const cl = Math.cos(lo * RAD), sl = Math.sin(lo * RAD);
      let first = null, last = null, best = null, seen = -Infinity, prev = null;
      G.forEach((g, n) => {
        const P = [cu * (cl * cg[n] - sl * sg[n]), cu * (sl * cg[n] + cl * sg[n]), su];
        const xi = dot(P, g.e1), eta = dot(P, g.e2), zeta = dot(P, g.d);
        const inside = g.rm + (zeta - g.zm) * g.f1 - Math.hypot(xi - g.x0, eta - g.y0);
        seen = Math.max(seen, Math.min(inside, -zeta));
        if (prev) {
          const f = prev.inside / (prev.inside - inside), t = ts[n - 1] + 60 * f, z = prev.zeta + f * (zeta - prev.zeta);
          if (prev.inside <= 0 && inside > 0 && !first) first = { t, z };
          if (prev.inside > 0 && inside <= 0) last = { t, z };
        }
        if (!best || inside > best.inside) best = { inside, zeta, t: ts[n] };
        prev = { inside, zeta };
      });
      // no contact: the closest approach, for both
      first = first || best;
      last = last || best;
      row.deep.push(best.inside);
      row.seen.push(seen);
      row.begin.push((first.t - day) / 3600);
      row.end.push((last.t - day) / 3600);
      row.zBegin.push(first.z ?? first.zeta);
      row.zEnd.push(last.z ?? last.zeta);
      row.zMax.push(best.zeta);
    }
    for (const k of Object.keys(F)) F[k].push(row[k]);
  }
  const neg = (g) => g.map((r) => r.map((x) => -x));
  // the hours, where the eclipse is and the Sun up at that contact
  const hours = (grid, z) => {
    const within = [F.deep, neg(z)], out = [];
    const deep = F.deep.flat(), vals = grid.flat().filter((x, n) => deep[n] > 0);
    if (!vals.length) return out;
    for (let h = Math.ceil(Math.min(...vals)); h <= Math.floor(Math.max(...vals)); h++) {
      const lines = clip(contour(grid, lats, lons, h), within, lats, lons);
      if (lines.length) out.push([h, lines]);
    }
    return out;
  };
  const rise = (z) => clip(contour(z, lats, lons, 0), [F.deep], lats, lons);
  return {
    begin: hours(F.begin, F.zBegin), end: hours(F.end, F.zEnd), outline: contour(F.seen, lats, lons, 0),
    rise: { begin: rise(F.zBegin), max: rise(F.zMax), end: rise(F.zEnd) },
  };
}

// The track of a solar eclipse on the Earth around its greatest phase at
// tmax, every two minutes: the central line, the limits of the umbra
// (north and south: of totality or of the annular phase) and of the
// penumbra (of the partial eclipse), as segments of [latitude, longitude]
// (geodetic, degrees; the central line with the UTC hour, from 0h of the
// day); the band of the central phase, as pairs of points of its limits,
// and at its ends the footprints of the umbra; the point of greatest eclipse and the one with the Sun overhead
// then; and the lines of the times of eclipseContours
function eclipseTrack(tmax) {
  const k = 1 / 0.99664719, f2e = 0.99330562;
  const geo = (P, gast) => {
    const z = P[2] / k, lon = mod360(Math.atan2(P[1], P[0]) / RAD - gast + 180) - 180;
    return [Math.atan2(z, f2e * Math.hypot(P[0], P[1])) / RAD, lon];
  };
  const shadow = shadowGeometry;
  // the point of the sunlit side of the Earth at (x, y) on the plane, or null
  const surface = (g, x, y) => {
    const r2 = x * x + y * y;
    if (r2 > 1) return null;
    const z = -Math.sqrt(1 - r2);
    return geo([0, 1, 2].map((i) => x * g.e1[i] + y * g.e2[i] + z * g.d[i]), g.gast);
  };
  // the radius of a cone (penumbra: +1, umbra: −1) at the height z
  const radius = (g, sign, z) => g.rm + sign * (z - g.zm) * (sign > 0 ? g.f1 : g.f2);
  // the points at a cone's radius from the axis across its motion, or null
  // off the Earth's sunlit side
  const edge = (g, n, sign, side) => {
    let z = -Math.sqrt(Math.max(0, 1 - g.x0 * g.x0 - g.y0 * g.y0)), x, y;
    for (let i = 0; i < 3; i++) {
      const r = Math.abs(radius(g, sign, z));
      x = g.x0 + side * r * n[0];
      y = g.y0 + side * r * n[1];
      z = -Math.sqrt(Math.max(0, 1 - x * x - y * y));
    }
    return surface(g, x, y);
  };
  const curves = { center: [[]], umbraN: [[]], umbraS: [[]], penN: [[]], penS: [[]] }, band = [], ends = [];
  const push = (name, p) => {
    const c = curves[name], seg = c[c.length - 1];
    if (p) seg.push(p.map((x) => Math.round(x * 100) / 100));
    else if (seg.length) c.push([]);
  };
  // every two minutes, every 15 s where the axis grazes the Earth (the
  // ends of the path, which stretch there)
  for (let t = tmax - 4 * 3600, step = 120; t <= tmax + 4 * 3600; t += step) {
    const g = shadow(t), a = shadow(t - 30), b = shadow(t + 30);
    step = Math.abs(Math.hypot(g.x0, g.y0) - 1) < 0.1 ? 15 : 120;
    const vx = b.x0 - a.x0, vy = b.y0 - a.y0, vn = Math.hypot(vx, vy), n = [-vy / vn, vx / vn];
    // north first: the side toward the north pole of the plane
    const north = n[1] * 1 >= 0 ? 1 : -1;
    const central = g.x0 * g.x0 + g.y0 * g.y0 < 1;
    const c = central ? surface(g, g.x0, g.y0) : null;
    push("center", c && [...c, (t - Math.floor(tmax / 86400) * 86400) / 3600]);
    const uN = central ? edge(g, n, -1, north) : null, uS = central ? edge(g, n, -1, -north) : null;
    push("umbraN", uN);
    push("umbraS", uS);
    // the band of the central phase, by pairs of its limits
    band.push(uN && uS ? [...uN, ...uS].map((x) => Math.round(x * 100) / 100) : null);
    // at the ends of the path, where a limit has left the Earth's sunlit
    // side, the footprint of the umbra, cut at the terminator
    if (central && (!uN || !uS)) {
      const z0 = -Math.sqrt(1 - g.x0 * g.x0 - g.y0 * g.y0), L = Math.abs(radius(g, -1, z0)), poly = [];
      for (let i = 0; i < 24; i++) {
        let x = g.x0 + L * Math.cos(i * Math.PI / 12), y = g.y0 + L * Math.sin(i * Math.PI / 12);
        const r = Math.hypot(x, y);
        if (r > 0.99999) { x *= 0.99999 / r; y *= 0.99999 / r; }
        poly.push(surface(g, x, y).map((v) => Math.round(v * 100) / 100));
      }
      ends.push(poly);
    }
    push("penN", edge(g, n, 1, north));
    push("penS", edge(g, n, 1, -north));
  }
  for (const c of Object.values(curves)) if (!c[c.length - 1].length) c.pop();
  const g = shadow(tmax), rr = Math.hypot(g.x0, g.y0), S = equatorial("sun", tmax);
  const greatest = rr < 1 ? surface(g, g.x0, g.y0) : surface(g, g.x0 / rr * 0.9999, g.y0 / rr * 0.9999);
  return { ...curves, band, ends, greatest, sun: [S.dec, mod360(S.ra - siderealTime(tmax, 0) + 180) - 180], ...eclipseContours(tmax) };
}

// A solar eclipse seen from a place at the time t: the distance between
// the centers of the Sun and the Moon and their apparent radii (degrees)
function solarLocalAt(t, place) {
  const m = topocentric("moon", t, place), s = topocentric("sun", t, place);
  return { d: sep(vec(m), vec(s)), moon: Math.asin(1737.4 / m.dist) / RAD, sun: Math.asin(R_SUN / s.dist) / RAD };
}

// the part of the Sun's disk (radius R) that the Moon's (radius r) at the
// distance d covers
function obscuration(R, r, d) {
  if (d >= R + r) return 0;
  if (d <= Math.abs(R - r)) return r >= R ? 1 : (r / R) ** 2;
  const a = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r)) + R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R))
    - 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  return a / (Math.PI * R * R);
}

// The solar eclipse with its greatest phase near t seen from a place: its
// kind there, magnitude, obscuration, the maximum and the contacts (C2, C3
// null when not central there), the altitudes of the Sun at the contacts
// and at the maximum; or null when the Moon does not cover the Sun there
function solarLocal(t, place) {
  const max = least((x) => solarLocalAt(x, place).d, t, 3 * 3600), g = solarLocalAt(max, place);
  if (g.d >= g.sun + g.moon) return null;
  const outer = (x) => { const a = solarLocalAt(x, place); return a.d - (a.sun + a.moon); };
  const inner = (x) => { const a = solarLocalAt(x, place); return a.d - Math.abs(a.sun - a.moon); };
  const C1 = zero(outer, max - 4 * 3600, max), C4 = zero(outer, max, max + 4 * 3600);
  const central = g.d < Math.abs(g.sun - g.moon);
  const alt = (x) => (x === null ? null : horizontal("sun", x, place).alt);
  const e = {
    kind: central ? (g.moon > g.sun ? "total" : "annular") : "partial", max, C1, C4,
    C2: central ? zero(inner, C1, max) : null, C3: central ? zero(inner, max, C4) : null,
    magnitude: (g.sun + g.moon - g.d) / (2 * g.sun), obscuration: obscuration(g.sun, g.moon, g.d),
  };
  return { ...e, altC1: alt(e.C1), altMax: alt(max), altC4: alt(e.C4) };
}

// Local sidereal time in degrees (apparent: with the equation of the
// equinoxes)
function siderealTime(t, lon) {
  const T = centuries(t);
  const n = nutation(T);
  return mod360(gmst(t) + n.dpsi * cos(n.eps) + lon);
}

// ---------------------------------------------------------------------
// Equinoxes and solstices (Meeus, chapter 27, for the years −1000 to
// 3000): k = 0 March equinox, 1 June solstice, 2 September equinox,
// 3 December solstice

// mean times: before 1000, in thousands of years from 0; after, from 2000
const SEASON_MEAN_0 = [
  [1721139.29189, 365242.1374, 0.06134, 0.00111, -0.00071],
  [1721233.25401, 365241.72562, -0.05323, 0.00907, 0.00025],
  [1721325.70455, 365242.49558, -0.11677, -0.00297, 0.00074],
  [1721414.39987, 365242.88257, -0.00769, -0.00933, -0.00006],
];
const SEASON_MEAN = [
  [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003],
  [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
];
const SEASON_TERMS = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112],
  [156, 73.14, 45036.886], [136, 171.52, 22518.443], [77, 222.54, 65928.934], [74, 296.72, 3034.906],
  [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328],
  [17, 288.79, 4562.452], [16, 198.04, 62894.029], [14, 199.76, 31436.921], [12, 95.39, 14577.848],
  [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];

// The Unix time (UT) of an equinox or solstice, or null out of range
function season(year, k) {
  if (!(year >= -1000 && year <= 3000)) return null;
  const [mean, Y] = year < 1000 ? [SEASON_MEAN_0, year / 1000] : [SEASON_MEAN, (year - 2000) / 1000];
  const jde0 = mean[k].reduce((s, c, i) => s + c * Y ** i, 0);
  const T = (jde0 - 2451545) / 36525;
  const W = 35999.373 * T - 2.47;
  const dl = 1 + 0.0334 * cos(W) + 0.0007 * cos(2 * W);
  const S = SEASON_TERMS.reduce((s, [a, b, c]) => s + a * cos(b + c * T), 0);
  return (jde0 + 0.00001 * S / dl - 2440587.5) * 86400 - deltaT(year);
}

// The apparent longitude of the Sun (degrees) at the Unix time t
const solarLongitude = (t) => planetEcliptic("sun", centuries(t)).lon;

export { aspect, magnitude, diameter, transit, moons, moonEvents, planetOf, lunarEclipse, solarEclipse, shadowAt, solarLocal, eclipseTrack, elongation, solarLongitude, equatorial, topocentric, ecliptic, centuries, nutation, horizontal, riseSet, crossing, nextPhase, moonPhase, siderealTime, season, hourAngle, deltaT };
