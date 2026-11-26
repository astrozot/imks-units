import {createAerialPerspective,AERIAL_GLSL} from './aerialperspective.js';
import { physicalSky, SCATTERING_GLSL, scatteringUniforms } from './scattering.js';
import { terrainGpuMesh, terrainDrawGroups, TERRAIN_VERTEX_STRIDE } from './terrainlighting.js';
import { lightVector } from './terrainmesh.js';
import { WATER_TOLERANCE } from './terrainwater.js';
// Geometry only carries shape. Shading normals and Sun/Moon shadows are
// per-pixel lookups into per-ring textures derived from the height grids, so
// triangle edges and mesh simplification never show in the lighting.
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
uniform vec3 right,up,forward;
uniform vec2 size;
uniform float radius;
out vec3 P;
void main(){
 P=position;
 float d=max(length(P),1.0),z=dot(P,forward),w=max(d+z,0.001);
 // The same stereographic projection and handedness as projectVector().
 gl_Position=vec4(-2.0*radius*dot(P,right)/size.x,2.0*radius*dot(P,up)/size.y,(2.0*log2(1.0+d)/log2(1000001.0)-1.0)*w,w);
}`;
// Shared by the normal and shadow passes. Ring k's grid holds heights above
// the eye at texel centres; curvature (with the usual refraction factor 0.87)
// is added from the horizontal position, exactly as for the mesh vertices.
const RINGS = `
precision highp float;
precision highp int;
precision highp usampler2DArray;
const float EARTH=6371008.8;
uniform highp usampler2DArray heights;
uniform float ringExtent[5],ringScale[5],ringOffset[5],ringTexel[5];
uniform int ringSize[5];
uniform int rings;
float curvature(vec2 q){return 0.87*dot(q,q)/(2.0*EARTH);}
float texelSize(int k){return ringTexel[k];}
vec2 texelPosition(int k,ivec2 i){return (vec2(i)+0.5)*texelSize(k)-ringExtent[k];}
float rawHeight(int k,ivec2 i){
 i=clamp(i,ivec2(0),ivec2(ringSize[k]-1));
 uint h=texelFetch(heights,ivec3(i,k),0).r;
 return h==65535u?-1.0e6:float(h)*ringScale[k]+ringOffset[k];
}
float gridHeight(int k,vec2 q){
 vec2 t=(q+ringExtent[k])/texelSize(k)-0.5,f=fract(t);ivec2 i=ivec2(floor(t));
 float a=rawHeight(k,i),b=rawHeight(k,i+ivec2(1,0)),c=rawHeight(k,i+ivec2(0,1)),d=rawHeight(k,i+ivec2(1,1));
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float heightAt(int k,vec2 q){return gridHeight(k,q)-curvature(q);}
// One texel read: for the sky-visibility pass, which is jittered and filtered.
float nearestHeightAt(int k,vec2 q){return rawHeight(k,ivec2(floor((q+ringExtent[k])/texelSize(k))))-curvature(q);}`;
const screenVertex = `#version 300 es
out vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
// Central differences at grid resolution; mipmaps then filter them for
// distant, minified terrain.
const normalFragment = `#version 300 es
${RINGS}
uniform int ring;
out vec4 colour;
float surface(ivec2 i){return rawHeight(ring,i)-curvature(texelPosition(ring,i));}
void main(){
 ivec2 i=ivec2(gl_FragCoord.xy),n=ivec2(ringSize[ring]-1);
 ivec2 l=ivec2(max(i.x-1,0),i.y),r=ivec2(min(i.x+1,n.x),i.y),d=ivec2(i.x,max(i.y-1,0)),u=ivec2(i.x,min(i.y+1,n.y));
 float hl=surface(l),hr=surface(r),hd=surface(d),hu=surface(u),s=texelSize(ring);
 if(min(min(hl,hr),min(hd,hu))<-1.0e5){colour=vec4(0.5,0.5,0,1);return;}
 vec3 normal=normalize(vec3(-(hr-hl)/(float(r.x-l.x)*s),-(hu-hd)/(float(u.y-d.y)*s),1.0));
 colour=vec4(normal.xy*0.5+0.5,0,1);
}`;
// Heightfield horizon toward the light for every texel, marching through the
// finest ring that contains each sample. Each texel stores its margin below the light: the
// light's slope minus the steepest occluder slope toward it (negative in
// shadow). The margin varies continuously across the grid, so interpolating
// it puts the shadow edge where it falls inside each cell; interpolated
// visibility (nearly 0 or 1 per texel) showed every texel as a rounded
// square. Visibility, the uncovered fraction of the light's disc, is then
// computed per pixel (shadowVisibility): a physical penumbra.
const SHADOW_CODEC = `
const float SHADOW_SLOPE=2.0;
vec4 shadowEncode(float margin){float n=floor(clamp(margin/(2.0*SHADOW_SLOPE)+0.5,0.0,1.0)*65535.0+0.5),hi=floor(n/256.0);return vec4(hi,n-hi*256.0,0,255)/255.0;}
// The two bytes recombine linearly, so filtered texels decode exactly. spread
// is half the light disc's extent in slope.
float shadowVisibility(vec4 c,float spread){
 float margin=((c.r*65280.0+c.g*255.0)/65535.0-0.5)*2.0*SHADOW_SLOPE,x=clamp(margin/spread,-1.0,1.0);
 return (3.14159265-acos(x)+x*sqrt(1.0-x*x))/3.14159265;
}`;
const shadowFragment = `#version 300 es
${RINGS}
${SHADOW_CODEC}
uniform int ring,size;
uniform vec3 light;
uniform float sourceRadius,maxHeight,innerSkip,stepGrowth;
out vec4 colour;
void main(){
 float E=ringExtent[ring],horizontal=length(light.xy),alt=atan(light.z,horizontal);
 vec2 q0=gl_FragCoord.xy/float(size)*2.0*E-E;
 vec4 lit=shadowEncode(SHADOW_SLOPE);
 if(max(abs(q0.x),abs(q0.y))<innerSkip||horizontal<1e-5){colour=lit;return;}
 int k0=rings-1;
 for(int k=0;k<5;k++)if(k<rings&&max(abs(q0.x),abs(q0.y))<ringExtent[k]){k0=k;break;}
 float z0=heightAt(k0,q0);
 if(z0<-1.0e5){colour=lit;return;}
 vec2 dir=light.xy/horizontal;
 float tanAlt=light.z/horizontal,tanTop=tan(alt+sourceRadius),tanBottom=tan(alt-sourceRadius);
 // Samples sit on a world-aligned lattice along the light direction, with
 // power-of-two spacing growing with distance. Neighbouring receivers on the
 // same light line then test identical occluder points: a sharp crest is never
 // hit by one texel and missed by the next, which showed as striped shadows.
 float minStep=texelSize(k0),s0=dot(q0,dir),t=0.0,best=-1.0e9,limit=ringExtent[rings-1];
 // The smallest power-of-two multiple of the finest texel covering minStep;
 // it doubles as the distance grows (cheaper than exp2/log2 every step).
 float step=texelSize(0);
 while(step<minStep*(1.0-1e-4))step*=2.0;
 for(int s=0;s<640;s++){
  if(t*stepGrowth>step*(1.0+1e-4))step*=2.0;
  t=(floor((s0+t)/step+1e-4)+1.0)*step-s0;
  if(t<minStep*0.5)t+=step;
  vec2 q=q0+dir*t;float m=max(abs(q.x),abs(q.y));
  // Beyond the data, or the ray has climbed above every possible occluder.
  if(m>=limit||z0+t*tanBottom>maxHeight)break;
  // The finest ring holding the sample, read bilinearly, even when the step
  // spans several of its texels. Nearest texels of the coarser rings (15–60 m)
  // made occluders blocks: the horizon slope jumped between neighbouring
  // receivers, a sawtooth edge tens of metres deep at low Sun. Bilinear reads
  // of a coarse ring still bend a smooth crest at its texel period.
  int k=0;
  for(;k<rings-1;k++)if(m<ringExtent[k])break;
  best=max(best,(heightAt(k,q)-z0)/t);
  // Fully hidden, with two texels to spare in height so that interpolation
  // toward a lit neighbour still places the edge well.
  if(best>=tanTop+2.0*minStep/t)break;
 }
 colour=shadowEncode(tanAlt-best);
}`;
// Shadow ceiling for the air, in the same job and from the same heights as
// the surface shadows: above each texel, the height of the light ray that
// grazes the highest occluder toward the light (the ground where lit), and
// that occluder's distance (km) for the penumbra. Air below it is shaded.
// Unlike surface visibility, the march cannot stop at the first full
// occluder; it stops once no farther terrain can raise the ceiling.
const ceilingFragment = `#version 300 es
${RINGS}
uniform int ring,size;
uniform vec3 light;
uniform float maxHeight,innerSkip,stepGrowth;
out vec4 colour;
void main(){
 float E=ringExtent[ring],horizontal=length(light.xy);
 vec2 q0=gl_FragCoord.xy/float(size)*2.0*E-E;
 if(max(abs(q0.x),abs(q0.y))<innerSkip||horizontal<1e-5){colour=vec4(-1.0e4,0,0,1);return;}
 int k0=rings-1;
 for(int k=0;k<5;k++)if(k<rings&&max(abs(q0.x),abs(q0.y))<ringExtent[k]){k0=k;break;}
 float z0=heightAt(k0,q0);
 if(z0<-1.0e5){colour=vec4(-1.0e4,0,0,1);return;}
 vec2 dir=light.xy/horizontal;
 float tanAlt=light.z/horizontal,minStep=texelSize(k0),s0=dot(q0,dir),t=0.0,top=z0,at=0.0,limit=ringExtent[rings-1];
 float step=texelSize(0);
 while(step<minStep*(1.0-1e-4))step*=2.0;
 for(int s=0;s<640;s++){
  if(t*stepGrowth>step*(1.0+1e-4))step*=2.0;
  t=(floor((s0+t)/step+1e-4)+1.0)*step-s0;
  if(t<minStep*0.5)t+=step;
  vec2 q=q0+dir*t;float m=max(abs(q.x),abs(q.y));
  if(m>=limit||maxHeight-t*tanAlt<=top)break;
  int k=0;
  for(;k<rings-1;k++)if(m<ringExtent[k]&&texelSize(k)*2.0>=step)break;
  float c=heightAt(k,q)-t*tanAlt;
  if(c>top){top=c;at=t;}
 }
 colour=vec4(top,at/1000.0,0,1);
}`;
// Sky visibility, once per surface: the horizon in 8 directions (jittered per
// texel, then smoothed by filtering) out to 20 km; each sees cos² of its
// horizon elevation, the share of a horizontal surface's sky irradiance.
const skyFragment = `#version 300 es
${RINGS}
uniform int ring,size;
out vec4 colour;
void main(){
 float E=ringExtent[ring];
 vec2 q0=gl_FragCoord.xy/float(size)*2.0*E-E;
 int k0=rings-1;
 for(int k=0;k<5;k++)if(k<rings&&max(abs(q0.x),abs(q0.y))<ringExtent[k]){k0=k;break;}
 float z0=heightAt(k0,q0);
 if(z0<-1.0e5){colour=vec4(1);return;}
 float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453),limit=ringExtent[rings-1],seen=0.0;
 for(int a=0;a<8;a++){
  float angle=(float(a)+jitter)*0.785398;
  vec2 dir=vec2(sin(angle),cos(angle));
  float t=texelSize(k0),best=0.0;
  for(int s=0;s<80;s++){
   vec2 q=q0+dir*t;float m=max(abs(q.x),abs(q.y));
   if(m>=limit||t>20000.0)break;
   int k=0;
   for(;k<rings-1;k++)if(m<ringExtent[k]&&texelSize(k)*4.0>=t*0.12)break;
   best=max(best,(nearestHeightAt(k,q)-z0)/t);
   t*=1.12;
  }
  seen+=1.0/(1.0+best*best);
 }
 colour=vec4(seen/8.0);
}`;
const fragment = `#version 300 es
${RINGS}
in vec3 P;
uniform vec3 light, forward, right, up;
uniform vec2 size;
uniform float radius;
uniform highp sampler2D normalMap,nextNormalMap,shadowMap,nextShadowMap,levelMap,skyMap,nextSkyMap;
uniform float extent,nextExtent,waterTolerance;
uniform int ringIndex;
uniform float sunAlt, moonFlux, exposure, nearField, farField, solarFlux;
uniform bool shadows, paper, moonSource, waterColor, atmosphere, volumeShadows;
uniform highp sampler2DArray ceilingMap;
${SHADOW_CODEC}
uniform float shadowSpread;
uniform float ceilingTop, ceilingRadius, ceilingSlope;
// The app's sky model (skyraster.js), for haze that meets the visible sky.
uniform vec3 skyZenith, skyHorizon, skyIrradiance;
uniform float eyeElevation;
#define ATM_STEPS 12
${SCATTERING_GLSL}
${AERIAL_GLSL}
// The shadow ceiling of the finest ring containing p: air below it is in
// terrain shadow, with a penumbra as wide as the light's disc seen from the
// occluder.
float aerialVisibility(vec3 p,float spread){
 if(!volumeShadows||p.z>ceilingTop+spread)return 1.0;
 for(int k=0;k<5;k++){
  if(k>=rings)break;
  float E=ringExtent[k];if(max(abs(p.x),abs(p.y))>=E)continue;
  vec2 c=texture(ceilingMap,vec3((p.xy+E)/(2.0*E),float(k))).rg;
  // No occluder toward the light: the ceiling is the lit ground itself.
  if(c.g*1000.0<1.0)return 1.0;
  // Penumbra, or the height change between ray and ceiling (which descends
  // along the light) over the sample's stretch, whichever is wider.
  float w=max(max(3.0,c.g*1000.0*ceilingRadius),0.5*spread*(abs(p.z)/max(length(p),1.0)+ceilingSlope));
  return smoothstep(-w,w,p.z-c.r);
 }
 return 1.0;
}
// Land cover (compact WorldCover class indices) and the noise anchor.
precision highp usampler2D;
uniform highp usampler2D coverMap,nextCoverMap;
uniform bool hasCover,nextHasCover;
uniform vec2 noiseOrigin;
out vec4 colour;
// Surface albedo per class: unknown, tree cover, shrubland, grassland,
// cropland, built-up, bare/sparse, snow and ice, water, wetland, mangroves,
// moss and lichen. LUSH marks vegetation (cliffs within it are rock, and its
// hue varies).
const vec3 COVER[12]=vec3[12](vec3(0.2),vec3(0.075,0.105,0.06),vec3(0.15,0.16,0.10),vec3(0.17,0.21,0.10),vec3(0.21,0.21,0.13),vec3(0.25,0.23,0.21),vec3(0.42),vec3(0.80,0.82,0.86),vec3(0.06,0.09,0.11),vec3(0.12,0.15,0.10),vec3(0.07,0.10,0.06),vec3(0.20,0.21,0.15));
const float LUSH[12]=float[12](0.0,1.0,1.0,1.0,0.6,0.0,0.0,0.0,0.0,1.0,1.0,0.6);
// Neutral, light limestone grey (photos of the Garda cliffs): the warm cast
// of sunlit rock comes from the light, not the surface.
const vec3 ROCK=vec3(0.46);
vec3 slopeAlbedo(vec3 n){return mix(vec3(0.18,0.21,0.16),ROCK,1.0-smoothstep(0.15,0.65,n.z));}
vec4 material(uint c,vec3 n){
 if(c==0u)return vec4(slopeAlbedo(n),0.5);
 return vec4(mix(COVER[c],ROCK,LUSH[c]*(1.0-smoothstep(0.3,0.6,n.z))),LUSH[c]);
}
// Blend the four nearest classes' materials (bilinear in colour), so 10 m
// class edges are soft rather than blocky. Returns albedo and vegetation.
vec4 coverAt(highp usampler2D map,float E,vec2 q,vec3 n){
 ivec2 size=textureSize(map,0),m=size-1;
 vec2 t=(q+E)/(2.0*E)*vec2(size)-0.5,f=fract(t);ivec2 i=ivec2(floor(t));
 vec4 a=material(texelFetch(map,clamp(i,ivec2(0),m),0).r,n),b=material(texelFetch(map,clamp(i+ivec2(1,0),ivec2(0),m),0).r,n);
 vec4 c=material(texelFetch(map,clamp(i+ivec2(0,1),ivec2(0),m),0).r,n),d=material(texelFetch(map,clamp(i+ivec2(1,1),ivec2(0),m),0).r,n);
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
// Ground-anchored variation from a fixed random texture (R: brightness,
// G: hue) at 15, 80 and 400 m. Mipmaps average it out where a scale is
// smaller than a pixel, so distant ground never shimmers.
uniform sampler2D noiseMap;
vec2 groundNoise(vec2 w){
 vec2 total=vec2(0);
 for(int k=0;k<3;k++){
  float scale=k==0?15.0:k==1?80.0:400.0,weight=k==0?0.45:k==1?0.35:0.2;
  vec2 c=w/(scale*256.0)+float(k)*0.37;
  total+=weight*(textureGrad(noiseMap,fract(c),dFdx(c),dFdy(c)).rg*2.0-1.0);
 }
 return total;
}
vec3 srgb(vec3 c){return mix(12.92*c,1.055*pow(max(c,vec3(0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
// Direct-light attenuation uses the same spherical optical columns as sky
// and aerial perspective, including the planet's shadow and ozone.
vec3 sunlight(float alt,float h){return atmTransmission(h,sin(alt));}
vec3 unpackNormal(vec2 v){v=v*2.0-1.0;return vec3(v,sqrt(max(0.0,1.0-dot(v,v))));}
void main(){
 if(length(P.xy)<nearField || length(P.xy)>farField || dot(P,forward)<-0.2*length(P))discard;
 // Inverse-distance depth lost hundreds of metres of precision on distant
 // ridges in a 24-bit buffer. Log depth retains sub-metre separation there.
 gl_FragDepth=log2(1.0+length(P))/log2(1000001.0);
 // Near a ring's outer edge, fade into the next ring's textures so the
 // change of resolution never shows as a seam.
 vec2 uv=(P.xy+extent)/(2.0*extent),nextUV=(P.xy+nextExtent)/(2.0*nextExtent);
 float edge=nextExtent>extent?smoothstep(0.8,1.0,max(abs(P.x),abs(P.y))/extent):0.0;
 vec3 n=normalize(mix(unpackNormal(texture(normalMap,uv).rg),unpackNormal(texture(nextNormalMap,nextUV).rg),edge));
 float visible=shadows?mix(shadowVisibility(texture(shadowMap,uv),shadowSpread),edge>0.0?shadowVisibility(texture(nextShadowMap,nextUV),shadowSpread):0.0,edge):1.0;
 float skyView=mix(texture(skyMap,uv).r,texture(nextSkyMap,nextUV).r,edge);
 // Water is where the DEM lies at the local lake (or sea) level: the shoreline
 // is that DEM contour, never the coarse source outline. Level surfaces shade
 // flat so DEM noise over water cannot look like waves.
 bool lake=false;
 if(ringIndex>=0){float level=texture(levelMap,uv).r;lake=level>-1.0e5&&abs(gridHeight(ringIndex,P.xy)-level)<waterTolerance;}
 // Rivers and small lakes from land cover, where the ground is level.
 if(!lake&&hasCover&&n.z>0.97){ivec2 size=textureSize(coverMap,0);lake=texelFetch(coverMap,clamp(ivec2((P.xy+extent)/(2.0*extent)*vec2(size)),ivec2(0),size-1),0).r==8u;}
 if(lake)n=vec3(0,0,1);
 float day=smoothstep(-5.0,6.0,sunAlt),twilight=smoothstep(-18.0,-3.0,sunAlt);
 float direct=max(0.0,dot(n,light))*visible;
 // Sky light: the approved brightness levels, coloured like the sky above
 // (half-saturated) and reduced where terrain hides the sky.
 vec3 skyLight=skyZenith*0.6+skyHorizon*0.4;
 skyLight=paper?vec3(1):mix(vec3(1),skyLight/max(1e-4,dot(skyLight,vec3(0.2126,0.7152,0.0722))),0.5);
 float diffuse=(0.16*day+0.008*twilight*(1.0-day))*(paper?1.0:skyView/0.85);
 diffuse*=0.65+0.35*max(n.z,0.0);
 if(paper)diffuse+=0.34*day*(0.8+0.2*max(n.z,0.0));
 float strength=moonSource?moonFlux:solarFlux;
 // Absolute height of this point (P.z includes the curvature drop).
 float d2=dot(P.xy,P.xy),height=eyeElevation+P.z+0.87*d2/(2.0*EARTH);
 vec3 radial=normalize(vec3(P.xy,ATM_R+eyeElevation+P.z));
 vec3 tint=atmosphere&&!paper?sunlight(asin(clamp(dot(radial,light),-1.0,1.0)),height):vec3(1);
 vec3 albedo=vec3(0.79);
 if(!paper){
  vec4 surface=hasCover?coverAt(coverMap,extent,P.xy,n):vec4(slopeAlbedo(n),0.5);
  if(edge>0.0&&nextHasCover)surface=mix(surface,coverAt(nextCoverMap,nextExtent,P.xy,n),edge);
  albedo=surface.rgb;
  // Patches of lighter and darker ground, and yellower or bluer vegetation.
  vec2 w=P.xy+noiseOrigin;
  vec2 variation=groundNoise(w);
  albedo*=1.0+0.13*variation.x;
  float hue=0.14*surface.a*variation.y;
  albedo*=vec3(1.0+hue,1.0,1.0-hue);
 }
 if(lake)albedo=waterColor?vec3(0.035,0.14,0.34):(paper?vec3(0.83):vec3(0.10,0.19,0.21));
 // Night adaptation applies to weak moonlight/ambient light, never sunlight
 // or twilight. Amplifying twilight here made mountains turn white at dusk.
 float adaptation=mix(4000.0,1.0,max(day,twilight*0.9));
 vec3 sun=strength*(paper?0.4:0.8)*(moonSource?adaptation:1.0)*tint;
 // Light reflected from sunlit ground onto slopes that see less sky.
 vec3 bounce=paper?vec3(0):sun*max(light.z,0.0)*0.2*0.5*(1.0-skyView)*(1.0-max(n.z,0.0)*0.5);
 vec3 radiance=albedo*(diffuse*skyLight+0.00000008*adaptation+sun*direct+bounce);
 if(atmosphere&&!paper){
  // Lambertian reflection of direct irradiance and the integrated sky.
  // The sky and terrain share exposure before final display conversion.
  float incident=moonSource?scatteringMoonFlux:scatteringSolarFlux;
  radiance=albedo*(skyIrradiance*skyView*(0.5+0.5*max(n.z,0.0))+tint*incident*direct)/3.141592653589793*scatteringExposure;
 }
 // Soft shoulder instead of clipping; unchanged below 0.8.
 vec3 x=radiance*exposure;
 if(!atmosphere||paper)x=mix(x,0.8+0.2*(1.0-exp(-(x-0.8)/0.2)),step(vec3(0.8),x));
 vec3 c=srgb(x);
 if(paper){
  float fog=(1.0-exp(-length(P.xy)/45000.0))*max(day,twilight*0.4);
  c=mix(c,mix(vec3(0.004,0.006,0.012),vec3(0.97),max(day,twilight*0.45)),fog*0.7);
 }else if(atmosphere){
  // Finite-path radiative transfer. In-scattering is integrated only up
  // to this mountain, not approximated by mixing toward a distant sky.
  vec3 T,air=aerialShadowedAt(P,fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715)))),T);
  c=atmSRGB(atmLinearDisplay(x*T+air));
 }
 // Dither by under half an 8-bit step, as the sky: haze gradients band too.
 c+=(fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))-0.5)/255.0;
 colour=vec4(c,1);
}`;
const postFragment = `#version 300 es
precision highp float;
in vec2 uv;
uniform highp sampler2D image,depth;
uniform bool outlines,edgeAA;
out vec4 colour;
float distanceAt(vec2 p){return exp2(texture(depth,p).r*log2(1000001.0))-1.0;}
void main(){vec4 sampleColor=texture(image,uv);
// Filter coverage only at transparent boundaries. Interior terrain keeps its
// full detail, with one shaded sample per pixel rather than multisample cost.
if(edgeAA){
 vec2 px=1.0/vec2(textureSize(image,0));
 vec4 a=texture(image,uv+vec2(px.x,0)),b=texture(image,uv-vec2(px.x,0));
 vec4 c=texture(image,uv+vec2(0,px.y)),d=texture(image,uv-vec2(0,px.y));
 if(a.a!=sampleColor.a||b.a!=sampleColor.a||c.a!=sampleColor.a||d.a!=sampleColor.a)sampleColor=(sampleColor*4.0+a+b+c+d)/8.0;
}
// Coverage filtering averages against transparent black. Undo that
// premultiplication for this straight-alpha canvas to avoid a dark fringe.
vec3 c=sampleColor.a>0.0?sampleColor.rgb/sampleColor.a:vec3(0);
if(outlines && texture(depth,uv).r<1.0){vec2 px=1.0/vec2(textureSize(depth,0));float d=distanceAt(uv),edge=0.0;
for(int k=0;k<4;k++){vec2 o=k==0?vec2(1,0):k==1?vec2(-1,0):k==2?vec2(0,1):vec2(0,-1);float nextD=distanceAt(uv+o*px);edge=max(edge,smoothstep(0.06,0.22,(nextD-d)/max(d,1.0)));}
c*=1.0-edge*0.58;}
colour=vec4(c,sampleColor.a);}`;
function program(gl, vs, fs) {
  const shaders = [vs, fs].map((code, i) => { const s = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER); gl.shaderSource(s, code); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; });
  const p = gl.createProgram(); shaders.forEach((s) => gl.attachShader(p, s)); gl.linkProgram(p); shaders.forEach((s) => gl.deleteShader(s)); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
}
// Angular radii of the light sources' discs, for the penumbra.
const SUN_RADIUS = 0.2666 * Math.PI / 180, MOON_RADIUS = 0.259 * Math.PI / 180;
// Half the light disc's extent in slope (tan), seen along the light's azimuth.
const shadowSpread = (light, r) => { const alt = Math.atan2(light[2], Math.hypot(light[0], light[1])); return (Math.tan(Math.min(alt + r, 1.5)) - Math.tan(Math.max(alt - r, -1.5))) / 2; };
export const terrainShadowSize = gridSize => Math.min(1024, gridSize);
export function createTerrainRenderer(canvas, { antialias = true, shadowStep = 0.0125 } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('Terrain shading requires WebGL2');
  const scene = program(gl, vertex, fragment), post = program(gl, screenVertex, postFragment);
  const transport=scatteringUniforms(gl,scene),aerial=createAerialPerspective(gl);
  const normalPass = program(gl, screenVertex, normalFragment), shadowPass = program(gl, screenVertex, shadowFragment), skyPass = program(gl, screenVertex, skyFragment), ceilingPass = program(gl, screenVertex, ceilingFragment);
  // Shadow ceilings need half-float render targets; without them the air is unshadowed.
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  let ceilings = null, shownRadius = SUN_RADIUS, shownSpread = SUN_RADIUS;
  const empty = gl.createVertexArray(), anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  let meshes = [], heights = null, maxHeight = 0, framebuffer, image, depth, w = 0, h = 0, destroyed = false;
  const locations=new Map();
  const u = (p, name) => {let names=locations.get(p);if(!names){names=new Map();locations.set(p,names);}if(!names.has(name))names.set(name,gl.getUniformLocation(p,name));return names.get(name);};
  function disposeFrame(){
    if(framebuffer){gl.deleteFramebuffer(framebuffer);gl.deleteTexture(image);gl.deleteTexture(depth);}
  }
  function texture(internal, format, type, width, height, { mipmaps = false, filter = gl.NEAREST, data = null } = {}) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (mipmaps) gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(width, height))) + 1, internal, width, height);
    else gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Terrain is seen at grazing angles: isotropic mipmaps alone blur it.
    if (mipmaps && anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }
  // Meshes without height grids (synthetic tests) shade as level, unshadowed.
  const flatNormal = texture(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, 1, 1, { data: new Uint8Array([128, 128]) });
  const fullLight = texture(gl.R8, gl.RED, gl.UNSIGNED_BYTE, 1, 1, { data: new Uint8Array([255]) });
  // Encoded shadow texel for full light (SHADOW_CODEC: the largest margin).
  const litShadow = texture(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, 1, 1, { data: new Uint8Array([255, 255]) });
  const noWater = texture(gl.R32F, gl.RED, gl.FLOAT, 1, 1, { data: new Float32Array([-1e6]) });
  const noCeiling = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, noCeiling); gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const noCover = texture(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 1, 1, { data: new Uint8Array([0]) });
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  // Fixed-seed random texture for ground variation (deterministic everywhere).
  const noise = (() => {
    const t = gl.createTexture(), data = new Uint8Array(256 * 256 * 4);
    let seed = 0x9e3779b9;
    for (let i = 0; i < data.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[i] = (seed >>> 0) & 255; }
    gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  })();
  function target(tex) { const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Terrain texture framebuffer unavailable'); return fbo; }
  function ringUniforms(p, rings) {
    gl.useProgram(p);
    gl.uniform1fv(u(p, 'ringExtent'), Float32Array.from({ length: 5 }, (_, k) => rings[k]?.extent ?? 1));
    gl.uniform1fv(u(p, 'ringScale'), Float32Array.from({ length: 5 }, (_, k) => rings[k]?.scale ?? 1));
    gl.uniform1fv(u(p, 'ringOffset'), Float32Array.from({ length: 5 }, (_, k) => rings[k]?.offset ?? 0));
    gl.uniform1iv(u(p, 'ringSize'), Int32Array.from({ length: 5 }, (_, k) => rings[k]?.size ?? 1));
    gl.uniform1fv(u(p, 'ringTexel'), Float32Array.from({ length: 5 }, (_, k) => rings[k] ? rings[k].extent * 2 / rings[k].size : 1));
    gl.uniform1i(u(p, 'rings'), rings.length); gl.uniform1i(u(p, 'heights'), 0);
  }
  // Land-cover materials, unless the muted-earth or pale-relief style is drawn.
  let useCover=true;
  function drawMeshes(forward=null,viewAngle=0) {
    let triangles=0;
    meshes.forEach((m,i)=>{
      const next=m.grid&&meshes[i+1]?.grid?meshes[i+1]:m;
      [[m.normal,m.grid?m.normal:flatNormal],[next.normal,next.grid?next.normal:flatNormal],[m.shadow,m.grid?m.shadow:litShadow],[next.shadow,next.grid?next.shadow:litShadow]].forEach(([,tex],unit)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);});
      gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,m.sky??fullLight);gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,next.sky??fullLight);
      gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_2D,m.cover??noCover);gl.activeTexture(gl.TEXTURE9);gl.bindTexture(gl.TEXTURE_2D,next.cover??noCover);
      gl.uniform1i(u(scene,'hasCover'),useCover&&!!m.cover);gl.uniform1i(u(scene,'nextHasCover'),useCover&&!!next.cover);
      gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,m.level??noWater);gl.uniform1i(u(scene,'ringIndex'),m.level?m.ringIndex:-1);
      gl.uniform1f(u(scene,'extent'),m.grid?.extent??1e9);gl.uniform1f(u(scene,'nextExtent'),next.grid?.extent??1e9);
      gl.bindVertexArray(m.vao);
      if(!forward){gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_INT,0);triangles+=m.count/3;return;}
      for(const group of m.groups){
        const angle=viewAngle+group.angle;if(group.angle<Math.PI/2&&angle<Math.PI&&group.axis.reduce((s,v,i)=>s+v*forward[i],0)<Math.cos(angle)-1e-6)continue;
        gl.drawElements(gl.TRIANGLES,group.count,gl.UNSIGNED_INT,group.offset);triangles+=group.count/3;
      }
    });
    return triangles;
  }
  function disposeMeshes() {
    for (const m of meshes) { gl.deleteVertexArray(m.vao); m.buffers.forEach((b) => gl.deleteBuffer(b)); if (m.level) gl.deleteTexture(m.level); if (m.cover) gl.deleteTexture(m.cover); for (const name of ['normal', 'shadow', 'shadowBack', 'sky']) if (m[name]) { gl.deleteTexture(m[name]); gl.deleteFramebuffer(m[name + 'Target']); } }
    if (heights) gl.deleteTexture(heights);
    if (ceilings) { gl.deleteTexture(ceilings.front); gl.deleteTexture(ceilings.back); [...ceilings.frontTargets, ...ceilings.backTargets].forEach(f => gl.deleteFramebuffer(f)); }
    meshes = []; heights = null; ceilings = null;
  }
  // Light-dependent pass: one horizon march per shadow texel, then mipmaps.
  // Work is split into horizontal bands rendered into back textures; a
  // finished set replaces the visible one at once. Progressive drawing paces
  // the bands per frame (possibly fewer than one) on the frame interval that
  // the scene takes without shadow work, measured on frames that have none:
  // every 30th frame skips it on purpose. Shadows may lag; the frame rate
  // comes first. A started update finishes with its own light first.
  let shownKey = '', job = null;
  const pace = { rate: 1, credit: 0, base: 0, probeIn: 3, idle: true, last: 0 };
  const sync = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  function shadowJob(light, sourceRadius, key) {
    const rings = meshes.filter(m => m.grid), bands = [];
    rings.forEach((m, k) => { const S = m.shadowSize, rows = Math.max(8, Math.ceil(S / 64)); for (let y = 0; y < S; y += rows) bands.push({ m, k, y, rows: Math.min(rows, S - y) }); });
    if (ceilings) rings.forEach((m, k) => { const S = ceilings.size; for (let y = 0; y < S; y += 16) bands.push({ ceiling: true, k, y, rows: Math.min(16, S - y) }); });
    return { light, sourceRadius, key, rings, bands };
  }
  function runShadowJob(count) {
    const { rings } = job;
    gl.disable(gl.DEPTH_TEST); gl.useProgram(shadowPass); gl.bindVertexArray(empty);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, heights);
    gl.uniform3fv(u(shadowPass, 'light'), job.light); gl.uniform1f(u(shadowPass, 'sourceRadius'), job.sourceRadius); gl.uniform1f(u(shadowPass, 'maxHeight'), maxHeight); gl.uniform1f(u(shadowPass, 'stepGrowth'), shadowStep);
    gl.enable(gl.SCISSOR_TEST);
    let done = 0;
    for (let n = 0; n < count && job.bands.length; n++) {
      if (job.bands[0].ceiling) {
        const { k, y, rows } = job.bands.shift(), S = ceilings.size;
        gl.useProgram(ceilingPass);
        gl.uniform3fv(u(ceilingPass, 'light'), job.light); gl.uniform1f(u(ceilingPass, 'maxHeight'), maxHeight); gl.uniform1f(u(ceilingPass, 'stepGrowth'), shadowStep);
        gl.bindFramebuffer(gl.FRAMEBUFFER, ceilings.backTargets[k]); gl.viewport(0, 0, S, S); gl.scissor(0, y, S, rows);
        gl.uniform1i(u(ceilingPass, 'ring'), k); gl.uniform1i(u(ceilingPass, 'size'), S);
        gl.uniform1f(u(ceilingPass, 'innerSkip'), k ? rings[k - 1].grid.extent - 4 * rings[k].grid.extent / S : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3); gl.useProgram(shadowPass); done += S * rows; continue;
      }
      const { m, k, y, rows } = job.bands.shift(), S = m.shadowSize;
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.shadowBackTarget); gl.viewport(0, 0, S, S); gl.scissor(0, y, S, rows);
      gl.uniform1i(u(shadowPass, 'ring'), k); gl.uniform1i(u(shadowPass, 'size'), S);
      // Hollow centres are never drawn, except where the finer ring fades in.
      gl.uniform1f(u(shadowPass, 'innerSkip'), k ? rings[k - 1].grid.extent * 0.75 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3); done += S * rows;
    }
    gl.disable(gl.SCISSOR_TEST);
    if (!job.bands.length) {
      for (const m of rings) {
        [m.shadow, m.shadowBack] = [m.shadowBack, m.shadow]; [m.shadowTarget, m.shadowBackTarget] = [m.shadowBackTarget, m.shadowTarget];
        gl.bindTexture(gl.TEXTURE_2D, m.shadow); gl.generateMipmap(gl.TEXTURE_2D);
      }
      if (ceilings) { [ceilings.front, ceilings.back] = [ceilings.back, ceilings.front]; [ceilings.frontTargets, ceilings.backTargets] = [ceilings.backTargets, ceilings.frontTargets]; ceilings.ready = true; }
      shownKey = job.key; shownRadius = job.sourceRadius; shownSpread = shadowSpread(job.light, job.sourceRadius); job = null;
    }
    return done;
  }
  return {
    setMeshes(data) {
      disposeMeshes(); shownKey = ''; job = null;
      if (data.filter(m => m.grid).length > 5) throw new Error('At most five terrain rings are supported');
      meshes = data.map((m) => {
        const vao = gl.createVertexArray(), buffers = []; gl.bindVertexArray(vao);
        const packed=terrainGpuMesh(m),vertexBuffer=gl.createBuffer();buffers.push(vertexBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,packed.vertices,gl.STATIC_DRAW);
        const stride=TERRAIN_VERTEX_STRIDE*4;
        gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0);
        const grouped=m.groups?{indices:packed.indices,groups:m.groups}:terrainDrawGroups(packed),b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,grouped.indices,gl.STATIC_DRAW);
        return { vao, buffers, count: m.indices.length, groups:grouped.groups, grid: m.grid ? { size: m.grid.size, extent: m.grid.extent, scale: m.grid.scale, offset: m.grid.offset } : null, source: m.grid, waterSource: m.water, coverSource: m.cover };
      });
      gl.bindVertexArray(null);
      const rings = meshes.filter(m => m.grid);
      if (!rings.length) return;
      // All grids in one 16-bit array texture so the shadow march can switch
      // rings per sample; smaller grids use the corner of their layer.
      const layer = Math.max(...rings.map(m => m.grid.size));
      heights = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, heights);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R16UI, layer, layer, rings.length);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
      maxHeight = -Infinity;
      rings.forEach((m, k) => {
        const { heights: values, size, scale, offset } = m.source;
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, size, size, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, values);
        let top = 0; for (const v of values) if (v !== 65535 && v > top) top = v;
        maxHeight = Math.max(maxHeight, top * scale + offset);
        m.normal = texture(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, size, size, { mipmaps: true, filter: gl.LINEAR }); m.normalTarget = target(m.normal);
        m.shadowSize = terrainShadowSize(size);
        // A 16-bit margin in a byte pair (SHADOW_CODEC): linear in each
        // channel, so filtering and mipmaps work on every device.
        m.shadow = texture(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, m.shadowSize, m.shadowSize, { mipmaps: true, filter: gl.LINEAR }); m.shadowTarget = target(m.shadow);
        m.shadowBack = texture(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, m.shadowSize, m.shadowSize, { mipmaps: true, filter: gl.LINEAR }); m.shadowBackTarget = target(m.shadowBack);
        if (m.coverSource) { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); m.cover = texture(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, m.coverSource.size, m.coverSource.size, { data: m.coverSource.classes }); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2); }
        delete m.coverSource;
        m.skySize = Math.max(64, m.shadowSize >> 1);
        m.sky = texture(gl.R8, gl.RED, gl.UNSIGNED_BYTE, m.skySize, m.skySize, { mipmaps: true, filter: gl.LINEAR }); m.skyTarget = target(m.sky);
        // Water levels: nearest lookup, so neighbouring lakes never blend.
        if (m.waterSource) { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); m.level = texture(gl.R32F, gl.RED, gl.FLOAT, m.waterSource.size, m.waterSource.size, { data: Float32Array.from(m.waterSource.levels, v => Number.isFinite(v) ? v : -1e6) }); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2); }
        m.ringIndex = k;
        delete m.source; delete m.waterSource;
      });
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      if (floatTargets) {
        const S = Math.min(256, Math.max(...rings.map(m => m.shadowSize))), make = () => {
          const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t); gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG16F, S, S, rings.length);
          for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, v);
          const targets = rings.map((_, k) => { const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, k); return fbo; });
          return [t, targets];
        };
        const [front, frontTargets] = make(), [back, backTargets] = make();
        ceilings = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE ? { size: S, front, back, frontTargets, backTargets, ready: false } : null;
        if (!ceilings) { [front, back].forEach(t => gl.deleteTexture(t)); [...frontTargets, ...backTargets].forEach(f => gl.deleteFramebuffer(f)); }
      }
      for (const p of [normalPass, shadowPass, skyPass, ceilingPass, scene]) ringUniforms(p, rings.map(m => m.grid));
      gl.useProgram(normalPass); gl.bindVertexArray(empty); gl.disable(gl.DEPTH_TEST);
      rings.forEach((m, k) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.normalTarget); gl.viewport(0, 0, m.grid.size, m.grid.size);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, heights);
        gl.uniform1i(u(normalPass, 'ring'), k); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, m.normal); gl.generateMipmap(gl.TEXTURE_2D);
      });
      gl.useProgram(skyPass);
      rings.forEach((m, k) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.skyTarget); gl.viewport(0, 0, m.skySize, m.skySize);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, heights);
        gl.uniform1i(u(skyPass, 'ring'), k); gl.uniform1i(u(skyPass, 'size'), m.skySize); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, m.sky); gl.generateMipmap(gl.TEXTURE_2D);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    // profile: wait for the GPU after each pass (diagnostics only: it stalls).
    draw({ W, H, radius, rotation, moving = false, sun, moon, flux, lightingSunAlt = sun.alt, solarFlux = 1, shadows = true, paper = false, outlines = false, exposure = 1, nearField = 100, farField = 150000, waterColor = true, landCover = true, cull = true, profile = false, progressive = false, atmosphere = true, atmosphereSettings = null, eyeElevation = 0, sky = null, noiseOrigin = [0, 0] }) {
      if (destroyed || gl.isContextLost()) return;
      const start = performance.now(), scale = moving ? Math.min(1, Math.sqrt(900000 / (W * H))) : Math.min(1.5, devicePixelRatio || 1), width = Math.max(1,Math.round(W * scale)), height = Math.max(1,Math.round(H * scale));
      if (width !== w || height !== h) {
        w = canvas.width = width; h = canvas.height = height;
        disposeFrame();
        image = texture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, w, h); depth = texture(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, w, h);
        framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Scene framebuffer unavailable');
      }
      const moonSource = sun.alt < -6, source = moonSource ? moon : sun, light = lightVector(source.az, source.alt);
      // Shadows follow a light direction quantised to 0.05°, so ordinary
      // playback reuses them; diffuse lighting uses the exact direction.
      const mapLight = lightVector(Math.round(source.az*20)/20, Math.round(source.alt*20)/20), key = JSON.stringify([mapLight, moonSource]);
      let shadowMs = 0, shadowGpuMs = 0, shadowTexels = 0;
      if (shadows && heights && (job || shownKey !== key)) {
        const t0 = performance.now();
        // In sync, an unfinished job for an older light is dropped, not finished.
        if (!progressive && job && job.key !== key) job = null;
        if (!job) job = shadowJob(mapLight, moonSource ? MOON_RADIUS : SUN_RADIUS, key);
        // The first shadows of a surface appear complete, and time each ring.
        // The first shadows of a surface appear complete.
        if (!progressive || !shownKey) shadowTexels = runShadowJob(Infinity);
        else {
          // This frame's interval reflects the previous frame's work (pauses
          // over 250 ms are idle, not slow).
          const gap = pace.last ? t0 - pace.last : 0;
          if (gap > 0 && gap < 250) {
            if (pace.idle) pace.base = pace.base ? 0.7 * pace.base + 0.3 * gap : gap;
            else if (pace.base) {
              if (gap <= pace.base * 1.15) pace.rate = Math.min(64, pace.rate * 1.15 + 0.1);
              else if (gap > pace.base * 1.35) pace.rate = Math.max(0.2, pace.rate * 0.6);
            }
          }
          if (--pace.probeIn <= 0 || !pace.base) pace.probeIn = 30;
          else {
            pace.credit = Math.min(pace.credit + pace.rate, 64);
            const n = Math.floor(pace.credit); pace.credit -= n;
            shadowTexels = n ? runShadowJob(n) : 0;
          }
        }
        if (profile) { sync(); shadowGpuMs = performance.now() - t0; }
        shadowMs = performance.now() - t0;
      }
      const physical=atmosphere?(sky?.physical||physicalSky(atmosphereSettings,eyeElevation,{alt:sun.alt,vector:lightVector(sun.az,sun.alt),flux:solarFlux},moon?{alt:moon.alt,vector:lightVector(moon.az,moon.alt),illum:(1+Math.cos((moon.phase??180)*Math.PI/180))/2}:null)):null;
      const aerialStart=performance.now();
      if(physical&&!paper)aerial.render(physical,{W,H,radius,rotation,farField});
      if(profile)sync();const aerialMs=performance.now()-aerialStart;
      const sceneStart = performance.now();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const r=rotation.slice(0,3), up=rotation.slice(3,6), forward=rotation.slice(6,9);
      gl.useProgram(scene); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.CULL_FACE);
      for (const [name, v] of Object.entries({ right: r, up, forward, light })) gl.uniform3fv(u(scene, name), v);
      gl.uniform2f(u(scene,'size'),W,H); gl.uniform1f(u(scene,'radius'),radius);
      gl.uniform1f(u(scene, 'sunAlt'), lightingSunAlt); gl.uniform1f(u(scene, 'solarFlux'), solarFlux); gl.uniform1f(u(scene, 'moonFlux'), flux); gl.uniform1f(u(scene, 'exposure'), exposure); gl.uniform1f(u(scene, 'nearField'), nearField);
      gl.uniform1f(u(scene,'farField'),farField);
      const volumeShadows = !!(shadows && atmosphere && !paper && ceilings?.ready);
      for (const [name, value] of Object.entries({ shadows, paper, moonSource, waterColor, volumeShadows })) gl.uniform1i(u(scene, name), value);
      gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D_ARRAY, ceilings?.front ?? noCeiling); gl.uniform1i(u(scene, 'ceilingMap'), 13);
      gl.uniform1f(u(scene, 'shadowSpread'), shownSpread); gl.uniform1f(u(scene, 'ceilingTop'), maxHeight); gl.uniform1f(u(scene, 'ceilingRadius'), shownRadius); gl.uniform1f(u(scene, 'ceilingSlope'), Math.min(1, Math.abs(Math.tan(source.alt * Math.PI / 180))));
      ['normalMap','nextNormalMap','shadowMap','nextShadowMap','heights','levelMap','skyMap','nextSkyMap','coverMap','nextCoverMap','noiseMap'].forEach((name,i)=>gl.uniform1i(u(scene,name),i));
      gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, noise);
      gl.uniform2fv(u(scene,'noiseOrigin'),noiseOrigin);

      if(physical){transport.set(physical,11);if(!paper)aerial.bind(scene);}
      const skyColour=sky||{zenith:[0.13,0.32,0.72],horizon:[0.6,0.73,0.88]};
      gl.uniform3fv(u(scene,'skyIrradiance'),physical?.irradiance||[0,0,0]);
      gl.uniform3fv(u(scene,'skyZenith'),skyColour.zenith);gl.uniform3fv(u(scene,'skyHorizon'),skyColour.horizon);
      gl.uniform1f(u(scene,'eyeElevation'),eyeElevation);gl.uniform1i(u(scene,'atmosphere'),atmosphere);gl.uniform1f(u(scene,'waterTolerance'),WATER_TOLERANCE);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D_ARRAY,heights);
      useCover=landCover;
      const drawnTriangles=drawMeshes(cull?forward:null,2*Math.atan(Math.hypot(W,H)/(2*radius))); gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,w,h); gl.bindVertexArray(empty); gl.useProgram(post);
      for (const [i, tex] of [image, depth].entries()) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u(post, i ? 'depth' : 'image'), i); }
      gl.uniform1i(u(post, 'outlines'), outlines);gl.uniform1i(u(post,'edgeAA'),antialias===true); gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (profile) sync();
      // The next interval measures the bare scene if this frame did no shadows.
      if (progressive) { pace.last = start; pace.idle = !shadowTexels; }
      return { canvas, submitMs: performance.now() - start, shadowMs, shadowGpuMs, shadowTexels, // Also pending when the finished shadows are for an older light (the light
      // moved while they were computed): they must catch up once paused.
      shadowsPending: !!job || (shadows && !!heights && shownKey !== key), shadowBands: Math.round(pace.rate * 10) / 10, aerialBuilds:aerial.builds, aerialMs, volumeShadows, sceneGpuMs: profile ? performance.now() - sceneStart : 0, width: w, height: h, antialias, drawnTriangles, glError: profile ? gl.getError() : 0 };
    },
    // Diagnostics: the current visibility texture of grid ring k (row-major,
    // texel centres as for the height grid, 0 = fully shadowed, 255 = lit).
    // margin (light slope minus horizon slope) is the stored value.
    readShadow(k) {
      const m = meshes.filter(m => m.grid)[k], n = m.shadowSize, rgba = new Uint8Array(n * n * 4), values = new Uint8Array(n * n), margin = new Float32Array(n * n);
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.shadowTarget); gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, rgba); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (let i = 0; i < values.length; i++) {
        margin[i] = ((rgba[i * 4] * 256 + rgba[i * 4 + 1]) / 65535 - 0.5) * 4;
        const x = Math.max(-1, Math.min(1, margin[i] / shownSpread));
        values[i] = Math.round(255 * (Math.PI - Math.acos(x) + x * Math.sqrt(1 - x * x)) / Math.PI);
      }
      return { size: n, extent: m.grid.extent, values, margin };
    },
    // Diagnostics: the shown shadow ceilings of ring k (metres above the eye,
    // texel centres; null without half-float targets or before the first job).
    readCeiling(k) {
      if (!ceilings?.ready) return null;
      const n = ceilings.size, rgba = new Float32Array(n * n * 4), values = new Float32Array(n * n), distance = new Float32Array(n * n);
      gl.bindFramebuffer(gl.FRAMEBUFFER, ceilings.frontTargets[k]); gl.readPixels(0, 0, n, n, gl.RGBA, gl.FLOAT, rgba); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (let i = 0; i < values.length; i++) { values[i] = rgba[i * 4]; distance[i] = rgba[i * 4 + 1] * 1000; }
      return { size: n, extent: meshes.filter(m => m.grid)[k].grid.extent, values, distance };
    },
    destroy() { aerial.dispose();transport.dispose(); destroyed = true; disposeMeshes(); [scene, post, normalPass, shadowPass, skyPass, ceilingPass].forEach((p) => gl.deleteProgram(p)); gl.deleteTexture(noCeiling); gl.deleteVertexArray(empty); gl.deleteTexture(flatNormal); gl.deleteTexture(fullLight); gl.deleteTexture(litShadow); gl.deleteTexture(noWater); gl.deleteTexture(noCover); gl.deleteTexture(noise); disposeFrame(); },
  };
}
