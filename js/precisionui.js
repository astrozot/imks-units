// Lightweight event-panel controls. Numeric ephemeris code is worker-only;
// even the worker is created only after the user requests a refinement.
const CACHE = 'imks-data-precision-v1';
let active = null;
const abortError = () => new DOMException('Calculation cancelled', 'AbortError');

export function precisionEvent(job, progress = () => {}) {
  active?.cancel();
  let worker, rejectJob, resolveJob, timer;
  let closed = false;
  const controller = new AbortController();
  const finish = () => { closed = true; controller.abort(); clearTimeout(timer); worker?.terminate(); if (active === handle) active = null; };
  const handle = { cancel: () => { finish(); rejectJob?.(abortError()); }, promise: null };
  handle.promise = new Promise((resolve, reject) => { rejectJob = reject; resolveJob = resolve; });
  active = handle;
  try {
    // The worker client must remain within its owning app's offline scope.
    const coelum = new URL('../coelum/', import.meta.url);
    const url = location.pathname.startsWith(coelum.pathname) ? new URL('precisionworker.js', coelum) : new URL('./precisionworker.js', import.meta.url);
    worker = new Worker(url, { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.progress) progress(data.progress);
      else { finish(); data.error ? rejectJob(new Error(data.error)) : resolveJob(data.result); }
    };
    worker.onerror = (error) => { finish(); rejectJob(new Error(error.message || 'Precision worker unavailable')); };
    timer = setTimeout(() => { finish(); rejectJob(new Error('Precision calculation timed out; please retry')); }, 60000);
    (async () => {
      try {
        // CacheStorage belongs to the controlling page. Some WebKit
        // versions do not share a restarted worker's cache view reliably.
        // Streaming I/O and WebCrypto are asynchronous; only the small
        // header/record validation runs here. Transfer the buffer without
        // copying; every astronomical calculation remains in the worker.
        const { loadPrecisionYear } = await import('./precisionload.js');
        if (closed) return;
        const { buffer, fromCache } = await loadPrecisionYear(new Date(job.t * 1000).getUTCFullYear(), (text) => { if (!closed) progress(text); }, controller.signal);
        if (!closed) worker.postMessage({ ...job, buffer, fromCache }, [buffer]);
      } catch (error) { if (!closed) { finish(); rejectJob(error); } }
    })();
  } catch (error) { finish(); rejectJob(error); }
  return handle;
}

export function mountPrecision(root, job) {
  const year = new Date(job.t * 1000).getUTCFullYear();
  if (year < 1900 || year > 2100 || !Number.isFinite(job.t)) return { destroy() {} };
  root.innerHTML = '<p><button type="button" class="chip" data-precision-run>Refine contacts with DE440</button> <button type="button" class="chip" data-precision-clear>Clear downloaded event data</button></p><p class="sky-hint" data-precision-status aria-live="polite">Downloads about 120 KiB for this year when needed. Stored event data is limited to 8 MiB.</p><div data-precision-result></div>';
  const run = root.querySelector('[data-precision-run]'), clear = root.querySelector('[data-precision-clear]'), status = root.querySelector('[data-precision-status]'), result = root.querySelector('[data-precision-result]');
  let pending = null, observer = null, serial = 0;
  const stop = () => { ++serial; pending?.cancel(); pending = null; observer?.disconnect(); observer = null; run.textContent = 'Refine contacts with DE440'; };
  const show = (r) => {
    result.replaceChildren();
    const note = document.createElement('p');
    note.textContent = r.event ? `${r.source}: ${r.event.kind || 'occultation'} contacts${job.place && job.kind !== 'lunar' ? ` at ${job.place[0].toFixed(4)}°, ${job.place[1].toFixed(4)}°` : ''}.` : 'DE440: no event at this place.';
    result.append(note);
    if (r.event) {
      const table = document.createElement('table'); table.className = 'map-contacts';
      const head = table.insertRow();
      for (const text of ['Contact', r.rotationErrorSeconds === null ? 'UTC' : 'Estimated UT']) { const cell = document.createElement('th'); cell.textContent = text; head.append(cell); }
      const names = job.kind === 'lunar' ? ['P1','U1','U2','max','U3','U4','P4'] : ['R1','C1','R2','C2','max','C3','R3','C4','R4'];
      for (const name of names) {
        const t = r.event[name]; if (!Number.isFinite(t)) continue;
        const row = table.insertRow(); row.insertCell().textContent = name === 'max' ? 'Maximum' : name;
        row.insertCell().textContent = new Date(Math.round(t) * 1000).toISOString().replace('T', ' ').slice(0, 19);
      }
      result.append(table);
    }
    const detail = document.createElement('p'); detail.className = 'sky-hint';
    detail.textContent = `${r.earthOrientation}${r.rotationErrorSeconds !== null ? `; estimated rotation uncertainty ${r.rotationErrorSeconds.toFixed(1)} s` : ''}. ${job.kind === 'lunar' ? 'Uses the existing atmospheric shadow model.' : 'Uses smooth mean limbs; lunar terrain is not included.'}${r.planetModel ? ' Planet centres also use the compact satellite models.' : ''} Map and animation retain their original calculations. Seconds shown are calculation resolution, not an accuracy guarantee.`;
    result.append(detail);
    status.textContent = `${r.fromCache ? 'Used downloaded' : 'Downloaded'} ${r.year} data (${Math.ceil(r.residentBytes / 1024)} KiB). Calculation complete.`;
  };
  run.addEventListener('click', async () => {
    if (pending) { stop(); status.textContent = 'Calculation cancelled.'; return; }
    const token = ++serial;
    run.textContent = 'Cancel DE440 calculation'; result.replaceChildren(); status.textContent = 'Loading DE440 event data…';
    // Sheet implementations can hide, empty or replace their body. Watch
    // only this element and its ancestors, and only while a job is active.
    observer = new MutationObserver(() => {
      if (!root.isConnected || root.closest('[hidden], [aria-hidden="true"]')) { stop(); status.textContent = 'Calculation cancelled.'; }
    });
    for (let el = root; el; el = el.parentElement) observer.observe(el, { attributes: true, attributeFilter: ['hidden', 'aria-hidden'], childList: true });
    try {
      pending = precisionEvent(job, (text) => { if (token === serial) status.textContent = text; });
      const r = await pending.promise;
      if (token === serial && root.isConnected) show(r);
    } catch (error) { if (token === serial) status.textContent = error.name === 'AbortError' ? 'Calculation cancelled.' : `${error.message}. Compact calculations remain available.`; }
    finally { if (token === serial) { pending = null; observer?.disconnect(); observer = null; run.textContent = 'Refine contacts with DE440'; } }
  });
  clear.addEventListener('click', async () => {
    stop(); active?.cancel();
    try { await caches.delete(CACHE); status.textContent = 'Downloaded event data cleared.'; }
    catch { status.textContent = 'Browser storage is unavailable.'; }
  });
  return { destroy: stop };
}
