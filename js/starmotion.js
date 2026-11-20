// Uniform ICRS space motion and visual-binary Kepler orbits. Distances in
// returned vectors are relative to the reference distance, never normalised:
// this preserves perspective acceleration and the changing annual parallax.
import { BINARY_SYSTEMS } from './binarydata.js';
const R = Math.PI / 180, MAS = R / 3600000;
export const KM_S_TO_PC_YR = 31557600 / (149597870.7 * 648000 / Math.PI);
export function spaceVector(ra, dec, pmra = 0, pmdec = 0, plx = 0, rv = null, years = 0) {
  const a = ra * R, d = dec * R, ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
  const radius = 1 + years * (Number.isFinite(rv) && plx > 0 ? rv * KM_S_TO_PC_YR * plx / 1000 : 0);
  const east = pmra * MAS * years, north = pmdec * MAS * years;
  return [radius * cd * ca - east * sa - north * sd * ca, radius * cd * sa + east * ca - north * sd * sa, radius * sd + north * cd];
}

const components = new Map(BINARY_SYSTEMS.flatMap((s) => s.components.map((c, i) => [c.id, { system: s, component: c, index: i }])));
export const binaryComponent = (id) => components.get(id) || null;

// Fixed geometry is shared by both components. The cache holds one exact
// timestamp per system; playback never accumulates an ephemeris history.
const geometry = new WeakMap(), states = new Map();
let orbitEvaluations = 0;
function orbitGeometry(s) {
  let g = geometry.get(s);
  if (!g) {
    const [,e,i,O,w] = s.orbit, cO=Math.cos(O),sO=Math.sin(O),cw=Math.cos(w),sw=Math.sin(w),ci=Math.cos(i),si=Math.sin(i);
    g = { eccentricFactor: Math.sqrt(1-e*e), x: [cO*cw-sO*sw*ci,sO*cw+cO*sw*ci,sw*si], y: [-cO*sw-sO*cw*ci,-sO*sw+cO*cw*ci,cw*si] };
    geometry.set(s,g);
  }
  return g;
}
const compiled = new Map(BINARY_SYSTEMS.map(s => {
  const b=s.barycentre,a=b.ra*R,d=b.dec*R,ca=Math.cos(a),sa=Math.sin(a),cd=Math.cos(d),sd=Math.sin(d);
  const u=[cd*ca,cd*sa,sd], east=[-sa,ca,0], north=[-sd*ca,-sd*sa,cd];
  const radial=(b.rv||0)*KM_S_TO_PC_YR/b.distance;
  return [s,{u,east,north,plx:1000/b.distance,velocity:u.map((x,k)=>radial*x+MAS*(b.pmra*east[k]+b.pmdec*north[k]))}];
}));
export const binaryMotionStats = () => ({orbitEvaluations,cachedSystems:states.size,maximumCachedSystems:BINARY_SYSTEMS.length});

// Orbital coordinates are north, east, away from the observer. The angular
// semimajor axis is the relative orbit (B minus A), not either absolute orbit.
export function relativeOrbit(s, jd) {
  const [period, eccentricity, , , , epoch, axis] = s.orbit, g=orbitGeometry(s);
  const m = ((2 * Math.PI * (jd - epoch) / period + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let lo = -Math.PI, hi = Math.PI, E = m;
  for (let i = 0; i < 60; i++) {
    const f = E - eccentricity * Math.sin(E) - m;
    if (Math.abs(f) < 1e-14) break;
    if (f > 0) hi = E; else lo = E;
    const trial = E - f / (1 - eccentricity * Math.cos(E));
    E = trial > lo && trial < hi ? trial : (lo + hi) / 2;
  }
  const x = axis * (Math.cos(E) - eccentricity), y = axis * g.eccentricFactor * Math.sin(E);
  return g.x.map((a,k)=>a*x+g.y[k]*y);
}

// Centre-of-mass space motion, without either component's orbit.
export function binaryBarycentreState(id, jd) {
  const entry = components.get(id);
  if (!entry) return null;
  const s = entry.system, g = compiled.get(s), years = (jd - s.barycentre.epoch) / 365.25;
  return { vector: g.u.map((x,k) => x + years*g.velocity[k]), plx: g.plx, system: s };
}

export function binaryState(id, jd) {
  const entry = components.get(id);
  if (!entry) return null;
  const { system: s, index } = entry, b = s.barycentre;
  let cached=states.get(s);
  if (!cached || cached.jd!==jd) {
    const g=compiled.get(s),years=(jd-b.epoch)/365.25,q=relativeOrbit(s,jd),mass=s.masses,total=mass[0]+mass[1];
    const centre=g.u.map((x,k)=>x+years*g.velocity[k]);
    const displacement=g.u.map((x,k)=>(q[0]*g.north[k]+q[1]*g.east[k]+q[2]*x)*R/3600);
    cached={jd,components:s.components.map((c,i)=>({vector:centre.map((x,k)=>x+(i?mass[0]:-mass[1])/total*displacement[k]),plx:g.plx,system:s,component:c}))};
    states.set(s,cached);orbitEvaluations++;
  }
  // Keep the caller's ordinary packed numeric arrays on the rendering hot
  // path. A tiny copy protects the shared cache without frozen-array deopts.
  const result=cached.components[index],v=result.vector;
  return {vector:[v[0],v[1],v[2]],plx:result.plx,system:s,component:entry.component};
}

export function stellarState(star, jd) {
  return binaryState(star.binary, jd) || { vector: spaceVector(star.ra, star.dec, star.pmra, star.pmdec, star.plx, star.rv, (jd - 2451545) / 365.25), plx: star.plx || 0 };
}

// Both components are built in, even when the secondary is fainter than the
// ordinary catalogue limit. Replace integrated-light rows rather than drawing
// a third copy of the system or adding an orbit to component proper motions.
export function withBinaryStars(rows) {
  const replaced = new Set(BINARY_SYSTEMS.flatMap((s) => s.components.flatMap((c) => c.replace || [])));
  const result = rows.filter((s) => !s[13] && !replaced.has(s[0] ? `HIP ${s[0]}` : s[9] || s[10]));
  for (const s of BINARY_SYSTEMS) for (const c of s.components) {
    const { vector: v, plx } = binaryState(c.id, 2451545), ra = (Math.atan2(v[1], v[0]) / R + 360) % 360, dec = Math.atan2(v[2], Math.hypot(v[0], v[1])) / R;
    result.push([c.hip || 0, ra, dec, c.mag, c.bv, 1, s.barycentre.pmra, s.barycentre.pmdec, plx, c.name, c.aliases.join('|'), c.spect || '', s.barycentre.rv, c.id]);
  }
  return result.sort((a, b) => a[3] - b[3]);
}

// Prevent old optional downloads from drawing duplicate binary components.
const tycs = new Map(BINARY_SYSTEMS.flatMap((s) => s.components.filter((c) => c.tyc).map((c) => [c.tyc,c.id])));
const gaias = new Map(BINARY_SYSTEMS.flatMap((s) => s.components.filter((c) => c.gaia).map((c) => [c.gaia,c.id])));
export const binaryCatalogComponent = (tyc, gaia = '') => tycs.get(tyc) || gaias.get(gaia) || null;
export const isBinaryCatalogStar = (tyc, gaia = '') => Boolean(binaryCatalogComponent(tyc,gaia));
