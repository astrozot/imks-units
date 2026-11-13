// Optional DE440 event ephemeris. Every cache here is bounded to one
// instant. No global provider is installed in astro.js or the sky renderer.
import { precisionFrame } from './precisionframes.js';
import { deltaT } from './astro.js';
import { MOONS } from './moons.js';
import { moonSeriesPosition } from './moonposition.js';
import { SYSTEM_GM } from './precision-gm.js';
const RAD = Math.PI / 180, AU = 149597870.7, C = 299792.458, AS = RAD / 3600;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const add = (a, b, scale = 1) => a.map((x, i) => x + scale * b[i]);
const unit = (a) => { const n = Math.hypot(...a); return a.map((x) => x / n); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const IDS = { mercury: 1, venus: 2, mars: 4, jupiter: 5, saturn: 6, uranus: 7, neptune: 8 };
const SATELLITES = { phobos:[4,401],deimos:[4,402],io:[5,501],europa:[5,502],ganymede:[5,503],callisto:[5,504],mimas:[6,601],enceladus:[6,602],tethys:[6,603],dione:[6,604],rhea:[6,605],titan:[6,606],hyperion:[6,607],iapetus:[6,608],miranda:[7,705],ariel:[7,701],umbriel:[7,702],titania:[7,703],oberon:[7,704],triton:[8,801] };
const LEAPS = [[1972,1,10],[1972,7,11],[1973,1,12],[1974,1,13],[1975,1,14],[1976,1,15],[1977,1,16],[1978,1,17],[1979,1,18],[1980,1,19],[1981,7,20],[1982,7,21],[1983,7,22],[1985,7,23],[1988,1,24],[1990,1,25],[1991,1,26],[1992,7,27],[1993,7,28],[1994,7,29],[1996,1,30],[1997,7,31],[1999,1,32],[2006,1,33],[2009,1,34],[2012,7,35],[2015,7,36],[2017,1,37]].map(([y,m,d]) => [Date.UTC(y,m-1,1)/86400000+2440587.5,d]);

export function precisionClock(pack, t) {
  const utcJD = t / 86400 + 2440587.5, eop = pack.orientation(utcJD);
  let ttJD, ut1JD;
  if (eop && utcJD >= LEAPS[0][0]) {
    const leap = LEAPS.findLast(([jd]) => jd <= utcJD)[1];
    ttJD = utcJD + (leap + 32.184) / 86400; ut1JD = utcJD + eop.dut1 / 86400;
  } else {
    // Beyond the measured/predicted IERS interval, civil time and Earth
    // rotation cannot be known in advance: retain the app's ΔT model.
    ut1JD = utcJD; ttJD = utcJD + deltaT(2000 + (utcJD-2451545)/365.25) / 86400;
  }
  const g = (357.53 + 0.9856003 * (ttJD-2451545)) * RAD;
  const tdbJD = ttJD + (0.001657*Math.sin(g)+0.000022*Math.sin(2*g))/86400;
  return { utcJD, ttJD, tdbJD, ut1JD, eop };
}

export function makePrecisionEphemeris(pack, { satelliteState = null } = {}) {
  let time = NaN, context = null;
  const centre = (body, jd) => {
    const satellite = SATELLITES[body.toLowerCase()];
    if (satellite) {
      const [parent,id] = satellite, a = pack.native(0,parent,jd), b = pack.native(parent,id,jd);
      return { position:add(a.position,b.position), velocity:add(a.velocity,b.velocity) };
    }
    if (body === 'sun') return pack.native(0, 10, jd);
    const emb = () => pack.native(0, 3, jd);
    if (body === 'earth' || body === 'moon') {
      const a = emb(), b = pack.native(3, body === 'earth' ? 399 : 301, jd);
      return { position: add(a.position,b.position), velocity: add(a.velocity,b.velocity) };
    }
    const id = IDS[body];
    if (!id) throw new Error('Precision data supports the Sun, Moon, major planets and catalog stars');
    const state = pack.native(0, id, jd), sys = MOONS[body];
    if (pack.has(id,id*100+99)) {
      const p = pack.native(id,id*100+99,jd);
      return { position:add(state.position,p.position), velocity:add(state.velocity,p.velocity) };
    }
    if (!sys) return state;
    if (jd < 2415020.5 || jd > 2488434.5) throw new RangeError('A native satellite kernel is required for this planet centre outside 1900–2100');
    // DE440 carries system barycentres. Correct to the planet centre with
    // mass-weighted satellite vectors. Omitted small moons limit this
    // correction (notably Nereid: up to a few km), explicitly audited.
    const [a,d] = sys.pole.map((x) => x*RAD), z = [Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d)], x = [-Math.sin(a),Math.cos(a),0], y = cross(z,x);
    const masses = SYSTEM_GM[body], total = masses.gm + Object.values(masses.moons).reduce((s,m) => s+m,0);
    const shift = [0,0,0];
    for (const [name,mass] of Object.entries(masses.moons)) {
      const q = satelliteState?.(name,jd) || moonSeriesPosition(sys.moons[name],jd-2451545);
      for (let i=0;i<3;i++) shift[i] += (q[0]*x[i]+q[1]*y[i]+q[2]*z[i])*mass/total;
    }
    return { position: add(state.position,shift,-1), velocity: state.velocity };
  };
  const at = (t) => {
    if (time !== t) {
      const clock = precisionClock(pack,t), frame = precisionFrame(clock.ttJD), earth = centre('earth',clock.tdbJD), sun = centre('sun',clock.tdbJD);
      context = { ...clock, frame, earth, sun }; time = t;
    }
    return context;
  };
  const observer = (c, place) => {
    if (!place) return { position:c.earth.position, velocity:c.earth.velocity };
    const [lat,lon,h=0] = place, phi = lat*RAD, u = Math.atan(0.99664719*Math.tan(phi));
    const rc = 6378.137*Math.cos(u)+h/1000*Math.cos(phi), rs = 6378.137*0.99664719*Math.sin(u)+h/1000*Math.sin(phi);
    let v = [rc*Math.cos(lon*RAD),rc*Math.sin(lon*RAD),rs];
    const xp = (c.eop?.xp || 0)*AS, yp = (c.eop?.yp || 0)*AS;
    v = [v[0]-xp*v[2],v[1]+yp*v[2],v[2]+xp*v[0]-yp*v[1]];
    const theta = c.frame.sidereal(c.ut1JD)*RAD, cs = Math.cos(theta), sn = Math.sin(theta);
    v = [v[0]*cs-v[1]*sn,v[0]*sn+v[1]*cs,v[2]];
    const spin = [-v[1]*7.29211514670698e-5*86400,v[0]*7.29211514670698e-5*86400,0];
    return { position:add(c.earth.position,c.frame.inverse(v)), velocity:add(c.earth.velocity,c.frame.inverse(spin)) };
  };
  const apparent = (body,t,place) => {
    const c = at(t), obs = observer(c,place);
    let p, dist;
    if (typeof body === 'object') {
      if (body.orbit || body.orbits || body.sgp4 || !Number.isFinite(body.ra) || !Number.isFinite(body.dec)) return null;
      const a=body.ra*RAD,d=body.dec*RAD, u=[Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d)], east=[-Math.sin(a),Math.cos(a),0], north=[-Math.sin(d)*Math.cos(a),-Math.sin(d)*Math.sin(a),Math.cos(d)];
      const years=(c.ttJD-2451545)/365.25, distance=body.plx>0 ? 206264806/body.plx*AU : 1e18;
      const radial=(body.rv||0)*31557600/distance;
      p=u.map((x,i) => distance*(x+years*((body.pmra||0)*AS/1000*east[i]+(body.pmdec||0)*AS/1000*north[i]+radial*x)));
    } else {
      let delay=0;
      for (let i=0;i<4;i++) { p=centre(body,c.tdbJD-delay).position; delay=Math.hypot(...add(p,obs.position,-1))/C/86400; }
    }
    let q=add(p,obs.position,-1); dist=Math.hypot(...q); let direction=unit(q);
    if (body!=='sun') {
      const e=unit(add(obs.position,c.sun.position,-1)), source=unit(add(p,c.sun.position,-1)), em=Math.hypot(...add(obs.position,c.sun.position,-1))/AU;
      const scale=1.97412574336e-8/(em*Math.max(dot(source,add(source,e)),1e-6/(em*em)));
      direction=unit(add(direction,cross(direction,cross(e,source)),scale));
    }
    const beta=obs.velocity.map((x) => x/86400/C), pv=dot(direction,beta), bm1=Math.sqrt(1-dot(beta,beta)), w=1+pv/(1+bm1);
    direction=unit(direction.map((x,i) => bm1*x+w*beta[i]));
    const v=c.frame.apply(direction);
    return { ra:(Math.atan2(v[1],v[0])/RAD+360)%360, dec:Math.atan2(v[2],Math.hypot(v[0],v[1]))/RAD, dist };
  };
  return { equatorial:(body,t)=>apparent(body,t,null), topocentric:apparent, siderealTime:(t,lon=0)=>{const c=at(t);return c.frame.sidereal(c.ut1JD,lon);}, clock:(t)=>at(t), centre,
    supports:(body)=>typeof body==='string' ? body==='sun'||body==='moon'||body in IDS||Boolean(SATELLITES[body.toLowerCase()]&&pack.has(...SATELLITES[body.toLowerCase()])) : Boolean(body && Number.isFinite(body.ra)&&Number.isFinite(body.dec)&&!body.orbit&&!body.orbits&&!body.sgp4) };
}
