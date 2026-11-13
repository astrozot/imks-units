import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStaticSession,STATIC_LIMITS} from '../js/precisionstatic.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),chunkBytes=STATIC_LIMITS.chunkBytes;
const files=new Map(),manifest={version:2,chunkBytes,kernels:{}};
function add(id,bytes){
 const prefix=`${id==='iers'?'iers':'kernels'}/${id}-${hash(bytes)}`,hashes=[];
 for(let at=0,i=0;at<bytes.length;at+=chunkBytes,i++){
  const chunk=bytes.subarray(at,at+chunkBytes);hashes.push(Buffer.from(hash(chunk),'hex'));files.set(`${prefix}/${String(i).padStart(6,'0')}.bin`,chunk);
 }
 const index=Buffer.concat(hashes);files.set(prefix+'/index.bin',index);
 return {path:prefix,bytes:bytes.length,sha256:hash(bytes),indexSha256:hash(index),indexBytes:index.length};
}
manifest.kernels.de440=add('de440',await fs.readFile(new URL('fixtures/de440-native.bsp',import.meta.url)));
manifest.earthOrientation=add('iers',await fs.readFile(new URL('fixtures/iers-native.txt',import.meta.url)));
const probe=Buffer.alloc(chunkBytes*5+29);for(let i=0;i<probe.length;i++)probe[i]=i%251;
manifest.kernels.probe=add('probe',probe);
let calls=0;
const fetcher=async(url,options)=>{
 calls++;assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined,'Static downloads need no Range, If-Range or preflight');
 if(String(url).endsWith('manifest.json'))return Response.json(manifest);
 const key=new URL(url).pathname.replace(/^\/[^/]+\//,'');const bytes=files.get(key);assert.ok(bytes,key);
 return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});
};
class MemoryCache{
 entries=new Map();async match(k){return this.entries.get(typeof k==='string'?k:k.url)?.clone();}
 async put(k,r){this.entries.set(typeof k==='string'?k:k.url,r.clone());}
 async delete(k){return this.entries.delete(typeof k==='string'?k:k.url);}
 async keys(){return [...this.entries.keys()].map(x=>new Request(x));}
}
const store=new MemoryCache(),old=globalThis.caches;globalThis.caches={open:async()=>store};
const job={kind:'solar',transport:'static',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]};
try{
 const s=await createStaticSession('https://static.test/data/',()=>{},undefined,fetcher);
 const pack=readPrecisionPack(await nativeEphemerisPack(job,s.descriptors,s.read)),result=await calculatePrecisionEvent(job,pack);
 assert.equal(pack.header.transport,'static');assert.ok(Math.abs(result.event.C2-Date.parse('2024-04-08T18:40:40.942Z')/1000)<.1);
 const cold={...s.stats};
 const offline=await createStaticSession('https://static.test/data/',()=>{},undefined,async()=>{throw new Error('Must work offline');});
 assert.deepEqual(readPrecisionPack(await nativeEphemerisPack(job,offline.descriptors,offline.read)).native(3,301,2460408.75),pack.native(3,301,2460408.75));
 assert.equal(offline.fromCache(),true);
 assert.deepEqual(Buffer.from(await s.read('probe',chunkBytes-13,42)),probe.subarray(chunkBytes-13,chunkBytes+29));
 const before=calls;await Promise.all([s.read('probe',chunkBytes*3,100),s.read('probe',chunkBytes*3,100),s.read('probe',chunkBytes*3,100)]);assert.equal(calls,before+1,'Concurrent reads share a download');
 await s.read('probe',chunkBytes*4,100);await s.read('probe',chunkBytes*5,29);
 assert.ok(s.stats.peakResidentBytes<=4*chunkBytes);
 await assert.rejects(()=>s.read('probe',probe.length-1,2),RangeError);
 await assert.rejects(()=>s.read('probe',0,524289),RangeError);
 // Even self-consistent cache corruption must fail the published checksum.
 const key=`https://static.test/data/${manifest.kernels.de440.path}/000000.bin`,corrupt=Buffer.alloc(manifest.kernels.de440.bytes);
 await store.put(key,new Response(corrupt,{headers:{'Content-Length':String(corrupt.length),'X-Ephemeris-SHA256':hash(corrupt)}}));
 const repaired=await createStaticSession('https://static.test/data/',()=>{},undefined,fetcher);const beforeRepair=calls;
 assert.equal((await repaired.read('de440',0,8)).length,8);assert.equal(calls,beforeRepair+1);
 for(const kind of ['index','chunk']){
  const bad=await createStaticSession(`https://static.test/bad-${kind}/`,()=>{},undefined,async(url,opts)=>{
   const response=await fetcher(url,opts);if(!String(url).endsWith('manifest.json')&&(String(url).endsWith('index.bin')===(kind==='index'))){const b=new Uint8Array(await response.arrayBuffer());b[0]^=1;return new Response(b);}return response;
  });
  await assert.rejects(()=>bad.read('de440',0,8),/checksum/);
 }
 const aborted=new AbortController();aborted.abort();const cancelled=await createStaticSession('https://static.test/data/',()=>{},aborted.signal,fetcher);await assert.rejects(()=>cancelled.read('de440',0,8),{name:'AbortError'});
 // Cancel rolls back this job's new fragments, without clearing other jobs.
 const retained=[...store.entries.keys()];
 const cancel=new AbortController(),partial=await createStaticSession('https://static.test/cancel/',()=>{},cancel.signal,fetcher);
 await partial.read('de440',0,8);assert.ok([...store.entries.keys()].some(k=>k.includes('/cancel/')));
 cancel.abort();await Promise.resolve();assert.ok(![...store.entries.keys()].some(k=>k.includes('/cancel/')));
 for(const key of retained)assert.ok(store.entries.has(key),'Cancellation retains previously cached ephemerides');
 const complete=new AbortController(),kept=await createStaticSession('https://static.test/committed/',()=>{},complete.signal,fetcher);
 await kept.read('de440',0,8);kept.commit();complete.abort();assert.ok([...store.entries.keys()].some(k=>k.includes('/committed/')),'Completed data survives worker cleanup');
 // Simulate a full cache; a new chunk must evict older payloads.
 const filler=new Uint8Array(chunkBytes);for(let i=0;i<32;i++)await store.put(`https://static.test/old/${i}`,new Response(filler,{headers:{'Content-Length':String(chunkBytes)}}));
 const bounded=await createStaticSession('https://static.test/data/',()=>{},undefined,fetcher);await bounded.read('probe',chunkBytes*2,10);
 let total=0;for(const response of store.entries.values())total+=Number(response.headers.get('Content-Length'));assert.ok(total<=8*1024**2);
 s.dispose();assert.equal(s.stats.residentBytes,0);assert.equal(s.stats.indexBytes,0);
 console.log(JSON.stringify({status:'Native chunk calculation, offline reuse, cross-chunk reads, deduplication, checksums, cancellation and cache eviction passed',coldDownload:cold,cachePayloadBytes:total},null,2));
 if(process.env.STATIC_STAGED){
  const dir=process.env.STATIC_STAGED,refs=JSON.parse(await fs.readFile(new URL('fixtures/precision-events.json',import.meta.url)));
  const local=async(url,options)=>{assert.equal(options.headers,undefined);const key=new URL(url).pathname.slice('/full/'.length);return new Response(await fs.readFile(path.join(dir,key)));};
  let maxError=0;
  for(const q of refs.events){
   const session=await createStaticSession('https://static.test/full/',()=>{},undefined,local);
   const p=readPrecisionPack(await nativeEphemerisPack({...q,transport:'static'},session.descriptors,session.read)),r=await calculatePrecisionEvent(q,p);
   assert.equal(Boolean(r.event),Boolean(q.event),q.name);
   if(q.event)for(const name of ['max','C1','C2','C3','C4','P1','U1','U2','U3','U4','P4']){
    if(!(name in q.event))continue;if(q.event[name]===null){assert.equal(r.event[name],null);continue;}
    const error=Math.abs(r.event[name]-q.event[name]);assert.ok(error<.2,`${q.name} ${name}: ${error} seconds`);maxError=Math.max(maxError,error);
   }
   assert.ok(session.stats.peakResidentBytes<=4*chunkBytes);session.dispose();
  }
  console.log(JSON.stringify({independentReferenceEvents:refs.events.length,maxTimingDifferenceSeconds:maxError},null,2));
 }
}finally{globalThis.caches=old;}
