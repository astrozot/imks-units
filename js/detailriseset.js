// Rise/set for one selected chart object. Yield while scanning so selection
// and playback stay responsive, including for rapidly moving satellites.
import {skyObjectAt, refraction} from './coelum.js';
import {horizonRefraction} from './astro.js';

export async function detailRiseSet(object, start, end, place, terrain = null, {signal, position = skyObjectAt, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))} = {}) {
  const theoretical = {rise: [], set: [], above: null}, local = terrain ? {rise: [], set: [], above: null} : null;
  const r = horizonRefraction(place[2]);
  const clearance = time => {
    const h = position(object, time, place);
    if (!h || !Number.isFinite(h.alt) || !Number.isFinite(h.az)) throw new Error('Position unavailable for this object');
    const limb = object.body === 'sun' ? 0.2666 : object.body === 'moon' ? Math.asin(1737.4 / h.dist) * 180 / Math.PI : 0;
    return [h.alt + r + limb, terrain ? h.alt + refraction(h.alt, place[2]) + limb - terrain(h.az) : null];
  };
  const check = () => signal?.throwIfAborted();
  check();
  let a = start, fa = clearance(a), count = 0;
  theoretical.above = fa[0] >= 0;
  if (local) local.above = fa[1] >= 0;
  const step = object.satellite ? 5 : 30;
  while (a < end) {
    check();
    const b = Math.min(a + step, end), fb = clearance(b);
    for (const [i, events] of [theoretical, local].entries()) {
      if (!events || (fa[i] >= 0) === (fb[i] >= 0)) continue;
      let lo = a, hi = b;
      while (hi - lo > 0.1) {
        const mid = (lo + hi) / 2;
        if ((clearance(mid)[i] >= 0) === (fa[i] >= 0)) lo = mid; else hi = mid;
      }
      const time = (lo + hi) / 2;
      if (time < end) events[fb[i] >= 0 ? 'rise' : 'set'].push(time);
    }
    a = b; fa = fb;
    if (++count % 32 === 0) await yieldTask();
  }
  check();
  return {theoretical, terrain: local};
}
