// Native SPK extraction, official-source range limits, service validation,
// independent native state/velocity checks and browser-loader cache reuse.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { openSpk, encodeSpkPack } from '../js/spk.js';
import { readPrecisionPack } from '../js/precisionpack.js';
import { makePrecisionEphemeris } from '../js/precisionephem.js';
import { calculatePrecisionEvent } from '../js/precisionworker.js';
import { loadPrecisionEvent } from '../js/precisionload.js';
import service, { buildPack, sourceReader } from '../workers/ephemeris/index.js';

const fixture=(name)=>fs.readFileSync(new URL(`fixtures/${name}`,import.meta.url));
const files=new Map(['de440','jup365','sat441'].map(n=>[n,fixture(`${n}-native.bsp`)]));
const eop=fixture('iers-native.txt');
const calls=[];
const fetcher=async(url,{headers}={})=>{
  const name=url.split('/').at(-1), file=name==='finals2000A.all'?eop:files.get(name.replace('.bsp',''));
  if(!file)throw new Error('Fixture does not contain '+name);
  const range=/^bytes=(\d+)-(\d+)$/.exec(headers?.Range||'');assert.ok(range,'Every source request is bounded');
  const a=+range[1],end=Math.min(+range[2],file.length-1);assert.ok(end-a<16384);
  calls.push([name,a,end]);
  return new Response(file.subarray(a,end+1),{status:206,headers:{'Content-Range':`bytes ${a}-${end}/${file.length}`,'Content-Length':String(end-a+1),'Last-Modified':'Mon, 01 Jan 2024 00:00:00 GMT'}});
};
class MemoryCache {
  entries=new Map();
  key(k){return typeof k==='string'?new URL(k,'https://app.test').href:k.url;}
  async match(k){return this.entries.get(this.key(k))?.clone();}
  async put(k,r){this.entries.delete(this.key(k));this.entries.set(this.key(k),r.clone());}
  async delete(k){return this.entries.delete(this.key(k));}
  async keys(){return [...this.entries.keys()].map(k=>new Request(k));}
}
const refs=JSON.parse(fixture('native-spk-states.json'));
let states=0,maxKm=0,maxKmDay=0;
for(const [name,file] of files){
  const read=async(offset,length)=>new Uint8Array(file.buffer,file.byteOffset+offset,length);
  const spk=await openSpk(read), records=[];
  for(const s of spk.segments)records.push(await spk.extract(s.center,s.target,2460406.5,2460411.5));
  const p=readPrecisionPack(encodeSpkPack(records,{fromJD:2460406.5,toJD:2460411.5}));
  for(const [source,center,target,jd,...ref] of refs.states){
    if(source!==name)continue;const q=p.native(center,target,jd);
    maxKm=Math.max(maxKm,...q.position.map((x,i)=>Math.abs(x-ref[i])));
    maxKmDay=Math.max(maxKmDay,...q.velocity.map((x,i)=>Math.abs(x-ref[i+3])));states++;
  }
}
assert.ok(maxKm<.00005 && maxKmDay<.000005,`Native SPK agreement: ${maxKm} km, ${maxKmDay} km/day`);
// Type 3 stores independent velocity polynomials. Verify the pack reader
// does not substitute differentiated position coefficients for those.
const type3=readPrecisionPack(encodeSpkPack([{center:5,target:501,start:2451545,step:1,count:1,degree:1,positions:new Float64Array([1,2,3,4,5,6]),velocities:new Float64Array([7,8,9,10,11,12])}],{fromJD:2451545,toJD:2451546}));
assert.deepEqual(type3.native(5,501,2451545.5),{position:[1,3,5],velocity:[7,9,11]});
for(const little of [true,false]){
 const buffer=new ArrayBuffer(4096),bytes=new Uint8Array(buffer),v=new DataView(buffer),text=new TextEncoder();
 bytes.set(text.encode('DAF/SPK '));bytes.set(text.encode(little?'LTL-IEEE':'BIG-IEEE'),88);
 v.setInt32(8,2,little);v.setInt32(12,6,little);v.setInt32(76,2,little);
 v.setFloat64(1040,1,little);v.setFloat64(1048,0,little);v.setFloat64(1056,86400,little);
 for(const [i,x] of [501,5,1,3,385,402].entries())v.setInt32(1064+i*4,x,little);
 for(const [i,x] of [43200,43200,1,2,3,4,5,6,.01,.02,.03,.04,.05,.06,0,86400,14,1].entries())v.setFloat64(3072+i*8,x,little);
 const s=await openSpk(async(a,n)=>bytes.subarray(a,a+n)),r=await s.extract(5,501,2451545,2451546);
 const p=readPrecisionPack(encodeSpkPack([r],{fromJD:2451545,toJD:2451546}));
 assert.deepEqual(p.native(5,501,2451545.5).position,[1,3,5]);
 assert.ok(p.native(5,501,2451545.5).velocity.every((x,i)=>Math.abs(x-[864,2592,4320][i])<1e-8));
}

