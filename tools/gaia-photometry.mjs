// ESA Gaia DR3 documentation §5.5.1, Tables 5.9 and 5.10:
// https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu5pho/cu5pho_sec_photSystem/cu5pho_ssec_photRelations.html
// Observed colours: do not deredden stars in an apparent sky chart.
export function visualMagnitude(g, bpRp) {
  if (!Number.isFinite(g) || !Number.isFinite(bpRp) || bpRp < -0.5 || bpRp > 5) return null;
  return g + 0.02704 + bpRp * (-0.01424 + bpRp * (0.2156 - 0.01426 * bpRp));
}

export const gaiaColour = (bv) => 0.06483 + bv * (1.575 + bv * (-0.7815 + bv * (0.5707 + bv * (-0.176 + bv * 0.01916))));
// Invert the monotonic BP−RP = f(B−V) relation inside its published range.
// This is an approximate display colour, not a measured Johnson B−V.
export function johnsonColour(bpRp) {
  if (!Number.isFinite(bpRp) || bpRp < gaiaColour(-0.5) || bpRp > gaiaColour(3.5)) return null;
  let lo = -0.5, hi = 3.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (gaiaColour(mid) < bpRp) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Gaia's ICRS directions at J2016.0 -> J2000.0. pmra is μα cos δ.
// Work with unit vectors so high declinations and RA wrap need no special case.
export function j2000(ra, dec, pmra, pmdec) {
  const R = Math.PI / 180, a = ra * R, d = dec * R, k = -16 * R / 3.6e6;
  const ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
  const e = pmra * k, n = pmdec * k;
  const x = cd * ca - e * sa - n * sd * ca, y = cd * sa + e * ca - n * sd * sa, z = sd + n * cd;
  return [(Math.atan2(y, x) / R + 360) % 360, Math.atan2(z, Math.hypot(x, y)) / R];
}
