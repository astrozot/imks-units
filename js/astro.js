// The Sun, the Moon and the planets: positions, rising and setting, phases
// and sidereal time, after Meeus, "Astronomical Algorithms" (the Moon of
// chapter 47 with its largest terms; the Sun and the planets from VSOP87,
// in vsop87.js). Times are Unix seconds (UT), angles degrees, places
// [latitude, longitude] in degrees, east positive. The bodies are "sun",
// "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus" and
// "neptune".

import { VSOP87 } from "./vsop87.js";
import { MOONS } from "./moons.js";

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

// The moons of a planet seen from the center of the Earth: for each, its
// offsets from the planet to the east and to the north (degrees), its
// distance behind the planet's center (km, negative in front), whether it
// is in front of the disk (transit), behind it (occulted), in the planet's
// shadow (eclipsed) or casting its shadow on the planet, and the error of
// its position (degrees); and the planet's
// equatorial radius (degrees), the position angle of its north pole and
// the latitude of the Earth over its equator (degrees)
function moons(planet, t) {
  const sys = MOONS[planet], T = centuries(t);
  const P = equatorial(planet, t), S = equatorial("sun", t);
  // the moons where they were when the light left them
  const days = T * 36525 - P.dist / 299792.458 / 86400;
  const toDate = (v) => precessVector(v, T);
  const zAxis = unit(sys.pole[0], sys.pole[1]), h = Math.hypot(zAxis[0], zAxis[1]);
  const xAxis = [-zAxis[1] / h, zAxis[0] / h, 0];
  const yAxis = [zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1], zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2], zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0]];
  // toward the planet, to the east and to the north on the sky
  const u = unit(P.ra, P.dec), east = [-sin(P.ra), cos(P.ra), 0], north = [-sin(P.dec) * cos(P.ra), -sin(P.dec) * sin(P.ra), cos(P.dec)];
  // the sunlight at the planet
  const pv = u.map((x) => x * P.dist), sv = unit(S.ra, S.dec).map((x) => x * S.dist);
  const light = pv.map((x, k) => x - sv[k]), ln = Math.hypot(...light), l = light.map((x) => x / ln);
  const pole = toDate(zAxis);
  const out = Object.entries(sys.moons).map(([name, [zt, wt, err]]) => {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < zt.length; i += 3) {
      const c = Math.cos(zt[i] * days), s = Math.sin(zt[i] * days);
      x += zt[i + 1] * c - zt[i + 2] * s;
      y += zt[i + 1] * s + zt[i + 2] * c;
    }
    for (let i = 0; i < wt.length; i += 3) z += wt[i + 1] * Math.cos(wt[i] * days) + wt[i + 2] * Math.sin(wt[i] * days);
    const v = toDate([0, 1, 2].map((k) => x * xAxis[k] + y * yAxis[k] + z * zAxis[k]));
    const behind = dot(v, u), across = Math.hypot(dot(v, east), dot(v, north));
    const along = dot(v, l), off = Math.sqrt(Math.max(0, dot(v, v) - along * along));
    const disk = across < sys.radius, shade = off < sys.radius;
    return {
      // seen at its own distance, which differs from the planet's by 0.1 %
      // for Callisto
      name, east: Math.atan2(dot(v, east), P.dist + behind) / RAD, north: Math.atan2(dot(v, north), P.dist + behind) / RAD, behind, err: err / P.dist / RAD,
      transit: disk && behind < 0, occulted: disk && behind > 0, eclipsed: shade && along > 0, shadow: shade && along < 0,
    };
  });
  return {
    moons: out, radius: Math.asin(sys.radius / P.dist) / RAD,
    pa: mod360(Math.atan2(dot(pole, east), dot(pole, north)) / RAD), tilt: -Math.asin(dot(pole, u)) / RAD,
  };
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

export { aspect, magnitude, diameter, transit, moons, elongation, solarLongitude, equatorial, topocentric, ecliptic, centuries, nutation, horizontal, riseSet, crossing, nextPhase, moonPhase, siderealTime, season, hourAngle, deltaT };