const cache=new MemoryCache(), options={fetcher,cache,origin:'https://service.test'};
const packed=await buildPack({day:2460408.5},options), pack=readPrecisionPack(packed);
assert.equal(pack.header.eop.count,9);assert.equal(pack.header.segments.length,4);assert.ok(packed.byteLength<10000);
const event=await calculatePrecisionEvent({kind:'solar',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]},pack);
assert.ok(Math.abs(event.event.C2-Date.parse('2024-04-08T18:40:40.942Z')/1000)<.1);
assert.match(event.earthOrientation,/IERS/);
for(const system of ['jupiter','saturn']){
  const b=await buildPack({day:2460408.5,system},options),p=readPrecisionPack(b),provider=makePrecisionEphemeris(p);
  const body=system==='jupiter'?'Io':'Iapetus';assert.ok(provider.supports(body));
  const [parent,id]=system==='jupiter'?[5,501]:[6,608],jd=2460408.75;
  const native=p.native(parent,id,jd),bary=p.native(0,parent,jd),q=provider.centre(body,jd);
  assert.ok(q.position.every((x,i)=>Math.abs(x-bary.position[i]-native.position[i])<1e-5));
  assert.ok(provider.topocentric(body,Date.parse('2024-04-08T18:42:00Z')/1000,[45,9,120]).dist>1e8);
}
const before=calls.length;await buildPack({day:2460408.5},options);assert.equal(calls.length,before,'Cloudflare chunk cache avoids repeated upstream reads');
for(const query of [{day:2460408.5,system:'__proto__'},{day:2460408.5,bodies:['constructor']},{day:NaN},{day:2460408},{day:2460408.5,model:'https://evil.test'}])await assert.rejects(()=>buildPack(query,options),RangeError);
await assert.rejects(()=>buildPack({day:2460400.5},options),/coverage/);
await assert.rejects(()=>sourceReader('https://fixed.test',{fetcher:async()=>new Response(new Uint8Array(20000),{status:200})}).read(0,1024),/byte-range/);
await assert.rejects(()=>sourceReader('https://fixed.test',{fetcher:async()=>new Response(new Uint8Array(20),{status:206,headers:{'Content-Range':'bytes 1-20/100','Last-Modified':'today'}})}).read(0,10),/revision|range/);

const env={ALLOWED_ORIGINS:'https://app.test',fetcher,cache};
let response=await service.fetch(new Request('https://service.test/v1/pack?day=2460408.5',{headers:{Origin:'https://app.test'}}),env);
assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://app.test');
assert.equal(response.headers.get('X-Ephemeris-SHA256'),crypto.createHash('sha256').update(new Uint8Array(await response.clone().arrayBuffer())).digest('hex'));
for(const [url,init,status] of [
 ['https://service.test/v1/pack?day=2460408.5',{headers:{Origin:'https://evil.test'}},403],
 ['https://service.test/v1/pack?day=2460408.5',{method:'POST'},405],
 ['https://service.test/v1/pack?day=2460408.5&url=https://evil.test',{},422],
 ['https://service.test/v1/pack?day=2460400.5',{},422],
 ['https://service.test/not-a-route',{},404],
 ['https://service.test/health',{},200],
 ['https://service.test/v1/pack',{method:'OPTIONS',headers:{Origin:'https://app.test'}},204],
])assert.equal((await service.fetch(new Request(url,init),env)).status,status);

// Exercise the actual app loader with this service, then disconnect it.
const oldFetch=globalThis.fetch,oldCaches=globalThis.caches,store=new MemoryCache();let downloads=0;
globalThis.caches={open:async()=>store};
globalThis.fetch=async(url)=>{downloads++;return service.fetch(new Request(String(url),{headers:{Origin:'https://app.test'}}),env);};
try {
 const job={kind:'solar',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]};
 const first=await loadPrecisionEvent(job,()=>{},undefined,'https://service.test');assert.equal(first.fromCache,false);
 globalThis.fetch=async()=>{throw new Error('offline');};
 const second=await loadPrecisionEvent(job,()=>{},undefined,'https://service.test');assert.equal(second.fromCache,true);assert.equal(downloads,1);
 assert.deepEqual(new Uint8Array(first.buffer),new Uint8Array(second.buffer));
}finally{globalThis.fetch=oldFetch;globalThis.caches=oldCaches;}
console.log(JSON.stringify({nativeStates:states,maxPositionDifferenceKm:maxKm,maxVelocityDifferenceKmDay:maxKmDay,solarExtractBytes:packed.byteLength,upstreamRequests:calls.length,status:'Native coefficients, satellite positions, bounded ranges, CORS, cache reuse and offline loader passed'},null,2));
