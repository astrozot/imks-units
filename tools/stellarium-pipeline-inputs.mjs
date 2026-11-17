// Development inputs for the actual Stellarium desktop scripting pipeline.
// Usage: node tools/stellarium-pipeline-inputs.mjs staged-v3 output.json
import fs from 'node:fs/promises';
import path from 'node:path';
import {createStaticSession} from '../js/precisionstatic.js';
import {nativeEphemerisPack} from '../js/precisionnative.js';
import {readPrecisionPack} from '../js/precisionpack.js';
import {makePrecisionEphemeris} from '../js/precisionephem.js';
import {calculatePrecisionEvent} from '../js/precisionworker.js';
import {horizontal} from '../js/astro.js';
const [directory,output]=process.argv.slice(2),profiles=[];
const observers=[['Milan',[45.4642,9.19,120]],['Dallas',[32.7767,-96.797,130]],['Equator',[0,0,0]],['Tromso',[69.6492,18.9553,10]],['SouthPole',[-89.9,0,2800]]];
const allBodies=['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Phobos','Deimos','Io','Europa','Ganymede','Callisto','Mimas','Enceladus','Tethys','Dione','Rhea','Titan','Hyperion','Iapetus','Miranda','Ariel','Umbriel','Titania','Oberon','Triton'];
const definitions=[
 {id:'modern',stamp:'2024-04-08T18:42:00Z',bodies:allBodies,observers},
 {id:'historical',stamp:'1900-06-01T00:00:00Z',bodies:allBodies.slice(0,9),observers:[observers[0]]},
 {id:'future',stamp:'2099-06-01T00:00:00Z',bodies:allBodies.slice(0,9),observers:[observers[0]]},
 {id:'solar2017',stamp:'2017-08-21T18:21:00Z',bodies:['Sun','Moon'],observers:[['Carbondale',[37.7273,-89.2168,126]]],event:{kind:'solar'}},
 {id:'lunar2025',stamp:'2025-03-14T06:59:00Z',bodies:['Sun','Moon'],observers:[observers[0]],event:{kind:'lunar'}},
 {id:'venusOccultation',stamp:'2023-11-09T10:00:00Z',bodies:['Moon','Venus'],observers:[observers[0]],event:{kind:'occultation',target:'venus',front:'moon'}},
];
for(const definition of definitions){
 const t=Date.parse(definition.stamp)/1000,rows=[];let clock;
 for(const body of definition.bodies){
  const session=await createStaticSession('https://native.test/',()=>{},undefined,async u=>new Response(await fs.readFile(path.join(directory,new URL(u).pathname))));
  const job={kind:'position',body:body.toLowerCase(),t,place:definition.observers[0][1]},pack=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read)),e=makePrecisionEphemeris(pack);clock=e.clock(t);
  const control=makePrecisionEphemeris({...pack,native:(c,b,jd)=>c>=4&&b===c*100+99?{position:[0,0,0],velocity:[0,0,0]}:pack.native(c,b,jd)});
  for(const [name,place] of definition.observers)for(const topocentric of [false,true]){
   if(!topocentric&&name!==definition.observers[0][0])continue;
   const position=topocentric?{...e.topocentric(job.body,t,place),...horizontal(job.body,t,place,e)}:e.equatorial(job.body,t);
   const barycentre=topocentric?control.topocentric(job.body,t,place):control.equatorial(job.body,t);
   rows.push({body,observer:name,place,topocentric,position,barycentre});
  }
  session.dispose();
 }
 const profile={id:definition.id,t,stamp:definition.stamp,clock:{utcJD:clock.utcJD,ttJD:clock.ttJD,tdbJD:clock.tdbJD,ut1JD:clock.ut1JD,eop:clock.eop},rows,events:[]};
 const event=definition.event||(definition.id==='modern'?{kind:'solar'}:null);
 if(event){
  const place=definition.id==='modern'?observers[1][1]:definition.observers[0][1],job={...event,t,place},session=await createStaticSession('https://native.test/',()=>{},undefined,async u=>new Response(await fs.readFile(path.join(directory,new URL(u).pathname))));
  const pack=readPrecisionPack(await nativeEphemerisPack(job,session.descriptors,session.read)),r=await calculatePrecisionEvent(job,pack);profile.events.push({job,result:r.event});session.dispose();
 }
 profiles.push(profile);
}
await fs.writeFile(output,JSON.stringify({source:'Current native application pipeline; exact staged JPL chunks',profiles},null,2)+'\n');console.log(profiles.map(p=>[p.id,p.rows.length,p.events.map(e=>e.result?.kind)]));
