// Validate and snapshot a release while independent source preparation
// continues. Immutable chunk files are hard-linked; catalogues are copied.
// node tools/stage-ephemeris-release.mjs old-static-root v3-catalogue output
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const [source,catalogue,output]=process.argv.slice(2);
if(!source||!catalogue||!output||path.resolve(output)===path.resolve(source)||path.resolve(output).startsWith(path.resolve(source)+path.sep))throw new Error('Usage: node tools/stage-ephemeris-release.mjs source-root prepared-v3-catalogue separate-output-directory');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const legacy=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8')),extended=JSON.parse(await fs.readFile(catalogue,'utf8'));
if(legacy.version!==2||extended.version!==3)throw new Error('Unexpected catalogue versions');
let assets=0,bytes=0;
await fs.mkdir(output,{recursive:true});
for(const [prefix,m] of [['',legacy],['v3',extended]]){
 for(const d of [...Object.values(m.kernels),m.earthOrientation]){
  if(!d||! /^(kernels|iers)\/[a-zA-Z0-9._-]+$/.test(d.path))throw new Error('Unsafe data path');
  const input=path.join(source,prefix,d.path),dest=path.join(output,prefix,d.path),index=await fs.readFile(path.join(input,'index.bin')),chunkBytes=d.chunkBytes||m.chunkBytes;
  if(sha(index)!==d.indexSha256||index.length!==Math.ceil(d.bytes/chunkBytes)*32)throw new Error('Invalid source index');
  await fs.mkdir(dest,{recursive:true});
  for(let i=0;i<index.length/32;i++){
   const expected=index.subarray(i*32,i*32+32).toString('hex');if(expected==='0'.repeat(64))continue;
   const name=String(i).padStart(6,'0')+'.bin',file=path.join(input,name),body=await fs.readFile(file);
   if(body.length!==Math.min(chunkBytes,d.bytes-i*chunkBytes)||sha(body)!==expected)throw new Error('Invalid native chunk: '+file);
   await fs.link(file,path.join(dest,name));assets++;bytes+=body.length;
  }
  await fs.link(path.join(input,'index.bin'),path.join(dest,'index.bin'));assets++;bytes+=index.length;
 }
 await fs.mkdir(path.join(output,prefix),{recursive:true});
 await fs.writeFile(path.join(output,prefix,'manifest.json'),JSON.stringify(m,null,2)+'\n');assets++;
}
for(const name of ['_headers','404.html']){await fs.copyFile(path.join(source,name),path.join(output,name));assets++;}
if(assets>20000)throw new Error('Release exceeds the Workers Free static asset count');
console.log(JSON.stringify({output,assets,payloadBytes:bytes,kernels:Object.keys(extended.kernels)},null,2));
