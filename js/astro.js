// The Sun, the Moon and the planets: positions, rising and setting, phases
// and sidereal time, after Meeus, "Astronomical Algorithms" (the Moon of
// chapter 47 with its largest terms; the Sun and the planets from VSOP87,
// in vsop87.js). Times are Unix seconds (UT), angles degrees, places
// [latitude, longitude] in degrees, east positive, or [latitude,
// longitude, height] with the height above sea level in metres. The bodies
// are "sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn",
// "uranus" and "neptune"; a star or other object outside the solar
// system, as { ra, dec, pmra, pmdec, plx, rv } (ICRS, epoch J2000: degrees,
// mas/yr with μα cos δ, mas, km/s); a minor planet or a comet, as { orbit:
// { q, e, i, node, peri, tp } } (heliocentric, ecliptic and equinox of
// J2000: au, degrees, the time of perihelion as a Julian day of TT) or as
// { orbits: [[epoch (Julian day), q, e, i, node, peri, tp]…] }, the
// elements of the epoch nearest to the date; or an artificial satellite,
// as { sgp4, epoch } (sgp4.js, the epoch in Unix seconds).

import { VSOP87 } from "./vsop87.js";
import { MOONS } from "./moons.js";
import { MOON } from "./moonseries.js";
import { sgp4 } from "./sgp4.js";

const RAD = Math.PI / 180;
const sin = (x) => Math.sin(x * RAD), cos = (x) => Math.cos(x * RAD);
const mod360 = (x) => x - 360 * Math.floor(x / 360);

// ---------------------------------------------------------------------
// Time

const jdOf = (t) => t / 86400 + 2440587.5;

// TT − UT in seconds: the polynomials of Espenak and Meeus (2006) from −500
// to 2005, fitted to ancient eclipses, then to occultations and to
// measurements; measured values to 2026; after them the parabola of
// Morrison and Stephenson (2004), the mean slowing by the tides (which
// also holds before −500), from the last value, its rate going from the
// present one to that of the parabola in some fifty years
const parabola = (y) => -20 + 32 * ((y - 1820) / 100) ** 2;
// [first year, origin, years per unit, coefficients]
const DELTA_T_POLY = [
  [-500, 0, 100, [10583.6, -1014.41, 33.78311, -5.952053, -0.1798452, 0.022174192, 0.0090316521]],
  [500, 1000, 100, [1574.2, -556.01, 71.23472, 0.319781, -0.8503463, -0.005050998, 0.0083572073]],
  [1600, 1600, 1, [120, -0.9808, -0.01532, 1 / 7129]],
  [1700, 1700, 1, [8.83, 0.1603, -0.0059285, 0.00013336, -1 / 1174000]],
  [1800, 1800, 1, [13.72, -0.332447, 0.0068612, 0.0041116, -0.00037436, 0.0000121272, -0.0000001699, 0.000000000875]],
  [1860, 1860, 1, [7.62, 0.5737, -0.251754, 0.01680668, -0.0004473624, 1 / 233174]],
  [1900, 1900, 1, [-2.79, 1.494119, -0.0598939, 0.0061966, -0.000197]],
  [1920, 1920, 1, [21.2, 0.84493, -0.0761, 0.0020936]],
  [1941, 1950, 1, [29.07, 0.407, -1 / 233, 1 / 2547]],
  [1961, 1975, 1, [45.45, 1.067, -1 / 260, -1 / 718]],
  [1986, 2000, 1, [63.86, 0.3345, -0.060374, 0.0017275, 0.000651814, 0.00002373599]],
];
const DELTA_T = [[2005, 64.69], [2010, 66.07], [2015, 67.64], [2020, 69.36], [2026, 69.2]];

function deltaT(y) {
  const last = DELTA_T.at(-1);
  if (y < DELTA_T_POLY[0][0]) return parabola(y);
  if (y < DELTA_T[0][0]) {
    const [, y0, unit, c] = DELTA_T_POLY.findLast(([from]) => from <= y), u = (y - y0) / unit;
    return c.reduceRight((s, a) => s * u + a, 0);
  }
  if (y >= last[0]) {
    // the rate of the last ten years, against that of the parabola
    const [y0, d0] = last, tau = 50;
    const dr = (d0 - deltaT(y0 - 10)) / 10 - 64 * (y0 - 1820) / 1e4;
    return d0 + parabola(y) - parabola(y0) + dr * tau * (1 - Math.exp(-(y - y0) / tau));
  }
  const i = DELTA_T.findIndex(([x]) => x > y);
  const [x0, d0] = DELTA_T[i - 1], [x1, d1] = DELTA_T[i];
  return d0 + (d1 - d0) * (y - x0) / (x1 - x0);
}

