// Bounded I/O for native SPK data, served as ranges or immutable static chunks. Loaded only when refinement is requested.
// CacheStorage stays in the page (not in a restarted WebKit worker).
import { boundedBytes, PRECISION_CACHE } from './precisionload.js';
import { PRECISION_LIMITS } from './precisionpack.js';
export const DATA_LIMITS = Object.freeze({ blockBytes:16384, chunkBytes:262144, residentBlocks:4, residentBytes:1048576, networkRequests:64, manifestBytes:65536, indexBytes:524288 });
const recent = new Map(), sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const touch = key => {recent.delete(key);recent.set(key,performance.now());while(recent.size>1024)recent.delete(recent.keys().next().value);};
let cacheWrites=Promise.resolve();

function validateManifest(value, base, mode) {
  if(!(mode==='static'?[2,3].includes(value?.version):value?.version===1)||!value.kernels?.de440||Object.keys(value.kernels).length>12)throw new Error('Invalid ephemeris manifest');
  const entries = {...value.kernels,...(value.earthOrientation?{iers:value.earthOrientation}:{})};
  for(const [id,d] of Object.entries(entries)) {
    const identity=d?.partial===true&&value.version===3?d.indexSha256:d?.sha256;
    if(!/^[a-z0-9-]{1,30}$/.test(id)||!d||!Number.isSafeInteger(d.bytes)||d.bytes<188||d.bytes>4*1024**3||!/^[0-9a-f]{64}$/.test(identity)||typeof d.path!=='string'||!/^(kernels|iers)\/[a-zA-Z0-9._-]+$/.test(d.path)||!d.path.includes(identity))throw new Error('Invalid ephemeris object descriptor');
    const chunkBytes=d.chunkBytes??value.chunkBytes;
    if(mode==='static'&&(![262144,524288].includes(chunkBytes)||!/^[0-9a-f]{64}$/.test(d.indexSha256)||!Number.isInteger(d.indexBytes)||d.indexBytes!==Math.ceil(d.bytes/chunkBytes)*32||d.indexBytes>DATA_LIMITS.indexBytes))throw new Error('Invalid static ephemeris index');
    if(mode==='static')d.chunkBytes=chunkBytes;
    if(d.fromJD!==undefined&&(!Number.isFinite(d.fromJD)||!Number.isFinite(d.toJD)||d.toJD<=d.fromJD))throw new Error('Invalid native kernel coverage');
    d.url=new URL(d.path,base).href;
  }
  return entries;
}

