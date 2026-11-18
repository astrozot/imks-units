// Optional OpenNGC data, shared by the calculator and both sky explorers.
import { DEEP as BUILTIN } from './catalog.js';
export let DEEP = BUILTIN;
export let deepRevision = 0;
export const OPENNGC_URL = new URL('../data/openngc.json', import.meta.url).href;
const CACHE = 'imks-data-openngc';
const key = (s) => s.toLowerCase().replace(/\s+/g, '').replace(/(^|[a-z])0+(?=\d)/g, '$1');
export const builtinDeepNames = new Set(BUILTIN.map((r) => r[0][0]));
export const openNGCCount = () => DEEP === BUILTIN ? 0 : DEEP.length;
function parse(data) {
  if (data.version !== 1 || data.revision !== 'be3cd6c5498806a2fbb2f7e0452ef802dbb02be0' || data.objects?.length !== 13372) throw new Error('Invalid OpenNGC catalog');
  for (const r of data.objects) {
    if (!Array.isArray(r) || r.length !== 8 || !Array.isArray(r[0]) || !r[0].length || !r[0].every((s) => typeof s === 'string' && s.length) || !Number.isFinite(r[1]) || r[1] < 0 || r[1] >= 360 || !Number.isFinite(r[2]) || Math.abs(r[2]) > 90 || !(r[3] === null || Number.isFinite(r[3])) || typeof r[4] !== 'string' || ![r[5], r[6]].every((n) => n === null || Number.isFinite(n) && n > 0) || ![null, 'V', 'B'].includes(r[7])) throw new Error('Invalid OpenNGC object');
  }
  // Preserve familiar names, positions and sizes; extend their aliases.
  const merged = BUILTIN.map((r) => [r[0].slice(), ...r.slice(1)]), names = new Map();
  for (const r of merged) for (const n of r[0]) names.set(key(n), r);
  for (const row of data.objects) {
    const existing = row[0].map((n) => names.get(key(n))).find(Boolean);
    const r = existing || [row[0].slice(), ...row.slice(1)];
    if (existing) { for (const n of row[0]) if (!r[0].some((s) => key(s) === key(n))) r[0].push(n); }
    else merged.push(r);
    for (const n of r[0]) names.set(key(n), r);
  }
  return merged;
}
let loading;
export function loadOpenNGC() {
  return loading ||= (async () => {
    try {
      const cache = await caches.open(CACHE), res = await cache.match(OPENNGC_URL);
      if (res) {
        try { DEEP = parse(await res.json()); deepRevision++; }
        catch { await cache.delete(OPENNGC_URL); }
      }
    } catch { /* Cache Storage unavailable: session downloads still work. */ }
  })();
}
export async function downloadOpenNGC() {
  await loadOpenNGC();
  const res = await fetch(OPENNGC_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`OpenNGC download failed (${res.status})`);
  const data = await res.text(), merged = parse(JSON.parse(data));
  try { await (await caches.open(CACHE)).put(OPENNGC_URL, new Response(data, { headers: { 'content-type': 'application/json' } })); } catch { /* Available for this session. */ }
  DEEP = merged; deepRevision++;
}
export async function removeOpenNGC() {
  await loadOpenNGC();
  try { await caches.delete(CACHE); } catch { /* Nothing stored. */ }
  DEEP = BUILTIN; deepRevision++;
}
// Restore for calculator use too, even before opening the sky explorer.
void loadOpenNGC();
// Additional atlas symbols appear progressively with zoom; selection is always shown.
export function showDeepObject(o, scale, selected) {
  return o.name === selected || builtinDeepNames.has(o.name) || (o.mag ?? 14) <= 8 + 2 * Math.log2(Math.max(1, scale));
}
