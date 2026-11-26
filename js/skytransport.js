// Physical sky transport cached for a camera and lighting state. A small
// integration pass feeds the display pass; UI-only redraws reuse it.
import {SCATTERING_GLSL,scatteringUniforms} from './scattering.js';
const W=192,H=128;
const V=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const F=`#version 300 es
precision highp float;
${SCATTERING_GLSL}
uniform vec3 cameraRight,cameraUp,cameraForward;
uniform vec2 cameraSize;
uniform float cameraRadius;
out vec4 colour;
void main(){vec2 uv=(gl_FragCoord.xy-0.5)/vec2(191,127),screen=(uv-0.5)*cameraSize/cameraRadius;float rr=length(screen),angle=2.0*atan(rr),k=rr>1e-9?-sin(angle)/rr:0.0;vec3 v=cameraRight*screen.x*k-cameraUp*screen.y*k+cameraForward*cos(angle);colour=vec4(atmBackground(v),1);}`;
export const SKY_LOOKUP_GLSL=`
uniform sampler2D skyTransport;
vec3 physicalSkyAt(vec2 uv){return texture(skyTransport,(clamp(uv,0.0,1.0)*vec2(191,127)+0.5)/vec2(192,128)).rgb;}
`;
export function createSkyTransport(gl){
 const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const p=gl.createProgram(),v=compile(gl.VERTEX_SHADER,V),f=compile(gl.FRAGMENT_SHADER,F);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
 const transport=scatteringUniforms(gl,p),texture=gl.createTexture(),fbo=gl.createFramebuffer(),vao=gl.createVertexArray(),floating=!!gl.getExtension('EXT_color_buffer_float');
 gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,floating?gl.RGBA16F:gl.RGBA8,W,H,0,gl.RGBA,floating?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Sky transport target unavailable');gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 let previous=null,builds=0;
 return {render(sky,{W:screenW,H:screenH,radius,camera}){
  const key=[sky.medium.key,sky.height,...sky.sun,...sky.moon,sky.solarFlux.toPrecision(4),sky.moonFlux.toPrecision(4),sky.exposure.toPrecision(4),sky.pollution,screenW,screenH,radius,...camera.rotation].join(':');
  if(key===previous)return;previous=key;builds++;
  gl.useProgram(p);transport.set(sky,2);gl.uniform3fv(gl.getUniformLocation(p,'cameraRight'),camera.rotation.slice(0,3));gl.uniform3fv(gl.getUniformLocation(p,'cameraUp'),camera.rotation.slice(3,6));gl.uniform3fv(gl.getUniformLocation(p,'cameraForward'),camera.rotation.slice(6,9));gl.uniform2f(gl.getUniformLocation(p,'cameraSize'),screenW,screenH);gl.uniform1f(gl.getUniformLocation(p,'cameraRadius'),radius);gl.bindVertexArray(vao);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,W,H);gl.drawArrays(gl.TRIANGLES,0,3);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 },bind(program){gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(program,'skyTransport'),2);},get builds(){return builds;},dispose(){transport.dispose();gl.deleteTexture(texture);gl.deleteFramebuffer(fbo);gl.deleteVertexArray(vao);gl.deleteProgram(p);}};
}
