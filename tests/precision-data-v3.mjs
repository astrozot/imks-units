import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStaticSession} from '../js/precisionstatic.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),size=524288,files=new Map();
function partial(id,seed){
 const first=Buffer.alloc(size,seed),last=Buffer.alloc(104,seed+1),index=Buffer.alloc(96);
 Buffer.from(hash(first),'hex').copy(index,0);Buffer.from(hash(last),'hex').copy(index,64);
 const prefix=`kernels/${id}-${hash(index)}`;files.set(prefix+'/index.bin',index);files.set(prefix+'/000000.bin',first);files.set(prefix+'/000002.bin',last);
 return {path:prefix,partial:true,bytes:size*2+last.length,chunkBytes:size,indexBytes:index.length,indexSha256:hash(index),fromJD:1300000,toJD:2450000};
}
const manifest={version:3,chunkBytes:262144,kernels:{de440:partial('de440',11),'de441-part1':partial('de441-part1',31)}};
let requests=[];
const fetcher=async(url,options)=>{
 assert.equal(options.headers,undefined);requests.push(String(url));
 if(String(url).endsWith('manifest.json'))return Response.json(manifest);
 const key=new URL(url).pathname.slice(1),bytes=files.get(key);assert.ok(bytes,'Must not request an unpublished chunk');return new Response(bytes);
};
const session=await createStaticSession('https://native.test/',()=>{},undefined,fetcher);
assert.equal((await session.read('de440',0,16))[0],11);
assert.equal((await session.read('de441-part1',0,16))[0],31);
assert.equal((await session.read('de440',size*2,104))[0],12);
assert.equal((await session.read('de441-part1',size*2,104))[0],32);
assert.ok(session.stats.peakResidentBytes<=1048576,'512 KiB chunks still share the 1 MiB raw-memory budget');
const before=requests.length;await assert.rejects(()=>session.read('de441-part1',size-1,2),/hosted coverage/);assert.equal(requests.length,before,'Missing chunk rejected from its zero index hash before any HTTP request');
await assert.rejects(()=>createStaticSession('https://invalid.test/',()=>{},undefined,async()=>Response.json({...manifest,version:2})),/descriptor/);
await assert.rejects(()=>createStaticSession('https://invalid.test/',()=>{},undefined,async()=>Response.json({...manifest,kernels:{de440:{...manifest.kernels.de440,chunkBytes:1048576}}})),/index/);
session.dispose();assert.equal(session.stats.residentBytes,0);assert.equal(session.stats.indexBytes,0);
console.log('Versioned partial native chunks: authenticated indexes, explicit missing coverage and 1 MiB memory limit passed');