// The uncertainty of ΔT (s): before the telescope 0.8 s a century² from
// 1820 (Morrison and Stephenson), 20 s in 1600, 5 s in 1700, 1 s in 1800;
// after the last measurement the rate of the Earth's rotation wanders,
// some tenths of a second a year from decade to decade: about 10 s in 25
// years, growing as the years^1.5
const DELTA_T_ERR = [[1600, 20], [1700, 5], [1800, 1], [1900, 0.1]];
function deltaTError(y) {
  const n = y - DELTA_T.at(-1)[0];
  if (n > 0) return Math.hypot(0.1, 0.08 * n ** 1.5);
  if (y < DELTA_T_ERR[0][0]) return Math.max(20, 0.8 * ((y - 1820) / 100) ** 2);
  const i = DELTA_T_ERR.findIndex(([x]) => x > y);
  if (i < 0) return 0.1;
  const [x0, e0] = DELTA_T_ERR[i - 1], [x1, e1] = DELTA_T_ERR[i];
  return e0 + (e1 - e0) * (y - x0) / (x1 - x0);
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
  return { dpsi, eps: eps0 + deps, eps0 };
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

// The apparent ecliptic longitude and latitude (degrees) and distance (km)
// of a star: moved by its proper motion and radial velocity to the date,
// precessed to the mean equator of the date and turned to its ecliptic,
// seen from the Earth (the annual parallax, where known) as it moves
// (aberration), with nutation. Without a parallax, 1e18 km (about a
// hundred light years), far enough for no parallax from the surface
const MAS = RAD / 3.6e6;
function starEcliptic(s, T) {
  const y = T * 100, u = unit(s.ra, s.dec);
  const e = [-sin(s.ra), cos(s.ra), 0], n = [-sin(s.dec) * cos(s.ra), -sin(s.dec) * sin(s.ra), cos(s.dec)];
  // the radial velocity as a relative change of the distance per year
  const vr = s.plx > 0 ? (s.rv || 0) * s.plx / (4.740470 * 1000 * 206264.806) : 0;
  const p = u.map((x, k) => x + y * (MAS * ((s.pmra || 0) * e[k] + (s.pmdec || 0) * n[k]) + vr * x));
  const [qx, qy, qz] = precessVector(p, T), eps0 = nutation(T).eps0;
  let g = [qx, qy * cos(eps0) + qz * sin(eps0), -qy * sin(eps0) + qz * cos(eps0)];
  const [E, V] = heliocentric("earth", T, true);
  // in au, from the Earth
  const d = s.plx > 0 ? 206264806 / s.plx / Math.hypot(...p) : 0;
  if (d) g = g.map((x, k) => x * d - E[k]);
  const r = Math.hypot(...g), a = g.map((x, k) => x + r * V[k] / C_AU);
  const lon = Math.atan2(a[1], a[0]) / RAD, lat = Math.atan2(a[2], Math.hypot(a[0], a[1])) / RAD;
  return { lon: mod360(lon + nutation(T).dpsi), lat, dist: d ? r * AU : 1e18 };
}

// The root of f(x) = M, f growing on [−b, b] (Kepler's equation): Newton's
// method, kept within the bracket (near-parabolic orbits), starting from
// the cube root that holds near 0 for e near 1
function kepler(f, df, M, b) {
  let lo = -b, hi = b, x = Math.max(lo, Math.min(hi, Math.sign(M) * Math.min(Math.abs(M), Math.cbrt(6 * Math.abs(M)))));
  for (let k = 0; k < 100; k++) {
    const v = f(x) - M;
    if (v > 0) hi = x; else lo = x;
    let next = x - v / df(x);
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    const done = Math.abs(next - x) <= 1e-15 * Math.max(1, Math.abs(x));
    x = next;
    if (done) break;
  }
  return x;
}

// Minor planets and comets: the heliocentric position (au, ecliptic and
// equinox of J2000) on a fixed orbit (two bodies), at the Julian day jd of
// TT; elliptic, parabolic or hyperbolic
const GAUSS = 0.01720209895;
function orbitPosition(o, jd) {
  const { q, e } = o, dt = jd - o.tp;
  let x, y;
  if (Math.abs(e - 1) < 1e-6) {
    // Barker's equation
    const W = 3 * GAUSS / Math.SQRT2 / q ** 1.5 * dt;
    const Y = Math.cbrt(W / 2 + Math.sqrt(W * W / 4 + 1)), s = Y - 1 / Y;
    x = q * (1 - s * s);
    y = 2 * q * s;
  } else {
    const a = q / Math.abs(1 - e), M = GAUSS / a ** 1.5 * dt;
    if (e < 1) {
      const E = kepler((E) => E - e * Math.sin(E), (E) => 1 - e * Math.cos(E), M - 2 * Math.PI * Math.round(M / (2 * Math.PI)), Math.PI);
      x = a * (Math.cos(E) - e);
      y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    } else {
      const H = kepler((H) => e * Math.sinh(H) - H, (H) => e * Math.cosh(H) - 1, M, Math.asinh(Math.abs(M) / e) + 1);
      x = a * (e - Math.cosh(H));
      y = a * Math.sqrt(e * e - 1) * Math.sinh(H);
    }
  }
  // from the plane of the orbit to the ecliptic
  const cw = cos(o.peri), sw = sin(o.peri), cn = cos(o.node), sn = sin(o.node), ci = cos(o.i), si = sin(o.i);
  const xp = x * cw - y * sw, yp = x * sw + y * cw;
  return [xp * cn - yp * ci * sn, xp * sn + yp * ci * cn, yp * si];
}

// from the ecliptic of J2000 to the ecliptic of the date
function eclipticOfDate([x, y, z], T) {
  const e0 = 23.4392911;
  const v = precessVector([x, y * cos(e0) - z * sin(e0), y * sin(e0) + z * cos(e0)], T);
  const eps = nutation(T).eps0;
  return [v[0], v[1] * cos(eps) + v[2] * sin(eps), -v[1] * sin(eps) + v[2] * cos(eps)];
}

// The apparent ecliptic longitude and latitude (degrees) and distance (km)
// of a minor planet or a comet, as for the planets: light time, aberration,
// nutation
function orbitEcliptic(o, T) {
  const [E, V] = heliocentric("earth", T, true);
  const jd = 2451545 + T * 36525;
  let g, tau = 0;
  for (let k = 0; k < 3; k++) {
    const P = eclipticOfDate(orbitPosition(o, jd - tau), T);
    g = P.map((x, i) => x - E[i]);
    tau = Math.hypot(...g) / C_AU;
  }
  const dist = Math.hypot(...g), a = g.map((x, k) => x + dist * V[k] / C_AU);
  const lon = Math.atan2(a[1], a[0]) / RAD, lat = Math.atan2(a[2], Math.hypot(a[0], a[1])) / RAD;
  return { lon: mod360(lon + nutation(T).dpsi), lat, dist: dist * AU };
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
const ecliptic = (body, T) => (typeof body === "object" ? (body.orbits || body.orbit ? orbitEcliptic(orbitOf(body, T), T) : starEcliptic(body, T))
  : body === "moon" ? moonEcliptic(T) : planetEcliptic(body, T));

// the orbit of a minor planet or comet at T: of the epoch nearest to it
function orbitOf(body, T) {
  if (body.orbit) return body.orbit;
  const jd = 2451545 + T * 36525;
  let best = body.orbits[0];
  for (const o of body.orbits) if (Math.abs(o[0] - jd) < Math.abs(best[0] - jd)) best = o;
  const [, q, e, i, node, peri, tp] = best;
  return { q, e, i, node, peri, tp };
}
// the years from the date to the nearest epoch of the orbits
const orbitAge = (body, t) => Math.min(...body.orbits.map((o) => Math.abs(o[0] - jdOf(t)))) / 365.25;

// An artificial satellite: its geocentric position (TEME, km) at the time
// t, or null when SGP4 no longer holds
const satellitePosition = (body, t) => sgp4(body.sgp4, (t - body.epoch) / 60);

// Right ascension and declination (degrees) of a body, its distance (km):
// apparent, geocentric
function equatorial(body, t) {
  const T = centuries(t);
  if (body.sgp4) {
    // TEME: the true equator, from the mean equinox (the equation of the
    // equinoxes); NaN once SGP4 fails
    const p = satellitePosition(body, t);
    if (!p) return { ra: NaN, dec: NaN, dist: NaN };
    const n = nutation(T);
    return { ra: mod360(Math.atan2(p[1], p[0]) / RAD + n.dpsi * cos(n.eps)), dec: Math.atan2(p[2], Math.hypot(p[0], p[1])) / RAD, dist: Math.hypot(...p) };
  }
  const p = ecliptic(body, T);
  const eps = nutation(T).eps;
  return {
    ra: mod360(Math.atan2(sin(p.lon) * cos(eps) - Math.tan(p.lat * RAD) * sin(eps), cos(p.lon)) / RAD),
    dec: Math.asin(sin(p.lat) * cos(eps) + cos(p.lat) * sin(eps) * sin(p.lon)) / RAD,
    dist: p.dist,
  };
}

// The same seen from a place on the surface (WGS 84, its height above sea
// level taken as above the ellipsoid): the geocentric position minus the
// place
function topocentric(body, t, [lat, lon, h = 0]) {
  const { ra, dec, dist } = equatorial(body, t);
  const lst = siderealTime(t, lon), u = Math.atan(0.99664719 * Math.tan(lat * RAD));
  const rc = 6378.137 * Math.cos(u) + h / 1000 * cos(lat), rs = 6378.137 * 0.99664719 * Math.sin(u) + h / 1000 * sin(lat);
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

// The refraction at the horizon (degrees): the standard 34′ at sea level,
// less with the pressure of the standard atmosphere at the height h (m)
const horizonRefraction = (h = 0) => 0.5667 * Math.max(0, 1 - 2.25577e-5 * h) ** 5.25588;

// Rising or setting of the upper limb, with the refraction at the horizon
// (34′ at sea level): the Sun at −0.833° (or at h0, for twilights), the
// Moon at −34′ minus its semidiameter, the planets and stars at −34′ (or
// at h0)
function riseSet(body, t, place, rising, h0 = null) {
  const r = horizonRefraction(place[2]);
  const f = body === "moon"
    ? (x) => { const h = horizontal("moon", x, place); return h.alt + r + Math.asin(RADIUS.moon / h.dist) / RAD; }
    : (x) => horizontal(body, x, place).alt - (h0 ?? (body === "sun" ? -0.2666 - r : -r));
  // satellites pass in minutes: steps of 20 s
  const e = body.sgp4 ? crossing(f, t, rising, 2 * 86400, 20) : crossing(f, t, rising);
  if (e === null) return null;
  // how fast the altitude changes, for the uncertainty
  return { t: e, rate: Math.abs(f(e + 30) - f(e - 30)) / 60 };
}

// The passes of a satellite over a place from t, for the days given: its
// rising, highest point and setting (time, altitude, azimuth), and whether
// it can be seen, sunlit (outside the Earth's shadow, taken as a cylinder)
// with the Sun 6° or more below the horizon. A pass under way at t counts
function satellitePasses(body, t, place, days) {
  const passes = [], end = t + days * 86400;
  const alt = (x) => horizontal(body, x, place).alt, r = horizonRefraction(place[2]);
  let x = t;
  // under way: from its rising, up to 20 minutes before
  if (alt(t) > -r) {
    const back = crossing((y) => alt(t - y) + r, 0, false, 1200, 10);
    x = back === null ? t : t - back - 1;
  }
  while (x < end && passes.length < 30) {
    const rise = riseSet(body, x, place, true);
    if (!rise || rise.t > end) break;
    const set = riseSet(body, rise.t + 1, place, false);
    if (!set) break;
    // the highest point, by golden sections
    let a = rise.t, b = set.t;
    for (let k = 0; k < 40; k++) {
      const m1 = b - 0.618 * (b - a), m2 = a + 0.618 * (b - a);
      if (alt(m1) < alt(m2)) a = m1; else b = m2;
    }
    const top = (a + b) / 2;
    let visible = false;
    for (let y = rise.t; y <= set.t && !visible; y += 10) {
      const p = satellitePosition(body, y), sun = equatorial("sun", y);
      const sv = [cos(sun.dec) * cos(sun.ra), cos(sun.dec) * sin(sun.ra), sin(sun.dec)];
      const along = p[0] * sv[0] + p[1] * sv[1] + p[2] * sv[2];
      const lit = along > 0 || Math.hypot(...p.map((v, k) => v - along * sv[k])) > 6378.137;
      visible = lit && horizontal("sun", y, place).alt < -6;
    }
    const at = (y) => { const h = horizontal(body, y, place); return { t: y, alt: h.alt, az: h.az }; };
    passes.push({ rise: { ...at(rise.t), rate: rise.rate }, max: at(top), set: { ...at(set.t), rate: set.rate }, visible });
    x = set.t + 60;
  }
  return passes;
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
  // comets: total magnitude M1 + 5 log Δ + K log r; minor planets: the H, G
  // system (Bowell et al. 1989)
  if (typeof body === "object") {
    if (body.M1 !== undefined) return body.M1 + 5 * Math.log10(delta / AU) + body.K * Math.log10(r / AU);
    const ta = Math.tan(a * RAD / 2);
    const phi1 = Math.exp(-3.33 * ta ** 0.63), phi2 = Math.exp(-1.87 * ta ** 1.22);
    return body.H + d - 2.5 * Math.log10((1 - body.G) * phi1 + body.G * phi2);
  }
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

// For drawing a lunar eclipse e (of lunarEclipse): the radii of the
// umbra, the penumbra and the Moon at the maximum, and the Moon's center
// from the center of the shadow (degrees, to the east and to the north)
// every five minutes and at the contacts; with a place, whether the Moon is
// up there
function lunarDiagram(e, place = null) {
  const at = (t) => {
    const m = vec(equatorial("moon", t)), S = equatorial("sun", t);
    const ra = S.ra + 180, dec = -S.dec, a = [cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec)];
    const east = [-sin(ra), cos(ra), 0], north = [-sin(dec) * cos(ra), -sin(dec) * sin(ra), cos(dec)], along = dot(m, a);
    const p = { x: Math.atan2(dot(m, east), along) / RAD, y: Math.atan2(dot(m, north), along) / RAD };
    if (place) p.up = horizontal("moon", t, place).alt > -0.8;
    return p;
  };
  const g = lunarAt(e.max), path = [];
  for (let t = e.P1 - 1800; t <= e.P4 + 1800; t += 300) path.push({ t, ...at(t) });
  const marks = [["P1", e.P1], ["U1", e.U1], ["U2", e.U2], ["max", e.max], ["U3", e.U3], ["U4", e.U4], ["P4", e.P4]]
    .filter(([, t]) => t !== null).map(([name, t]) => ({ name, t, ...at(t) }));
  return { umbra: g.umbra, penumbra: g.penumbra, moon: g.moon, path, marks };
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
// the penumbra (f1) and of the umbra (f2), and the sidereal time (degrees).
// For an occultation (occ: { target, front }), the shadow of the body in
// front in the light of the target: of the Moon's mean limb, a cylinder
// for a star; for a planet behind, its penumbra where it is partly covered
// and its umbra where wholly (the disks taken round)
function shadowGeometry(t, occ = null) {
  const k = 1 / 0.99664719, st = (v) => [v[0], v[1], v[2] * k].map((x) => x / R_EARTH);
  const m = st(vec(equatorial(occ ? occ.front : "moon", t))), s = st(vec(equatorial(occ ? occ.target : "sun", t)));
  const ms = m.map((x, i) => x - s[i]), len = Math.hypot(...ms), d = ms.map((x) => x / len);
  const h = Math.hypot(d[0], d[1]), e1 = [-d[1] / h, d[0] / h, 0];
  const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
  const rm = (occ ? limbRadius(occ.front) : 1737.4) / R_EARTH, rs = (occ ? limbRadius(occ.target) : R_SUN) / R_EARTH;
  // the axis unstretched (D), for the shape of the shadow across it
  const D = ms.map((x, i) => (i === 2 ? x / k : x)), Dn = Math.hypot(...D);
  return { d, e1, e2, x0: dot(m, e1), y0: dot(m, e2), zm: dot(m, d), rm, f1: (rs + rm) / len, f2: (rs - rm) / len, gast: siderealTime(t, 0), D: D.map((x) => x / Dn) };
}

// A point (x, y) of the plane of a shadow g (shadowGeometry), on the sunlit
// side of the Earth, to [lat, lon] (geodetic, degrees), or null
function shadowGeo(g, x, y) {
  const q = x * x + y * y;
  if (q > 1) return null;
  const z = -Math.sqrt(1 - q), P = [0, 1, 2].map((i) => x * g.e1[i] + y * g.e2[i] + z * g.d[i]);
  const lon = mod360(Math.atan2(P[1], P[0]) / RAD - g.gast + 180) - 180;
  return [Math.atan2(P[2] / (1 / 0.99664719), 0.99330562 * Math.hypot(P[0], P[1])) / RAD, lon];
}

// The Moon's shadow on the Earth at the time t: the point with the Sun
// overhead (sun), the outlines (lines of [lat, lon], closed) of where the
// eclipse is partial with a magnitude above each of levels (the penumbra
// at 0), and of the umbra (total) or antumbra (annular) with its kind and
// its center (or null when it misses the Earth)
function shadowMap(t, levels = [0]) {
  const g = shadowGeometry(t), S = equatorial("sun", t);
  // the radius of the penumbra (L1) and the signed one of the umbra (L2,
  // negative past its tip) at the height z
  const L1 = (z) => g.rm + (z - g.zm) * g.f1, L2 = (z) => g.rm - (z - g.zm) * g.f2;
  // the outline of the disk of radius rad(z) around the axis on the sunlit
  // side: its edge where it is on that side, then the terminator back to
  // where the edge comes in again
  const outline = (rad) => {
    const at = (th) => {
      let z = -Math.sqrt(Math.max(0, 1 - g.x0 * g.x0 - g.y0 * g.y0)), x, y;
      for (let i = 0; i < 3; i++) {
        const r = rad(z);
        x = g.x0 + r * Math.cos(th);
        y = g.y0 + r * Math.sin(th);
        z = -Math.sqrt(Math.max(0, 1 - x * x - y * y));
      }
      return [x, y];
    };
    const ins = (p) => p[0] * p[0] + p[1] * p[1] < 1, d0 = Math.hypot(g.x0, g.y0), r0 = rad(0);
    if (r0 <= 0) return null;
    const N = 120, ths = Array.from({ length: N }, (_, j) => (2 * Math.PI * j) / N), pts = ths.map(at), inside = pts.map(ins);
    const circle = (a, b, n) => Array.from({ length: n + 1 }, (_, j) => { const u = a + ((b - a) * j) / n; return [Math.cos(u), Math.sin(u)]; });
    let plane;
    if (inside.every(Boolean)) plane = pts;
    else if (!inside.some(Boolean)) {
      // all of the sunlit side, or none of it
      if (d0 + 1 > r0) return null;
      plane = circle(0, 2 * Math.PI, 120).slice(1);
    } else {
      // from where the edge comes in, around to where it goes out
      const i0 = inside.findIndex((v, i) => v && !inside[(i + N - 1) % N]);
      const cross = (a, b) => {
        let lo = a, hi = b;
        for (let m = 0; m < 30; m++) { const mid = (lo + hi) / 2; if (ins(at(mid))) lo = mid; else hi = mid; }
        return at(lo);
      };
      const enter = cross(ths[i0], ths[i0] - (2 * Math.PI) / N);
      plane = [enter];
      let j = i0;
      for (; inside[j % N]; j++) plane.push(pts[j % N]);
      const leave = cross(ths[(j - 1) % N] + (j - 1 >= N ? 2 * Math.PI : 0), ths[j % N] + (j >= N ? 2 * Math.PI : 0));
      plane.push(leave);
      // the terminator from leave to enter, the way inside the disk
      const a = Math.atan2(leave[1], leave[0]);
      let b = Math.atan2(enter[1], enter[0]);
      while (b < a) b += 2 * Math.PI;
      const mid = (a + b) / 2;
      if (Math.hypot(Math.cos(mid) - g.x0, Math.sin(mid) - g.y0) > r0) b -= 2 * Math.PI;
      const n = Math.max(2, Math.ceil(Math.abs(b - a) / (3 * RAD)));
      plane.push(...circle(a, b, n).slice(1, -1));
    }
    return plane.map(([x, y]) => shadowGeo(g, x * 0.999999, y * 0.999999)).filter(Boolean)
      .map((p) => p.map((v) => Math.round(v * 1000) / 1000));
  };
  // a magnitude m at the distance from the axis L1 − m (L1 + L2)
  const partial = levels.map((m) => ({ m, line: outline((z) => L1(z) - m * (L1(z) + L2(z))) })).filter((p) => p.line);
  const z0 = -Math.sqrt(Math.max(0, 1 - g.x0 * g.x0 - g.y0 * g.y0)), axis = g.x0 * g.x0 + g.y0 * g.y0 < 1 ? shadowGeo(g, g.x0, g.y0) : null;
  const line = outline((z) => Math.abs(L2(z)));
  const umbra = line && { kind: L2(z0) > 0 ? "total" : "annular", line, center: axis };
  return { sun: [S.dec, mod360(S.ra - g.gast + 180) - 180], partial, umbra };
}

// The contacts of a solar eclipse with its greatest phase at tmax with the
// Earth (made a sphere as in shadowGeometry): P1 and P4, the penumbra
// first and last on the Earth, U1 and U4, the umbra (or antumbra; null
// when it misses)
function solarContacts(tmax) {
  const off = (sign) => (t) => {
    const g = shadowGeometry(t), z = sign > 0 ? 0 : -Math.sqrt(Math.max(0, 1 - g.x0 * g.x0 - g.y0 * g.y0));
    return Math.hypot(g.x0, g.y0) - 1 - Math.abs(g.rm + sign * (z - g.zm) * (sign > 0 ? g.f1 : g.f2));
  };
  const c = (sign, side) => (side < 0 ? zero(off(sign), tmax - 5 * 3600, tmax) : zero(off(sign), tmax, tmax + 5 * 3600));
  return { P1: c(1, -1), U1: c(-1, -1), max: tmax, U4: c(-1, 1), P4: c(1, 1) };
}

// A solar eclipse seen from a place at the time t: its phase (none,
// partial, total, annular), magnitude, the part of the Sun covered, and
// the Sun's altitude
function solarPhase(t, place) {
  const a = solarLocalAt(t, place), mag = Math.max(0, (a.sun + a.moon - a.d) / (2 * a.sun));
  const phase = a.d >= a.sun + a.moon ? "none" : a.d < Math.abs(a.sun - a.moon) ? (a.moon > a.sun ? "total" : "annular") : "partial";
  return { phase, magnitude: mag, obscuration: obscuration(a.sun, a.moon, a.d), alt: horizontal("sun", t, place).alt };
}

// The track of a solar eclipse on the Earth around its greatest phase at
// tmax, from the Moon's shadow every 30 s (on the Earth made a sphere, as in
// shadowGeometry), all as lines of [latitude, longitude] (geodetic,
// degrees):
// - center: the central line, with the UTC hour (from 0h of the day)
// - band: the outlines of the central phase (total or annular): the limits
//   of the umbra, and at the ends where its edge meets the terminator
// - penN, penS: the limits of the partial eclipse, north and south
// - begin, end: [hour, lines] at each UTC hour, the edge of the penumbra
//   coming in (the eclipse begins then) and going out (it ends)
// - rise: { begin, end, max }, where the eclipse begins, ends or is greatest
//   at sunrise or sunset
// - greatest: the point of greatest eclipse; sun: the point with the Sun
//   overhead then
// - step: the hours between the lines of the hours, tick: between the
//   times on the central line
// For an occultation (occ, as in shadowGeometry) the same with its shadow,
// sunrise and sunset there the target's rising and setting, and the lines
// closer when it crosses the Earth in minutes (a planet in front)
function eclipseTrack(tmax, occ = null) {
  const sg = (t) => shadowGeometry(t, occ);
  const k = 1 / 0.99664719, f2e = 0.99330562, day = Math.floor(tmax / 86400) * 86400, r2 = (x) => Math.round(x * 100) / 100;
  // the plane of a shadow and the Earth: a point (x, y) of the sunlit side
  // to [lat, lon], and back (with its height z, negative on the sunlit side)
  const toGeo = (g, x, y) => {
    const q = x * x + y * y;
    if (q > 1) return null;
    const z = -Math.sqrt(1 - q), P = [0, 1, 2].map((i) => x * g.e1[i] + y * g.e2[i] + z * g.d[i]);
    const lon = mod360(Math.atan2(P[1], P[0]) / RAD - g.gast + 180) - 180;
    return [Math.atan2(P[2] / k, f2e * Math.hypot(P[0], P[1])) / RAD, lon];
  };
  const toPlane = (g, [lat, lon]) => {
    const u = Math.atan(0.99664719 * Math.tan(lat * RAD)), l = (lon + g.gast) * RAD;
    const P = [Math.cos(u) * Math.cos(l), Math.cos(u) * Math.sin(l), Math.sin(u)];
    return [dot(P, g.e1), dot(P, g.e2), dot(P, g.d)];
  };
  // the shadow, round across its axis, made an ellipse by the stretched
  // Earth (0.34 %: 6 km at the edge of the Moon's shadow, which matters
  // for the limits of an occultation; under a km at the edge of a total
  // eclipse, left out for eclipses): its radius toward th, in parts of
  // the round one
  const shape = (g, th) => {
    if (!occ || th === undefined) return 1;
    const u = [0, 1, 2].map((i) => Math.cos(th) * g.e1[i] + Math.sin(th) * g.e2[i]);
    u[2] /= k;
    const a = dot(u, g.D);
    return 1 / Math.hypot(...u.map((x, i) => x - a * g.D[i]));
  };
  // a cone's radius at the height z (toward th): penumbra (+1) and umbra
  // (−1, its size)
  const radius = (g, sign, z, th) => Math.abs(g.rm + sign * (z - g.zm) * (sign > 0 ? g.f1 : g.f2)) * shape(g, th);
  // how far a place is outside a cone (negative inside)
  const outside = (g, p, sign) => {
    const [x, y, z] = toPlane(g, p);
    return Math.hypot(x - g.x0, y - g.y0) - radius(g, sign, z, Math.atan2(y - g.y0, x - g.x0));
  };
  // the points of the terminator at a cone's edge (two circles meeting)
  const meet = (g, sign) => {
    const L = radius(g, sign, 0), d = Math.hypot(g.x0, g.y0);
    if (d < 1e-9 || d > 1 + L || d < Math.abs(1 - L)) return [];
    const a = (1 + d * d - L * L) / (2 * d), h = Math.sqrt(Math.max(0, 1 - a * a)), ux = g.x0 / d, uy = g.y0 / d;
    return [[a * ux - h * uy, a * uy + h * ux], [a * ux + h * uy, a * uy - h * ux]].map(([x, y]) => toGeo(g, x * 0.999999, y * 0.999999));
  };
  // the point at a cone's radius from the axis across its motion (n), or null
  const edge = (g, n, sign, side) => {
    let z = -Math.sqrt(Math.max(0, 1 - g.x0 * g.x0 - g.y0 * g.y0)), x, y;
    for (let i = 0; i < 3; i++) {
      const r = radius(g, sign, z, Math.atan2(side * n[1], side * n[0]));
      x = g.x0 + side * r * n[0];
      y = g.y0 + side * r * n[1];
      z = -Math.sqrt(Math.max(0, 1 - x * x - y * y));
    }
    return toGeo(g, x, y);
  };
  // points found time after time joined into lines, each to the nearest
  // end of a line from the time before (within 3°)
  const chain = (frames) => {
    const done = [];
    let open = [];
    for (const pts of frames) {
      const next = [];
      for (const p of pts) {
        let best = null, bd = 3;
        for (const l of open) {
          const q = l[l.length - 1], dd = Math.hypot(p[0] - q[0], (((p[1] - q[1] + 540) % 360) - 180) * Math.cos(p[0] * RAD));
          if (dd < bd && !next.includes(l)) { bd = dd; best = l; }
        }
        if (best) { best.push(p); next.push(best); } else next.push([p]);
      }
      for (const l of open) if (!next.includes(l)) done.push(l);
      open = next;
    }
    return [...done, ...open].filter((l) => l.length > 1).map((l) => l.map((p) => p.map(r2)));
  };

  // The limits of a cone's track at the time of g (a and b, a little before
  // and after): the points of its edge, on the sunlit side, where it stops
  // coming in and starts going out over the turning Earth (the envelope of
  // its edges)
  const limitPoints = (g, a, b, sign) => {
    const at = (th) => {
      let z = -Math.sqrt(Math.max(0, 1 - g.x0 * g.x0 - g.y0 * g.y0)), x, y;
      for (let m = 0; m < 3; m++) {
        const r = radius(g, sign, z, th);
        x = g.x0 + r * Math.cos(th);
        y = g.y0 + r * Math.sin(th);
        z = -Math.sqrt(Math.max(0, 1 - x * x - y * y));
      }
      const p = toGeo(g, x, y);
      return { p, kind: p ? (outside(b, p, sign) < outside(a, p, sign) ? 1 : -1) : 0 };
    };
    // samples every 5°, with the terminator found exactly between them (its
    // visible side), then the switches between visible neighbors
    const N = 72, sm = [];
    for (let j = 0; j <= N; j++) {
      const th = (2 * Math.PI * j) / N, q = at(th);
      const last = sm[sm.length - 1];
      if (last && !last.q.kind !== !q.kind) {
        let lo = last.th, hi = th;
        for (let m = 0; m < 25; m++) {
          const mid = (lo + hi) / 2;
          if (!at(mid).kind === !last.q.kind) lo = mid; else hi = mid;
        }
        const tb = last.q.kind ? lo : hi;
        sm.push({ th: tb, q: at(tb) });
      }
      sm.push({ th, q });
    }
    const out = [];
    for (let j = 1; j < sm.length; j++) {
      const A = sm[j - 1], B = sm[j];
      if (!A.q.kind || !B.q.kind || A.q.kind === B.q.kind) continue;
      let lo = A.th, hi = B.th;
      for (let m = 0; m < 25; m++) {
        const mid = (lo + hi) / 2, q = at(mid);
        if (!q.kind) break;
        if (q.kind === A.q.kind) lo = mid; else hi = mid;
      }
      const q = at((lo + hi) / 2);
      if (q.p) out.push(q.p);
    }
    return out;
  };
  const gap = (p, q) => Math.hypot(p[0] - q[0], (((p[1] - q[1] + 540) % 360) - 180) * Math.cos(p[0] * RAD));
  const northness = (g, nN, p) => { const [x, y] = toPlane(g, p); return (x - g.x0) * nN[0] + (y - g.y0) * nN[1]; };
  // every 30 s, every 2 s while the umbra grazes the Earth (the ends of
  // the band, where its two sides close), for four hours each side; for
  // an occultation, steps in which the shadow moves as far (0.005 Earth
  // radii), while it crosses the Earth; the lines of the hours at least
  // three
  let step = 30, span = 4 * 3600, lineStep = 1;
  if (occ) {
    const a = sg(tmax - 30), b = sg(tmax + 30), v = Math.hypot(b.x0 - a.x0, b.y0 - a.y0) / 60;
    step = Math.min(30, Math.max(0.2, 0.005 / v));
    span = Math.min(4 * 3600, (1.3 + radius(sg(tmax), 1, 0)) / v);
    lineStep = [1, 0.5, 0.25, 1 / 6, 1 / 12, 1 / 30, 1 / 60].find((x) => (2 * span) / 3600 / x >= 3) ?? 1 / 60;
  }
  const ts = [], G = [];
  for (let t = tmax - span; t <= tmax + span;) {
    const g = sg(t);
    ts.push(t);
    G.push(g);
    // (and while the edge of the penumbra grazes it, from outside or inside:
    // the ends of the limits and of the curves at sunrise or sunset)
    const r0 = Math.hypot(g.x0, g.y0), L1 = radius(g, 1, 0);
    t += Math.abs(r0 - 1) < radius(g, -1, 0) + 0.03 || Math.abs(r0 - 1 - L1) < 0.03 || Math.abs(r0 - 1 + L1) < 0.03 ? step / 15 : step;
  }
  // At the time t: where the penumbra's edge meets the terminator, the
  // eclipse beginning there (rb) or ending (re) at sunrise or sunset, and
  // where the greatest eclipse is at sunrise or sunset (pts)
  const risesAt = (t) => {
    const g = sg(t), a = sg(t - step / 2), b = sg(t + step / 2);
    // where the penumbra's edge meets the terminator: the eclipse begins or
    // ends there at sunrise or sunset, as the edge comes in or goes out
    const rb = [], re = [];
    for (const p of meet(g, 1)) {
      if (!p) continue;
      (outside(b, p, 1) < outside(a, p, 1) ? rb : re).push(p);
    }
    // the greatest eclipse at sunrise or sunset: on the arc of the
    // terminator inside the penumbra (200 steps along it, however short),
    // where the distance from the axis stops falling
    const L = radius(g, 1, 0), d0 = Math.hypot(g.x0, g.y0), pts = [];
    if (d0 > 1e-9 && d0 < 1 + L && d0 > L - 1) {
      // the arc: around the direction of the axis, half-width w (all of the
      // terminator when the penumbra covers it)
      const c = (1 + d0 * d0 - L * L) / (2 * d0), w = c <= -1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, c))), th0 = Math.atan2(g.y0, g.x0);
      const slope = (th) => {
        const p = toGeo(g, Math.cos(th) * 0.999999, Math.sin(th) * 0.999999);
        if (!p) return NaN;
        const [xa, ya] = toPlane(a, p), [xb, yb] = toPlane(b, p);
        return Math.hypot(xb - b.x0, yb - b.y0) - Math.hypot(xa - a.x0, ya - a.y0);
      };
      const N = 200;
      let thPrev = th0 - w, prev = slope(thPrev);
      for (let j = 1; j <= N; j++) {
        const th = th0 - w + (2 * w * j) / N, cur = slope(th);
        if (!Number.isNaN(prev) && !Number.isNaN(cur) && (prev < 0) !== (cur < 0)) {
          let lo = thPrev, hi = th, flo = prev;
          for (let m = 0; m < 30; m++) {
            const mid = (lo + hi) / 2, fm = slope(mid);
            if (Number.isNaN(fm)) break;
            if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
          }
          const p = toGeo(g, Math.cos((lo + hi) / 2) * 0.999999, Math.sin((lo + hi) / 2) * 0.999999);
          if (p) pts.push(p);
        }
        prev = cur;
        thPrev = th;
      }
    }
    return { rb, re, pts };
  };
  // frames of points at the times ts, with more in between where those of
  // two following times do not match (another number, or 0.5° apart): the
  // curves born or ending where they run fast
  const refined = (fn) => {
    const far = (P, Q) => P.length !== Q.length || P.some((p) => !Q.some((q) => gap(p, q) < 0.5));
    const out = [];
    const rec = (t1, F1, t2, F2, depth) => {
      if (depth >= 7 || !far(F1.pts, F2.pts) && !far(F1.rb, F2.rb) && !far(F1.re, F2.re)) return;
      const tm = (t1 + t2) / 2, Fm = fn(tm);
      rec(t1, F1, tm, Fm, depth + 1);
      out.push(Fm);
      rec(tm, Fm, t2, F2, depth + 1);
    };
    let tPrev = ts[0], Fprev = fn(ts[0]);
    out.push(Fprev);
    for (let i = 1; i < ts.length; i++) {
      const F = fn(ts[i]);
      rec(tPrev, Fprev, ts[i], F, 0);
      out.push(F);
      tPrev = ts[i];
      Fprev = F;
    }
    return out;
  };
  const center = [], penN = [], penS = [], bandN = [], bandS = [], riseB = [], riseE = [], riseM = [];
  G.forEach((g, i) => {
    const a = G[Math.max(0, i - 1)], b = G[Math.min(G.length - 1, i + 1)];
    const vx = b.x0 - a.x0, vy = b.y0 - a.y0, vn = Math.hypot(vx, vy), n = [-vy / vn, vx / vn];
    // the side of the north pole of the plane first
    const north = n[1] >= 0 ? 1 : -1, nN = [north * n[0], north * n[1]];
    const central = g.x0 * g.x0 + g.y0 * g.y0 < 1;
    const c = central ? toGeo(g, g.x0, g.y0) : null;
    center.push(c && [...c, (ts[i] - day) / 3600]);
    // the limits of the partial eclipse: of the two points, the one more to
    // the north for the north
    // (of two points, the one more to the north for the north; a single
    // one to the side whose point before is nearer)
    const pl = limitPoints(g, a, b, 1);
    let plN = null, plS = null;
    if (pl.length >= 2) [plN, plS] = northness(g, nN, pl[0]) > northness(g, nN, pl[1]) ? pl : [pl[1], pl[0]];
    else if (pl.length === 1) {
      const lN = penN[penN.length - 1], lS = penS[penS.length - 1];
      const toN = lN && lS ? gap(pl[0], lN) < gap(pl[0], lS) : lN ? true : lS ? false : northness(g, nN, pl[0]) > 0;
      if (toN) plN = pl[0]; else plS = pl[0];
    }
    penN.push(plN);
    penS.push(plS);
    // the band: the limits of the umbra, or where its edge meets the terminator
    // (the points where its edge meets the terminator, followed in time:
    // each side takes the one nearest to its point before, and at first
    // the one more to the north for the north side)
    const ends = meet(g, -1).filter(Boolean);
    // (the limits of the umbra's track wherever they are on the sunlit side,
    // the axis there or not)
    const touch = Math.hypot(g.x0, g.y0) < 1 + radius(g, -1, 0);
    const ul = touch ? limitPoints(g, a, b, -1) : [];
    let uN = null, uS = null;
    if (ul.length === 2) [uN, uS] = northness(g, nN, ul[0]) > northness(g, nN, ul[1]) ? ul : [ul[1], ul[0]];
    else if (ul.length === 1) { if (northness(g, nN, ul[0]) > 0) uN = ul[0]; else uS = ul[0]; }
    const near = (prevP, list) => list.reduce((best, p) => (!best || gap(p, prevP) < gap(best, prevP) ? p : best), null);
    let pN = uN, pS = uS;
    const lastN = bandN[bandN.length - 1], lastS = bandS[bandS.length - 1];
    if (!pN && ends.length) pN = lastN ? near(lastN, ends.filter((p) => p !== pS)) : ends.reduce((a, b) => (northness(g, nN, a) > northness(g, nN, b) ? a : b));
    if (!pS && ends.length) pS = lastS ? near(lastS, ends.filter((p) => p !== pN)) : ends.find((p) => p !== pN) || null;
    bandN.push(pN && pS ? pN : null);
    bandS.push(pN && pS ? pS : null);

  });
  const frames = refined(risesAt);
  for (const F of frames) { riseB.push(F.rb); riseE.push(F.re); riseM.push(F.pts); }
  // runs of points, broken where there is none
  const runs = (arr) => {
    const out = [[]];
    for (const p of arr) {
      if (p) out[out.length - 1].push(p.map(r2));
      else if (out[out.length - 1].length) out.push([]);
    }
    return out.filter((l) => l.length > 1);
  };
  // the band: for each run of times, its north side forward and its south
  // side back, a closed outline
  const band = [];
  let cur = null;
  bandN.forEach((pN, i) => {
    const pS = bandS[i];
    if (pN && pS) {
      if (!cur) band.push((cur = { n: [], s: [] }));
      cur.n.push(pN.map(r2));
      cur.s.push(pS.map(r2));
    } else cur = null;
  });
  // the lines of the hours: the edge of the penumbra at each hour, in pieces
  // coming in (beginning) and going out (end), which share their ends; the
  // ends found exactly, at the terminator too
  const hours = { begin: [], end: [] };
  for (let n = Math.ceil((ts[0] - day) / 3600 / lineStep); n <= Math.floor((ts[ts.length - 1] - day) / 3600 / lineStep); n++) {
    const h = n * lineStep, t = day + h * 3600, g = sg(t), a = sg(t - step), b = sg(t + step);
    const at = (th) => {
      let z = -Math.sqrt(Math.max(0, 1 - g.x0 * g.x0 - g.y0 * g.y0)), x, y;
      for (let m = 0; m < 3; m++) {
        const r = radius(g, 1, z, th);
        x = g.x0 + r * Math.cos(th);
        y = g.y0 + r * Math.sin(th);
        z = -Math.sqrt(Math.max(0, 1 - x * x - y * y));
      }
      const p = toGeo(g, x, y);
      return { p, kind: p && (outside(b, p, 1) < outside(a, p, 1) ? "begin" : "end") };
    };
    const pieces = [];
    let cur = null, prev = at(0), thPrev = 0;
    const open = (kind) => { cur = kind ? { kind, pts: [] } : null; if (cur) pieces.push(cur); };
    open(prev.kind);
    if (cur) cur.pts.push([0, prev.p]);
    for (let j = 1; j <= 360; j++) {
      const th = (j * Math.PI) / 180, q = at(th);
      if (q.kind !== prev.kind) {
        // the boundary between thPrev and th
        let lo = thPrev, hi = th;
        for (let m = 0; m < 30; m++) {
          const mid = (lo + hi) / 2;
          if (at(mid).kind === prev.kind) lo = mid; else hi = mid;
        }
        const left = at(lo), right = at(hi);
        // the point of the boundary, for both sides where they are seen
        const edgePt = left.p ? [lo, left.p] : right.p ? [hi, right.p] : null;
        if (cur && edgePt) cur.pts.push(edgePt);
        open(q.kind);
        if (cur && edgePt) cur.pts.push(edgePt);
      }
      if (cur) cur.pts.push([th, q.p]);
      prev = q;
      thPrev = th;
    }
    // the circle closes: the last piece goes on with the first
    if (pieces.length > 1 && pieces[0].kind && pieces[0].kind === pieces[pieces.length - 1].kind && at(0).kind) {
      const last = pieces.pop();
      pieces[0].pts = [...last.pts, ...pieces[0].pts];
    }
    // more points where they are far apart (near the terminator)
    const far = (p, q) => Math.hypot(p[0] - q[0], (((p[1] - q[1] + 540) % 360) - 180) * Math.cos(p[0] * RAD)) > 0.8;
    const dense = (pts) => {
      const out = [pts[0]];
      const split = (A, B, depth) => {
        if (depth < 8 && far(A[1], B[1])) {
          const th = (A[0] + B[0]) / 2, m = at(th);
          if (m.p) { split(A, [th, m.p], depth + 1); out.push([th, m.p]); split([th, m.p], B, depth + 1); }
        }
      };
      for (let i = 1; i < pts.length; i++) {
        // across 0 the angles go on from 2π
        const A = out[out.length - 1], B = pts[i][0] < A[0] - Math.PI ? [pts[i][0] + 2 * Math.PI, pts[i][1]] : pts[i];
        split(A, B, 0);
        out.push(pts[i]);
      }
      return out.map(([, p]) => p);
    };
    for (const k2 of ["begin", "end"]) {
      const list = pieces.filter((pc) => pc.kind === k2 && pc.pts.length > 1).map((pc) => dense(pc.pts).map((p) => p.map(r2)));
      if (list.length) hours[k2].push([h, list]);
    }
  }
  const g = sg(tmax), rr = Math.hypot(g.x0, g.y0), S = equatorial("sun", tmax);
  // a star: the umbra is the penumbra, no band of its own
  const point = occ && !limbRadius(occ.target);
  const greatest = rr < 1 ? toGeo(g, g.x0, g.y0) : toGeo(g, (g.x0 / rr) * 0.9999, (g.y0 / rr) * 0.9999);
  // fewer points: 0.3° apart at least, the ends kept (the lines are drawn
  // as curves through them)
  const thin = (l) => l.filter((p, i) => {
    if (i === 0 || i === l.length - 1) return true;
    const q = thin.last;
    if (!q || Math.hypot(p[0] - q[0], (((p[1] - q[1] + 540) % 360) - 180) * Math.cos(p[0] * RAD)) >= 0.3) { thin.last = p; return true; }
    return false;
  });
  const lines = (ls) => ls.map((l) => { thin.last = null; return thin(l); });
  // the curves where the eclipse begins and where it ends at sunrise or
  // sunset meet (at the limits): each end of a line of the first goes on to
  // the nearest end of the second, within 2°
  // lines whose ends meet (within 1.5°) made one: the two halves of a
  // curve born where two points start together
  const merge = (ls) => {
    const out = ls.map((l) => l.slice());
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < out.length && !again; i++) {
        for (let j = i + 1; j < out.length && !again; j++) {
          const a = out[i], b = out[j];
          const ways = [[a[a.length - 1], b[0], () => [...a, ...b]], [a[a.length - 1], b[b.length - 1], () => [...a, ...b.slice().reverse()]],
            [a[0], b[b.length - 1], () => [...b, ...a]], [a[0], b[0], () => [...b.slice().reverse(), ...a]]];
          const w = ways.find(([p, q]) => gap(p, q) < 1.5);
          if (w) { out[i] = w[2](); out.splice(j, 1); again = true; }
        }
      }
    }
    return out;
  };
  const joinEnds = (begin0, end0, max0) => {
    const begin = merge(begin0), end = merge(end0), max = merge(max0);
    for (const l of begin) {
      for (const at of [0, l.length - 1]) {
        let best = null, bd = 2;
        for (const m of end) for (const q of [m[0], m[m.length - 1]]) if (gap(l[at], q) < bd) { bd = gap(l[at], q); best = q; }
        if (best && bd > 0) { if (at === 0) l.unshift(best); else l.push(best); }
      }
    }
    return { begin, end, max };
  };
  return {
    center: lines(runs(center)), band: point ? [] : lines(band.map((b) => [...b.n, ...b.s.reverse()])), penN: lines(runs(penN)), penS: lines(runs(penS)),
    begin: hours.begin.map(([h, ls]) => [h, lines(ls)]), end: hours.end.map(([h, ls]) => [h, lines(ls)]),
    rise: joinEnds(lines(chain(riseB)), lines(chain(riseE)), occ ? [] : lines(chain(riseM))),
    greatest, sun: [S.dec, mod360(S.ra - siderealTime(tmax, 0) + 180) - 180], t: tmax, step: lineStep, tick: Math.min(0.5, lineStep),
  };
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

