// Verify a public test bucket without downloading its complete kernels.
// node tools/verify-r2-data.mjs https://pub-EXAMPLE.r2.dev/
import assert from 'node:assert/strict';
import {createR2Session} from '../js/precisionr2.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
const endpoint=process.argv[2];
if(!endpoint)throw new Error('Usage: node tools/verify-r2-data.mjs public-bucket-URL');
const origin='https://astrozot.github.io';
const fetcher=async(url,options)=>{
 const response=await fetch(url,{...options,headers:{...options.headers,Origin:origin}});
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin,'Bucket CORS must allow the app origin');
 if(options.headers?.Range){
  const exposed=(response.headers.get('Access-Control-Expose-Headers')||'').toLowerCase().split(',').map(x=>x.trim());
  assert.ok(['content-range','etag'].every(x=>exposed.includes(x)),'Range and revision headers must be exposed to browsers');
 }
 return response;
};
const session=await createR2Session(endpoint,()=>{},undefined,fetcher);
try{
 const job={kind:'solar',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]};
 const pack=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read));
 const result=await calculatePrecisionEvent(job,pack);
 assert.ok(Math.abs(result.event.C2-Date.parse('2024-04-08T18:40:40.942Z')/1000)<.1,'Native solar eclipse calculation changed');
 console.log(JSON.stringify({status:'Public CORS, exact ranges and native eclipse calculation passed',...session.stats},null,2));
}finally{session.dispose();}
