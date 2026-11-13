// Native SPK, independent Skyfield apparent positions/events and ERFA frames.
// Regenerate references with tools/precision-data.py / precision-reference.py.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { readPrecisionPack, PRECISION_LIMITS } from '../js/precisionpack.js';
import { precisionFrame } from '../js/precisionframes.js';
import { makePrecisionEphemeris, precisionClock } from '../js/precisionephem.js';
import { calculatePrecisionEvent } from '../js/precisionworker.js';
import { boundedBytes, loadPrecisionYear } from '../js/precisionload.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url)));
const bytes = (year) => { const b = fs.readFileSync(new URL(`../data/precision/${year}.bin`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const pack = (year) => readPrecisionPack(bytes(year));
const manifest = read('../data/precision/index.json');
assert.equal(Object.keys(manifest.files).length, 201);
let maxFile = 0;
for (let year = 1900; year <= 2100; year++) {
  const b = bytes(year), p = readPrecisionPack(b), entry = manifest.files[`${year}.bin`];
  maxFile = Math.max(maxFile, b.byteLength);
  assert.equal(b.byteLength, entry.bytes);
  assert.equal(crypto.createHash('sha256').update(new Uint8Array(b)).digest('hex'), entry.sha256);
  assert.equal(p.header.year, year);
  for (const t of [Date.UTC(year,0,1)/86400000+2440587.5,Date.UTC(year+1,0,1)/86400000+2440587.5]) {
    assert.ok(p.native(3,301,t).position.every(Number.isFinite), `${year}: boundary coverage`);
  }
  assert.throws(() => p.native(3,301,NaN), RangeError);
}
const spk = read('fixtures/precision-spk.json');
let maxPositionKm = 0, maxVelocityKmDay = 0;
for (const [year,center,target,jd,...ref] of spk.states) {
  const s = pack(year).native(center,target,jd);
  maxPositionKm = Math.max(maxPositionKm,...s.position.map((x,i)=>Math.abs(x-ref[i])));
  maxVelocityKmDay = Math.max(maxVelocityKmDay,...s.velocity.map((x,i)=>Math.abs(x-ref[i+3])));
}
assert.ok(maxPositionKm < .00004, `Native SPK agreement: ${maxPositionKm} km`);
assert.ok(maxVelocityKmDay < .000003);
const refs = read('fixtures/precision-events.json');
for (const q of refs.frames) {
  const f = precisionFrame(q.tt);
  assert.ok(Math.abs(f.dpsi-q.dpsi)<1e-15 && Math.abs(f.deps-q.deps)<1e-15);
  for (let i=0;i<3;i++) {
    const v=[0,0,0]; v[i]=1;
    const out=f.apply(v);
    assert.ok(out.every((x,k)=>Math.abs(x-q.matrix[k][i])<1e-14));
    assert.ok(f.inverse(out).every((x,k)=>Math.abs(x-v[k])<1e-14));
  }
}
for (const q of refs.clocks) {
  const c=precisionClock(pack(new Date(q.t*1000).getUTCFullYear()),q.t);
  assert.ok(Math.abs(c.ttJD-q.tt)*86400<.0001);
  assert.ok(Math.abs(c.ut1JD-q.ut1)*86400<.0001);
}
const positions = {};
for (const q of refs.positions) {
  const e=makePrecisionEphemeris(pack(new Date(q.t*1000).getUTCFullYear()));
  const p=q.place ? e.topocentric(q.body,q.t,q.place) : e.equatorial(q.body,q.t);
  const ra=((p.ra-q.ra+540)%360-180)*Math.cos(q.dec*Math.PI/180);
  const error=Math.hypot(ra,p.dec-q.dec)*3600;
  positions[q.body]=Math.max(positions[q.body]||0,error);
  assert.ok(error<.005, `${q.body}: ${error} arcsec vs Skyfield`);
  assert.ok(Math.abs(p.dist-q.dist)<.002, `${q.body}: range vs Skyfield`);
}
let maxContactSeconds=0, maxMaximumSeconds=0;
const eventErrors=[];
for (const q of refs.events) {
  const p=pack(new Date(q.t*1000).getUTCFullYear()), r=await calculatePrecisionEvent(q,p);
  assert.ok(r.residentBytes<PRECISION_LIMITS.residentBytes);
  assert.equal(Boolean(r.event),Boolean(q.event), q.name);
  if (!q.event) continue;
  if (q.event.kind) assert.equal(r.event.kind,q.event.kind,q.name);
  const errors={};
  for (const name of ['max','C1','C2','C3','C4','P1','U1','U2','U3','U4','P4']) {
    if (!(name in q.event)) continue;
    const a=r.event[name], b=q.event[name];
    if (b===null) { assert.equal(a,null); continue; }
    errors[name]=Math.abs(a-b);
    assert.ok(errors[name]<.2, `${q.name} ${name}: ${errors[name]} s vs independent contacts`);
    if(name==='max') maxMaximumSeconds=Math.max(maxMaximumSeconds,errors[name]);
    else maxContactSeconds=Math.max(maxContactSeconds,errors[name]);
  }
  eventErrors.push({name:q.name,errorsSeconds:errors});
}
// Reject malformed records before they can drive loops or large allocations.
for (const b of [new ArrayBuffer(0),new ArrayBuffer(PRECISION_LIMITS.fileBytes+1),new ArrayBuffer(24)]) assert.throws(()=>readPrecisionPack(b));
const invalid=bytes(2024);new DataView(invalid).setUint32(8,0xffffffff,true);assert.throws(()=>readPrecisionPack(invalid));
const nonfinite=bytes(2024),v=new DataView(nonfinite),offset=16+Math.ceil(v.getUint32(8,true)/8)*8;v.setFloat64(offset,NaN,true);assert.throws(()=>readPrecisionPack(nonfinite));
await assert.rejects(()=>boundedBytes(new Response(new Uint8Array(25)),24),/size limit/);
await assert.rejects(()=>boundedBytes(new Response('not found',{status:404}),24),/unavailable/);
await assert.rejects(()=>loadPrecisionYear(1899),RangeError);
await assert.rejects(()=>calculatePrecisionEvent({kind:'solar',t:Date.UTC(2101,0,1)/1000,place:[0,0]},pack(2100)),RangeError);
await assert.rejects(()=>calculatePrecisionEvent({kind:'solar',t:Date.UTC(2024,0,1)/1000,place:[91,0]},pack(2024)),/valid observing/);

const report={reference:refs.source,nativeStates:spk.states.length,nativeMaxPositionKm:maxPositionKm,nativeMaxVelocityKmDay:maxVelocityKmDay,apparentPositions:refs.positions.length,maxApparentErrorArcsec:positions,eventCases:refs.events.length,maxContactDifferenceSeconds:maxContactSeconds,maxMaximumDifferenceSeconds:maxMaximumSeconds,events:eventErrors,largestYearBytes:maxFile,limits:PRECISION_LIMITS};
if(process.argv.includes('--report')) fs.writeFileSync(new URL('../data/precision-accuracy.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
