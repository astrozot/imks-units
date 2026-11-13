// IAU 2006 frame bias/precession and 77-term nutation: IAU 2000B within
// DE440's interval, full IERS arguments and CIO rotation outside it. The
// shared sky frame explicitly selects full arguments and CIO at all dates.
// Formulae/series adapted from ERFA; see data/precision/ERFA-LICENSE.txt.
import { NUTATION_2000B as TERMS } from './precision-nutation.js';
import { equationOrigins } from './precision-cio.js';
const AS = Math.PI / (180 * 3600);
export const rotateX = (a, [x, y, z]) => [x, Math.cos(a) * y + Math.sin(a) * z, -Math.sin(a) * y + Math.cos(a) * z];
export const rotateZ = (a, [x, y, z]) => [Math.cos(a) * x + Math.sin(a) * y, -Math.sin(a) * x + Math.cos(a) * y, z];
const poly = (t, c) => c.reduceRight((sum, a) => sum * t + a, 0);
export function precisionFrame(ttJD, full = ttJD < 2287184.5 || ttJD > 2688976.5) {
  const T = (ttJD - 2451545) / 36525;
  // IAU 2000B linearises its fundamental arguments for modern dates.
  // That drifts by tenths of an arcsecond in historical apparent places.
  // Outside DE440's interval retain the same bounded 77-term series but
  // evaluate the complete IERS 2003 arguments (ERFA fa[l,lp,f,d,om]03).
  const arguments_ = (full?
    [[485868.249036,1717915923.2178,31.8792,.051635,-.00024470],[1287104.793048,129596581.0481,-.5532,.000136,-.00001149],[335779.526232,1739527262.8478,-12.7512,-.001037,.00000417],[1072260.703692,1602961601.2090,-6.3706,.006593,-.00003169],[450160.398036,-6962890.5431,7.4722,.007702,-.00005939]]:
    [[485868.249036,1717915923.2178],[1287104.79305,129596581.0481],[335779.526232,1739527262.8478],[1072260.70369,1602961601.2090],[450160.398036,-6962890.5431]])
    .map(c => (poly(T,c) % 1296000) * AS);
  let dp = 0, de = 0;
  for (let i = TERMS.length - 11; i >= 0; i -= 11) {
    let a = 0;
    for (let j = 0; j < 5; j++) a += TERMS[i + j] * arguments_[j];
    dp += (TERMS[i + 5] + TERMS[i + 6] * T) * Math.sin(a) + TERMS[i + 7] * Math.cos(a);
    de += (TERMS[i + 8] + TERMS[i + 9] * T) * Math.cos(a) + TERMS[i + 10] * Math.sin(a);
  }
  const j2 = -2.7774e-6 * T;
  const dpsi = (dp / 1e7 - 0.000135) * AS * (1 + 0.4697e-6 + j2), deps = (de / 1e7 + 0.000388) * AS * (1 + j2);
  const gamma = poly(T, [-.052928,10.556378,.4932044,-.00031238,-.000002788,.000000026]) * AS;
  const phi = poly(T, [84381.412819,-46.811016,.0511268,.00053289,-.00000044,-.0000000176]) * AS;
  const psi = poly(T, [-.041775,5038.481484,1.5584175,-.00018522,-.000026452,-.0000000148]) * AS;
  const eps = poly(T, [84381.406,-46.836769,-.0001831,.0020034,-.000000576,-.0000000434]) * AS;
  const apply = (v) => rotateX(-eps - deps, rotateZ(-psi - dpsi, rotateX(phi, rotateZ(gamma, v))));
  const inverse = (v) => rotateZ(-gamma, rotateX(-phi, rotateZ(psi + dpsi, rotateX(eps + deps, v))));
  let origins=null;
  if(full){
    const columns=[[1,0,0],[0,1,0],[0,0,1]].map(apply),matrix=[0,1,2].map(row=>columns.map(c=>c[row]));
    origins=equationOrigins(T,arguments_,matrix);
  }
  const sidereal = (ut1JD, lon = 0) => {
    if(origins!==null){
      // The polynomial GMST + dpsi*cos(eps) approximation accumulates a
      // significant rotation error over millennia. Use ERA minus the
      // IAU 2006 equation of the origins for the historical path.
      const era=2*Math.PI*(ut1JD%1+.7790572732640+.00273781191135448*(ut1JD-2451545));
      return (((era-origins)*180/Math.PI+lon)%360+360)%360;
    }
    const era = 2 * Math.PI * (0.7790572732640 + 1.00273781191135448 * (ut1JD - 2451545));
    const gmst = era + poly(T, [.014506,4612.156534,1.3915817,-.00000044,-.000029956,-.0000000368]) * AS;
    return ((gmst + dpsi * Math.cos(eps) + lon * Math.PI / 180) * 180 / Math.PI % 360 + 360) % 360;
  };
  return { T, dpsi, deps, eps, apply, inverse, sidereal };
}
