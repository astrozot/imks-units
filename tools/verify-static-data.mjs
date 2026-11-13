// Check a real public endpoint without downloading the complete kernel.
// node tools/verify-static-data.mjs https://astrolabium-ephemeris-data.EXAMPLE.workers.dev/
import assert from 'node:assert/strict';
import {createStaticSession} from '../js/precisionstatic.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
const endpoint=process.argv[2];if(!endpoint)throw new Error('Usage: node tools/verify-static-data.mjs public-URL');
const origin='https://astrozot.github.io';
const fetcher=async(url,options)=>{
 const response=await fetch(url,{...options,headers:{Origin:origin}});
 assert.ok(['*',origin].includes(response.headers.get('Access-Control-Allow-Origin')),'Static hosting must allow the app origin');
 const policy=response.headers.get('Cache-Control')||'';
 if(String(url).endsWith('/manifest.json')){assert.ok(policy.includes('max-age=3600'));assert.ok(!policy.includes('immutable'),'The mutable catalogue must not inherit the chunk cache policy');}
 else assert.ok(policy.includes('immutable'),'Hash-named data should be cached immutably');
 return response;
};
const session=await createStaticSession(endpoint,()=>{},undefined,fetcher);
try{
 const job={kind:'solar',transport:'static',t:Date.parse('2024-04-08T18:42:00Z')/1000,place:[32.7767,-96.797,130]};
 const pack=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read)),result=await calculatePrecisionEvent(job,pack);
 assert.ok(Math.abs(result.event.C2-Date.parse('2024-04-08T18:40:40.942Z')/1000)<.1);
 assert.ok(session.stats.peakResidentBytes<=1024**2);
 console.log(JSON.stringify({status:'Public CORS, checksum-verified chunks and native eclipse calculation passed',endpoint,...session.stats},null,2));
}finally{session.dispose();}
