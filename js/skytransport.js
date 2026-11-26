// Physical sky transport in world space, cached per lighting state. Without
// terrain the sky is symmetric about each light's vertical plane, so one
// table per light, over the azimuth difference to that light and the view
// elevation, holds the whole sky. Panning and zooming are lookups; the
// integration runs only when the Sun, Moon, exposure or weather change.
import {SCATTERING_GLSL} from './scattering.js';
import {scatteringUniforms} from './scattering.js';
// Per light: azimuth difference (finer toward the light, for the aureole) ×
// elevation (finer toward the horizon). The Moon's half is drawn only when
// moonlight contributes.
const W=96,H=192;
const V=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const F=`#version 300 es
precision highp float;
${SCATTERING_GLSL}
uniform bool encoded;
out vec4 colour;
void main(){
 float x=gl_FragCoord.x-0.5;bool moon=x>=${W}.0;if(moon)x-=${W}.0;
 float u=x/${W-1}.0,q=2.0*(gl_FragCoord.y-0.5)/${H-1}.0-1.0;
 float delta=u*u*3.141592653589793,alt=sign(q)*q*q*1.5707963267948966;
 vec3 S=moon?scatteringMoon:scatteringSun;
 float az=atan(S.x,S.y)+delta;
 vec3 v=vec3(cos(alt)*sin(az),cos(alt)*cos(az),sin(alt)),T,Ls;
 vec3 L=atmIntegrate(v,S,1e9,T,Ls)*(moon?scatteringMoonFlux:scatteringSolarFlux)*scatteringExposure;
 colour=vec4(encoded?L/(1.0+L):L,1);
}`;
// physicalSkyAt(v): the display colour of the sky in world direction v,
// with the natural night-sky floor and artificial skyglow.
export const SKY_LOOKUP_GLSL=`
uniform sampler2D skyTransport;
uniform vec3 skySun,skyMoon;
uniform bool skyMoonOn,skyEncoded;
uniform float skyExposure,skyPollution;
vec3 skyFromLight(vec3 v,vec3 S,float side){
 vec2 a=v.xy,s=S.xy;float la=length(a),ls=length(s);
 float delta=la>1e-6&&ls>1e-6?acos(clamp(dot(a,s)/(la*ls),-1.0,1.0)):0.0;
 float alt=asin(clamp(v.z,-1.0,1.0)),q=sign(alt)*sqrt(abs(alt)/1.5707963267948966);
 vec2 uv=vec2((side*${W}.0+0.5+sqrt(delta/3.141592653589793)*${W-1}.0)/${2*W}.0,(0.5+(q+1.0)*0.5*${H-1}.0)/${H}.0);
 vec3 c=texture(skyTransport,uv).rgb;
 return skyEncoded?c/max(vec3(1e-5),1.0-c):c;
}
vec3 physicalSkyAt(vec3 v){
 vec3 L=skyFromLight(v,skySun,0.0);
 if(skyMoonOn)L+=skyFromLight(v,skyMoon,1.0);
 L+=(vec3(1e-7,1.8e-7,2.4e-7)+skyPollution*vec3(3e-6,2.3e-6,1.6e-6)*(1.0+3.0*exp(-max(v.z,0.0)/0.15)))*skyExposure;
 vec3 x=1.0-exp(-max(L,vec3(0)));
 return mix(12.92*x,1.055*pow(max(x,vec3(0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),x));
}
`;
export function createSkyTransport(gl){
 const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const p=gl.createProgram(),v=compile(gl.VERTEX_SHADER,V),f=compile(gl.FRAGMENT_SHADER,F);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
 const transport=scatteringUniforms(gl,p),texture=gl.createTexture(),fbo=gl.createFramebuffer(),vao=gl.createVertexArray(),floating=!!gl.getExtension('EXT_color_buffer_float');
 gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,floating?gl.RGBA16F:gl.RGBA8,2*W,H,0,gl.RGBA,floating?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Sky transport target unavailable');gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 let previous=null,builds=0,state=null;
 return {render(sky){
  state=sky;
  const key=[sky.medium.key,sky.height,...sky.sun,...sky.moon,sky.solarFlux.toPrecision(4),sky.moonFlux.toPrecision(4),sky.exposure.toPrecision(4)].join(':');
  if(key===previous)return;previous=key;builds++;
  gl.useProgram(p);transport.set(sky,2);gl.uniform1i(gl.getUniformLocation(p,'encoded'),!floating);
  gl.bindVertexArray(vao);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,sky.moonFlux>0?2*W:W,H);
  gl.drawArrays(gl.TRIANGLES,0,3);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 },bind(program){
  const loc=n=>gl.getUniformLocation(program,n);
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(loc('skyTransport'),2);
  gl.uniform3fv(loc('skySun'),state.sun);gl.uniform3fv(loc('skyMoon'),state.moon);gl.uniform1i(loc('skyMoonOn'),state.moonFlux>0);gl.uniform1i(loc('skyEncoded'),!floating);
  gl.uniform1f(loc('skyExposure'),state.exposure);gl.uniform1f(loc('skyPollution'),state.pollution);
 },get builds(){return builds;},dispose(){transport.dispose();gl.deleteTexture(texture);gl.deleteFramebuffer(fbo);gl.deleteVertexArray(vao);gl.deleteProgram(p);}};
}