// ---------------------------------------------------------------------
// Conjunctions and occultations

// The fastest motions in right ascension (degrees a day), seen from a
// place (the Moon also moves by its parallax as the Earth turns), so that
// steps of the difference over them cannot jump over a conjunction; stars
// barely move, minor planets and comets seldom faster than 5° a day
const RA_SPEED = { moon: 27, sun: 1.3, mercury: 3, venus: 2, mars: 1.2, jupiter: 0.3, saturn: 0.2, uranus: 0.1, neptune: 0.1 };
const raSpeed = (body) => (typeof body === "string" ? RA_SPEED[body] : body.orbits ? 5 : 0.01);
const seenFrom = (body, t, place) => (place ? topocentric(body, t, place) : equatorial(body, t));
// the position angle (degrees) of q from p, from the north through the east
function positionAngle(p, q) {
  const da = q.ra - p.ra;
  return mod360(Math.atan2(sin(da), cos(p.dec) * Math.tan(q.dec * RAD) - sin(p.dec) * cos(da)) / RAD);
}

// The next conjunction in right ascension of the bodies a and b after t,
// seen from the center of the Earth or from a place, within the years
// given: its time and the rate of the difference (degrees a second), the
// declination of a, and b north of a by sep (degrees, south when
// negative); their closest approach (closest) and least separation; or
// null
function conjunction(a, b, t, place = null, years = 200) {
  const f = (x) => mod360(seenFrom(a, x, place).ra - seenFrom(b, x, place).ra + 180) - 180;
  const v = (raSpeed(a) + raSpeed(b)) / 86400, end = t + years * 31557600;
  let x = t, fx = f(x), c = null;
  // steps of the difference over the speed: no conjunction in between
  while (x < end && c === null) {
    const y = x + Math.max(Math.abs(fx), 0.01) / v, fy = f(y);
    if (fx < 0 !== fy < 0 && Math.abs(fx - fy) < 180) c = zero(f, x, y);
    x = y;
    fx = fy;
  }
  if (c === null) return null;
  const A = seenFrom(a, c, place), B = seenFrom(b, c, place);
  const d = (u) => sep(vec(seenFrom(a, u, place)), vec(seenFrom(b, u, place)));
  // the closest approach, near the conjunction: days for the slow planets,
  // months for Uranus and Neptune
  let h = Math.max(0.5, 2 / (v * 86400)) * 86400, closest = least(d, c, h);
  while (Math.abs(closest - c) > 0.9 * h && h < 365 * 86400) closest = least(d, c, h *= 2);
  return { t: c, rate: Math.abs(f(c + 30) - f(c - 30)) / 60, dec: A.dec, sep: B.dec - A.dec, closest, least: d(closest) };
}

