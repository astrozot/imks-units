// Barycentric stellar motion must contain space motion and the binary orbit,
// with no observer-side solar correction as the Sun moves around the origin.
import assert from 'node:assert/strict';
import {skyFrame,createSkyAnimator,findObject,vec,galacticCoordinates} from '../js/coelum.js';
import {binaryState} from '../js/starmotion.js';
import {topocentric} from '../js/astro.js';
import {findObject as lookup} from '../js/lookup.js';
const start=Date.parse('2026-11-20T00:00:00Z')/1000,place=[41.9,12.5,0,'barycentric'];
const arcsec=180/Math.PI*3600,unit=v=>v.map(x=>x/Math.hypot(...v));
const error=(a,b)=>Math.hypot(...unit(a).map((x,i)=>x-unit(b)[i]))*arcsec;
const inertial=(p,matrix)=>matrix.map(col=>col.reduce((sum,x,i)=>sum+x*vec(p.ra,p.dec)[i],0));
const play=createSkyAnimator(start,place);
let maximumError=0,maximumStationaryDrift=0,reference;
// Quarterly samples through a full Alpha Centauri orbit, in both directions;
// this spans several Sun/barycentre cycles that previously caused the bumps.
for(let k=0;k<=640;k++){
 const time=start+(k<=320?k:640-k)*365.25*86400/4,frame=play(time),jd=2451545+frame.years*365.25;
 for(const name of ['Rigil Kentaurus','Toliman']){
  const star=findObject(frame,name),expected=binaryState(star.binary,jd).vector;
  const e=error(inertial(star,frame.matrix),expected);maximumError=Math.max(maximumError,e);
  assert.ok(e<1e-6,`${name}: ${e} arcsec from unperturbed space motion + Kepler orbit`);
  // Calculator and chart must use the same astrometric origin.
  if(k%16===0){
   const p=topocentric(lookup({},name),time,place);
   assert.ok(error(vec(p.ra,p.dec),vec(star.ra,star.dec))<.001);
  }
 }
 const fixed=frame.apparentCatalog(219.86,-60.83),g=galacticCoordinates(fixed,frame),v=vec(g.lon,g.lat);
 reference??=v;const drift=error(v,reference);maximumStationaryDrift=Math.max(maximumStationaryDrift,drift);
 assert.ok(drift<1e-6,`A star with no space motion must stay fixed in Galactic coordinates: ${drift} arcsec`);
 assert.equal(frame.observer.deflection.strength,0);
}
// Non-barycentric views still include physical solar deflection.
assert.ok(skyFrame(start,[41.9,12.5,0,'geocentric']).observer.deflection.strength>0);
console.log({maximumBinaryErrorArcsec:maximumError,maximumStationaryDriftArcsec:maximumStationaryDrift});
