// Lightweight event-panel controls. Numeric ephemeris code is worker-only;
// even the worker is created only after the user requests a refinement.
import { EPHEMERIS_YEARS, R2_DATA_URL, STATIC_DATA_URL } from './precisionconfig.js';
const CACHE = 'imks-data-precision-v1';
let active = null;
const abortError = () => new DOMException('Calculation cancelled', 'AbortError');
export async function clearPrecisionData(){active?.cancel();await caches.delete(CACHE);}

export function precisionEvent(job, progress = () => {}) {
  active?.cancel();
  let worker, rejectJob, resolveJob, timer, session = null,legacyTransaction=null;
  let closed = false;
  const controller = new AbortController();
  const finish = (success = false) => { if(success){session?.commit?.();legacyTransaction?.commit?.();}else{session?.discard?.();legacyTransaction?.discard?.();} closed = true; controller.abort(); clearTimeout(timer); worker?.terminate(); session?.dispose();session=null; if (active === handle) active = null; };
  const handle = { cancel: () => { finish(); rejectJob?.(abortError()); }, promise: null };
  handle.promise = new Promise((resolve, reject) => { rejectJob = reject; resolveJob = resolve; });
  active = handle;
  try {
    // The worker client must remain within its owning app's offline scope.
    const coelum = new URL('../coelum/', import.meta.url);
    const url = location.pathname.startsWith(coelum.pathname) ? new URL('precisionworker.js', coelum) : new URL('./precisionworker.js', import.meta.url);
    worker = new Worker(url, { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.range) {
        const { id, key, offset, length } = data.range;
        (async()=>{
          try {if(!session)throw new Error('Range reader unavailable');const bytes=await session.read(key,offset,length);if(!closed)worker.postMessage({rangeResult:{id,buffer:bytes.buffer}},[bytes.buffer]);}
          catch(error){if(!closed)worker.postMessage({rangeError:{id,message:error.message}});}
        })();
      } else if (data.progress) progress(data.progress);
      else { const result=data.result;if(result&&session)Object.assign(result,{transport:STATIC_DATA_URL?'static':'r2',fromCache:session.fromCache(),downloadedBytes:session.stats.networkBytes,rangeRequests:session.stats.networkRequests,peakRawBytes:session.stats.peakResidentBytes});finish(!data.error); data.error ? rejectJob(new Error(data.error)) : resolveJob(result); }
    };
    worker.onerror = (error) => { finish(); rejectJob(new Error(error.message || 'Precision worker unavailable')); };
    timer = setTimeout(() => { finish(); rejectJob(new Error('Precision calculation timed out; please retry')); }, 60000);
    (async () => {
      try {
        if(STATIC_DATA_URL||R2_DATA_URL){
          const {createStaticSession}=STATIC_DATA_URL?await import('./precisionstatic.js'):{};
          const {createR2Session}=!STATIC_DATA_URL?await import('./precisionr2.js'):{};if(closed)return;
          session=await (createStaticSession||createR2Session)(STATIC_DATA_URL||R2_DATA_URL,(text)=>{if(!closed)progress(text);},controller.signal);
          if(!closed)worker.postMessage({...job,nativeData:session.descriptors,transport:STATIC_DATA_URL?'static':'r2'});else {session.dispose();session=null;}return;
        }
        // CacheStorage belongs to the controlling page. Some WebKit
        // versions do not share a restarted worker's cache view reliably.
        // Streaming I/O and WebCrypto are asynchronous; only the small
        // header/record validation runs here. Transfer the buffer without
        // copying; every astronomical calculation remains in the worker.
        const { loadPrecisionEvent } = await import('./precisionload.js');
        if (closed) return;
        const loaded = await loadPrecisionEvent(job, (text) => { if (!closed) progress(text); }, controller.signal);
        legacyTransaction=loaded;const {buffer,fromCache}=loaded;
        if (!closed) worker.postMessage({ ...job, buffer, fromCache }, [buffer]);else loaded.discard?.();
      } catch (error) { if (!closed) { finish(); rejectJob(error); } }
    })();
  } catch (error) { finish(); rejectJob(error); }
  return handle;
}

// Shared fixed-size control: loading is cancellable; completed results stay local
// so switching models never starts another worker or data request.
export function mountEphemerisSwitch(root, getJob, apply = () => {}) {
  root.innerHTML='<div class="ephemeris-toolbar"><button type="button" class="chip coelum-chip ephemeris-toggle" data-precision-run aria-pressed="false">JPL Ephemeris</button><span class="ephemeris-status" data-precision-status role="status" aria-live="polite"></span></div>';
  const button=root.querySelector('[data-precision-run]'),status=root.querySelector('[data-precision-status]');
  let pending=null,result=null,selected=false,serial=0,observer=null;
  const paint=()=>{button.textContent=pending?'Downloading…':selected?'JPL Ephemeris':result?'Approx. Ephem.':'JPL Ephemeris';button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-busy',String(Boolean(pending)));button.title=pending?'Cancel download and discard its data':button.dataset.error||selected?'Switch to approximate ephemeris':result?'Switch to JPL ephemeris':'Download JPL ephemeris';};
  const stop=()=>{serial++;pending?.cancel();pending=null;observer?.disconnect();observer=null;paint();};
  const reset=()=>{stop();result=null;selected=false;status.textContent='';delete button.dataset.error;paint();};
  button.addEventListener('click',async()=>{
    if(pending){stop();result=null;selected=false;status.textContent='Download cancelled.';apply(null);paint();return;}
    if(result){selected=!selected;status.textContent=selected?result.source:'';paint();apply(selected?result:null);return;}
    const job=getJob();if(!job)return;delete button.dataset.error;
    const token=++serial;
    observer=new MutationObserver(()=>{if(!root.isConnected||root.closest('[hidden], [aria-hidden="true"]')||root.closest('dialog')?.open===false){stop();status.textContent='Download cancelled.';}});
    for(let el=root;el;el=el.parentElement)observer.observe(el,{attributes:true,attributeFilter:['hidden','aria-hidden','open'],childList:true});
    try{
      pending=precisionEvent(job,text=>{if(token===serial)button.title=text+' · Click to cancel';});paint();status.textContent='';
      const value=await pending.promise;
      if(token===serial&&root.isConnected){result=value;selected=true;status.textContent=value.source;apply(value);}
    }catch(error){if(token===serial){status.textContent=error.name==='AbortError'?'Download cancelled.':error.message;button.dataset.error=status.textContent;apply(null);}}
    finally{if(token===serial){pending=null;observer?.disconnect();observer=null;paint();}}
  });
  return {reset,stop,destroy:reset,get result(){return selected?result:null;},get cachedResult(){return result;},get pending(){return Boolean(pending);},get error(){return button.dataset.error||'';}};
}

export function mountPrecision(root, job, apply = () => {}) {
  const year=new Date(job.t*1000).getUTCFullYear();
  if(year<EPHEMERIS_YEARS[0]||year>EPHEMERIS_YEARS[1]||!Number.isFinite(job.t))return {destroy(){}};
  return mountEphemerisSwitch(root,()=>job,apply);
}