// The radii (km) of the bodies in front: the Moon's mean limb, k = 0.2725076
// Earth radii as in the predictions of occultations; the planets
// equatorial; stars, minor planets and comets as points
const limbRadius = (body) => (body === "moon" ? 0.2725076 * R_EARTH : RADIUS[body] ?? 0);
const angularRadius = (body, dist) => Math.asin(Math.min(1, limbRadius(body) / dist)) / RAD;

// The limb of an oblate planet seen at s, toward the point q of the sky,
// as a part of its equatorial radius: an ellipse, its minor axis along the
// pole as seen, b′ = √(b² cos²D + a² sin²D) with D the latitude of the
// Earth from the planet; across the line of the centers, so within 0.05″
// for touching disks
function limbShape(body, s, q, T) {
  const f = FLATTENING[body];
  if (!f) return 1;
  const u = unit(s.ra, s.dec), w = unit(q.ra, q.dec), pole = precessVector(unit(...MOONS[body].pole), T);
  const sinD = -dot(u, pole), b = Math.sqrt((1 - f) ** 2 * (1 - sinD * sinD) + sinD * sinD);
  // the pole and q on the sky, from the planet's center
  const P = pole.map((x, k) => x + sinD * u[k]), Q = w.map((x, k) => x - dot(w, u) * u[k]);
  const n = Math.hypot(...P) * Math.hypot(...Q);
  const c = n > 0 ? dot(P, Q) / n : 0;
  return b / Math.sqrt(c * c + b * b * (1 - c * c));
}

