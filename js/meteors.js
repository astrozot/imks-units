// Source: International Meteor Organization, 2027 Meteor Shower Calendar,
// Table 5 (https://www.imo.net/files/meteor-shower/cal2027.pdf).
// name, approximate active month/day bounds, J2000 peak solar longitude,
// broad/plateau maximum. This predicts the regular maximum, not outbursts.
import { solarLongitudeJ2000 } from './astro.js';
import { skyTimeParts } from './coelumtime.js';
const SHOWERS = [
  ['Quadrantids', 1228, 112, 283.15, false], ['Lyrids', 414, 430, 32.32, false],
  ['Eta Aquariids', 419, 528, 45.5, true], ['Southern Delta Aquariids', 712, 823, 128, true],
  ['Perseids', 717, 824, 140, false], ['Draconids', 1006, 1010, 195.4, false],
  ['Orionids', 1002, 1107, 208, true], ['Southern Taurids', 920, 1120, 223, true],
  ['Northern Taurids', 1020, 1210, 230, true], ['Leonids', 1106, 1130, 235.27, false],
  ['Geminids', 1204, 1220, 262.2, true], ['Ursids', 1217, 1226, 270.7, false],
];
const cache = new Map();
export function meteorPeak(year, longitude) {
  if (year < 2000 || year > 2100) return null;
  const key = `${year},${longitude}`;
  if (cache.has(key)) return cache.get(key);
  // A January seed plus the forward angular distance gives an estimate
  // within a few days. Newton refinement follows Earth's actual motion.
  const start = Date.UTC(year, 0, 1) / 1000;
  let time = start + ((longitude - solarLongitudeJ2000(start) + 360) % 360) / 360 * 365.25636 * 86400;
  for (let i = 0; i < 8; i++) {
    const delta = (solarLongitudeJ2000(time) - longitude + 540) % 360 - 180;
    const rate = ((solarLongitudeJ2000(time + 3600) - solarLongitudeJ2000(time - 3600) + 540) % 360 - 180) / 7200;
    time -= delta / rate;
    if (Math.abs(delta / rate) < 0.1) break;
  }
  cache.set(key, time);
  return time;
}
export function meteorShowers(time, zone) {
  const p = skyTimeParts(time, zone), md = p.month * 100 + p.day;
  if (p.year < 2000 || p.year > 2100) return [];
  return SHOWERS.filter(([, a, b]) => a > b ? md >= a || md <= b : md >= a && md <= b)
    .map(([name, a, , longitude, broad]) => ({ name, longitude, broad,
      // December's Quadrantids belong to the following January maximum.
      peak: meteorPeak(p.year + (a === 1228 && p.month === 12 ? 1 : 0), longitude),
    })).filter((s) => s.peak !== null).sort((a, b) => a.peak - b.peak);
}
