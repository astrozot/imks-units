// Artificial satellites: SGP4 (Hoots and Roehrich 1980, as revised by
// Vallado, Crawford, Hujsak and Kelso 2006, "improved" mode), for the
// near-Earth orbits, periods under 225 minutes (the deep-space SDP4 is not
// here). The elements are those of CelesTrak's OMM/JSON: mean motion
// (revolutions per day), eccentricity, inclination, node, argument of
// perigee and mean anomaly (degrees), B* (per Earth radius) and the epoch
// (UTC). Positions in km in TEME, the frame of the elements.

// WGS 72, as SGP4 wants
const MU = 398600.8, RE = 6378.135, XKE = 60 / Math.sqrt(RE ** 3 / MU);
const J2 = 0.001082616, J3 = -0.00000253881, J4 = -0.00000165597, J3OJ2 = J3 / J2;
const TAU = 2 * Math.PI, RAD = Math.PI / 180;
const fmod = (x) => x % TAU;

// The constants of an orbit, or throws for one it cannot follow
function sgp4init(el) {
  const no = el.MEAN_MOTION * TAU / 1440, e0 = el.ECCENTRICITY, i0 = el.INCLINATION * RAD;
  const node0 = el.RA_OF_ASC_NODE * RAD, argp0 = el.ARG_OF_PERICENTER * RAD, m0 = el.MEAN_ANOMALY * RAD, bstar = el.BSTAR;
  const s = { e0, i0, node0, argp0, m0, bstar };
  // initl: the un-Kozai mean motion
  const eccsq = e0 * e0, omeosq = 1 - eccsq, rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(i0), cosio2 = cosio * cosio, sinio = Math.sin(i0);
  const ak = (XKE / no) ** (2 / 3);
  const d1 = 0.75 * J2 * (3 * cosio2 - 1) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + 134 * del * del / 81));
  del = d1 / (adel * adel);
  s.no = no / (1 + del);
  const ao = (XKE / s.no) ** (2 / 3), po = ao * omeosq, con42 = 1 - 5 * cosio2;
  s.con41 = -con42 - cosio2 - cosio2;
  const posq = po * po, rp = ao * (1 - e0);
  if (TAU / s.no >= 225) throw new Error("a deep-space orbit (a period of 225 minutes or more), which needs SDP4");
  if (!(e0 >= 0 && e0 < 1) || !(s.no > 0)) throw new Error("elements out of range");

  s.isimp = rp < 220 / RE + 1;
  let sfour = 78 / RE + 1, qzms24 = ((120 - 78) / RE) ** 4;
  const perige = (rp - 1) * RE;
  if (perige < 156) {
    sfour = perige < 98 ? 20 : perige - 78;
    qzms24 = ((120 - sfour) / RE) ** 4;
    sfour = sfour / RE + 1;
  }
  const pinvsq = 1 / posq, tsi = 1 / (ao - sfour);
  s.eta = ao * e0 * tsi;
  const etasq = s.eta * s.eta, eeta = e0 * s.eta, psisq = Math.abs(1 - etasq);
  const coef = qzms24 * tsi ** 4, coef1 = coef / psisq ** 3.5;
  const cc2 = coef1 * s.no * (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) + 0.375 * J2 * tsi / psisq * s.con41 * (8 + 3 * etasq * (8 + etasq)));
  s.cc1 = bstar * cc2;
  const cc3 = e0 > 1e-4 ? -2 * coef * tsi * J3OJ2 * s.no * sinio / e0 : 0;
  s.x1mth2 = 1 - cosio2;
  s.cc4 = 2 * s.no * coef1 * ao * omeosq * (s.eta * (2 + 0.5 * etasq) + e0 * (0.5 + 2 * etasq) - J2 * tsi / (ao * psisq) *
    (-3 * s.con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) + 0.75 * s.x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * argp0)));
  s.cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * s.no, temp2 = 0.5 * temp1 * J2 * pinvsq, temp3 = -0.46875 * J4 * pinvsq * pinvsq * s.no;
  s.mdot = s.no + 0.5 * temp1 * rteosq * s.con41 + 0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  s.argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) + temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  s.nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
  s.omgcof = bstar * cc3 * Math.cos(argp0);
  s.xmcof = e0 > 1e-4 ? -2 / 3 * coef * bstar / eeta : 0;
  s.nodecf = 3.5 * omeosq * xhdot1 * s.cc1;
  s.t2cof = 1.5 * s.cc1;
  s.xlcof = -0.25 * J3OJ2 * sinio * (3 + 5 * cosio) / (Math.abs(cosio + 1) > 1.5e-12 ? 1 + cosio : 1.5e-12);
  s.aycof = -0.5 * J3OJ2 * sinio;
  s.delmo = (1 + s.eta * Math.cos(m0)) ** 3;
  s.sinmao = Math.sin(m0);
  s.x7thm1 = 7 * cosio2 - 1;
  if (!s.isimp) {
    const cc1sq = s.cc1 * s.cc1;
    s.d2 = 4 * ao * tsi * cc1sq;
    const temp = s.d2 * tsi * s.cc1 / 3;
    s.d3 = (17 * ao + sfour) * temp;
    s.d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * s.cc1;
    s.t3cof = s.d2 + 2 * cc1sq;
    s.t4cof = 0.25 * (3 * s.d3 + s.cc1 * (12 * s.d2 + 10 * cc1sq));
    s.t5cof = 0.2 * (3 * s.d4 + 12 * s.cc1 * s.d3 + 6 * s.d2 * s.d2 + 15 * cc1sq * (2 * s.d2 + cc1sq));
  }
  return s;
}

