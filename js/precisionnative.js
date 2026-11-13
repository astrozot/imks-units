// All native SPK indexing, extraction and numerical work runs in the
// calculation worker. Byte I/O is delegated to the page's bounded cache.
import {openSpk,encodeSpkPack} from './spk.js';
import {PLANET_IDS as PLANETS,NATIVE_SYSTEMS as SYSTEMS,NATIVE_MOONS,systemOf,selectNativeKernel} from './precisioncatalog.js';
import {deltaT} from './astro.js';
const BASE_PAIRS=[[0,3],[0,10],[3,301],[3,399]];
export async function nativeEphemerisPack(job,descriptors,read,progress=()=>{}){
  if(!Number.isFinite(job.t)||!descriptors.de440)throw new Error('Native planetary data is unavailable');
  const names=[...new Set([job.body,job.front,job.target].filter(b=>typeof b==='string').map(b=>b.toLowerCase()))];
  const bodies=names.filter(b=>Object.hasOwn(PLANETS,b));
  const day=Math.floor(job.t/86400)+2440587.5,year=new Date(job.t*1000).getUTCFullYear();
  const tt=job.t/86400+2440587.5+deltaT(year)/86400;
  // A position needs only a short light-time window, particularly for
  // quickly sampled satellite records. Events retain their contact window.
  let fromJD=job.kind==='position'?tt-.6:day-2,toJD=job.kind==='position'?tt+.05:day+3;
  const selected=selectNativeKernel(descriptors,tt,{fromJD,toJD});
  const requiredFrom=job.kind==='position'?tt:day,requiredTo=job.kind==='position'?tt+.001:day+1;
  const pairs=BASE_PAIRS.filter(([,target])=>!['position','moon-events'].includes(job.kind)||target!==301||names.includes('moon')).map(x=>x.slice());
  for(const body of new Set([...(job.system?[job.system]:[]),...bodies,...names.filter(b=>NATIVE_MOONS[b]).map(systemOf)]))pairs.push([0,PLANETS[body]]);
  const groups=[{id:selected.id,pairs}],systems=new Set([...bodies.filter(b=>SYSTEMS[b]),...names.filter(b=>NATIVE_MOONS[b]).map(systemOf),...(job.system?[job.system]:[])]);
  for(const name of systems){
    const spec=SYSTEMS[name],d=descriptors[spec?.kernel],moons=names.filter(b=>systemOf(b)===name);
    const available=d&&(!Number.isFinite(d.fromJD)||fromJD>=d.fromJD)&&(!Number.isFinite(d.toJD)||toJD<=d.toJD);
    if(!available){if(moons.length||job.system===name)throw new RangeError('Native data for this satellite system has not been installed for this date');continue;}
    const targets=job.system===name?spec.targets:[...(bodies.includes(name)?[spec.center*100+99]:[]),...moons.map(b=>NATIVE_MOONS[b][1])];
    groups.push({id:spec.kernel,pairs:[...new Set(targets)].map(target=>[spec.center,target])});
  }
  progress('Reading native ephemeris records…');
  for(const group of groups){
    group.spk=await openSpk((offset,length)=>read(group.id,offset,length));
    for(const [center,target] of group.pairs){
      const matches=group.spk.segments.filter(s=>s.center===center&&s.target===target&&s.frame===1&&[2,3].includes(s.type));
      if(!matches.length)throw new RangeError('This body is not present in the installed kernel');
      fromJD=Math.max(fromJD,2451545+Math.min(...matches.map(s=>s.from))/86400);toJD=Math.min(toJD,2451545+Math.max(...matches.map(s=>s.to))/86400);
    }
  }
  if(fromJD>requiredFrom||toJD<requiredTo)throw new RangeError('This date is outside the installed kernel coverage');
  const records=[];for(const group of groups)for(let i=0;i<group.pairs.length;i+=3)records.push(...await Promise.all(group.pairs.slice(i,i+3).map(([c,t])=>group.spk.extract(c,t,fromJD,toJD))));
  let orientation=[];
  if(descriptors.iers){
    const first=new TextDecoder().decode(await read('iers',0,188)),mjd=Number(first.slice(7,15)),begin=Math.max(0,Math.floor(fromJD-2400000.5-mjd)-1),count=Math.ceil(toJD-fromJD)+4;
    if(first[187]==='\n'&&Number.isFinite(mjd)&&fromJD>=mjd+2400000.5&&(begin+count)*188<=descriptors.iers.bytes){
      const rows=new TextDecoder().decode(await read('iers',begin*188,count*188)).split('\n');
      for(let i=0;i<rows.length-1;i++){
        const fields=[rows[i].slice(7,15),rows[i].slice(18,27),rows[i].slice(37,46),rows[i].slice(58,68)];if(fields.some(x=>!x.trim()))continue;
        const [jd,x,y,u]=fields.map(Number);if(jd!==mjd+begin+i||![x,y,u].every(Number.isFinite)||Math.abs(x)>5||Math.abs(y)>5||Math.abs(u)>2)throw new Error('Invalid Earth-orientation row');
        orientation.push([jd+2400000.5,x,y,u]);
      }
    }
  }
  return encodeSpkPack(records,{source:selected.source,native:true,transport:job.transport||'r2',year:new Date(job.t*1000).getUTCFullYear(),fromJD,toJD,kernels:groups.map(g=>({id:g.id,...descriptors[g.id]})),created:new Date().toISOString()},orientation);
}
