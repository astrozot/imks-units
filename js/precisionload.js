// Loaded only on explicit refinement. Optional downloads never
// enter either app's unbounded service-worker asset cache.
import { readPrecisionPack, PRECISION_LIMITS } from './precisionpack.js';
import { EPHEMERIS_SERVICE } from './precisionconfig.js';
export const PRECISION_CACHE = 'imks-data-precision-v1';
const BASE = new URL('../data/precision/', import.meta.url);
export const precisionYearRange = EPHEMERIS_SERVICE ? [1550, 2650] : [1900, 2100];

export async function boundedBytes(response, limit) {
  if (!response?.ok) { await response?.body?.cancel(); throw new Error('Precision data unavailable; connect once to download this date'); }
  if (Number(response.headers.get('Content-Length')) > limit) { await response.body?.cancel(); throw new Error('Precision download exceeds its size limit'); }
  if (!response.body) throw new Error('Streaming downloads are unavailable in this browser');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Precision download exceeds its size limit');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes.buffer;
}

// Serialise writes across tabs where Web Locks is available. A failed
// persistent cache (quota/private browsing) must not prevent a calculation.
export async function savePrecisionData(cache, url, bytes, type, checksum = null) {
  if (!cache) return;
  const write = async () => {
    let size = bytes.byteLength;
    const entries = [];
    for (const key of await cache.keys()) {
      if (key.url === String(url)) { await cache.delete(key); continue; }
      const res = await cache.match(key), n = Number(res?.headers.get('Content-Length'));
      if (!(n > 0 && n <= PRECISION_LIMITS.fileBytes)) { await cache.delete(key); continue; }
      entries.push([key, n]); size += n;
    }
    for (const [key, n] of entries) {
      if (size <= PRECISION_LIMITS.diskBytes) break;
      await cache.delete(key); size -= n;
    }
    await cache.put(String(url), new Response(bytes, { headers: { 'Content-Type': type, 'Content-Length': String(bytes.byteLength), ...(checksum ? { 'X-Ephemeris-SHA256': checksum } : {}) } }));
  };
  try {
    if (globalThis.navigator?.locks) await navigator.locks.request(PRECISION_CACHE, write);
    else await write();
  } catch { /* transient storage/quota failures: use the downloaded data */ }
}

// Roll back only new payloads from an unfinished request. Existing offline
// ephemerides survive cancellation; successful worker completion commits them.
function cacheTransaction(cache,signal){
 const created=new Set();let committed=false;
 const discard=()=>{if(!committed)for(const key of created)cache?.delete(key).catch(()=>{});};
 signal?.addEventListener('abort',discard,{once:true});
 return {remember(url,existed){if(!existed)created.add(url.href);},check(){if(signal?.aborted){discard();signal.throwIfAborted();}},commit(){committed=true;created.clear();signal?.removeEventListener('abort',discard);},discard};
}

