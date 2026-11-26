// Clear-sky radiative transfer in metres, RGB radiance per unit incident
// irradiance. Original implementation of the standard transport equations:
// https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html
// Single scattering is directional; order two uses an isotropic angular
// closure. This is not the full spectral/all-orders Bruneton solver.
import { atmosphericState } from './atmosphere.js';
export const EARTH_RADIUS = 6371000, ATMOSPHERE_HEIGHT = 100000;
export const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6];
export const OZONE = [0.650e-6, 1.881e-6, 0.085e-6];
const AEROSOL = 3e-5, ALBEDO = 0.9, PI = Math.PI;
const OW = 128, OH = 48, MW = 48, MH = 20;
const clamp = (x, a=0, b=1) => Math.max(a,Math.min(b,x));
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const rayleighPhase = mu => 3*(1+mu*mu)/(16*PI);
export const aerosolPhase = (mu,g) => (1-g*g)/(4*PI*(1+g*g-2*g*mu)**1.5);
const ozoneDensity = h => Math.max(0,1-Math.abs(h-25000)/15000);
const horizonMu = h => -Math.sqrt(Math.max(0,1-(EARTH_RADIUS/(EARTH_RADIUS+h))**2));
function boundary(h,mu) {
  const r=EARTH_RADIUS+h;
  if(mu<horizonMu(h))return Math.max(0,-r*mu-Math.sqrt(Math.max(0,r*r*(mu*mu-1)+EARTH_RADIUS**2)));
  return -r*mu+Math.sqrt(r*r*(mu*mu-1)+(EARTH_RADIUS+ATMOSPHERE_HEIGHT)**2);
}
// Bilinear interpolation uses texel centres, identical to GPU sampling.
function sample(data,w,h,u,v,out=[0,0,0]) {
  const x=clamp(u)*(w-1),y=clamp(v)*(h-1),i=Math.min(w-2,Math.floor(x)),j=Math.min(h-2,Math.floor(y)),a=x-i,b=y-j;
  for(let k=0;k<3;k++)out[k]=(data[4*(j*w+i)+k]*(1-a)+data[4*(j*w+i+1)+k]*a)*(1-b)+(data[4*((j+1)*w+i)+k]*(1-a)+data[4*((j+1)*w+i+1)+k]*a)*b;
  return out;
}
let columns=null;
function opticalColumns() {
  if(columns)return columns;
  columns=new Float32Array(OW*OH*4);
  for(let j=0;j<OH;j++)for(let i=0;i<OW;i++) {
    const h=(j/(OH-1))**2*ATMOSPHERE_HEIGHT,r=EARTH_RADIUS+h,mh=horizonMu(h),mu=mh+(1-mh)*(i/(OW-1))**2;
    const end=boundary(h,mu),o=4*(j*OW+i);
    for(let n=0;n<96;n++) {
      // Quadratic intervals resolve the dense layer close to the origin.
      const a=end*(n/96)**2,b=end*((n+1)/96)**2,t=(a+b)/2;
      const z=Math.max(0,Math.sqrt(r*r+t*t+2*r*mu*t)-EARTH_RADIUS),ds=b-a;
      columns[o]+=Math.exp(-z/8000)*ds;columns[o+1]+=Math.exp(-z/1500)*ds;columns[o+2]+=ozoneDensity(z)*ds;
    }
  }
  return columns;
}
export function scatteringMedium(settings=null,height=0) {
  const air=atmosphericState(settings,height);
  // Sea-level equivalents; density is integrated in absolute height.
  const molecular=air.rayleigh*Math.exp(clamp(height,0,ATMOSPHERE_HEIGHT)/8000);
  const aerosol=air.aerosol*Math.exp(clamp(height,0,ATMOSPHERE_HEIGHT)/1500);
  const g=0.76+0.10*clamp((air.growth-1)/3);
  const key=[molecular,aerosol,g].map(x=>x.toPrecision(10)).join(':');
  if(media.has(key)){const m=media.get(key);media.delete(key);media.set(key,m);return m;}
  const m={key,molecular,aerosol,g,columns:opticalColumns(),multiple:null};
  // Only retain a few weather states; time and camera do not affect these.
  media.set(key,m);if(media.size>4)media.delete(media.keys().next().value);
  return m;
}
const media=new Map();
export function sourceTransmission(m,height,mu,finiteDisk=true,out=[0,0,0]) {
  return transmission(m,height,mu,finiteDisk,out);
}
// Keep the independent columns intact while constructing three transmissions.
function transmission(m,h,mu,finite,out) {
  h=clamp(h,0,ATMOSPHERE_HEIGHT);const mh=horizonMu(h),t=clamp((mu-mh+0.00465)/0.0093),visible=finite?t*t*(3-2*t):(mu>=mh?1:0);
  if(!visible){out.fill(0);return out;}
  sample(m.columns,OW,OH,Math.sqrt(clamp((mu-mh)/(1-mh))),Math.sqrt(h/ATMOSPHERE_HEIGHT),out);
  const r=out[0],a=out[1],o=out[2];
  for(let k=0;k<3;k++)out[k]=visible*Math.exp(-(RAYLEIGH[k]*m.molecular*r+AEROSOL*m.aerosol*a+OZONE[k]*o));
  return out;
}
function multipleSample(m,h,mu,out) {
  return sample(m.multiple,MW,MH,(Math.sign(mu)*Math.sqrt(Math.abs(mu))+1)/2,Math.sqrt(clamp(h/ATMOSPHERE_HEIGHT)),out);
}
// Integrate L = integral T_eye * (sigma_s * phase * T_light + j_order2) ds.
// A closed-form homogeneous segment integral avoids overbright opaque haze.
export function integrateScattering(m,height,view,source,{distance=Infinity,steps=32,multiple=true,direct=null}={}) {
  height=clamp(height,0,ATMOSPHERE_HEIGHT);const r=EARTH_RADIUS+height,mu=clamp(view[2],-1,1),end=Math.min(distance,boundary(height,mu));
  const L=[0,0,0],T=[1,1,1],light=[0,0,0],second=[0,0,0];
  const nu=clamp(dot(view,source),-1,1),pr=rayleighPhase(nu),pa=aerosolPhase(nu,m.g);
  // Terrain shadows are not applied here: the terrain renderer applies them
  // per pixel to the single-scattering part (see aerialperspective.js).
  for(let n=0;n<steps;n++) {
    const a=end*(n/steps)**2,b=end*((n+1)/steps)**2,t=(a+b)/2,ds=b-a;
    const x=view[0]*t,y=view[1]*t,z=r+view[2]*t,rp=Math.sqrt(x*x+y*y+z*z),h=Math.max(0,rp-EARTH_RADIUS),mus=(x*source[0]+y*source[1]+z*source[2])/rp;
    const dr=Math.exp(-h/8000)*m.molecular,da=Math.exp(-h/1500)*m.aerosol,dO=ozoneDensity(h);
    transmission(m,h,mus,true,light);
    if(multiple&&m.multiple)multipleSample(m,h,mus,second);
    for(let k=0;k<3;k++) {
      const ext=RAYLEIGH[k]*dr+AEROSOL*da+OZONE[k]*dO,tr=Math.exp(-ext*ds);
      const j=(RAYLEIGH[k]*dr*pr+AEROSOL*ALBEDO*da*pa)*light[k]+(RAYLEIGH[k]*dr+AEROSOL*ALBEDO*da)*second[k];
      const w=T[k]*(ext>1e-12?(1-tr)/ext:ds);L[k]+=j*w;
      if(direct)direct[k]+=(RAYLEIGH[k]*dr*pr+AEROSOL*ALBEDO*da*pa)*light[k]*w;T[k]*=tr;
    }
  }
  return {radiance:L,transmission:T};
}
export function prepareScattering(m) {
  if(m.multiple)return m;
  const data=new Float32Array(MW*MH*4);
  // Equal solid-angle quadrature for the angular mean of order-one radiance.
  // The second collision is isotropic; anisotropy is retained in order one.
  for(let j=0;j<MH;j++)for(let i=0;i<MW;i++) {
    const h=(j/(MH-1))**2*ATMOSPHERE_HEIGHT,q=2*i/(MW-1)-1,mus=Math.sign(q)*q*q,S=[Math.sqrt(Math.max(0,1-mus*mus)),0,mus];
    const o=4*(j*MW+i),N=32;
    for(let d=0;d<N;d++) {
      const mu=1-2*(d+0.5)/N,az=d*2.399963229728653,c=Math.sqrt(1-mu*mu);
      const L=integrateScattering(m,h,[c*Math.cos(az),c*Math.sin(az),mu],S,{steps:20,multiple:false}).radiance;
      for(let k=0;k<3;k++)data[o+k]+=L[k]/N;
    }
  }
  m.multiple=data;return m;
}
const skyCache=new Map();
export function physicalSky(settings,height,sun,moon=null) {
  const medium=prepareScattering(scatteringMedium(settings,height));
  const direction=o=>{const alt=(o?.alt??-90)*PI/180,v=o?.vector||[0,1,0],h=Math.hypot(v[0],v[1])||1;return [v[0]/h*Math.cos(alt),v[1]/h*Math.cos(alt),Math.sin(alt)];};
  const sunDirection=direction(sun),moonDirection=direction(moon);
  // Krisciunas & Schaefer (1991), with distance and eclipse dimming kept
  // separate from lunar phase. Callers can supply direct source irradiance.
  const phase=moon?Math.acos(clamp(2*(moon.illum||0)-1,-1,1))*180/PI:180;
  const lunarFlux=moon?(moon.flux??((moon.illum>0?2.5e-6*10**(-0.4*(0.026*phase+4e-9*phase**4)):0)*(384400/(moon.dist||384400))**2)):0;
  // Below -6° lunar scattering is below the natural night-sky floor; in
  // daylight it is negligible beside solar scattering. Keep the disk itself.
  const moonFlux=moon&&moon.alt>=-6&&(!(sun.alt>0)||((sun.flux??1)<.01))?lunarFlux:0;
  const pollution=atmosphericState(settings,height).pollution;
  const cacheKey=[medium.key,pollution,height,...sunDirection,...moonDirection,moonFlux,sun?.flux??1].join(':');
  if(skyCache.has(cacheKey))return skyCache.get(cacheKey);
  const sky={medium,height:clamp(height,0,ATMOSPHERE_HEIGHT),sun:sunDirection,moon:moonDirection,moonFlux,solarFlux:sun?.flux??1};
  const zenith=skyRadiance(sky,[0,0,1]);
  const luminance=0.2126*zenith[0]+0.7152*zenith[1]+0.0722*zenith[2];
  const solar=integrateScattering(medium,sky.height,[0,0,1],sunDirection).radiance;
  const solarLuminance=(0.2126*solar[0]+0.7152*solar[1]+0.0722*solar[2])*sky.solarFlux;
  // Exposure is a display adaptation, not an extra atmospheric light source.
  sky.exposure=0.8/(Math.sqrt(Math.max(0,solarLuminance))+0.05*Math.sqrt(Math.max(0,luminance-solarLuminance))+0.00002);
  sky.pollution=pollution;
  sky.irradiance=[0,0,0];
  // Cosine-weighted hemisphere quadrature aligned to each source's azimuth.
  // Rotating the scene cannot change total diffuse irradiance.
  for(const [S,flux] of [[sky.sun,sky.solarFlux],[sky.moon,sky.moonFlux]]){
    if(!flux)continue;
    const az=Math.atan2(S[0],S[1]);
    for(let i=0;i<16;i++){
      const mu=(i+0.5)/16,phi=i*2.399963229728653+az,c=Math.sqrt(1-mu*mu);
      const L=integrateScattering(medium,sky.height,[c*Math.sin(phi),c*Math.cos(phi),mu],S).radiance;
      for(let k=0;k<3;k++)sky.irradiance[k]+=L[k]*flux*mu*2*PI/16;
    }
  }
  skyCache.set(cacheKey,sky);if(skyCache.size>6)skyCache.delete(skyCache.keys().next().value);
  return sky;
}
export function skyRadiance(sky,view,distance=Infinity) {
  const sun=integrateScattering(sky.medium,sky.height,view,sky.sun,{distance}).radiance;
  const moon=sky.moonFlux?integrateScattering(sky.medium,sky.height,view,sky.moon,{distance}).radiance:[0,0,0];
  return sun.map((v,k)=>v*sky.solarFlux+moon[k]*sky.moonFlux);
}
export function displayRadiance(rgb,exposure) {
  return rgb.map(v=>{const x=1-Math.exp(-Math.max(0,v)*exposure);return x<=0.0031308?12.92*x:1.055*x**(1/2.4)-0.055;});
}
export const opticalDimensions=[OW,OH],multipleDimensions=[MW,MH];
// Shared by both WebGL renderers. Samplers store optical columns (metres)
// and order-one angular mean radiance, not painted colours.
export const SCATTERING_GLSL=`
#ifndef ATM_STEPS
#define ATM_STEPS 32
#endif
uniform sampler2D opticalColumns, multipleScattering;
uniform vec3 mediumParameters, scatteringSun, scatteringMoon;
uniform float scatteringHeight, scatteringExposure, scatteringMoonFlux, scatteringSolarFlux, scatteringPollution;
const float ATM_R=6371000.0,ATM_H=100000.0;
const vec3 ATM_B_R=vec3(5.802e-6,13.558e-6,33.1e-6),ATM_B_O=vec3(0.650e-6,1.881e-6,0.085e-6);
vec2 atmUV(vec2 uv,vec2 size){return (clamp(uv,0.0,1.0)*(size-1.0)+0.5)/size;}
float atmHorizon(float h){return -sqrt(max(0.0,1.0-pow(ATM_R/(ATM_R+h),2.0)));}
float atmBoundary(float h,float mu){float r=ATM_R+h;if(mu<atmHorizon(h))return max(0.0,-r*mu-sqrt(max(0.0,r*r*(mu*mu-1.0)+ATM_R*ATM_R)));return -r*mu+sqrt(max(0.0,r*r*(mu*mu-1.0)+pow(ATM_R+ATM_H,2.0)));}
vec3 atmTransmission(float h,float mu){h=clamp(h,0.0,ATM_H);float mh=atmHorizon(h),visible=smoothstep(-0.00465,0.00465,mu-mh);if(visible<=0.0)return vec3(0);vec3 d=texture(opticalColumns,atmUV(vec2(sqrt(clamp((mu-mh)/(1.0-mh),0.0,1.0)),sqrt(h/ATM_H)),vec2(128,48))).rgb;d*=100000.0;return visible*exp(-(ATM_B_R*mediumParameters.x*d.r+3e-5*mediumParameters.y*d.g+ATM_B_O*d.b));}
vec3 atmSecond(float h,float mu){return texture(multipleScattering,atmUV(vec2((sign(mu)*sqrt(abs(mu))+1.0)*0.5,sqrt(clamp(h/ATM_H,0.0,1.0))),vec2(48,20))).rgb;}
// Lsingle receives the single-scattering (direct-light) part of the result,
// the only part a terrain shadow can remove.
vec3 atmIntegrate(vec3 v,vec3 source,float distanceLimit,out vec3 T,out vec3 Lsingle){
 float r=ATM_R+scatteringHeight,end=min(distanceLimit,atmBoundary(scatteringHeight,v.z)),nu=clamp(dot(v,source),-1.0,1.0),g=mediumParameters.z;
 float pr=3.0*(1.0+nu*nu)/(16.0*3.141592653589793),pa=(1.0-g*g)/(4.0*3.141592653589793*pow(1.0+g*g-2.0*g*nu,1.5));
 vec3 L=vec3(0);T=vec3(1);Lsingle=vec3(0);
 for(int i=0;i<ATM_STEPS;i++){
  float a=end*pow(float(i)/float(ATM_STEPS),2.0),b=end*pow(float(i+1)/float(ATM_STEPS),2.0),t=(a+b)*0.5,ds=b-a;
  vec3 p=vec3(0,0,r)+v*t;float rp=length(p),h=max(0.0,rp-ATM_R),mus=dot(p,source)/rp;
  float dr=exp(-h/8000.0)*mediumParameters.x,da=exp(-h/1500.0)*mediumParameters.y,dO=max(0.0,1.0-abs(h-25000.0)/15000.0);
  vec3 ext=ATM_B_R*dr+3e-5*da+ATM_B_O*dO,tr=exp(-ext*ds);
  vec3 single=(ATM_B_R*dr*pr+3e-5*0.9*da*pa)*atmTransmission(h,mus);
  vec3 w=T*mix(vec3(ds),(1.0-tr)/max(ext,vec3(1e-20)),step(vec3(1e-12),ext));
  L+=(single+(ATM_B_R*dr+3e-5*0.9*da)*atmSecond(h,mus))*w;Lsingle+=single*w;T*=tr;
 }
 return L;
}
vec3 atmRadiance(vec3 v,float limit,out vec3 T,out vec3 Lsingle){vec3 S;vec3 L=atmIntegrate(v,scatteringSun,limit,T,S)*scatteringSolarFlux;Lsingle=S*scatteringSolarFlux;if(scatteringMoonFlux>0.0){vec3 unused;L+=atmIntegrate(v,scatteringMoon,limit,unused,S)*scatteringMoonFlux;Lsingle+=S*scatteringMoonFlux;}return L;}
vec3 atmRadiance(vec3 v,float limit,out vec3 T){vec3 S;return atmRadiance(v,limit,T,S);}
vec3 atmLinearDisplay(vec3 rgb){return 1.0-exp(-max(rgb,vec3(0)));}
vec3 atmSRGB(vec3 x){return mix(12.92*x,1.055*pow(max(x,vec3(0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),x));}
vec3 atmBackground(vec3 v){vec3 T;vec3 L=atmRadiance(v,1e9,T);L+=vec3(1e-7,1.8e-7,2.4e-7)+scatteringPollution*vec3(3e-6,2.3e-6,1.6e-6)*(1.0+3.0*exp(-max(v.z,0.0)/0.15));return atmSRGB(atmLinearDisplay(L*scatteringExposure));}
`;
// Per-context resources: atmospheric parameters change rarely, time changes
// only uniforms. Call dispose() with the owning renderer's lifecycle.
export function scatteringUniforms(gl,program){
  const textures=[gl.createTexture(),gl.createTexture()];let last=null;
  const scaledColumns=Float32Array.from(opticalColumns(),v=>v/100000);
  const loc=n=>gl.getUniformLocation(program,n);
  return {set(sky,firstUnit){
    [scaledColumns,sky.medium.multiple].forEach((data,i)=>{
      gl.activeTexture(gl.TEXTURE0+firstUnit+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);
      if(last!==sky.medium){const [w,h]=i?multipleDimensions:opticalDimensions;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.FLOAT,data);}
      gl.uniform1i(loc(i?'multipleScattering':'opticalColumns'),firstUnit+i);
    });last=sky.medium;
    gl.uniform3f(loc('mediumParameters'),sky.medium.molecular,sky.medium.aerosol,sky.medium.g);
    gl.uniform3fv(loc('scatteringSun'),sky.sun);gl.uniform3fv(loc('scatteringMoon'),sky.moon);
    for(const [name,value] of Object.entries({scatteringHeight:sky.height,scatteringExposure:sky.exposure,scatteringMoonFlux:sky.moonFlux,scatteringSolarFlux:sky.solarFlux,scatteringPollution:sky.pollution}))gl.uniform1f(loc(name),value);
  },dispose(){textures.forEach(t=>gl.deleteTexture(t));}};
}