export async function createDataSession(endpoint, progress = ()=>{}, signal, fetcher = fetch, mode='range') {
  const base=new URL(endpoint.endsWith('/')?endpoint:endpoint+'/');
  if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Ephemeris data requires HTTPS');
  const blockSize=id=>mode==='static'?descriptors[id].chunkBytes:DATA_LIMITS.blockBytes;
  const stats={networkRequests:0,networkBytes:0,residentBytes:0,peakResidentBytes:0,indexBytes:0,peakIndexBytes:0},resident=new Map(),pending=new Map(),etags=new Map(),sizes=new Map(),indexes=new Map(),indexPending=new Map();
  let cache=null;try{cache=await caches.open(PRECISION_CACHE);}catch{/* online calculations still work */}
  const created=new Set();let committed=false,discarded=false;
  const discard=()=>{if(committed)return;discarded=true;for(const key of created){cache?.delete(key).catch(()=>{});recent.delete(key);}created.clear();};
  signal?.addEventListener('abort',discard,{once:true});
  const remember=(key,n)=>{sizes.set(key,n);touch(key);};
  const put = async(key, bytes, extra={}) => {
    if(!cache||signal?.aborted||discarded)return;
    const write=async()=>{
      if(signal?.aborted||discarded)return;
      // Reuse known header sizes; only inspect newly discovered entries.
      // This avoids rescanning hundreds of response headers per fragment.
      const keys=await cache.keys(),present=new Set(keys.map(k=>k.url));
      for(const known of sizes.keys())if(!present.has(known)){sizes.delete(known);recent.delete(known);}
      for(const k of keys)if(!sizes.has(k.url)){
        const n=Number((await cache.match(k))?.headers.get('Content-Length'));
        if(!(n>0&&n<=PRECISION_LIMITS.fileBytes)){await cache.delete(k);continue;}sizes.set(k.url,n);
      }
      let total=bytes.byteLength;for(const [k,n] of sizes)if(k!==key)total+=n;
      const oldest=[...sizes.keys()].filter(k=>k!==key).sort((a,b)=>(recent.get(a)||0)-(recent.get(b)||0));
      for(const k of oldest){if(total<=PRECISION_LIMITS.diskBytes)break;await cache.delete(k);total-=sizes.get(k);sizes.delete(k);recent.delete(k);}
      const hash=await sha(bytes);
      if(signal?.aborted||discarded)return;
      const fresh=!present.has(key);if(fresh)created.add(key);
      await cache.put(key,new Response(bytes,{headers:{...extra,'Content-Length':String(bytes.byteLength),'X-Ephemeris-SHA256':hash}}));remember(key,bytes.byteLength);
      if((signal?.aborted||discarded)&&!committed&&fresh){await cache.delete(key);created.delete(key);recent.delete(key);}
    };
    try{if(globalThis.navigator?.locks)await navigator.locks.request(PRECISION_CACHE,write);else {const next=cacheWrites.then(write,write);cacheWrites=next.catch(()=>{});await next;}}catch{/* quota/private mode: don't lose the calculation */}
  };
  const cached = async(key,limit) => {
    const response=await cache?.match(key);if(!response)return null;
    try{
      const bytes=await boundedBytes(response.clone(),limit),expected=response.headers.get('X-Ephemeris-SHA256');
      if(!expected||await sha(bytes)!==expected)throw new Error('Corrupt cached fragment');
      remember(key,bytes.byteLength);return {bytes,response};
    }catch{await cache.delete(key);sizes.delete(key);return null;}
  };
  const download = async(url,options={})=>{
    if(signal?.aborted)throw signal.reason || new DOMException('Cancelled','AbortError');
    if(stats.networkRequests>=DATA_LIMITS.networkRequests)throw new Error('Ephemeris download request limit exceeded');
    stats.networkRequests++;return fetcher(url,{...options,signal,cache:'no-store',credentials:'omit'});
  };
  const manifestURL=new URL('manifest.json',base).href;
  progress('Loading the ephemeris catalogue…');
  let saved=await cached(manifestURL,DATA_LIMITS.manifestBytes),manifest;
  if(saved) {
    try{manifest=JSON.parse(new TextDecoder().decode(saved.bytes));validateManifest(manifest,base,mode);}catch{await cache?.delete(manifestURL);saved=null;}
  }
  if(!saved){
    const response=await download(manifestURL),bytes=await boundedBytes(response,DATA_LIMITS.manifestBytes);stats.networkBytes+=bytes.byteLength;
    manifest=JSON.parse(new TextDecoder().decode(bytes));validateManifest(manifest,base,mode);
    await put(manifestURL,bytes,{'Content-Type':'application/json'});
  }
  const descriptors=validateManifest(manifest,base,mode);
  const pinETag=(id,value)=>{
    if(!value||value.length>256||etags.has(id)&&etags.get(id)!==value)throw new Error('Ephemeris object changed between fragments');
    etags.set(id,value);
  };
  const getIndex=async(id)=>{
    const d=descriptors[id];
    if(indexes.has(id))return indexes.get(id);
    if(indexPending.has(id))return indexPending.get(id);
    const task=(async()=>{
      const url=d.url+'/index.bin';let bytes=(await cached(url,d.indexBytes))?.bytes;
      if(bytes&&await sha(bytes)!==d.indexSha256){await cache?.delete(url);bytes=null;}
      if(!bytes){
        bytes=await boundedBytes(await download(url),d.indexBytes);stats.networkBytes+=bytes.byteLength;
        if(bytes.byteLength!==d.indexBytes||await sha(bytes)!==d.indexSha256)throw new Error('Static ephemeris index failed checksum verification');
        await put(url,bytes,{'Content-Type':'application/octet-stream'});
      }
      indexes.set(id,new Uint8Array(bytes));while(indexes.size>2)indexes.delete(indexes.keys().next().value);
      stats.indexBytes=[...indexes.values()].reduce((n,b)=>n+b.byteLength,0);stats.peakIndexBytes=Math.max(stats.peakIndexBytes,stats.indexBytes);
      return indexes.get(id);
    })();indexPending.set(id,task);try{return await task;}finally{indexPending.delete(id);}
  };
  const getBlock=async(id,index)=>{
    const blockBytes=blockSize(id);
    const d=descriptors[id],offset=index*blockBytes,end=Math.min(d.bytes,offset+blockBytes)-1;
    const key=new URL(mode==='static'?`${d.url}/${String(index).padStart(6,'0')}.bin`:d.url);
    if(mode!=='static')key.searchParams.set('__astrolabium_range',`${offset}-${end}`);const address=key.href;
    if(resident.has(address)){const b=resident.get(address);resident.delete(address);resident.set(address,b);touch(address);return b;}
    if(pending.has(address))return pending.get(address);
    const task=(async()=>{
      let bytes;let old=await cached(address,end-offset+1);
      const hashes=mode==='static'?await getIndex(id):null;
      const expected=hashes?Array.from(hashes.subarray(index*32,index*32+32),x=>x.toString(16).padStart(2,'0')).join(''):null;
      if(expected==='0'.repeat(64))throw new RangeError('Native data for this body and date is outside the hosted coverage');
      if(old&&expected&&(old.bytes.byteLength!==end-offset+1||await sha(old.bytes)!==expected)){await cache?.delete(address);old=null;}
      if(old){if(mode!=='static')pinETag(id,old.response.headers.get('ETag'));bytes=old.bytes;}
      else {
        progress('Downloading the required ephemeris fragments…');
        let response;
        if(mode==='static')response=await download(address);
        else {
          const headers={Range:`bytes=${offset}-${end}`};if(etags.has(id))headers['If-Range']=etags.get(id);
          response=await download(d.url,{headers});
          if(response.status!==206||response.headers.get('Content-Range')!==`bytes ${offset}-${end}/${d.bytes}`){await response.body?.cancel();throw new Error('R2 must return readable, exact byte ranges; check bucket CORS settings');}
          pinETag(id,response.headers.get('ETag'));
        }
        bytes=await boundedBytes(response,end-offset+1);if(bytes.byteLength!==end-offset+1)throw new Error('Incomplete ephemeris fragment');
        stats.networkBytes+=bytes.byteLength;
        if(expected&&await sha(bytes)!==expected)throw new Error('Static ephemeris chunk failed checksum verification');
        await put(address,bytes,{'Content-Type':'application/octet-stream',...(mode==='static'?{}:{'ETag':etags.get(id)})});
      }
      resident.set(address,new Uint8Array(bytes));
      while(resident.size>DATA_LIMITS.residentBlocks||[...resident.values()].reduce((n,b)=>n+b.byteLength,0)>DATA_LIMITS.residentBytes)resident.delete(resident.keys().next().value);
      stats.residentBytes=[...resident.values()].reduce((n,b)=>n+b.byteLength,0);stats.peakResidentBytes=Math.max(stats.peakResidentBytes,stats.residentBytes);
      return resident.get(address);
    })();
    pending.set(address,task);try{return await task;}finally{pending.delete(address);}
  };
  const read=async(id,offset,length)=>{
    const d=descriptors[id];
    if(!d||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>PRECISION_LIMITS.fileBytes||offset+length>d.bytes)throw new RangeError('Invalid ephemeris byte range');
    const result=new Uint8Array(length);let at=0;
    const blockBytes=blockSize(id);
    while(at<length){if(signal?.aborted)throw signal.reason;const pos=offset+at,b=await getBlock(id,Math.floor(pos/blockBytes)),within=pos%blockBytes,n=Math.min(length-at,b.length-within);result.set(b.subarray(within,within+n),at);at+=n;}
    return result;
  };
  return {descriptors,read,stats,fromCache:()=>stats.networkRequests===0,commit(){committed=true;created.clear();signal?.removeEventListener('abort',discard);},discard,dispose(){signal?.removeEventListener('abort',discard);resident.clear();indexes.clear();stats.residentBytes=0;stats.indexBytes=0;}};
}
