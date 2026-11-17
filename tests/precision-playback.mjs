// Retained worker protocol: exact native evaluation, both clock directions,
// bounded coverage and no further byte reads after the initial download.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
const files=Object.fromEntries(await Promise.all([['de440','de440-native.bsp'],['jup365','jup365-native.bsp'],['sat441','sat441-native.bsp'],['iers','iers-native.txt']].map(async([id,file])=>[id,await fs.readFile(new URL(`fixtures/${file}`,import.meta.url))])));
const descriptors=Object.fromEntries(Object.entries(files).map(([id,b])=>[id,{bytes:b.length}]));
let reads=0;
const read=async(id,offset,length)=>{reads++;return new Uint8Array(files[id].subarray(offset,offset+length));};
const messages=[];
globalThis.self={postMessage:value=>messages.push(structuredClone(value))};
await import('../js/precisionworker.js?playback-test');
const t=Date.parse('2024-04-08T18:42:00Z')/1000,place=[45.4642,9.19,120];
for(const body of ['moon','jupiter','Io','saturn','Titan']){
 const job={kind:'position',body,t,place,livePosition:true};
 const buffer=await nativeEphemerisPack(job,descriptors,read),pack=readPrecisionPack(buffer);
 await self.onmessage({data:{...job,buffer}});
 const initial=messages.at(-1);assert.ok(initial.result,JSON.stringify(initial));
 const {interval}=initial.result;
 assert.ok(interval.from<=t-43198&&interval.to>=t+43198,`Loaded interval covers nearly one day: ${body} ${interval.from-t}, ${interval.to-t}`);
 const count=reads;
 for(const [id,time] of [t+3600,t-3600,interval.from,interval.to,t].entries()){
  await self.onmessage({data:{positionUpdate:{id,t:time}}});
  const update=messages.at(-1).positionUpdate;
  assert.equal(update.id,id);assert.ok(update.result,JSON.stringify(update));assert.equal(update.result.t,time);
  const expected=await calculatePrecisionEvent({...job,t:time},pack);
  assert.deepEqual(update.result.position,expected.position);assert.deepEqual(update.result.geocentric,expected.geocentric);
  assert.deepEqual(update.result.coordinateMatrix,expected.coordinateMatrix);
 }
 for(const time of [interval.from-1,interval.to+1,NaN]){
  await self.onmessage({data:{positionUpdate:{id:42,t:time}}});
  assert.match(messages.at(-1).positionUpdate.error,/Outside the loaded JPL interval/);
 }
 assert.equal(reads,count,'Playback cannot initiate data reads');
}
delete globalThis.self;
console.log('JPL playback: exact positions, forward/backward seeks, interval boundaries, expiry and byte reuse passed for Moon, planets and satellites');
