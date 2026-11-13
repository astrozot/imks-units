// One event, one year buffer, then the main thread terminates this worker.
import { readPrecisionPack } from './precisionpack.js';
import { makePrecisionEphemeris } from './precisionephem.js';
import { solarLocal, lunarEclipse, occultationLocal, deltaTError, horizontal } from './astro.js';
import { PLANET_IDS,HISTORICAL_YEARS,NATIVE_MOONS } from './precisioncatalog.js';

export async function calculatePrecisionEvent(job, pack) {
  const { kind, t, place, target, front } = job;
  const native = pack.header.native === true, source=pack.header.source==='DE440s'?'DE440':pack.header.source;
  const [first,last]=source==='DE441'?HISTORICAL_YEARS:native?[1550,2650]:[1900,2100],year=new Date(t*1000).getUTCFullYear();
  if (!Number.isFinite(t) || year<first || year>last) throw new RangeError(`${source} refinement covers astronomical years ${first}–${last}`);
  if (!['solar', 'lunar', 'occultation', 'position'].includes(kind)) throw new Error('Unsupported precision calculation');
  if (kind !== 'lunar' && (!Array.isArray(place) || place.length < 2 || !place.every(Number.isFinite) || Math.abs(place[0]) > 90 || Math.abs(place[1]) > 180 || Math.abs(place[2] || 0) > 1e7)) throw new Error('Select a valid observing place first');
  const ephemeris = makePrecisionEphemeris(pack,{allowBarycentres:kind==='position'});
  if (kind === 'occultation' && (!ephemeris.supports(target) || !ephemeris.supports(front))) throw new Error('DE440 refinement supports the Moon, major planets and catalog stars');
  const start = performance.now();
  if(kind==='position'){
    const body=typeof job.body==='string'?job.body.toLowerCase():null;
    if(!body||!ephemeris.supports(body))throw new Error('Native position data is unavailable for this body');
    const position={...ephemeris.topocentric(body,t,place),...horizontal(body,t,place,ephemeris)},geocentric=ephemeris.equatorial(body,t),clock=ephemeris.clock(t),id=PLANET_IDS[body];
    const centreModel=id>=4&&!pack.has(id,id*100+99)?(year>=1900&&year<=2100?'compact correction to system barycentre':'system barycentre'):'native body centre';
    const satellite=Boolean(NATIVE_MOONS[body]);
    return {kind,body,t,place:[...place],position,geocentric,centreModel,satellite,kernels:pack.header.kernels?.map(k=>k.id)||[],source,year,native,earthOrientation:clock.eop?'IERS daily UT1 and polar motion (observations/predictions)':'Modelled Earth rotation (ΔT)',rotationErrorSeconds:clock.eop?null:deltaTError(2000+(clock.utcJD-2451545)/365.25),residentBytes:pack.byteLength,calculationMs:performance.now()-start};
  }
  let event;
  if (kind === 'solar') event = solarLocal(t, place, ephemeris);
  else if (kind === 'lunar') {
    event = lunarEclipse(t - 86400, ephemeris, t + 86400);
    if (event && Math.abs(event.max - t) > 2 * 86400) throw new Error('The selected lunar eclipse could not be refined');
  } else event = occultationLocal(target, front, t, place, ephemeris);
  const clock = ephemeris.clock(event?.max ?? t);
  const ids = { mars:4, jupiter:5, saturn:6, uranus:7, neptune:8 };
  const planetModel = kind === 'occultation' && [target, front].some((b) => ids[b] && !pack.has(ids[b], ids[b] * 100 + 99));
  return { kind, event, source, year, native, earthOrientation: clock.eop ? 'IERS daily UT1 and polar motion (observations/predictions)' : 'Modelled Earth rotation (ΔT)', rotationErrorSeconds: clock.eop ? null : deltaTError(2000 + (clock.utcJD - 2451545) / 365.25), planetModel, residentBytes: pack.byteLength, calculationMs: performance.now() - start };
}

let nextRange=0;const ranges=new Map();
if (typeof self !== 'undefined' && typeof document === 'undefined') self.onmessage = async ({ data }) => {
  if(data.rangeResult||data.rangeError){
    const value=data.rangeResult||data.rangeError,pending=ranges.get(value.id);if(!pending)return;ranges.delete(value.id);
    if(data.rangeError)pending.reject(new Error(value.message));else pending.resolve(new Uint8Array(value.buffer));return;
  }
  try {
    let buffer=data.buffer;
    if(data.nativeData||data.r2){
      const {nativeEphemerisPack}=await import('./precisionnative.js');
      const read=(key,offset,length)=>new Promise((resolve,reject)=>{const id=++nextRange;ranges.set(id,{resolve,reject});self.postMessage({range:{id,key,offset,length}});});
      buffer=await nativeEphemerisPack(data,data.nativeData||data.r2,read,(message)=>self.postMessage({progress:message}));
    }
    const pack = readPrecisionPack(buffer);
    if (pack.header.year !== new Date(data.t * 1000).getUTCFullYear() || !(pack.header.source === 'DE440s' || ['DE440','DE441'].includes(pack.header.source) && pack.header.native === true)) throw new Error('Wrong precision data year or source');
    self.postMessage({ progress: `Calculating ${pack.header.source} ${data.kind==='position'?'position':'contacts'}…` });
    self.postMessage({ result: { ...await calculatePrecisionEvent(data, pack), fromCache: data.fromCache } });
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
