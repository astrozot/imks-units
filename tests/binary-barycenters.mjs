import assert from 'node:assert/strict';
import {BINARY_SYSTEMS} from '../js/binarydata.js';
import {binaryState,binaryBarycentreState} from '../js/starmotion.js';
import {skyFrame,createSkyAnimator,skyObjectAt,findObject,searchSky,skyChart,lookAt,pointVector,vec,unit3,dot3} from '../js/coelum.js';
import {trajectoryCoordinates,relativeTrajectoryVector} from '../js/skytrajectory.js';
const t=Date.parse('2026-11-20T00:00Z')/1000,place=[41.9,12.5,0,'barycentric'],frame=skyFrame(t,place),play=createSkyAnimator(t,place);
const angle=(a,b)=>Math.hypot(...unit3(a).map((x,i)=>x-unit3(b)[i]))*206264.806;
assert.equal(frame.barycenters.length,BINARY_SYSTEMS.length);
for(const s of BINARY_SYSTEMS){
 const center=findObject(frame,`${s.name} barycenter`);
 assert.ok(center);assert.equal(searchSky(frame,`${s.components[0].name} barycenter`)[0].name,center.name);
 for(const jd of [2451545,2461000,2500000]){
  const [a,b]=s.components.map(c=>binaryState(c.id,jd).vector),total=s.masses[0]+s.masses[1];
  const expected=a.map((x,i)=>(s.masses[0]*x+s.masses[1]*b[i])/total);
  assert.ok(angle(binaryBarycentreState(s.components[0].id,jd).vector,expected)<1e-7);
 }
 for(const dt of [0,30,86401,315576000,-315576000]){
  const historical=skyObjectAt(center,t+dt,place),exact=findObject(play(t+dt),center.name);
  assert.ok(angle(vec(historical.ra,historical.dec),vec(exact.ra,exact.dec))<1e-7);
 }
}
const center=findObject(frame,'Toliman barycenter'),star=findObject(frame,'Toliman');
const chart=skyChart(frame,600,600,{milkyway:false},{scale:1e5,rotation:lookAt(center.az,center.alt),selected:center.name,tracked:star.name});
assert.ok(chart.objects.some(o=>o.name===center.name));
assert.match(chart.svg,/stroke="#888888"/);assert.match(chart.svg,/<path[^>]*stroke="#ff5555"/);
// Historical object evaluation matches the live catalogue for all supported
// stellar types and ordinary solar-system bodies, including surface origins.
for(const origin of [place,[41.9,12.5,20]]){
 const f=skyFrame(t,origin);
 for(const name of ['Toliman','Rigil Kentaurus',"Barnard's Star",'Andromeda','Moon','Mars','Io']){
  const o=findObject(f,name);if(!o)continue;
  const past=skyObjectAt(o,t-100000,origin),exact=findObject(skyFrame(t-100000,origin),name);
  assert.ok(angle(vec(past.ra,past.dec),vec(exact.ra,exact.dec))<.001,`${name}: historical reference parity`);
 }
}
// Reference transport must fix the reference itself and preserve separation,
// including the antipodal case; no subtraction of non-unit angular vectors.
for(const from of [[1,0,0],[0,1,0]])for(const to of [[-1,0,0],[0,0,1],[1,0,0]]){
 const target=unit3([.7,.2,.1]),p=relativeTrajectoryVector(target,from,to);
 assert.ok(Math.abs(dot3(target,from)-dot3(p,to))<1e-12);
 assert.ok(angle(relativeTrajectoryVector(from,from,to),to)<1e-7);
}
console.log('Binary barycenters, search/picking crosses, historical references and spherical relative trajectories passed');
