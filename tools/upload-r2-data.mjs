// Requires Wrangler login and an R2-enabled account. Explicitly run only
// after reviewing the staged manifest and the bucket name.
// node tools/upload-r2-data.mjs astrolabium-data /path/to/staged-data
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFileSync} from 'node:child_process';
const [bucket,dir]=process.argv.slice(2);
if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket||'')||!dir)throw new Error('Usage: node tools/upload-r2-data.mjs bucket staged-directory');
const m=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
if(m.version!==1||!m.kernels?.de440||Object.keys(m.kernels).length!==1)throw new Error('The first pilot must contain only DE440 and IERS data');
const objects=[m.kernels.de440,m.earthOrientation];
for(const d of objects){
 if(!d||! /^(kernels|iers)\/[a-zA-Z0-9._-]+$/.test(d.path)||!d.path.includes(d.sha256))throw new Error('Invalid staged object');
 let bytes=0;const h=crypto.createHash('sha256');for await(const b of createReadStream(path.join(dir,d.path))){bytes+=b.length;h.update(b);}
 if(bytes!==d.bytes||h.digest('hex')!==d.sha256)throw new Error('Staged data failed verification; nothing has been uploaded');
}
const run=args=>execFileSync('npx',['wrangler',...args],{stdio:'inherit'});
// Publish the manifest last, so it never advertises an incomplete upload.
for(const d of objects)run(['r2','object','put',`${bucket}/${d.path}`,'--file',path.join(dir,d.path),'--content-type',d.path.endsWith('.bsp')?'application/octet-stream':'text/plain','--cache-control','public, max-age=31536000, immutable','--remote']);
run(['r2','object','put',`${bucket}/manifest.json`,'--file',path.join(dir,'manifest.json'),'--content-type','application/json','--cache-control','public, max-age=3600','--remote']);
