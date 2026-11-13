// Full hosted/native validation; explicit local dataset or URL required.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createStaticSession} from '../js/precisionstatic.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
import {NATIVE_MOONS,NATIVE_SYSTEMS} from '../js/precisioncatalog.js';
const dir=process.env.EXTENDED_STAGED,url=process.env.EXTENDED_URL;
if(!dir&&!url)throw new Error('Set EXTENDED_STAGED or EXTENDED_URL to test extended native data');
const base=url||'https://native.test/',fetcher=url?fetch:async(url)=>{
 const pathname=new URL(url).pathname,file=pathname==='/manifest.json'&&process.env.NATIVE_CATALOGUE?process.env.NATIVE_CATALOGUE:path.join(dir,pathname);return new Response(await fs.readFile(file));
};
const refs=JSON.parse(await fs.readFile(process.env.NATIVE_REFERENCES||new URL('fixtures/extended-native-states.json',import.meta.url)));
let maxPositionKm=0,maxVelocityKmDay=0,maxRawBytes=0,cases=0,moonsChecked=0,maxApparentArcsec=0,maxApparentRangeKm=0;
const groups=new Map();
for(const row of refs.states){const key=row[0]+':'+row[3];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
for(const rows of groups.values()){
 const [id,,,jd]=rows[0],session=await createStaticSession(base,()=>{},undefined,fetcher),system=Object.keys(NATIVE_SYSTEMS).find(s=>NATIVE_SYSTEMS[s].kernel===id);
 const job={kind:'position',body:system||'moon',...(system?{system}:{}),t:(jd-2440587.5)*86400,place:[45.4642,9.19,120],transport:'static'};
 // Planetary reference rows include each planet; request its barycentric
 // records through a tiny synthetic occultation job containing two bodies.
 const main=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read));
 for(const row of rows){
  const [,center,target,at,...expected]=row;let pack=main;
  if(!pack.has(center,target)){
   const name=Object.keys({mercury:1,venus:2,mars:4,jupiter:5,saturn:6,uranus:7,neptune:8}).find(n=>({mercury:1,venus:2,mars:4,jupiter:5,saturn:6,uranus:7,neptune:8})[n]===target);
   if(!name)throw new Error('Missing reference pair '+center+':'+target);
   const extra=await createStaticSession(base,()=>{},undefined,fetcher);
   pack=readPrecisionPack(await nativeEphemerisPack({...job,body:name},extra.descriptors,extra.read));
   maxRawBytes=Math.max(maxRawBytes,extra.stats.peakResidentBytes);extra.dispose();
  }
  const state=pack.native(center,target,at),dp=Math.hypot(...state.position.map((x,i)=>x-expected[i])),dv=Math.hypot(...state.velocity.map((x,i)=>x-expected[i+3]));
  maxPositionKm=Math.max(maxPositionKm,dp);maxVelocityKmDay=Math.max(maxVelocityKmDay,dv);
  assert.ok(dp<1e-5,`${id} ${target}: ${dp} km`);assert.ok(dv<1e-5,`${id} ${target}: ${dv} km/day`);cases++;
 }
 if(id.startsWith('de441')){
  assert.equal(main.header.source,'DE441');const r=await calculatePrecisionEvent(job,main);assert.ok(Number.isFinite(r.position.ra));
 }else if(id==='de440')assert.equal(main.header.source,'DE440','Modern dates must prefer DE440');
 maxRawBytes=Math.max(maxRawBytes,session.stats.peakResidentBytes);assert.ok(session.stats.peakResidentBytes<=1048576);session.dispose();
}
for(const body of Object.keys(NATIVE_MOONS).filter(body=>refs.source.kernels[NATIVE_SYSTEMS[Object.keys(NATIVE_SYSTEMS).find(s=>NATIVE_SYSTEMS[s].center===NATIVE_MOONS[body][0])].kernel])){
 const session=await createStaticSession(base,()=>{},undefined,fetcher),job={kind:'position',body,t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[45.4642,9.19,120]};
 const pack=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read)),r=await calculatePrecisionEvent(job,pack);
 assert.equal(r.centreModel,'native body centre');assert.ok(Number.isFinite(r.position.ra)&&Number.isFinite(r.position.alt));session.dispose();
 moonsChecked++;
}
for(const q of refs.positions||[]){
 const session=await createStaticSession(base,()=>{},undefined,fetcher),job={kind:'position',body:q.body,t:q.t,place:q.place||[45.4642,9.19,120]};
 const pack=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read)),r=await calculatePrecisionEvent(job,pack),p=q.place?r.position:r.geocentric;
 const dra=((p.ra-q.ra+540)%360-180)*Math.cos(q.dec*Math.PI/180),error=Math.hypot(dra,p.dec-q.dec)*3600;
 assert.ok(error<.005,`${q.body} at ${q.t}, place=${q.place}: ${error} arcsec vs Skyfield (RA ${dra*3600}, Dec ${(p.dec-q.dec)*3600})`);maxApparentArcsec=Math.max(maxApparentArcsec,error);
 const rangeError=Math.abs(p.dist-q.dist);maxApparentRangeKm=Math.max(maxApparentRangeKm,rangeError);
 assert.ok(rangeError<.002,`${q.body} at ${q.t}: ${p.dist-q.dist} km distance vs Skyfield`);session.dispose();
}
console.log(JSON.stringify({nativeStates:cases,maxPositionKm,maxVelocityKmDay,nativeMoonPositions:moonsChecked,apparentPositions:refs.positions?.length||0,maxApparentArcsec,maxApparentRangeKm,maxRawBytes},null,2));