// An occultation seen from a place, near its geocentric closest approach
// at t: the separation of the centers and the radii of the body in front
// (R) and of the other (r) toward each other, in degrees
function occultationAt(target, front, t, place) {
  const p = topocentric(target, t, place), o = topocentric(front, t, place), T = centuries(t);
  return {
    d: sep(vec(o), vec(p)), o, p,
    R: angularRadius(front, o.dist) * limbShape(front, o, p, T), r: angularRadius(target, p.dist) * limbShape(target, p, o, T),
  };
}
// Saturn's rings: the outer edge of the A ring (km), in the plane of its
// equator
const RING_A = 136775;
// The nearest and the farthest points of the outer edge of the rings from
// the direction o (degrees): the edge seen from the place, Saturn at s
// (topocentric), around the circle in steps of 4°, then refined
function ringReach(o, s, T) {
  const n = precessVector(unit(...MOONS.saturn.pole), T), h = Math.hypot(n[0], n[1]);
  const e1 = [-n[1] / h, n[0] / h, 0], e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  const c = vec(s), w = vec(o);
  const d = (a) => sep(w, c.map((x, k) => x + RING_A * (Math.cos(a) * e1[k] + Math.sin(a) * e2[k])));
  const extreme = (sign) => {
    let best = 0;
    for (let k = 1; k < 90; k++) if (sign * d(k * Math.PI / 45) < sign * d(best)) best = k * Math.PI / 45;
    // golden section, to 0.01° along the edge
    let a = best - Math.PI / 45, b = best + Math.PI / 45;
    while (b - a > 2e-4) {
      const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
      if (sign * d(m1) < sign * d(m2)) b = m2; else a = m1;
    }
    return sign * d((a + b) / 2);
  };
  return { near: extreme(1), far: -extreme(-1) };
}

