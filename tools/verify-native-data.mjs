// Public smoke check for DE440 preference, DE441 and all five moon systems.
// node tools/verify-native-data.mjs https://...workers.dev/v3/
import assert from 'node:assert/strict';
import {createStaticSession} from '../js/precisionstatic.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
const url=process.argv[2];if(!url)throw new Error('Supply the deployed v3 URL');
const cases=[['moon','-000653-06-01T00:00:00Z','DE441'],['sun','2175-06-01T00:00:00Z','DE440'],['moon','2800-06-01T00:00:00Z','DE441'],...['mars','phobos','jupiter','io','saturn','titan','uranus','miranda','neptune','triton'].map(body=>[body,'2024-04-08T18:42:00Z','DE440'])];
const results=[];
for(const [body,stamp,source] of cases){
 const session=await createStaticSession(url),job={kind:'position',body,t:Date.parse(stamp)/1000,place:[45.4642,9.19,120]};
 try{
  const pack=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read)),r=await calculatePrecisionEvent(job,pack);
  assert.equal(r.source,source);assert.equal(r.centreModel,'native body centre');assert.ok(Number.isFinite(r.position.ra)&&Number.isFinite(r.position.alt));
  assert.ok(session.stats.peakResidentBytes<=1048576);results.push({body,stamp,source,networkRequests:session.stats.networkRequests,downloadedBytes:session.stats.networkBytes,peakRawBytes:session.stats.peakResidentBytes});
 }finally{session.dispose();}
}
console.log(JSON.stringify({url,status:'Live native data checks passed',results},null,2));
