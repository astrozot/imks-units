// Astrolabium's bounded native-SPK extraction service. No complete kernel
// enters a Worker or a phone; only official, allowlisted byte ranges do.
import { openSpk, encodeSpkPack } from '../../js/spk.js';
import { KERNELS, SYSTEMS } from './kernels.js';
const BLOCK = 16384, MAX_FILE = 512 * 1024, EOP = 'https://maia.usno.navy.mil/ser7/finals2000A.all';
const BASE_PAIRS = [[0,3],[0,10],[3,301],[3,399]];
const PLANETS = {mercury:1,venus:2,mars:4,jupiter:5,saturn:6,uranus:7,neptune:8};
const hex = (buffer) => Array.from(new Uint8Array(buffer), x=>x.toString(16).padStart(2,'0')).join('');

async function bodyBytes(response, limit) {
  if (Number(response.headers.get('Content-Length')) > limit) { await response.body?.cancel(); throw new Error('Upstream ignored the byte-range limit'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Upstream has no readable body');
  const chunks=[];let n=0;
  try {
    for (;;) { const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit)throw new Error('Upstream exceeded the byte-range limit');chunks.push(value); }
  } catch(error) {await reader.cancel().catch(()=>{});throw error;} finally {reader.releaseLock();}
  const bytes=new Uint8Array(n);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}

export function sourceReader(url, { fetcher = fetch, cache = null, origin = 'https://astrolabium.invalid', signal, budget = { left: 40 } } = {}) {
  const resident = new Map(); let total = null, modified = null;
  async function block(index) {
    if(resident.has(index)){const b=resident.get(index);resident.delete(index);resident.set(index,b);return b;}
    const offset=index*BLOCK, key=new Request(`${origin}/__spk/${encodeURIComponent(url)}/${index}`);
    const saved = await cache?.match(key); let response = saved;
    if(!response) {
      if(--budget.left<0)throw new Error('Upstream request budget exceeded');
      const headers={Range:`bytes=${offset}-${offset+BLOCK-1}`};if(modified)headers['If-Range']=modified;
      response=await fetcher(url,{headers,signal,redirect:'error'});
      if(response.status!==206){await response.body?.cancel();throw new Error('Upstream byte-range download unavailable');}
    }
    const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');
    const stamp=response.headers.get('Last-Modified');
    if(!range || +range[1]!==offset || +range[2]!==Math.min(offset+BLOCK,+range[3])-1 || !Number.isSafeInteger(+range[3]) || +range[3]<=0 || !stamp || total!==null&&total!==+range[3] || modified!==null&&modified!==stamp) {await response.body?.cancel();throw new Error('Inconsistent upstream kernel revision or byte range');}
    total=+range[3];modified=stamp;
    const bytes=await bodyBytes(response,BLOCK);
    if(bytes.length!==+range[2]-offset+1)throw new Error('Truncated upstream byte range');
    if(cache && !saved) {
      // Store each complete chunk as 200: Cache API does not accept 206.
      const stored=new Response(bytes,{headers:{'Content-Range':response.headers.get('Content-Range'),'Last-Modified':stamp,'Cache-Control':'public, max-age=86400','Content-Length':String(bytes.length)}});
      await cache.put(key,stored).catch(()=>{});
    }
    resident.set(index,bytes);while(resident.size>4)resident.delete(resident.keys().next().value);
    return bytes;
  }
  const read=async(offset,length)=>{
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>MAX_FILE)throw new RangeError('Invalid bounded byte read');
    const out=new Uint8Array(length);let copied=0;
    while(copied<length){const pos=offset+copied,b=await block(Math.floor(pos/BLOCK)),within=pos%BLOCK,n=Math.min(length-copied,b.length-within);if(n<=0)throw new RangeError('Read beyond source kernel');out.set(b.subarray(within,within+n),copied);copied+=n;}
    return out;
  };
  return { read, metadata:()=>({url,bytes:total,lastModified:modified}) };
}

async function earthOrientation(from,to,options) {
  try {
    const source=sourceReader(EOP,options), first=await source.read(0,188), text=new TextDecoder().decode(first), mjd=Number(text.slice(7,15));
    if(!Number.isFinite(mjd)||text[187]!=='\n'||from<2400000.5+mjd)return [];
    const begin=Math.max(0,Math.floor(from-2400000.5-mjd)-1), count=Math.ceil(to-from)+4;
    if((begin+count)*188>source.metadata().bytes)return [];
    const rows=new TextDecoder().decode(await source.read(begin*188,count*188)).split('\n'), result=[];
    for(let i=0;i<rows.length-1;i++){
      const line=rows[i], fields=[line.slice(7,15),line.slice(18,27),line.slice(37,46),line.slice(58,68)];
      if(fields.some(x=>!x.trim()))continue;
      const [day,xp,yp,dut1]=fields.map(Number);
      if(day!==mjd+begin+i||![xp,yp,dut1].every(Number.isFinite)||Math.abs(xp)>5||Math.abs(yp)>5||Math.abs(dut1)>2)throw new Error('Invalid IERS daily row');
      result.push([day+2400000.5,xp,yp,dut1]);
    }
    return result;
  } catch(error) {if(options.signal?.aborted)throw error;return [];}
}

