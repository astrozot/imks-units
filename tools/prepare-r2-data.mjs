// Stage immutable originals and a tiny catalogue, never yearly extracts.
// node tools/prepare-r2-data.mjs de440.bsp finals2000A.all output-directory
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const [kernel,eop,out]=process.argv.slice(2);
if(!kernel||!eop||!out)throw new Error('Usage: node tools/prepare-r2-data.mjs de440.bsp finals2000A.all output-directory');
const checksum=async(file)=>{
 const sha=crypto.createHash('sha256'),md5=crypto.createHash('md5');let bytes=0;
 for await(const chunk of fs.createReadStream(file)){sha.update(chunk);md5.update(chunk);bytes+=chunk.length;}
 return {bytes,sha256:sha.digest('hex'),md5:md5.digest('hex')};
};
const k=await checksum(kernel);
// JPL aa_checksums.txt, DE440 original, verified 2026-11-13. This also
// prevents accidentally uploading a sparse range-test file of equal size.
if(k.bytes!==119799808||k.md5!=='c9d581bfd84209dbeee8b1583939b148')throw new Error('DE440 does not match JPL\'s published size/checksum; refusing to stage it');
const e=await checksum(eop),first=new Uint8Array(188),handle=await fsp.open(eop);
try{await handle.read(first,0,188,0);}finally{await handle.close();}
const line=new TextDecoder().decode(first),firstMJD=Number(line.slice(7,15));
if(e.bytes%188||line[187]!=='\n'||!Number.isFinite(firstMJD)||!line.slice(18,27).trim()||!line.slice(58,68).trim())throw new Error('Invalid fixed-width IERS input');
const kp=`kernels/de440-${k.sha256}.bsp`,ep=`iers/finals2000A-${e.sha256}.all`;
await fsp.mkdir(path.join(out,'kernels'),{recursive:true});await fsp.mkdir(path.join(out,'iers'),{recursive:true});
await fsp.copyFile(kernel,path.join(out,kp));await fsp.copyFile(eop,path.join(out,ep));
const manifest={version:1,created:new Date().toISOString(),kernels:{de440:{path:kp,...k,source:'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp'}},earthOrientation:{path:ep,...e,rowBytes:188,firstMJD,source:'https://maia.usno.navy.mil/ser7/finals2000A.all'}};
await fsp.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output:path.resolve(out),totalBytes:k.bytes+e.bytes,objects:[kp,ep,'manifest.json'],kernelSha256:k.sha256},null,2));
