// All native SPK indexing, extraction and numerical work runs in the
// calculation worker. Byte I/O is delegated to the page's bounded cache.
import {openSpk,encodeSpkPack} from './spk.js';
const BASE_PAIRS=[[0,3],[0,10],[3,301],[3,399]],PLANETS={mercury:1,venus:2,mars:4,jupiter:5,saturn:6,uranus:7,neptune:8};
const SYSTEMS={mars:['mar099',4,[499,401,402]],jupiter:['jup365',5,[599,501,502,503,504]],saturn:['sat441',6,[699,601,602,603,604,605,606,607,608]],uranus:['ura184',7,[799,705,701,702,703,704]],neptune:['nep097',8,[899,801]]};
export async function nativeEphemerisPack(job,descriptors,read,progress=()=>{}){
  if(!Number.isFinite(job.t)||!descriptors.de440)throw new Error('Native DE440 data is unavailable');
  const bodies=[...new Set([job.body,job.front,job.target].filter(b=>typeof b==='string'&&Object.hasOwn(PLANETS,b)))];
  const wanted=job.system||bodies.find(b=>Object.hasOwn(SYSTEMS,b));
  const system=wanted&&descriptors[SYSTEMS[wanted]?.[0]]?SYSTEMS[wanted]:null;
  if(job.system&&!system)throw new Error('Native data for this satellite system has not been installed');
  const pairs=BASE_PAIRS.map(x=>x.slice());for(const body of new Set([...bodies,...(system?[wanted]:[])]))pairs.push([0,PLANETS[body]]);
  const groups=[{id:'de440',pairs}];if(system)groups.push({id:system[0],pairs:system[2].map(target=>[system[1],target])});
  const day=Math.floor(job.t/86400)+2440587.5;let fromJD=day-2,toJD=day+3;
  progress('Reading native ephemeris records…');
  for(const group of groups){
    group.spk=await openSpk((offset,length)=>read(group.id,offset,length));
    for(const [center,target] of group.pairs){
      const matches=group.spk.segments.filter(s=>s.center===center&&s.target===target&&s.frame===1&&[2,3].includes(s.type));
      if(!matches.length)throw new RangeError('This body is not present in the installed kernel');
      fromJD=Math.max(fromJD,2451545+Math.min(...matches.map(s=>s.from))/86400);toJD=Math.min(toJD,2451545+Math.max(...matches.map(s=>s.to))/86400);
    }
  }
  if(fromJD>day||toJD<day+1)throw new RangeError('This date is outside the installed kernel coverage');
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
  return encodeSpkPack(records,{source:'DE440',native:true,transport:job.transport||'r2',year:new Date(job.t*1000).getUTCFullYear(),fromJD,toJD,kernels:groups.map(g=>({id:g.id,...descriptors[g.id]})),created:new Date().toISOString()},orientation);
}