export async function buildPack({day,model='de440',system=null,bodies=[]}, options={}) {
  if(!Number.isFinite(day)||day-Math.floor(day)!==.5||day< -4000000||day>10000000||!['de440','de440s','de441-part1','de441-part2'].includes(model)||system&&!Object.hasOwn(SYSTEMS,system)||!Array.isArray(bodies)||bodies.length>2||bodies.some(b=>typeof b!=='string'||!Object.hasOwn(PLANETS,b))) throw new RangeError('Invalid ephemeris day, model or satellite system');
  const pairs=BASE_PAIRS.map(p=>p.slice());
  for(const body of new Set([...bodies,...(system?[system]:[])]))pairs.push([0,PLANETS[body]]);
  const budget={left:40}, sources=[], groups=[{kernel:model,pairs}], records=[];
  if(system){const s=SYSTEMS[system];groups.push({kernel:s.kernel,pairs:s.targets.map(id=>[s.center,id])});}
  let fromJD=day-2,toJD=day+3;
  for(const group of groups){
    const source=sourceReader(KERNELS[group.kernel],{...options,budget}), spk=await openSpk(source.read);
    sources.push({id:group.kernel,source,spk,pairs:group.pairs});
    for(const [center,target] of group.pairs){
      const matches=spk.segments.filter(s=>s.center===center&&s.target===target&&s.frame===1&&[2,3].includes(s.type));
      if(!matches.length)throw new RangeError(`No native source for ${center} → ${target}`);
      fromJD=Math.max(fromJD,2451545+Math.min(...matches.map(s=>s.from))/86400);
      toJD=Math.min(toJD,2451545+Math.max(...matches.map(s=>s.to))/86400);
    }
  }
  if(fromJD>day||toJD<day+1)throw new RangeError('Requested date is outside this combination of kernel coverages');
  for(const {spk,pairs} of sources)for(let i=0;i<pairs.length;i+=3)records.push(...await Promise.all(pairs.slice(i,i+3).map(([center,target])=>spk.extract(center,target,fromJD,toJD))));
  const orientation=await earthOrientation(fromJD,toJD,{...options,budget});
  return encodeSpkPack(records,{source:model==='de440s'?'DE440s':model==='de440'?'DE440':'DE441',year:new Date((day-2440587.5)*86400000).getUTCFullYear(),fromJD,toJD,native:true,kernels:sources.map(s=>({id:s.id,...s.source.metadata()})),earthOrientation:orientation.length?'IERS finals2000A observations/predictions':'Modelled ΔT; IERS data unavailable for this interval',created:new Date().toISOString()},orientation);
}

export default {
  async fetch(request, env={}, ctx={waitUntil(){}}) {
    const url=new URL(request.url), allowed=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean), origin=request.headers.get('Origin');
    const headers={'Access-Control-Allow-Origin':origin&&allowed.includes(origin)?origin:'null','Vary':'Origin','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Expose-Headers':'X-Ephemeris-SHA256, ETag'};
    if(origin&&!allowed.includes(origin))return new Response('Origin not allowed',{status:403,headers});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers});
    if(url.pathname==='/health')return Response.json({service:'Astrolabium ephemeris',version:1},{headers});
    if(url.pathname!=='/v1/pack')return new Response('Not found',{status:404,headers});
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),25000);
    try {
      if([...url.searchParams.keys()].some(k=>!['day','model','system','body'].includes(k)))throw new RangeError('Unknown query parameter');
      const buffer=await buildPack({day:Number(url.searchParams.get('day')),model:url.searchParams.get('model')||'de440',system:url.searchParams.get('system')||null,bodies:(url.searchParams.get('body')||'').split(',').filter(Boolean)},{fetcher:env.fetcher||fetch,cache:env.cache||globalThis.caches?.default,origin:url.origin,signal:controller.signal});
      const digest=hex(await crypto.subtle.digest('SHA-256',buffer));
      return new Response(buffer,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(buffer.byteLength),'X-Ephemeris-SHA256':digest,'ETag':`"${digest}"`,'Cache-Control':'public, max-age=86400'}});
    } catch(error) {return Response.json({error:error.message},{status:error instanceof RangeError?422:502,headers});}
    finally {clearTimeout(timeout);}
  },
};