export async function loadPrecisionYear(year, progress = () => {}, signal) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new RangeError('DE440 event data covers 1900–2100');
  let cache = null;
  try { cache = await caches.open(PRECISION_CACHE); } catch { /* private browsing */ }
  const transaction=cacheTransaction(cache,signal);transaction.check();
  const indexURL = new URL('index.json', BASE);
  // The index describes this version's immutable snapshot. A cached year
  // must start immediately offline, without waiting for a network timeout.
  // Clear event data to replace the snapshot with newly hosted IERS data.
  const savedIndex = await cache?.match(indexURL.href);
  progress('Reading the DE440 event data index…');
  const manifestBytes = await boundedBytes(savedIndex || await fetch(indexURL, { cache: 'no-store', signal }), 64 * 1024);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const entry = manifest.files?.[`${year}.bin`];
  if (manifest.version !== 1 || !entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 24 || entry.bytes > PRECISION_LIMITS.fileBytes || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Invalid precision data index');
  const url = new URL(`${year}.bin`, BASE);
  const validate = async (response) => {
    const bytes = await boundedBytes(response, entry.bytes);
    if (bytes.byteLength !== entry.bytes) throw new Error('Incomplete precision download');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
    if (hash !== entry.sha256) throw new Error('Precision download failed its integrity check');
    const pack = readPrecisionPack(bytes);
    if (pack.header.year !== year || pack.header.source !== 'DE440s') throw new Error('Wrong precision data year or source');
    return { bytes, pack };
  };
  let result, fromCache = false;
  const saved = await cache?.match(url.href);
  if (saved) {
    progress(`Checking downloaded DE440 data for ${year}…`);
    try { result = await validate(saved); fromCache = true; }
    catch (error) { console.warn('Discarding cached precision data:', error.message); await cache.delete(url.href); }
  }
  if (!result) {
    progress(`Downloading DE440 for ${year} (${Math.ceil(entry.bytes / 1024)} KiB)…`);
    result = await validate(await fetch(url, { cache: 'no-store', signal }));
  }
  // Touch a reused year as well, so frequently used offline data survives
  // eviction of the oldest downloads.
  progress('Updating the bounded event data cache…');
  transaction.check();transaction.remember(url,fromCache);transaction.remember(indexURL,Boolean(savedIndex));
  await savePrecisionData(cache, url, result.bytes, 'application/octet-stream');
  await savePrecisionData(cache, indexURL, manifestBytes, 'application/json');
  transaction.check();return { buffer: result.bytes, fromCache,commit:transaction.commit,discard:transaction.discard };
}

// New path: request a date interval from the service, never a yearly file.
export async function loadPrecisionEvent(job, progress = () => {}, signal, endpoint = EPHEMERIS_SERVICE) {
  if (!endpoint) return loadPrecisionYear(new Date(job.t * 1000).getUTCFullYear(), progress, signal);
  const url = new URL('/v1/pack', endpoint), day = Math.floor(job.t / 86400) + 2440587.5;
  url.searchParams.set('day', String(day)); url.searchParams.set('model', 'de440');
  const system = job.system || (job.kind === 'occultation' ? [job.front, job.target].find(b => ['mars','jupiter','saturn','uranus','neptune'].includes(b)) : null);
  if (system) url.searchParams.set('system', system);
  const bodies = [...new Set([job.body, job.front, job.target].filter(b => ['mercury','venus','mars','jupiter','saturn','uranus','neptune'].includes(b)))];
  if (bodies.length) url.searchParams.set('body', bodies.join(','));
  let cache = null; try { cache = await caches.open(PRECISION_CACHE); } catch { /* usable online without persistent storage */ }
  const validate = async (response) => {
    const expected = response.headers.get('X-Ephemeris-SHA256');
    if (!/^[0-9a-f]{64}$/.test(expected || '')) throw new Error('Missing native ephemeris checksum');
    const buffer = await boundedBytes(response, PRECISION_LIMITS.fileBytes), hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), x => x.toString(16).padStart(2,'0')).join('');
    if (hash !== expected) throw new Error('Native ephemeris integrity check failed');
    const pack = readPrecisionPack(buffer);
    if (pack.header.native !== true || pack.header.source !== 'DE440' || pack.header.year !== new Date(job.t * 1000).getUTCFullYear() || !(pack.header.fromJD <= day && pack.header.toJD >= day + 1)) throw new Error('Wrong native ephemeris interval or model');
    return buffer;
  };
  const saved = await cache?.match(url.href);
  if (saved) {
    try { const buffer = await validate(saved); progress('Using downloaded native ephemeris data…'); return { buffer, fromCache: true }; }
    catch { await cache.delete(url.href); }
  }
  const transaction=cacheTransaction(cache,signal);transaction.check();
  progress('Downloading native JPL coefficients for this event…');
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 422 ? 'This date or satellite system is outside the available native coverage' : 'Ephemeris service unavailable; retry when connected');
  const checksum = response.headers.get('X-Ephemeris-SHA256'), buffer = await validate(response);
  if (cache) {
    // Reuse the same 8 MiB budget as legacy packs. The checksum is stored
    // with the response, not in an ever-growing per-date manifest.
    transaction.check();transaction.remember(url,false);
    await savePrecisionData(cache, url, buffer, 'application/octet-stream', checksum);
  }
  transaction.check();return { buffer, fromCache: false,commit:transaction.commit,discard:transaction.discard };
}
