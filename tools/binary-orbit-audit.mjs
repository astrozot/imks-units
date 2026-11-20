// Compare the implemented elements with pinned Stellarium 26.3 data and
// independently retained USNO ephemerides. Optional arguments: source .dat,
// then a freshly downloaded development .dat. Prints a JSON audit report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {BINARY_SYSTEMS} from '../js/binarydata.js';
import {relativeOrbit} from '../js/starmotion.js';
const file=process.argv[2] || new URL('../tests/fixtures/stellarium-binary-orbits.dat',import.meta.url);
const bytes=fs.readFileSync(file),hash=b=>createHash('sha256').update(b).digest('hex');
const expectedHash='9c207bfe1814440658b5e1664fca676da491a6bc703c4e30a5a3d967795614c1';
assert.equal(hash(bytes),expectedHash,'Compare against the independently pinned official release');
const rows=bytes.toString().split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('#')).map(l=>l.split(/\s+/));
assert.equal(rows.length,15,'Stellarium contains Castor in addition to the 14 guide-listed pairs');
const published=JSON.parse(fs.readFileSync(new URL('../tests/fixtures/binary-orbits.json',import.meta.url)));
const sourceIds={
  'α Centauri':'71683',Sirius:'32349','61 Cygni':'1872046609345556480','γ Virginis':'3683687763520080384',
  'Alula Australis':'756853643638639104',Achird:'425040000962559616','ε¹ Lyrae':'2098237660364079232',
  'ε² Lyrae':'2098202128093842432','β Muscae':'5855802671046171648',Dalim:'5059348952161258624',
  'ψ Velorum':'5426587107145955712','ρ Ophiuchi':'4468557611984384512','ζ Herculis':'1312665361415345920',
  'η Ophiuchi':'84012',
};
const R=180/Math.PI,near=(a,b)=>Math.abs(a-b)<1e-9*Math.max(1,Math.abs(a),Math.abs(b));
const wrapped=x=>((x+180)%360+360)%360-180;
const display=o=>({periodYears:o[0]/365.25,eccentricity:o[1],inclinationDegrees:o[2]*R,
  nodeDegrees:o[3]*R,periastronArgumentDegrees:o[4]*R,periastronJD:o[5],relativeSemimajorArcsec:o[6]});
const reasons={
  '61 Cygni':'USNO PkO2017b fit instead of Stellarium’s different adopted fit; grade 4, uncertain.',
  'γ Virginis':'USNO Sca2007c fit with different period, inclination, eccentricity, axis and epoch.',
  'β Muscae':'Stellarium’s seven orbital elements exactly repeat Achird’s, despite different component IDs. Use the USNO Tok2020e beta Mus orbit.',
  'ψ Velorum':'Use USNO Msn2023. Stellarium’s periastron JD exactly repeats Dalim’s, which is a substantial phase discrepancy rather than a year-conversion difference.',
  'ρ Ophiuchi':'Different systems: the guide lists rho Oph, but this Stellarium row identifies 70 Oph. The app implements rho Oph AB (USNO Izm2019, grade 5).',
  'ζ Herculis':'USNO Izm2019 fit. Periastron epochs are about one cycle apart; the orbital elements also differ slightly.',
  'η Ophiuchi':'USNO Doc2023c fit instead of Stellarium’s different adopted fit.',
};
const report={source:{tag:'v26.3',commit:'3f23cf3a1a59523a9c7b1ec4540c33bca77addfa',url:'https://github.com/Stellarium/stellarium/blob/v26.3/stars/hip_gaia3/binary_orbitparam.dat',sha256:hash(bytes),records:rows.length},
  scope:'Element and identity audit. Sample offsets use the same relative-orbit evaluator for both element sets; they are not full Stellarium apparent-position or observational-error measurements.',systems:[]};