// The position (km, TEME) t minutes after the epoch, or null once the
// orbit has decayed (or the elements no longer hold)
function sgp4(s, t) {
  const xmdf = s.m0 + s.mdot * t, argpdf = s.argp0 + s.argpdot * t, nodedf = s.node0 + s.nodedot * t;
  let argpm = argpdf, mm = xmdf;
  const t2 = t * t;
  let nodem = nodedf + s.nodecf * t2, tempa = 1 - s.cc1 * t, tempe = s.bstar * s.cc4 * t, templ = s.t2cof * t2;
  if (!s.isimp) {
    const delomg = s.omgcof * t, delm = s.xmcof * ((1 + s.eta * Math.cos(xmdf)) ** 3 - s.delmo);
    mm = xmdf + delomg + delm;
    argpm = argpdf - delomg - delm;
    const t3 = t2 * t, t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe += s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ += s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }
  const am = (XKE / s.no) ** (2 / 3) * tempa * tempa, nm = XKE / am ** 1.5;
  let em = s.e0 - tempe;
  if (!(am > 0) || em >= 1 || em < -0.001) return null;
  if (em < 1e-6) em = 1e-6;
  mm += s.no * templ;
  const xlm = fmod(mm + argpm + nodem);
  nodem = fmod(nodem);
  argpm = fmod(argpm);
  mm = fmod(xlm - argpm - nodem);
  const sinip = Math.sin(s.i0), cosip = Math.cos(s.i0);

  // long-period periodics
  const axnl = em * Math.cos(argpm);
  let temp = 1 / (am * (1 - em * em));
  const aynl = em * Math.sin(argpm) + temp * s.aycof;
  const xl = mm + argpm + nodem + temp * s.xlcof * axnl;
  // Kepler's equation
  const u = fmod(xl - nodem);
  let eo1 = u, tem5 = 9999.9, sineo1 = 0, coseo1 = 0;
  for (let k = 0; Math.abs(tem5) >= 1e-12 && k < 10; k++) {
    sineo1 = Math.sin(eo1);
    coseo1 = Math.cos(eo1);
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / (1 - coseo1 * axnl - sineo1 * aynl);
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
  }
  // short-period periodics
  const ecose = axnl * coseo1 + aynl * sineo1, esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl, pl = am * (1 - el2);
  if (pl < 0) return null;
  const rl = am * (1 - ecose), betal = Math.sqrt(1 - el2);
  temp = esine / (1 + betal);
  const sinu = am / rl * (sineo1 - aynl - axnl * temp), cosu = am / rl * (coseo1 - axnl + aynl * temp);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu, cos2u = 1 - 2 * sinu * sinu;
  temp = 1 / pl;
  const temp1 = 0.5 * J2 * temp, temp2 = temp1 * temp;
  const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  if (mrt < 1) return null;
  su -= 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodem + 1.5 * temp2 * cosip * sin2u, xinc = s.i0 + 1.5 * temp2 * cosip * sinip * cos2u;
  const sinsu = Math.sin(su), cossu = Math.cos(su), snod = Math.sin(xnode), cnod = Math.cos(xnode), sini = Math.sin(xinc), cosi = Math.cos(xinc);
  const xmx = -snod * cosi, xmy = cnod * cosi;
  return [(xmx * sinsu + cnod * cossu) * mrt * RE, (xmy * sinsu + snod * cossu) * mrt * RE, sini * sinsu * mrt * RE];
}

export { sgp4init, sgp4 };
