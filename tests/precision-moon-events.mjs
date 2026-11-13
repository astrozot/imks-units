// Native finite-contact event searches and sampled map playback. Set
// EXTENDED_STAGED to exercise the exact hosted dataset instead of fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createStaticSession} from '../js/precisionstatic.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
import {makePrecisionEphemeris} from '../js/precisionephem.js';
import {nativeMoonGeometry} from '../js/precisionmoons.js';
import {interpolatedPrecisionEphemeris} from '../js/precisioninterpolate.js';
import {shadowMap} from '../js/astro.js';
const blocks=new Map();
const files=Object.fromEntries(await Promise.all(['de440','jup365','sat441','iers'].map(async id=>[id,await fs.readFile(new URL(`fixtures/${id==='iers'?'iers-native.txt':id+'-native.bsp'}`,import.meta.url))])));
async function pack(job){
 if(process.env.EXTENDED_STAGED){const session=await createStaticSession('https://native.test/',()=>{},undefined,async url=>{const pathname=new URL(url).pathname;if(/\/kernels\/.*\/[0-9]{6}\.bin$/.test(pathname))blocks.set(pathname,true);return new Response(await fs.readFile(path.join(process.env.EXTENDED_STAGED,pathname)));});try{const p=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read));assert.ok(session.stats.peakResidentBytes<=1048576);return p;}finally{session.dispose();}}
 return readPrecisionPack(await nativeEphemerisPack(job,Object.fromEntries(Object.entries(files).map(([id,b])=>[id,{bytes:b.length}])),async(id,o,n)=>new Uint8Array(files[id].subarray(o,o+n))));
}
const t=Date.parse('2024-04-08T00:00Z')/1000,report={moonEvents:[],maps:[],independentContacts:0,maxReferenceSeconds:0};
const dates=process.env.EXTENDED_STAGED?[t,...['1900-06-01','2000-06-01','2009-09-04','2025-03-23','2099-06-01'].map(s=>Date.parse(s+'T00:00Z')/1000)]:[t];
for(const epoch of dates)for(const system of ['jupiter','saturn']){
 const job={kind:'moon-events',system,t:epoch,days:1},p=await pack(job),r=await calculatePrecisionEvent(job,p),ephemeris=makePrecisionEphemeris(p);
 if(epoch===t)assert.ok(r.list.length>0);assert.ok(r.residentBytes<524288);
 for(const e of r.list){
  assert.ok(e.begin<e.end&&e.end>epoch&&e.begin<epoch+86400);assert.ok(nativeMoonGeometry(ephemeris,e.moon,e.t)[e.kind]<0);
  assert.ok(nativeMoonGeometry(ephemeris,e.moon,e.begin-1)[e.kind]>0);assert.ok(nativeMoonGeometry(ephemeris,e.moon,e.end+1)[e.kind]>0);
  assert.equal(e.errors.begin,null,'Do not reuse compact-fit errors as native orbit uncertainty');
  if(e.contacts.C2!==null)assert.ok(e.contacts.C1<=e.contacts.C2&&e.contacts.C2<e.contacts.C3&&e.contacts.C3<=e.contacts.C4);
 }
 report.moonEvents.push({system,t:epoch,events:r.list.length,calculationMs:r.calculationMs,packBytes:p.byteLength});
 if(process.env.SEEDS){const current=JSON.parse(await fs.readFile(process.env.SEEDS).catch(()=> '[]'));current.push(...r.list.map(e=>({system,epoch,ttMinusUTC:(ephemeris.clock(e.t).ttJD-ephemeris.clock(e.t).utcJD)*86400,...e})));await fs.writeFile(process.env.SEEDS,JSON.stringify(current));}
 const refs=JSON.parse(await fs.readFile(process.env.NATIVE_CONTACT_REFERENCES||new URL('fixtures/native-moon-contacts.json',import.meta.url)).catch(()=> 'null'));
 for(const q of refs?.contacts||[]){if(q.system!==system||(q.epoch??t)!==epoch)continue;const e=r.list.find(e=>e.moon===q.moon&&e.kind===q.kind&&Math.abs(e.begin-q.begin)<120);assert.ok(e,`${q.moon} ${q.kind} present`);for(const key of ['begin','end',...(q.kind==='shadow'?['C1','C2','C3','C4']:[])]){const actual=key==='begin'||key==='end'?e[key]:e.contacts[key];if(q[key]===null){assert.equal(actual,null);continue;}const dt=Math.abs(actual-q[key]);assert.ok(dt<.12,`${q.moon} ${key}: ${dt}s vs independent solver`);report.maxReferenceSeconds=Math.max(report.maxReferenceSeconds,dt);report.independentContacts++;}}
}
for(const job of [{kind:'solar',t:Date.parse('2024-04-08T18:42Z')/1000,place:[32.7767,-96.797,130]}, {kind:'occultation',t:Date.parse('2024-04-08T18:42Z')/1000,place:[45.4642,9.19,120],target:'venus',front:'moon'}]){
 const p=await pack(job),r=await calculatePrecisionEvent({...job,map:true},p);assert.ok(r.map.track.center);assert.ok(JSON.stringify(r.map.track).length<1500000);
 if(r.map.samples){const e=makePrecisionEphemeris(p),sampled=interpolatedPrecisionEphemeris(r.map.samples);let maxArcsec=0,maxShadowKm=0;
  for(let i=0;i<r.map.samples.count-1;i+=7){const at=r.map.samples.from+(i+.5)*r.map.samples.step;
   for(const body of ['moon','sun']){const a=e.equatorial(body,at),b=sampled.equatorial(body,at),error=Math.hypot(((a.ra-b.ra+540)%360-180)*Math.cos(a.dec*Math.PI/180),a.dec-b.dec)*3600;maxArcsec=Math.max(maxArcsec,error);assert.ok(error<.003,'Interpolation error below 0.003 arcsec');}
   const a=shadowMap(at,[0],e),b=shadowMap(at,[0],sampled);if(a.umbra?.center&&b.umbra?.center){const error=Math.hypot(a.umbra.center[0]-b.umbra.center[0],(a.umbra.center[1]-b.umbra.center[1])*Math.cos(a.umbra.center[0]*Math.PI/180))*111.32;maxShadowKm=Math.max(maxShadowKm,error);assert.ok(error<.01,'Interpolated central shadow within 10 m of direct native evaluation');}
  }
  report.maps.push({kind:job.kind,sampleBytes:r.map.samples.data.byteLength,maxArcsec,maxShadowKm,calculationMs:r.calculationMs});
 }else report.maps.push({kind:job.kind,calculationMs:r.calculationMs});
}
if(process.env.REFERENCE_KERNELS&&process.env.EXTENDED_STAGED){
 const manifest=JSON.parse(await fs.readFile(path.join(process.env.EXTENDED_STAGED,'manifest.json')));await fs.mkdir(process.env.REFERENCE_KERNELS,{recursive:true});
 for(const [id,d] of Object.entries(manifest.kernels).filter(([id])=>['de440','jup365','sat441'].includes(id))){
  const handle=await fs.open(path.join(process.env.REFERENCE_KERNELS,id+'.bsp'),'w');try{await handle.truncate(d.bytes);const prefix='/'+d.path+'/';for(const key of blocks.keys())if(key.startsWith(prefix)){const data=await fs.readFile(path.join(process.env.EXTENDED_STAGED,key));await handle.write(data,0,data.length,Number(path.basename(key,'.bin'))*(d.chunkBytes??manifest.chunkBytes));}}finally{await handle.close();}
 }
}
console.log(JSON.stringify(report,null,2));if(process.env.REPORT)await fs.writeFile(process.env.REPORT,JSON.stringify(report,null,2)+'\n');
