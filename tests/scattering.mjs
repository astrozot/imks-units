import assert from 'node:assert/strict';
import { scatteringMedium,prepareScattering,sourceTransmission,integrateScattering,rayleighPhase,aerosolPhase,RAYLEIGH,OZONE,physicalSky,skyRadiance } from '../js/scattering.js';
const R=Math.PI/180;
const source=alt=>[0,Math.cos(alt*R),Math.sin(alt*R)];
// Phase functions must conserve scattered energy over the whole sphere.
for(const phase of [rayleighPhase,mu=>aerosolPhase(mu,.76),mu=>aerosolPhase(mu,.86)]) {
  let integral=0;const N=100000;
  for(let i=0;i<N;i++)integral+=phase(-1+2*(i+.5)/N)*4*Math.PI/N;
  assert.ok(Math.abs(integral-1)<1e-5,integral);
}
const m=scatteringMedium({aerosol:1});
const vertical=sourceTransmission(m,0,1,false);
for(let k=0;k<3;k++){
  const analytic=Math.exp(-RAYLEIGH[k]*8000-3e-5*1500-OZONE[k]*15000);
  assert.ok(Math.abs(vertical[k]-analytic)<.002,[vertical,analytic]);
}
assert.deepEqual(sourceTransmission(m,0,-.1,false),[0,0,0]);
assert.ok(sourceTransmission(m,0,0)[2]<sourceTransmission(m,0,1)[2]);
// Beer-Lambert transport composes across two segments in linear radiance.
const full=integrateScattering(m,0,[0,0,1],source(90),{distance:20000,steps:128,multiple:false});
const a=integrateScattering(m,0,[0,0,1],source(90),{distance:10000,steps:128,multiple:false});
const b=integrateScattering(m,10000,[0,0,1],source(90),{distance:10000,steps:128,multiple:false});
for(let k=0;k<3;k++){
 assert.ok(Math.abs(full.transmission[k]-a.transmission[k]*b.transmission[k])<2e-5);
 assert.ok(Math.abs(full.radiance[k]-a.radiance[k]-a.transmission[k]*b.radiance[k])<2e-5);
}
const zero=integrateScattering(m,0,[0,0,1],source(20),{distance:0});
assert.deepEqual(zero,{radiance:[0,0,0],transmission:[1,1,1]});
// Thin-medium limit: L = sigma_R * path length * Rayleigh phase.
const thin={...scatteringMedium({pressure:.001,aerosol:0}),multiple:null};
const L=integrateScattering(thin,0,[0,0,1],source(90),{distance:1,steps:16,multiple:false}).radiance;
for(let k=0;k<3;k++)assert.ok(Math.abs(L[k]/(RAYLEIGH[k]*thin.molecular*rayleighPhase(1)*sourceTransmission(thin,0,1)[k])-1)<.001);
prepareScattering(m);
const single=integrateScattering(m,0,[0,0,1],source(-6),{multiple:false}).radiance;
const twice=integrateScattering(m,0,[0,0,1],source(-6)).radiance;
assert.ok(twice.every((v,k)=>v>=single[k])&&twice[2]>single[2]);
// Convergence of the view quadrature, including twilight and tangent rays.
const cases=[];
for(const [alt,viewAlt] of [[45,90],[0,3],[-3,10],[-6,45]]){
 const v=source(viewAlt),coarse=integrateScattering(m,90,v,source(alt)).radiance,reference=integrateScattering(m,90,v,source(alt),{steps:256}).radiance;
 const error=Math.max(...coarse.map((v,k)=>Math.abs(v-reference[k])/Math.max(reference[k],1e-8)));
 assert.ok(error<.015,JSON.stringify({alt,viewAlt,error}));cases.push({alt,viewAlt,error});
}
for(const distance of [1000,20000,150000]){
 const near=integrateScattering(m,90,source(3),source(0),{distance,steps:12});
 const ref=integrateScattering(m,90,source(3),source(0),{distance,steps:256});
 assert.ok(near.radiance.every((v,k)=>Math.abs(v-ref.radiance[k])/Math.max(ref.radiance[k],1e-8)<.04));
 assert.ok(near.transmission.every((v,k)=>Math.abs(v-ref.transmission[k])<.002));
}
const north=physicalSky({},90,{alt:20,vector:source(20)}),east=physicalSky({},90,{alt:20,vector:[Math.cos(20*R),0,Math.sin(20*R)]});
assert.ok(north.irradiance.every((v,k)=>Math.abs(v-east.irradiance[k])<1e-10));
const sunset=sourceTransmission(m,0,Math.sin(.5*R)),noon=sourceTransmission(m,0,1);
assert.ok(sunset[0]/sunset[2]>noon[0]/noon[2]*10);
const dry=physicalSky({humidity:10},0,{alt:-30},{alt:30,illum:1,vector:source(30)}),wet=physicalSky({humidity:90},0,{alt:-30},{alt:30,illum:1,vector:source(30)});
const near=source(33),far=source(70);
const contrast=s=>skyRadiance(s,near)[0]-skyRadiance(s,far)[0];
assert.ok(contrast(wet)>contrast(dry));
for(const alt of [-30,-12,-6,0,45,90])for(const height of [0,3000]){
 const sky=physicalSky({},height,{alt});
 for(const v of [source(-5),source(0),source(45),source(90)])assert.ok(skyRadiance(sky,v).every(v=>Number.isFinite(v)&&v>=0));
}
// All scattering orders: the isotropic source exceeds the angular mean of
// order one (its first term, reproduced here with the same quadrature). Red
// gains most: ground-reflected light dominates its weak order-one sky. Haze
// makes the source larger and whiter.
{
 const meanOrderOne=(m,mus)=>{const S=[Math.sqrt(1-mus*mus),0,mus],L=[0,0,0];for(let d=0;d<32;d++){const mu=1-2*(d+0.5)/32,az=d*2.399963229728653,c=Math.sqrt(1-mu*mu),r=integrateScattering(m,0,[c*Math.cos(az),c*Math.sin(az),mu],S,{steps:20,multiple:false}).radiance;for(let k=0;k<3;k++)L[k]+=r[k]/32;}return L;};
 const i=Math.round((Math.sqrt(0.5)+1)/2*47),q=2*i/47-1,mus=Math.sign(q)*q*q;
 const source=settings=>{const m=prepareScattering(scatteringMedium(settings,0));return {all:[0,1,2].map(k=>m.multiple[4*i+k]),first:meanOrderOne(m,mus)};};
 const clear=source({}),hazy=source({aerosol:4,humidity:80}),sum=v=>v[0]+v[1]+v[2];
 for(let k=0;k<3;k++){const gain=clear.all[k]/clear.first[k];assert.ok(gain>1.02&&gain<6,`all-orders gain ${clear.all} ${clear.first}`);}
 assert.ok(sum(hazy.all)>sum(clear.all)&&hazy.all[2]/hazy.all[0]<clear.all[2]/clear.all[0],`haze ${clear.all} ${hazy.all}`);
}
console.log('Scattering: phase normalization, analytic optical depth, planet shadow, segment composition, thin limit, all scattering orders, convergence, sunset and humid lunar aureole passed',JSON.stringify(cases));