if(process.argv[3]){const b=fs.readFileSync(process.argv[3]);report.source.developmentSha256=hash(b);report.source.releaseAndDevelopmentIdentical=bytes.equals(b);}
let matching=0,changed=0,identity=0,ephemerides=0;
for(const s of BINARY_SYSTEMS.filter(s=>sourceIds[s.name])){
  const row=rows.find(r=>r[0]===sourceIds[s.name]);assert.ok(row,`Independent component-ID match: ${s.name}`);
  const old=row.slice(2,9).map(Number),now=s.orbit,ref=published.find(p=>p.name===s.name);
  // Independently compare every implemented element with its retained USNO
  // source record, including the field-specific unit codes.
  const l=ref.elements,n=(first,last)=>Number(l.slice(first-1,last).trim());
  const usnoEpoch=n(163,174),usno=[n(81,92)*({y:365.25,d:1,c:36525}[l[92]]),n(188,195),n(126,133)/R,n(144,151)/R,n(206,213)/R,
    l[174]==='y'?2415020.31352+(usnoEpoch-1900)*365.242198781:usnoEpoch+2400000+(l[174]==='m'?.5:0),n(106,114)*({a:1,m:.001,M:60}[l[114]])];
  for(let k=0;k<7;k++)assert.ok(Math.abs(now[k]-usno[k])<1e-8,`${s.name}: element ${k} agrees with the source record`);
  const sameShape=[0,1,2,3,4,6].every(i=>near(now[i],old[i]));
  const sameSystem=s.name!=='ρ Ophiuchi';
  const differences={};
  for(const [key,v]of Object.entries(display(now)))if(!near(v,display(old)[key]))differences[key]={app:v,stellarium:display(old)[key]};
  // A large JD is not a useful relative tolerance for epoch comparisons.
  if(Math.abs(now[5]-old[5])>1e-6)differences.periastronJD={app:now[5],stellarium:old[5],deltaDays:now[5]-old[5]};
  let classification;
  if(!sameSystem){classification='different-system';identity++;}
  else if(sameShape){
    classification='same-elements-year-convention';matching++;
    const year=Number(ref.elements.slice(162,174));
    assert.equal(ref.elements[174],'y');
    assert.ok(Math.abs(old[5]-(2451545+(year-2000)*365.25))<1e-8,'Stellarium uses the same fractional number as a Julian epoch');
    assert.ok(Math.abs(now[5]-(2415020.31352+(year-1900)*365.242198781))<1e-8,'App honours the documented USNO Besselian epoch');
  }else{classification='different-adopted-elements';changed++;assert.ok(reasons[s.name],'Every substantive difference has a recorded explanation');}
  const bary=s.barycentre,sourceBary={distance:Number(row[9]),epoch:Number(row[10]),ra:Number(row[11])*R,dec:Number(row[12])*R,rv:Number(row[13]),pmra:Number(row[14]),pmdec:Number(row[15])};
  const baryMatches=Object.keys(sourceBary).every(k=>near(bary[k],sourceBary[k]));
  assert.equal(baryMatches,sameSystem,'Barycentre changes must be explicit');
  const sampleJD=2451545+26*365.25,a=relativeOrbit(s,sampleJD),b=relativeOrbit({orbit:old},sampleJD);
  const pairs=ref.ephemerides.slice(43).trim().split(/\s+/).slice(0,10).map(Number);
  let maxSeparationDifference=0,maxPositionAngleDifference=0;
  for(let y=0;y<5;y++){
    const q=relativeOrbit(s,2415020.31352+(125+y)*365.242198781),rho=Math.hypot(q[0],q[1]),pa=Math.atan2(q[1],q[0])*R;
    const dr=Math.abs(rho-pairs[2*y+1]),dt=Math.abs(wrapped(pa-pairs[2*y]));
    maxSeparationDifference=Math.max(maxSeparationDifference,dr);maxPositionAngleDifference=Math.max(maxPositionAngleDifference,dt);
    assert.ok(dr<.002&&dt<.3,`${s.name}: USNO ephemeris (PA includes rounding and equinox-of-date differences)`);ephemerides++;
  }
  report.systems.push({name:s.name,classification,reason:reasons[s.name]||'Same orbital shape and period; the periastron date differs only because USNO specifies a fractional Besselian year.',
    app:{...display(now),components:s.components.map(c=>({id:c.id,name:c.name,hip:c.hip,gaia:c.gaia}))},stellarium:{...display(old),componentIds:row.slice(0,2),actualSystem:sameSystem?s.name:'70 Ophiuchi'},differences,
    barycentreMatchesStellarium:baryMatches,appBarycentre:bary,stellariumBarycentre:sourceBary,
    appMasses:s.masses,stellariumMasses:row.slice(16,18).map(Number),usnoReference:s.reference,usnoGrade:s.grade,
    comparisonAtJ2026:{ttJD:sampleJD,appSeparationArcsec:Math.hypot(a[0],a[1]),stellariumElementsSeparationArcsec:Math.hypot(b[0],b[1]),relativeVectorOffsetArcsec:sameSystem?Math.hypot(a[0]-b[0],a[1]-b[1]):null},
    usnoEphemerisAgreement:{samples:5,maxSeparationDifferenceArcsec:maxSeparationDifference,maxPositionAngleDifferenceDegrees:maxPositionAngleDifference},
  });
}
const get=name=>rows.find(r=>r[0]===sourceIds[name]);
assert.deepEqual(get('β Muscae').slice(2,9),get('Achird').slice(2,9),'Confirm the duplicated beta Mus elements');
assert.equal(get('ψ Velorum')[7],get('Dalim')[7],'Confirm the repeated psi Vel periastron date');
assert.deepEqual([matching,changed,identity,ephemerides],[7,6,1,70]);
report.summary={systems:14,sameElementsApartFromYearConvention:matching,differentAdoptedElements:changed,differentSystem:identity,usnoEphemeridesChecked:ephemerides,
  appTotalSystems:BINARY_SYSTEMS.length,additionalReviewedPairs:BINARY_SYSTEMS.filter(s=>!sourceIds[s.name]).map(s=>s.name),
  extraStellariumSystem:'Castor A–B; present in the data file but outside the requested guide-listed 14',
  caveat:'Matching relative orbits does not independently validate barycentre astrometry or adopted masses. Rho Oph uses an approximate equal-mass barycentre; beta Mus has separately adopted masses.'};
console.log(JSON.stringify(report,null,2));
