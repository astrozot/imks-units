import assert from 'node:assert/strict';
import { equatorial, topocentric, surfaceObserver, barycentricObserver, heliocentric, centuries, aspect } from '../js/astro.js';
import { skyFrame, createSkyAnimator, objectDetails, planetMoons, skyChart } from '../js/coelum.js';
import { makePrecisionEphemeris } from '../js/precisionephem.js';
const t=Date.parse('2026-11-19T21:00:00Z')/1000;
const geo=[41.9,12.5,0,'geocentric'], bary=[41.9,12.5,0,'barycentric'];
const vector=p=>[Math.cos(p.dec*Math.PI/180)*Math.cos(p.ra*Math.PI/180),Math.cos(p.dec*Math.PI/180)*Math.sin(p.ra*Math.PI/180),Math.sin(p.dec*Math.PI/180)].map(x=>x*p.dist);
for(const body of ['sun','moon','mercury','venus','mars','jupiter','saturn','uranus','neptune',{ra:10,dec:20,plx:750,pmra:10}]) {
 assert.deepEqual(topocentric(body,t,geo),equatorial(body,t));
 const p=topocentric(body,t,bary);
 assert.ok(Object.values(p).every(Number.isFinite));
 assert.deepEqual(p,topocentric(body,t,[-70,-150,10000,'barycentric']),'Origin independent of reference latitude/longitude');
}
assert.deepEqual(surfaceObserver(t,geo),{position:[0,0,0],beta:[0,0,0]});
const T=centuries(t), [origin]=barycentricObserver(T);
assert.ok(Math.hypot(...origin)<.02&&Math.hypot(...origin)>.0001);
// A barycentric outer-planet ray plus the Sun-to-barycentre displacement
// recovers the heliocentric range; Earth-based Mars does not.
const mars=topocentric('mars',t,bary),sun=topocentric('sun',t,bary);
assert.ok(Math.abs(Math.hypot(...vector(mars).map((x,i)=>x-vector(sun)[i]))/149597870.7-Math.hypot(...heliocentric('mars',T)))<.001);
assert.ok(aspect('venus',t,bary).phase<2,'Inner planets appear nearly full from near the Sun');
for(const place of [geo,bary]) {
 const frame=skyFrame(t,place), animate=createSkyAnimator(t,place);
 if(place===bary){assert.deepEqual(frame.observer.position,[0,0,0]);assert.deepEqual(frame.observer.beta,[0,0,0]);}
 for(const o of frame.bodies) assert.ok(Number.isFinite(o.ra)&&Number.isFinite(o.dec)&&Number.isFinite(o.dist));
 assert.equal(skyChart(frame,360,360,{ground:true,milkyway:false}).svg,skyChart(frame,360,360,{ground:false,milkyway:false}).svg,'Special origins ignore a requested ground layer');
 const jupiter=frame.bodies.find(o=>o.body==='jupiter');
 assert.ok(planetMoons(frame,jupiter).every(o=>Number.isFinite(o.ra)&&Number.isFinite(o.dist)));
 const html=objectDetails(jupiter,frame);
 assert.ok(!html.includes('Altitude (Alt)')&&!html.includes('Azimuth (Az)'));
 for(const time of [t,t+30,t+86400]) {
  const animated=animate(time), exact=skyFrame(time,place);
  const a=animated.bodies.find(o=>o.body==='mars'),b=exact.bodies.find(o=>o.body==='mars');
  assert.ok(Math.abs(a.ra-b.ra)<.0001&&Math.abs(a.dec-b.dec)<.0001);
 }
}
// The barycentre can lie outside the Sun: its disk must still stay hidden,
// including selection and labels during playback.
for (const year of [2000,2010,2020,2030]) {
 const time=Date.UTC(year,0,1)/1000, frame=skyFrame(time,bary), animate=createSkyAnimator(time,bary);
 assert.equal(frame.bodies[0].hidden,true);
 assert.equal(animate(time+30).bodies[0].hidden,true);
 const chart=skyChart(frame,360,360,{ground:true,milkyway:false},{selected:'Sun',revealed:new Set(['Sun'])});
 assert.ok(!chart.objects.some(o=>o.body==='sun'));
}
// An artificial barycentric kernel makes origin handling independently
// observable: the precision ray must start at zero rather than at Earth.
const pack={orientation:()=>null,native:(a,b)=>({position:b===10?[1000000,0,0]:b===3?[150000000,0,0]:b===399?[0,0,0]:[200000000,100000000,0],velocity:[0,0,0]}),has:(a)=>a===0};
const ephem=makePrecisionEphemeris(pack);
assert.deepEqual(ephem.topocentric('mars',t,geo),ephem.equatorial('mars',t));
assert.ok(Math.abs(ephem.topocentric('mars',t,bary).dist-Math.hypot(200000000,100000000))<1);
console.log('Special observer origins, distances, stellar positions, moons, playback and precision origins passed');
