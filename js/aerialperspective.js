// Camera-space finite-path transport, amortized across terrain fragments.
// A small volume stores in-scattering and transmission, not surface colours.
// It is unshadowed, so it varies smoothly and interpolates without blocks
// at silhouettes: each terrain pixel removes the single-scattered light of
// the air in terrain shadow along its own ray (aerialShadowedAt).
import {SCATTERING_GLSL,scatteringUniforms} from './scattering.js';
const NX=32,NY=24,NZ=20,WIDTH=NX*NZ,HEIGHT=NY;
const VERTEX=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const FRAGMENT=`#version 300 es
precision highp float;
#define ATM_STEPS 12
${SCATTERING_GLSL}
uniform vec3 cameraRight,cameraUp,cameraForward;
uniform vec2 cameraSize;
uniform float cameraRadius,aerialFar;
layout(location=0) out vec4 radiance;
layout(location=1) out vec4 transmission;
layout(location=2) out vec4 single;
void main(){
 float slice=floor(gl_FragCoord.x/32.0),x=mod(gl_FragCoord.x,32.0),y=gl_FragCoord.y;
 vec2 uv=(vec2(x,y)-0.5)/vec2(31,23),screen=(uv-0.5)*cameraSize/cameraRadius;
 float rr=length(screen),angle=2.0*atan(rr),k=rr>1e-9?-sin(angle)/rr:0.0;
 vec3 v=cameraRight*screen.x*k-cameraUp*screen.y*k+cameraForward*cos(angle);
 float distance=300.0*(exp(log(1.0+aerialFar/300.0)*slice/19.0)-1.0);
 vec3 T,S,L=atmRadiance(v,distance,T,S)*scatteringExposure;S*=scatteringExposure;
 // Bounded encoding also works without floating-point render targets.
 radiance=vec4(L/(1.0+L),1);transmission=vec4(T,1);single=vec4(S/(1.0+S),1);
}`;
// The includer defines aerialVisibility(p): the visible fraction of the
// shadowing light's disc at p (camera-centred metres), 1 without shadows;
// spread (metres along the ray) is the stretch the sample stands for, over
// which its visibility is averaged.
export const AERIAL_GLSL=`
uniform sampler2D aerialRadiance,aerialTransmission,aerialSingle;
uniform float aerialFar;
float aerialVisibility(vec3 p,float spread);
vec3 aerialSlice(sampler2D map,vec2 uv,float slice){return texture(map,vec2((slice*32.0+0.5+clamp(uv.x,0.0,1.0)*31.0)/640.0,(0.5+clamp(uv.y,0.0,1.0)*23.0)/24.0)).rgb;}
vec3 aerialDecode(vec3 c){return c/max(vec3(1e-5),1.0-c);}
vec2 aerialUV(vec3 P){float d=length(P),w=max(d+dot(P,forward),0.001);return vec2(0.5-radius*dot(P,right)/(w*size.x),0.5+radius*dot(P,up)/(w*size.y));}
float aerialSliceAt(float d){return clamp(log(1.0+d/300.0)/log(1.0+aerialFar/300.0)*19.0,0.0,19.0);}
vec3 aerialAt(vec3 P,out vec3 T){
 vec2 uv=aerialUV(P);
 float z=aerialSliceAt(length(P)),a=floor(z),b=min(a+1.0,19.0),f=z-a;
 T=mix(aerialSlice(aerialTransmission,uv,a),aerialSlice(aerialTransmission,uv,b),f);
 return mix(aerialDecode(aerialSlice(aerialRadiance,uv,a)),aerialDecode(aerialSlice(aerialRadiance,uv,b)),f);
}
// Only single scattering (direct light on the air) is removed where the air
// is in terrain shadow; skylight on the air (multiple scattering) is not.
// Samples on this pixel's own ray are distributed like the in-scattered
// light, which falls off as the transmission back to the eye: uniform in
// u=(1-exp(-b s))/(1-exp(-b d)), stratified and jittered, each sample
// filtered over its own stretch of the ray (no grain, no depth contours). Shadow fractions never mix rays across a silhouette.
#define AERIAL_SHADOW_SAMPLES 10
vec3 aerialShadowedAt(vec3 P,float jitter,out vec3 T){
 vec3 L=aerialAt(P,T);
 vec2 uv=aerialUV(P);float d=max(length(P),1.0),z=aerialSliceAt(d),a=floor(z);
 vec3 S=mix(aerialDecode(aerialSlice(aerialSingle,uv,a)),aerialDecode(aerialSlice(aerialSingle,uv,min(a+1.0,19.0))),z-a);
 float b=-log(clamp(T.g,1e-4,1.0))/d,span=1.0-exp(-b*d),shaded=0.0;
 for(int i=0;i<AERIAL_SHADOW_SAMPLES;i++){
  float u=(float(i)+jitter)/float(AERIAL_SHADOW_SAMPLES),s=b*d>1e-3?-log(1.0-u*span)/b:u*d;
  float spread=(b*d>1e-3?span/(b*(1.0-u*span)):d)/float(AERIAL_SHADOW_SAMPLES);
  shaded+=1.0-aerialVisibility(P*(s/d),spread);
 }
 return max(L-S*shaded/float(AERIAL_SHADOW_SAMPLES),vec3(0));
}
`;
export function createAerialPerspective(gl){
 const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const program=gl.createProgram(),vs=shader(gl.VERTEX_SHADER,VERTEX),fs=shader(gl.FRAGMENT_SHADER,FRAGMENT);
 gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 const transport=scatteringUniforms(gl,program),vao=gl.createVertexArray(),fbo=gl.createFramebuffer(),textures=[gl.createTexture(),gl.createTexture(),gl.createTexture()];
 const floating=!!gl.getExtension('EXT_color_buffer_float');
 gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
 textures.forEach((t,i)=>{gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,floating?gl.RGBA16F:gl.RGBA8,WIDTH,HEIGHT,0,gl.RGBA,floating?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0);});
 gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2]);
 if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Aerial volume framebuffer is unavailable');
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);let previous=null,far=150000,builds=0;
 const loc=n=>gl.getUniformLocation(program,n);
 return {render(sky,{W,H,radius,rotation,farField}){
  far=farField;const key=[sky.medium.key,sky.height,...sky.sun,...sky.moon,sky.moonFlux,sky.solarFlux,sky.exposure,W,H,radius,...rotation,far].join(':');
  if(key===previous)return;previous=key;builds++;
  gl.useProgram(program);transport.set(sky,0);gl.bindVertexArray(vao);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
  gl.uniform3fv(loc('cameraRight'),rotation.slice(0,3));gl.uniform3fv(loc('cameraUp'),rotation.slice(3,6));gl.uniform3fv(loc('cameraForward'),rotation.slice(6,9));
  gl.uniform2f(loc('cameraSize'),W,H);gl.uniform1f(loc('cameraRadius'),radius);gl.uniform1f(loc('aerialFar'),far);
  gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,WIDTH,HEIGHT);gl.drawArrays(gl.TRIANGLES,0,3);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 },bind(targetProgram){
  ['aerialRadiance','aerialTransmission','aerialSingle'].forEach((name,i)=>{gl.activeTexture(gl.TEXTURE14+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.uniform1i(gl.getUniformLocation(targetProgram,name),14+i);});gl.uniform1f(gl.getUniformLocation(targetProgram,'aerialFar'),far);
 },get builds(){return builds;},dispose(){transport.dispose();textures.forEach(t=>gl.deleteTexture(t));gl.deleteFramebuffer(fbo);gl.deleteVertexArray(vao);gl.deleteProgram(program);}};
}
