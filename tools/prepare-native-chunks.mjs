// Mirror exact native SPK chunks relevant to the app's supported dates.
// No sampling, fitting, yearly files or complete-kernel phone downloads.
// node tools/prepare-native-chunks.mjs old-static-dir output-v3-dir cache-dir
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {constants} from 'node:fs';
import {openSpk} from '../js/spk.js';
import {NATIVE_SYSTEMS,PLANET_IDS} from '../js/precisioncatalog.js';
const [old,out,cacheDir]=process.argv.slice(2);if(!old||!out||!cacheDir)throw new Error('Usage: node tools/prepare-native-chunks.mjs old-static-directory output-v3-directory cache-directory');
if(path.resolve(out)!==path.resolve(old,'v3'))throw new Error('Put the extended output in the base static directory’s v3 subdirectory');
const ROOT='https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/',CHUNK=524288,BLOCK=4194304;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sources={
 'de441-part1':'planets/de441_part-1.bsp','de441-part2':'planets/de441_part-2.bsp',
 mar099:'satellites/mar099.bsp',jup365:'satellites/jup365.bsp',sat441:'satellites/sat441.bsp',ura184:'satellites/ura184_part-3.bsp',nep097:'satellites/nep097.bsp',
};
const sums=new Map();for(const group of ['planets','satellites']){
 const response=await fetch(ROOT+group+'/aa_checksums.txt');if(!response.ok)throw new Error('JPL checksums unavailable');
 for(const line of (await response.text()).trim().split('\n')){const [hash,name]=line.trim().split(/\s+/);sums.set(group+'/'+name,hash);}
}
await fs.mkdir(out,{recursive:true});
const previous=JSON.parse(await fs.readFile(path.join(old,'manifest.json'),'utf8'));
if(previous.version!==2||!previous.kernels?.de440||!previous.earthOrientation)throw new Error('The base directory must contain the original v2 DE440/IERS catalogue');
const manifest={...previous,version:3,created:new Date().toISOString(),kernels:{...previous.kernels}};
for(const d of [previous.kernels.de440,previous.earthOrientation])await fs.cp(path.join(old,d.path),path.join(out,d.path),{recursive:true,force:false});
const appStart=Date.parse('-001000-01-01T00:00:00Z')/86400000+2440587.5-14,appEnd=Date.parse('3001-01-01T00:00:00Z')/86400000+2440587.5+14;
for(const [id,source] of Object.entries(sources)){
 const publishedMd5=sums.get(source);if(!/^[0-9a-f]{32}$/.test(publishedMd5||''))throw new Error('Missing published JPL checksum');
 const cache=path.join(cacheDir,id+'-'+publishedMd5);await fs.mkdir(cache,{recursive:true});
 const wanted=new Set(),pending=new Map(),resident=new Map();let meta,requests=0;
 try{meta=JSON.parse(await fs.readFile(path.join(cache,'origin.json'),'utf8'));}catch{/* first preparation */}
 async function block(index,small=false){
  const span=small?16384:BLOCK,key=small?'small-'+index:index;
  if(resident.has(key))return resident.get(key);if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   const file=path.join(cache,key+'.bin');let bytes;
   try{bytes=await fs.readFile(file);if(sha(bytes)!==(await fs.readFile(file+'.sha256','utf8')).trim())bytes=null;}catch{bytes=null;}
   if(!bytes){
    const start=index*span,end=meta?Math.min(meta.bytes-1,start+span-1):start+span-1;
    const headers={Range:`bytes=${start}-${end}`};if(meta)headers['If-Range']=meta.etag||meta.lastModified;
    let response;
    for(let attempt=0;attempt<3;attempt++){
     try{response=await fetch(ROOT+source,{headers,signal:AbortSignal.timeout(120000)});if(response.status===206)break;await response.body?.cancel();}catch(error){if(attempt===2)throw error;}
    }
    const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response?.headers.get('Content-Range')||'');
    if(!match||+match[1]!==start||+match[2]!==end||meta&&+match[3]!==meta.bytes)throw new Error('Origin did not return exact ranges: '+id);
    const revision={bytes:+match[3],etag:response.headers.get('ETag'),lastModified:response.headers.get('Last-Modified'),publishedMd5,url:ROOT+source};
    if(!revision.etag&&!revision.lastModified||meta&&(meta.etag!==revision.etag||meta.lastModified!==revision.lastModified))throw new Error('Origin revision changed during preparation');
    meta=revision;await fs.writeFile(path.join(cache,'origin.json'),JSON.stringify(meta));
    bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==end-start+1)throw new Error('Incomplete source block');
    await fs.writeFile(file,bytes);await fs.writeFile(file+'.sha256',sha(bytes));requests++;
    if(requests%25===0)console.log(id+': '+requests+' source blocks downloaded');
   }
   resident.set(key,bytes);while(resident.size>2)resident.delete(resident.keys().next().value);return bytes;
  })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
 }
 function mark(start,length){for(let i=Math.floor(start/CHUNK);i<=Math.floor((start+length-1)/CHUNK);i++)wanted.add(i);}
 const read=async(offset,length)=>{
  mark(offset,length);const bytes=Buffer.alloc(length);let at=0;
  while(at<length){const pos=offset+at,b=await block(Math.floor(pos/16384),true),within=pos%16384,n=Math.min(length-at,b.length-within);b.copy(bytes,at,within,within+n);at+=n;}
  return bytes;
 };
 const spk=await openSpk(read),header=await read(0,1024),little=header.toString('ascii',88,96)==='LTL-IEEE';
 const spec=Object.values(NATIVE_SYSTEMS).find(s=>s.kernel===id);
 const pairs=spec?spec.targets.map(t=>[spec.center,t]):[[0,3],[0,10],[3,301],[3,399],...Object.values(PLANET_IDS).map(t=>[0,t])];
 let fromJD=appStart,toJD=appEnd;
 if(id==='de441-part1')toJD=2287184.5+14;
 if(id==='de441-part2')fromJD=2688976.5-14;
 for(const [c,t] of pairs){
  const records=spk.segments.filter(s=>s.center===c&&s.target===t&&s.frame===1&&[2,3].includes(s.type));if(!records.length)throw new Error('Missing required native body '+id+' '+t);
  fromJD=Math.max(fromJD,2451545+Math.min(...records.map(s=>s.from))/86400);toJD=Math.min(toJD,2451545+Math.max(...records.map(s=>s.to))/86400);
 }
 for(const [c,t] of pairs){
  const segments=spk.segments.filter(s=>s.center===c&&s.target===t&&s.frame===1&&[2,3].includes(s.type)&&s.to>=(fromJD-2451545)*86400&&s.from<=(toJD-2451545)*86400);
  for(const s of segments){
   const trailer=await read((s.last-4)*8,32),v=new DataView(trailer.buffer,trailer.byteOffset,32),init=v.getFloat64(0,little),step=v.getFloat64(8,little),size=v.getFloat64(16,little),count=v.getFloat64(24,little);
   if(!(step>0)||!Number.isSafeInteger(size)||!Number.isSafeInteger(count)||size*count+4!==s.last-s.first+1)throw new Error('Invalid native record layout');
   const a=Math.max(0,Math.floor(((fromJD-2451545)*86400-init)/step)),z=Math.min(count,Math.floor(((toJD-2451545)*86400-init)/step)+1);
   if(z>a)mark((s.first-1+a*size)*8,(z-a)*size*8);
  }
 }
 const indices=[...wanted].sort((a,b)=>a-b),hashes=Buffer.alloc(Math.ceil(meta.bytes/CHUNK)*32),temp=path.join(cache,'chunks');await fs.mkdir(temp,{recursive:true});
 console.log(id+': preparing '+indices.length+' native chunks ('+Math.round(indices.length*CHUNK/1024**2)+' MiB)');
 // Fetch large origin blocks once, with six bounded preparation streams.
 const originBlocks=[...new Set(indices.map(i=>Math.floor(i*CHUNK/BLOCK)))];
 for(let n=0;n<originBlocks.length;n+=6)await Promise.all(originBlocks.slice(n,n+6).map(async index=>{
  const bytes=await block(index);
  for(const i of indices.filter(i=>Math.floor(i*CHUNK/BLOCK)===index)){
   const chunk=bytes.subarray(i*CHUNK%BLOCK,Math.min(bytes.length,i*CHUNK%BLOCK+CHUNK));
   Buffer.from(sha(chunk),'hex').copy(hashes,i*32);await fs.writeFile(path.join(temp,String(i).padStart(6,'0')+'.bin'),chunk);
  }
 }));
 const indexSha256=sha(hashes),prefix='kernels/'+id+'-'+indexSha256;
 await fs.mkdir(path.join(out,prefix),{recursive:true});
 for(const i of indices){const name=String(i).padStart(6,'0')+'.bin';try{await fs.copyFile(path.join(temp,name),path.join(out,prefix,name),constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}}
 try{await fs.writeFile(path.join(out,prefix,'index.bin'),hashes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
 manifest.kernels[id]={path:prefix,bytes:meta.bytes,chunkBytes:CHUNK,indexBytes:hashes.length,indexSha256,partial:true,publishedMd5,source:ROOT+source,sourceRevision:meta.etag||meta.lastModified,fromJD,toJD,hostedChunks:indices.length};
 console.log('Prepared '+id+'; native date interval '+fromJD+'–'+toJD);
 await fs.writeFile(path.join(cacheDir,'prepared-catalogue.json'),JSON.stringify(manifest,null,2));
}
const entries=await fs.readdir(out,{recursive:true});if(entries.length+500>20000)throw new Error('Combined deployment would exceed the Free asset count; catalogue not published');
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const headersPath=path.join(old,'_headers'),headers=await fs.readFile(headersPath,'utf8');
if(!headers.includes('/v3/manifest.json'))await fs.writeFile(headersPath,headers+'\n/v3/kernels/*\n  Cache-Control: public, max-age=31536000, immutable\n/v3/iers/*\n  Cache-Control: public, max-age=31536000, immutable\n/v3/manifest.json\n  Cache-Control: public, max-age=3600\n');
console.log(JSON.stringify({status:'Native catalogue prepared',output:out,kernels:Object.keys(manifest.kernels),assetsIncludingDirectories:entries.length},null,2));