function occultationLocal(target, front, t, place) {
  const at = (x) => occultationAt(target, front, x, place);
  // the parallax of the Moon shifts the time by up to two hours, and it
  // passes a star in up to two hours more; the planets take minutes
  const h = front === "moon" ? 4 * 3600 : 12 * 3600;
  const max = least((x) => at(x).d, t, h), g = at(max);
  if (g.o.dist > g.p.dist) return null;
  // Saturn's rings: they reach out to 2.3 times its radius, and may be
  // covered without the globe
  const rings = target === "saturn";
  const reach = (x) => { const a = at(x); return { ...ringReach(a.o, a.p, centuries(x)), R: a.R }; };
  const G = rings ? reach(max) : null;
  if (g.d >= g.R + g.r && !(rings && G.near < G.R)) return null;
  const outer = (x) => { const a = at(x); return a.d - (a.R + a.r); };
  const inner = (x) => { const a = at(x); return a.d - Math.abs(a.R - a.r); };
  const hit = g.d < g.R + g.r;
  const C1 = hit ? zero(outer, max - h, max) : null, C4 = hit ? zero(outer, max, max + h) : null;
  const full = hit && g.r > 0 && g.d < Math.abs(g.R - g.r);
  const C2 = full ? zero(inner, C1, max) : null, C3 = full ? zero(inner, max, C4) : null;
  // the rings: their first and last contacts (the nearest point of the
  // edge on the limb), and while they are wholly covered (the farthest)
  const ringOut = (x) => { const a = reach(x); return a.near - a.R; };
  const ringIn = (x) => { const a = reach(x); return a.far - a.R; };
  const R1 = rings ? zero(ringOut, max - h, max) : null, R4 = rings ? zero(ringOut, max, max + h) : null;
  const ringsFull = rings && G.far < G.R;
  const R2 = ringsFull ? zero(ringIn, R1, max) : null, R3 = ringsFull ? zero(ringIn, max, R4) : null;
  const rate = (f, x) => (x === null ? null : Math.abs(f(x + 5) - f(x - 5)) / 10);
  // where on the limb it goes in and out (its center, at the first and the
  // last contacts), and whether the Sun lights the limb there
  const first = R1 ?? C1, last = R4 ?? C4;
  const pa = (x) => { const a = at(x); return positionAngle(a.o, a.p); };
  const sunPA = (x) => positionAngle(topocentric(front, x, place), topocentric("sun", x, place));
  const lit = (x) => cos(pa(x) - sunPA(x)) > 0;
  return {
    max, C1, C2, C3, C4, R1, R2, R3, R4, first, last, least: g.d, R: g.R, r: g.r, covers: g.R > g.r,
    rates: { C1: rate(outer, C1), C2: rate(inner, C2), C3: rate(inner, C3), C4: rate(outer, C4), R1: rate(ringOut, R1), R2: rate(ringIn, R2), R3: rate(ringIn, R3), R4: rate(ringOut, R4) },
    paIn: pa(first), paOut: pa(last), litIn: lit(first), litOut: lit(last),
  };
}

