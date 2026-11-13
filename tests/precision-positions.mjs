import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openSpk} from '../js/spk.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
import {selectNativeKernel,NATIVE_MOONS} from '../js/precisioncatalog.js';
const fixtures=new URL('fixtures/',import.meta.url),bsp=await fs.readFile(new URL('de440-native.bsp',fixtures)),jup=await fs.readFile(new URL('jup365-native.bsp',fixtures)),sat=await fs.readFile(new URL('sat441-native.bsp',fixtures)),iers=await fs.readFile(new URL('iers-native.txt',fixtures));
const files={de440:bsp,jup365:jup,sat441:sat,iers},descriptors=Object.fromEntries(Object.entries(files).map(([id,b])=>[id,{bytes:b.length}]));
const read=async(id,offset,length)=>new Uint8Array(files[id].subarray(offset,offset+length));
const t=Date.parse('2024-04-08T18:42:00Z')/1000,place=[45.4642,9.19,120],refs=JSON.parse(await fs.readFile(new URL('precision-events.json',fixtures)));
for(const body of ['sun','moon','mercury','venus']){
 const job={kind:'position',body,t,place},pack=readPrecisionPack(await nativeEphemerisPack(job,descriptors,read)),r=await calculatePrecisionEvent(job,pack),expected=refs.positions.find(p=>p.t===t&&p.body===body&&p.place?.[0]===place[0]);
 const error=Math.hypot((r.position.ra-expected.ra)*Math.cos(expected.dec*Math.PI/180),r.position.dec-expected.dec)*3600;
 assert.ok(error<.005,`${body}: ${error} arcsec vs Skyfield`);assert.ok(Math.abs(r.position.dist-expected.dist)<.002);
 assert.ok(Number.isFinite(r.geocentric.ra)&&Number.isFinite(r.position.alt));assert.equal(r.centreModel,'native body centre');
}
for(const body of ['jupiter','Io','Europa','Ganymede','Callisto','saturn','Titan','Iapetus']){
 const job={kind:'position',body,t,place},pack=readPrecisionPack(await nativeEphemerisPack(job,descriptors,read)),r=await calculatePrecisionEvent(job,pack);
 assert.equal(r.centreModel,'native body centre');assert.equal(r.satellite,Boolean(NATIVE_MOONS[body.toLowerCase()]));assert.ok(Number.isFinite(r.position.ra));
 assert.ok(pack.byteLength<524288);
}
const selection={de440:{fromJD:2287184.5,toJD:2688976.5},'de441-part1':{fromJD:1200000,toJD:2440000},'de441-part2':{fromJD:2440000,toJD:3000000}};
assert.equal(selectNativeKernel(selection,2460409).source,'DE440');
assert.equal(selectNativeKernel(selection,1500000).source,'DE441');assert.equal(selectNativeKernel(selection,2800000).id,'de441-part2');
// Body centres require the right planet's native records, not just a
// barycentric DE440 position labelled as a planet centre.
const job={kind:'position',body:'jupiter',t,place};
const p=readPrecisionPack(await nativeEphemerisPack(job,descriptors,read));assert.ok(p.has(5,599));assert.equal(p.has(5,501),false,'Planet detail reads only the centre, not all moons');
const native=await openSpk((o,n)=>read('jup365',o,n));assert.ok(native.segments.length);
console.log('Precise planet/Moon positions vs Skyfield, native satellite positions, body-centre selection and DE440/DE441 preference passed');
