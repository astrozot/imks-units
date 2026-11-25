import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BINARY_SYSTEMS } from '../js/binarydata.js';
import { spaceVector, stellarState, binaryState, relativeOrbit, binaryMotionStats } from '../js/starmotion.js';
import { skyFrame, createSkyAnimator, findObject, eachFaint, pointVector, setFaintStars, readStars, objectDetails } from '../js/coelum.js';
import { findObject as lookup } from '../js/lookup.js';
import { horizontal, topocentric } from '../js/astro.js';
import { nativeEphemerisPack } from '../js/precisionnative.js';
import { readPrecisionPack } from '../js/precisionpack.js';
import { makePrecisionEphemeris } from '../js/precisionephem.js';
const fixture = JSON.parse(fs.readFileSync(new URL('fixtures/space-motion.json', import.meta.url)));
const published = JSON.parse(fs.readFileSync(new URL('fixtures/binary-orbits.json', import.meta.url)));
const arcsec = 180 / Math.PI * 3600;
const unit = (v) => { const r = Math.hypot(...v); return v.map(x => x / r); };
const angle = (a,b) => 2 * Math.asin(Math.min(1, Math.hypot(...unit(a).map((x,i)=>x-unit(b)[i])) / 2)) * arcsec;
let maxMotion = 0, maxOrbit = 0;
for (const { star:s, years, direction } of fixture.stars) {
  const v = spaceVector(s.ra,s.dec,s.pmra,s.pmdec,s.plx,s.rv,years), error = angle(v,direction);
  maxMotion = Math.max(maxMotion,error);
  assert.ok(error < .00001, `${error} arcsec vs ERFA pmpx`);
}
// Radial motion alone changes distance, not direction. Missing distance or
// velocity must not introduce a fictitious perspective correction.
assert.ok(angle(spaceVector(20,30,0,0,100,100,1000),spaceVector(20,30))<1e-9);
assert.deepEqual(spaceVector(20,30,50,100,0,100,1000),spaceVector(20,30,50,100,0,null,1000));
assert.deepEqual(spaceVector(20,30,50,100,100,NaN,1000),spaceVector(20,30,50,100,100,null,1000));
assert.ok(spaceVector(20,90,50,100,100,-100,1000).every(Number.isFinite));
for (const r of fixture.orbits) {
  const s=BINARY_SYSTEMS.find(s=>s.name===r.name), v=relativeOrbit(s,r.jd);
  const error=Math.hypot(...v.map((x,i)=>x-r.relative[i])); maxOrbit=Math.max(maxOrbit,error);
  assert.ok(error<1e-9, `${r.name}: independent true-anomaly orbit ${error} arcsec`);
}
assert.equal(BINARY_SYSTEMS.length,20);
assert.equal(fixture.orbits.length,BINARY_SYSTEMS.length*6,'Every binary has independent numerical references');
for(const name of ['Castor','Procyon','70 Ophiuchi','μ Cassiopeiae','β Coronae Borealis','80 Tauri'])assert.ok(BINARY_SYSTEMS.some(s=>s.name===name));
// Independent catalogue anchors: Hipparcos I/239 distinguishes component A
// from the centre of mass; Gaia DR3 positions have a J2016 reference epoch.
{
  const castor=BINARY_SYSTEMS.find(s=>s.name==='Castor');
  assert.equal(castor.barycentre.epoch,2448349.0625);
  assert.ok(angle(binaryState(castor.components[0].id,2448349.0625).vector,spaceVector(113.65001898,31.88863645))<1e-7);
  const procyon=BINARY_SYSTEMS.find(s=>s.name==='Procyon').barycentre;
  assert.deepEqual([procyon.epoch,procyon.ra,procyon.dec,procyon.pmra,procyon.pmdec],[2448349.0625,114.82724194,5.22750767,-716.57,-1034.58]);
  const oph=BINARY_SYSTEMS.find(s=>s.name==='70 Ophiuchi');
  assert.equal(oph.barycentre.epoch,2457389);
  for(const [i,ra,dec]of [[0,271.364453818457,2.495224095912567],[1,271.36591160903725,2.4941987580927343]])
    assert.ok(angle(binaryState(oph.components[i].id,2457389).vector,spaceVector(ra,dec))<.025,'ORB6 components agree with independent Gaia DR3 positions at their actual epoch');
  const hip=JSON.parse(fs.readFileSync(new URL('../data/binary-hipparcos-sources.json',import.meta.url)));
  for(const [name,id,masses,parallax,rv] of [
    ['μ Cassiopeiae','5336',[.7440,.1728],132.66,-97.4],
    ['β Coronae Borealis','75695',[1.71,1.330],29.31,null],
  ]){
    const system=BINARY_SYSTEMS.find(s=>s.name===name),b=system.barycentre,r=hip.records[id];
    assert.equal(r.AstroRef,'+');assert.equal(r.MultFlag,'O');
    assert.deepEqual([b.epoch,b.ra,b.dec,b.pmra,b.pmdec],[2448349.0625,+r.RAICRS,+r.DEICRS,+r.pmRA,+r.pmDE]);
    assert.deepEqual(system.masses,masses);assert.equal(b.distance,1000/parallax);assert.equal(b.rv,rv);
    const [a,c]=system.components.map(c=>binaryState(c.id,b.epoch).vector),mean=a.map((v,k)=>(v*masses[0]+c[k]*masses[1])/(masses[0]+masses[1]));
    assert.ok(angle(mean,spaceVector(+r.RAICRS,+r.DEICRS))<1e-7,'Published absolute anchor is the centre of mass');
  }
  assert.equal(BINARY_SYSTEMS.find(s=>s.name==='Procyon').components[1].mag,10.8);
  assert.equal(BINARY_SYSTEMS.find(s=>s.name==='μ Cassiopeiae').components[1].mag,10.7);
  const tau=BINARY_SYSTEMS.find(s=>s.name==='80 Tauri'),b=tau.barycentre;
  assert.deepEqual([b.epoch,b.pmra,b.pmdec,b.rv],[2457389,106.41,-25.72,null]);
  assert.equal(b.distance,1000/20.984);assert.deepEqual(tau.masses,[1.63,1.11]);
  for(const [i,ra,dec] of [[0,67.53632737173,15.63773609543],[1,67.53644292906,15.63813853583]])
    assert.ok(angle(binaryState(tau.components[i].id,b.epoch).vector,spaceVector(ra,dec))<.015,'80 Tau absolute components agree with independent Gaia DR3 positions at J2016.0');
}
for (const s of BINARY_SYSTEMS) {
  // Check externally published separations and PA. USNO rounds PA to 0.1°
  // and precesses it to date; our relativeOrbit uses the J2000 orbit axes.
  const p=published.find(p=>p.name===s.name), pairs=p.ephemerides.slice(43).trim().split(/\s+/).slice(0,10).map(Number);
  assert.equal(pairs.length,10);
  for(let y=0;y<5;y++) {
    const q=relativeOrbit(s,2415020.31352+(125+y)*365.242198781);
    const pa=(Math.atan2(q[1],q[0])*180/Math.PI+360)%360;
    assert.ok(Math.abs(Math.hypot(q[0],q[1])-pairs[2*y+1])<.002,`${s.name} USNO separation 202${5+y}`);
    assert.ok(Math.abs(((pa-pairs[2*y]+540)%360)-180)<.3,`${s.name} USNO position angle 202${5+y}`);
  }
  for(const jd of [2305447.5,2451545,2461000,2816787.5]) {
    const [a,b]=s.components.map(c=>binaryState(c.id,jd));
    const mean=a.vector.map((x,i)=>(s.masses[0]*x+s.masses[1]*b.vector[i])/(s.masses[0]+s.masses[1]));
    const bc=s.barycentre, expected=spaceVector(bc.ra,bc.dec,bc.pmra,bc.pmdec,1000/bc.distance,bc.rv,(jd-bc.epoch)/365.25);
    assert.ok(Math.hypot(...mean.map((x,i)=>x-expected[i]))<1e-14,'Mass-weighted components preserve the barycentre');
    assert.deepEqual(stellarState({binary:s.components[0].id,ra:0,dec:0,pmra:1e9,pmdec:-1e9,rv:1e9},jd).vector,a.vector,'Component catalogue motion is not added twice');
  }
}

