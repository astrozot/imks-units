// One event, one year buffer, then the main thread terminates this worker.
import { readPrecisionPack } from './precisionpack.js';
import { makePrecisionEphemeris } from './precisionephem.js';
import { solarLocal, lunarEclipse, occultationLocal, deltaTError } from './astro.js';

export async function calculatePrecisionEvent(job, pack) {
  const { kind, t, place, target, front } = job;
  const native = pack.header.native === true, first = native ? 1550 : 1900, last = native ? 2650 : 2100;
  if (!Number.isFinite(t) || t < Date.UTC(first, 0, 1) / 1000 || t >= Date.UTC(last + 1, 0, 1) / 1000) throw new RangeError(`DE440 event data covers ${first}–${last}`);
  if (!['solar', 'lunar', 'occultation'].includes(kind)) throw new Error('Unsupported precision event');
  if (kind !== 'lunar' && (!Array.isArray(place) || place.length < 2 || !place.every(Number.isFinite) || Math.abs(place[0]) > 90 || Math.abs(place[1]) > 180 || Math.abs(place[2] || 0) > 1e7)) throw new Error('Select a valid observing place first');
  const ephemeris = makePrecisionEphemeris(pack);
  if (kind === 'occultation' && (!ephemeris.supports(target) || !ephemeris.supports(front))) throw new Error('DE440 refinement supports the Moon, major planets and catalog stars');
  const start = performance.now();
  let event;
  if (kind === 'solar') event = solarLocal(t, place, ephemeris);
  else if (kind === 'lunar') {
    event = lunarEclipse(t - 86400, ephemeris, t + 86400);
    if (event && Math.abs(event.max - t) > 2 * 86400) throw new Error('The selected lunar eclipse could not be refined');
  } else event = occultationLocal(target, front, t, place, ephemeris);
  const clock = ephemeris.clock(event?.max ?? t), year = new Date(t * 1000).getUTCFullYear();
  const ids = { mars:4, jupiter:5, saturn:6, uranus:7, neptune:8 };
  const planetModel = kind === 'occultation' && [target, front].some((b) => ids[b] && !pack.has(ids[b], ids[b] * 100 + 99));
  return { kind, event, source: 'DE440', year, native, earthOrientation: clock.eop ? 'IERS daily UT1 and polar motion (observations/predictions)' : 'Modelled Earth rotation (ΔT)', rotationErrorSeconds: clock.eop ? null : deltaTError(2000 + (clock.utcJD - 2451545) / 365.25), planetModel, residentBytes: pack.byteLength, calculationMs: performance.now() - start };
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
    if (pack.header.year !== new Date(data.t * 1000).getUTCFullYear() || !(pack.header.source === 'DE440s' || pack.header.source === 'DE440' && pack.header.native === true)) throw new Error('Wrong precision data year or source');
    self.postMessage({ progress: 'Calculating DE440 contacts…' });
    self.postMessage({ result: { ...await calculatePrecisionEvent(data, pack), fromCache: data.fromCache } });
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