// The next occultation of target by the body in front (the Moon or a
// planet) after t seen from a place, above the horizon or not, within the
// years given: the times of the contacts (C1, C4 the outer ones; C2, C3
// the inner ones, null for a star or when it is not wholly covered; for
// Saturn also those of its rings, R1… R4, and C1… C4 null when only the
// rings are covered), the first and the last of them, their rates
// (degrees a second), the position angles on the limb where the target
// goes in and out and whether the Sun lights the limb there; or
// null. The conjunctions in right ascension, then their geocentric closest
// approach within the parallax, then the place
function occultation(target, front, t, place, years) {
  const end = t + years * 31557600;
  for (let u = t; u < end;) {
    const c = conjunction(front, target, u, null, (end - u) / 31557600);
    if (c === null) return null;
    const g = (x) => sep(vec(equatorial(front, x)), vec(equatorial(target, x)));
    const tg = least(g, c.t, (front === "moon" ? 0.3 : 2) * 86400);
    const o = equatorial(front, tg), p = equatorial(target, tg);
    const parallax = Math.asin(R_EARTH / o.dist) / RAD - Math.asin(Math.min(1, R_EARTH / p.dist)) / RAD;
    const reach = target === "saturn" ? Math.asin(RING_A / p.dist) / RAD : angularRadius(target, p.dist);
    if (g(tg) < parallax + angularRadius(front, o.dist) + reach + 0.01) {
      const e = occultationLocal(target, front, tg, place);
      if (e && e.first !== null && e.last !== null && e.last > t) return e;
    }
    u = c.t + 86400;
  }
  return null;
}

// The track on the Earth of an occultation of target by the body in front
// with its local maximum near t (eclipseTrack, with the shadow's axis
// nearest to the Earth's center then)
function occultationTrack(target, front, t) {
  const occ = { target, front };
  const tmax = least((x) => { const g = shadowGeometry(x, occ); return Math.hypot(g.x0, g.y0); }, t, 3 * 3600);
  return eclipseTrack(tmax, occ);
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

export { conjunction, occultation, occultationLocal, occultationTrack, orbitPosition, orbitAge, satellitePosition, satellitePasses, horizonRefraction, aspect, magnitude, diameter, transit, moons, moonEvents, planetOf, lunarEclipse, lunarDiagram, solarEclipse, shadowAt, solarLocal, eclipseTrack, shadowMap, solarContacts, solarPhase, elongation, solarLongitude, equatorial, topocentric, ecliptic, centuries, nutation, horizontal, riseSet, crossing, nextPhase, moonPhase, siderealTime, season, hourAngle, deltaT, deltaTError };
