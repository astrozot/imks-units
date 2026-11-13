import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createR2Session,R2_LIMITS} from '../js/precisionr2.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
const root=new URL('fixtures/',import.meta.url),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const bsp=fs.readFileSync(new URL('de440-native.bsp',root)),iers=fs.readFileSync(new URL('iers-native.txt',root));
const k=`kernels/de440-${hash(bsp)}.bsp`,e=`iers/finals-${hash(iers)}.all`;
const manifest={version:1,kernels:{de440:{path:k,bytes:bsp.length,sha256:hash(bsp)}},earthOrientation:{path:e,bytes:iers.length,sha256:hash(iers)}};
const files=new Map([[k,bsp],[e,iers]]),base='https://r2.test/data/';
let calls=[];
const fetcher=async(url,options)=>{
 calls.push({url:String(url),range:options?.headers?.Range});
 assert.equal(options.credentials,'omit');
 if(String(url).endsWith('manifest.json'))return Response.json(manifest);
 const file=files.get(new URL(url).pathname.slice('/data/'.length));assert.ok(file);
 const m=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);assert.ok(m);const a=+m[1],z=+m[2];assert.ok(z-a<R2_LIMITS.blockBytes);
 return new Response(file.subarray(a,z+1),{status:206,headers:{'Content-Range':`bytes ${a}-${z}/${file.length}`,'Content-Length':String(z-a+1),'ETag':`"${hash(file)}"`}});
};
class MemoryCache{
 entries=new Map();async match(k){return this.entries.get(typeof k==='string'?k:k.url)?.clone();}
 async put(k,r){this.entries.set(typeof k==='string'?k:k.url,r.clone());}
 async delete(k){return this.entries.delete(typeof k==='string'?k:k.url);}
 async keys(){return [...this.entries.keys()].map(x=>new Request(x));}
}
const store=new MemoryCache(),old=globalThis.caches;globalThis.caches={open:async()=>store};
const job={kind:'solar',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]};
try{
 const s=await createR2Session(base,()=>{},undefined,fetcher),buffer=await nativeEphemerisPack(job,s.descriptors,s.read),pack=readPrecisionPack(buffer);
 const result=await calculatePrecisionEvent(job,pack);
 assert.ok(Math.abs(result.event.C2-Date.parse('2024-04-08T18:40:40.942Z')/1000)<.1);
 assert.equal(pack.header.eop.count,9);assert.equal(pack.header.transport,'r2');
 assert.ok(s.stats.peakResidentBytes<=65536);assert.ok(s.stats.networkBytes<100000);
 const firstCalls=calls.length;
 const offline=await createR2Session(base,()=>{},undefined,async()=>{throw new Error('Offline: this must not be called');});
 const again=await nativeEphemerisPack(job,offline.descriptors,offline.read);
 assert.equal(offline.fromCache(),true);assert.equal(calls.length,firstCalls);
 assert.deepEqual(readPrecisionPack(again).native(3,301,2460408.75),pack.native(3,301,2460408.75));
 await assert.rejects(()=>offline.read('de440',0,1024*1024),RangeError);
 await assert.rejects(()=>offline.read('de440',bsp.length-1,2),RangeError);
 await assert.rejects(()=>nativeEphemerisPack({...job,system:'saturn'},s.descriptors,s.read),/not been installed/);
 await assert.rejects(()=>nativeEphemerisPack({...job,t:job.t-86400*100},s.descriptors,s.read),/coverage/);
 // Corrupt cached bytes must be rejected, then downloaded and verified.
 const address=[...store.entries.keys()].find(x=>x.includes(k)&&x.includes('0-16383'));
 await store.put(address,new Response('broken', {headers:{'Content-Length':'6','X-Ephemeris-SHA256':'0'.repeat(64),'ETag':'"wrong"'}}));
 const repaired=await createR2Session(base,()=>{},undefined,fetcher);await repaired.read('de440',0,1024);assert.ok(calls.length>firstCalls);
 // A server ignoring Range must be stopped before reading its full body.
 const ignored=await createR2Session(base,()=>{},undefined,fetcher);let cancelled=false;
 const bad=async(url,opts)=>String(url).endsWith('manifest.json')?Response.json(manifest):new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:200,headers:{'Content-Length':String(bsp.length)}});
 const alternate=await createR2Session('https://r2.test/other/',()=>{},undefined,bad);
 await assert.rejects(()=>alternate.read('de440',0,100),/exact byte ranges/);assert.equal(cancelled,true);
 // Reject malicious catalogue paths before sending any object request.
 await assert.rejects(()=>createR2Session('https://r2.test/bad/',()=>{},undefined,async()=>Response.json({...manifest,kernels:{de440:{...manifest.kernels.de440,path:'../secret'}}})),/descriptor/);
 const aborted=new AbortController();aborted.abort(new DOMException('Cancelled','AbortError'));
 const cached=await createR2Session(base,()=>{},aborted.signal,fetcher);await assert.rejects(()=>cached.read('de440',0,10),{name:'AbortError'});
 // Exercise eviction with a full 8 MiB payload cache.
 const filler=new Uint8Array(16384);
 for(const key of [...store.entries.keys()])if(key.includes(k)&&key.includes('65536-'))await store.delete(key);
 for(let i=0;i<512;i++)await store.put(`https://r2.test/old/${i}`,new Response(filler,{headers:{'Content-Length':'16384'}}));
 const bounded=await createR2Session(base,()=>{},undefined,fetcher);await bounded.read('de440',bsp.length-20,20);
 let total=0;for(const r of store.entries.values())total+=Number(r.headers.get('Content-Length'));
 assert.ok(total<=8*1024*1024,`Cache ${total} exceeds payload budget`);
 console.log(JSON.stringify({status:'R2 byte ranges, original SPK event result, offline reuse, cancellation, corrupt-cache recovery and bounded eviction passed',networkRequests:s.stats.networkRequests,networkBytes:s.stats.networkBytes,peakRawBytes:s.stats.peakResidentBytes,extractBytes:buffer.byteLength,cachePayloadBytes:total},null,2));
}finally{globalThis.caches=old;}
