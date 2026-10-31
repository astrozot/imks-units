// The Sun and the Moon: positions, rising and setting, phases and sidereal
// time, after Meeus, "Astronomical Algorithms" (the Sun of chapter 25, the
// Moon of chapter 47 with its largest terms). Times are Unix seconds (UT),
// angles degrees, places [latitude, longitude] in degrees, east positive.

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
// Right ascension and declination (degrees) of a body, its distance (km)
function equatorial(body, t) {
  const T = centuries(t);
  const p = body === "moon" ? moonEcliptic(T) : sunEcliptic(T);
  const eps = nutation(T).eps;
  return {
    ra: Math.atan2(sin(p.lon) * cos(eps) - Math.tan(p.lat * RAD) * sin(eps), cos(p.lon)) / RAD,
    dec: Math.asin(sin(p.lat) * cos(eps) + cos(p.lat) * sin(eps) * sin(p.lon)) / RAD,
    dist: p.dist,
  };
}

// The hour angle of a body (degrees, −180 to 180), zero on the meridian
function hourAngle(body, t, lon) {
  return mod360(siderealTime(t, lon) - equatorial(body, t).ra + 180) - 180;
}

function horizontal(body, t, [lat, lon]) {
  const { dec, dist } = equatorial(body, t);
  const H = hourAngle(body, t, lon);
  let alt = Math.asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H)) / RAD;
  const az = mod360(Math.atan2(-cos(dec) * sin(H), sin(dec) * cos(lat) - cos(dec) * sin(lat) * cos(H)) / RAD);
  if (body === "moon") alt -= Math.asin(6378.14 / dist) / RAD * cos(alt);
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
const solarLongitude = (t) => sunEcliptic(centuries(t)).lon;

export { elongation, solarLongitude, horizontal, riseSet, crossing, nextPhase, moonPhase, siderealTime, season, hourAngle, deltaT };
