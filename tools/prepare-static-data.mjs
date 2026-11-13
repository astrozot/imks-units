// Repackage verified originals as exact byte chunks; no ephemeris fitting.
// node tools/prepare-static-data.mjs verified-r2-staging output-directory
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const CHUNK_BYTES=262144;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

export async function prepareStaticData(input,out){
 const original=JSON.parse(await fs.readFile(path.join(input,'manifest.json'),'utf8'));
 if(original.version!==1||Object.keys(original.kernels||{}).join()!=='de440'||!original.earthOrientation)throw new Error('Expected verified DE440 and IERS staging manifest');
 const manifest={version:2,chunkBytes:CHUNK_BYTES,created:new Date().toISOString(),kernels:{}};
 for(const [id,d] of [['de440',original.kernels.de440],['iers',original.earthOrientation]]){
  if(!/^(kernels|iers)\/[a-zA-Z0-9._-]+$/.test(d.path)||!/^[0-9a-f]{64}$/.test(d.sha256)||!d.path.includes(d.sha256)||!Number.isSafeInteger(d.bytes)||d.bytes<188||d.bytes>4*1024**3)throw new Error('Invalid original object');
  if(id==='de440'&&(d.bytes!==119799808||d.md5!=='c9d581bfd84209dbeee8b1583939b148'))throw new Error('Expected original full DE440');
  const prefix=`${id==='iers'?'iers':'kernels'}/${id}-${d.sha256}`,dir=path.join(out,prefix);
  await fs.mkdir(dir,{recursive:true});
  const handle=await fs.open(path.join(input,d.path)),whole=crypto.createHash('sha256'),md5=crypto.createHash('md5'),hashes=[];
  try{
   if((await handle.stat()).size!==d.bytes)throw new Error('Original object size changed');
   for(let offset=0,index=0;offset<d.bytes;offset+=CHUNK_BYTES,index++){
    const chunk=Buffer.alloc(Math.min(CHUNK_BYTES,d.bytes-offset));let at=0;
    while(at<chunk.length){const {bytesRead}=await handle.read(chunk,at,chunk.length-at,offset+at);if(!bytesRead)throw new Error('Incomplete original object');at+=bytesRead;}
    whole.update(chunk);md5.update(chunk);hashes.push(Buffer.from(hash(chunk),'hex'));
    await fs.writeFile(path.join(dir,`${String(index).padStart(6,'0')}.bin`),chunk);
   }
  }finally{await handle.close();}
  if(whole.digest('hex')!==d.sha256||d.md5&&md5.digest('hex')!==d.md5)throw new Error('Original object checksum failed; manifest has not been published');
  const index=Buffer.concat(hashes);await fs.writeFile(path.join(dir,'index.bin'),index);
  const descriptor={...d,path:prefix,indexBytes:index.length,indexSha256:hash(index)};
  if(id==='iers')manifest.earthOrientation=descriptor;else manifest.kernels[id]=descriptor;
 }
 // Publish the catalogue only after all source hashes have been verified.
 await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await fs.writeFile(path.join(out,'_headers'),'/*\n  Access-Control-Allow-Origin: *\n/kernels/*\n  Cache-Control: public, max-age=31536000, immutable\n/iers/*\n  Cache-Control: public, max-age=31536000, immutable\n/manifest.json\n  Cache-Control: public, max-age=3600\n');
 // Explicit static 404: unknown paths must not fall back to a SPA index.
 await fs.writeFile(path.join(out,'404.html'),'<!doctype html><title>Not found</title><p>Ephemeris object not found.</p>\n');
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,out]=process.argv.slice(2);if(!input||!out)throw new Error('Usage: node tools/prepare-static-data.mjs verified-staging output-directory');
 const m=await prepareStaticData(input,out);
 console.log(JSON.stringify({output:path.resolve(out),chunkBytes:CHUNK_BYTES,dataChunks:Math.ceil(m.kernels.de440.bytes/CHUNK_BYTES)+Math.ceil(m.earthOrientation.bytes/CHUNK_BYTES),originalBytes:m.kernels.de440.bytes+m.earthOrientation.bytes},null,2));
}