const t=Date.parse('2026-11-19T12:00Z')/1000, place=[45,9,120], frame=skyFrame(t,place), advance=createSkyAnimator(t,place);
const moving=frame.stars.filter(s=>s.binary);
assert.equal(moving.length,BINARY_SYSTEMS.length*2);
assert.equal(new Set(frame.stars.map(s=>s.name)).size,frame.stars.length);
for(const s of BINARY_SYSTEMS)for(const c of s.components){
  const a=findObject(frame,c.name), b=lookup({},c.name);
  assert.equal(a.binary,c.id); assert.equal(b.binary,c.id);
  assert.ok(angle(pointVector(a),pointVector(horizontal(b,t,place)))<.001,'Drawing/calculator binary parity');
  for(const alias of c.aliases){
    const best=BINARY_SYSTEMS.flatMap(s=>s.components).filter(c=>c.aliases.includes(alias)).sort((a,b)=>a.mag-b.mag)[0];
    assert.equal(lookup({},alias).binary,best.id,alias);
  }
  assert.match(objectDetails(a,frame),/Binary orbit/);
  if(s.grade>=4)assert.match(objectDetails(a,frame),/uncertain/);
}
for(const dt of [0,60,86300,-600,86401,-90000,1e8,-1e8,1e10,-1e10]) {
  const live=advance(t+dt), exact=skyFrame(t+dt,place);
  for(const p of live.stars.filter(p=>p.binary))assert.ok(angle(pointVector(p),pointVector(findObject(exact,p.name)))<1e-7,'Binary orbit stays live during cached playback');
  assert.ok(angle(pointVector(findObject(live,"Barnard's Star")),pointVector(findObject(exact,"Barnard's Star")))<1e-7,'Fast-star radial/transverse motion stays live during playback');
}
// The speed guarantee is structural as well as measured: at most one exact
// solve per system and timestamp, shared by the components. No time history
// accumulates, including arbitrary seeks and very fast/reversed playback.
{
  const epoch=t+1234.56789,prior=binaryMotionStats().orbitEvaluations;
  skyFrame(epoch,place);
  assert.equal(binaryMotionStats().orbitEvaluations-prior,BINARY_SYSTEMS.length);
  const warm=binaryMotionStats().orbitEvaluations;skyFrame(epoch,place);
  assert.equal(binaryMotionStats().orbitEvaluations,warm,'Unchanged timestamp reuses exact binary positions');
  for(let k=0;k<1000;k++)for(const s of BINARY_SYSTEMS){
    const a=binaryState(s.components[0].id,2451545+k*.731),b=binaryState(s.components[1].id,2451545+k*.731);
    const original=a.vector[0];a.vector[0]=12345;
    assert.equal(binaryState(s.components[0].id,2451545+k*.731).vector[0],original,'Consumers cannot corrupt the shared cache');
  }
  assert.equal(binaryMotionStats().cachedSystems,BINARY_SYSTEMS.length);
  assert.equal(binaryMotionStats().maximumCachedSystems,BINARY_SYSTEMS.length);
}
// The optional JPL occultation provider must apply the same component orbit,
// rather than silently reverting to the unmodelled catalogue proper motion.
{
  const files=Object.fromEntries(['de440','iers'].map(id=>[id,fs.readFileSync(new URL(`fixtures/${id==='iers'?'iers-native.txt':'de440-native.bsp'}`,import.meta.url))]));
  const target=lookup({},'Porrima'),epoch=Date.parse('2024-04-08T18:42Z')/1000;
  const job={kind:'occultation',front:'moon',target,t:epoch,place};
  const pack=readPrecisionPack(await nativeEphemerisPack(job,Object.fromEntries(Object.entries(files).map(([id,b])=>[id,{bytes:b.length}])),async(id,o,n)=>new Uint8Array(files[id].subarray(o,o+n))));
  const provider=makePrecisionEphemeris(pack);
  // JPL stellar refinement at the barycentre must agree with the same
  // astrometric binary vectors, without adding local solar light bending.
  const baryPlace=[...place,'barycentric'],baryFrame=skyFrame(epoch,baryPlace);
  for(const name of ['Rigil Kentaurus','Toliman']){
    const star=lookup({},name),p=provider.topocentric(star,epoch,baryPlace),q=findObject(baryFrame,name);
    const vector=p=>[Math.cos(p.dec*Math.PI/180)*Math.cos(p.ra*Math.PI/180),Math.cos(p.dec*Math.PI/180)*Math.sin(p.ra*Math.PI/180),Math.sin(p.dec*Math.PI/180)];
    assert.ok(angle(vector(p),vector(q))<.001,'Barycentric JPL/compact stellar parity');
  }
  for(const name of ['Porrima','γ Virginis B','Castor B','Procyon B','70 Ophiuchi B']){
    const star=lookup({},name),a=topocentric(star,epoch,place),b=provider.topocentric(star,epoch,place);
    const vector=p=>[Math.cos(p.dec*Math.PI/180)*Math.cos(p.ra*Math.PI/180),Math.cos(p.dec*Math.PI/180)*Math.sin(p.ra*Math.PI/180),Math.sin(p.dec*Math.PI/180)];
    assert.ok(angle(vector(a),vector(b))<.03,'Binary JPL/compact apparent positions agree within compact reduction error');
  }
}
// Tiny-cone culling must allow both radial perspective motion and parallax.
const file=fs.readFileSync(new URL('../data/stars-12.bin',import.meta.url));
const buffer=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength), catalog=readStars(buffer);
assert.ok(catalog.rv);assert.equal(catalog.binaryIndices.size,0,'New downloads have no duplicate modelled components');
assert.ok(catalog.rv.some(Number.isNaN),'Missing velocities remain distinct from measured zero');
setFaintStars(buffer);
try {
  const historical=skyFrame(Date.parse('1000-01-01T00:00Z')/1000,place), cone={v:pointVector(findObject(historical,"Barnard's Star")),radius:.02};
  const inside=v=>v.reduce((sum,x,i)=>sum+x*cone.v[i],0)>Math.cos(cone.radius);
  const full=new Set(),culled=new Set();
  eachFaint(historical,12,(i,v)=>{if(inside(v))full.add(i);});
  eachFaint(historical,12,(i,v)=>{if(inside(v))culled.add(i);},cone);
  assert.deepEqual(culled,full,'Historical culling preserves radially moving stars');
} finally {setFaintStars(null);}
console.log(JSON.stringify({scope:'Numerical agreement with uniform-space-motion and fixed-Kepler models, not observed stellar-position uncertainty',erfaSpaceMotionCases:fixture.stars.length,maxDirectionArcsec:maxMotion,independentOrbits:fixture.orbits.length,maxOrbitArcsec:maxOrbit,usnoEphemerides:BINARY_SYSTEMS.length*5,binaryComponents:moving.length,nativeBinaryChecks:5,maximumCachedSystems:binaryMotionStats().maximumCachedSystems,radialVelocityEntries:catalog.rv.filter(Number.isFinite).length},null,2));
