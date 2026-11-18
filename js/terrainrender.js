import { TERRAIN_SHADOW_GLSL, terrainGpuMesh } from './terrainlighting.js';
import { lightVector, shadowBasis } from './terrainmesh.js';
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in float waterMask;
layout(location=3) in vec3 face;
flat out vec3 faceNormal;
uniform vec3 right,up,forward;
uniform vec2 size;
uniform float radius;
out vec3 P,N;
out float water;
void main(){
 P=position;N=normal;water=waterMask;faceNormal=face;
 float d=max(length(P),1.0),z=dot(P,forward),w=max(d+z,0.001);
 // The same stereographic projection and handedness as projectVector().
 gl_Position=vec4(-2.0*radius*dot(P,right)/size.x,2.0*radius*dot(P,up)/size.y,(1.0-2.0/d)*w,w);
}`;
const shadowVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
uniform vec3 right,up,light;
uniform float extent;
void main(){gl_Position=vec4(dot(position,right)/extent,dot(position,up)/extent,-dot(position,light)/250000.0,1.0);}`;
const shadowFragment = `#version 300 es
precision highp float;
void main(){}`;
const fragment = `#version 300 es
precision highp float;
in vec3 P,N;
in float water;
flat in vec3 faceNormal;
uniform vec3 light, lightRight, lightUp, forward;
uniform highp sampler2D nearShadow,farShadow;
uniform float sunAlt, moonFlux, exposure, nearField, solarFlux;
uniform bool shadows, paper, moonSource, waterColor;
out vec4 colour;
${TERRAIN_SHADOW_GLSL}
vec3 srgb(vec3 c){return mix(12.92*c,1.055*pow(max(c,vec3(0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
void main(){
 if(length(P.xy)<nearField || dot(P,forward)<-0.2*length(P))discard;
 gl_FragDepth=1.0-1.0/max(length(P),1.0);
 vec3 n=normalize(N);
 float day=smoothstep(-5.0,6.0,sunAlt),twilight=smoothstep(-18.0,-3.0,sunAlt);
 float direct=max(0.0,dot(n,light))*visibility(faceNormal);
 float diffuse=0.16*day+0.008*twilight*(1.0-day);
 diffuse*=0.65+0.35*max(n.z,0.0);
 if(paper)diffuse+=0.34*day*(0.8+0.2*max(n.z,0.0));
 float strength=moonSource?moonFlux:solarFlux;
 vec3 albedo=paper?vec3(0.79):mix(vec3(0.18,0.21,0.16),vec3(0.27,0.26,0.24),(1.0-smoothstep(0.15,0.65,n.z)));
 if(water>0.99 && n.z>0.9)albedo=waterColor?vec3(0.035,0.14,0.34):(paper?vec3(0.83):vec3(0.10,0.19,0.21));
 // Night adaptation applies to weak moonlight/ambient light, never sunlight
 // or twilight. Amplifying twilight here made mountains turn white at dusk.
 float adaptation=mix(4000.0,1.0,max(day,twilight*0.9));
 vec3 radiance=albedo*(diffuse+0.00000008*adaptation+strength*direct*(paper?0.4:0.8)*(moonSource?adaptation:1.0));
 vec3 c=srgb(radiance*exposure);
 vec3 haze=mix(vec3(0.004,0.006,0.012),paper?vec3(0.97):vec3(0.68,0.77,0.85),max(day,twilight*0.45));
 float fog=(1.0-exp(-length(P.xy)/45000.0))*max(day,twilight*0.4);
 c=mix(c,haze,fog*0.7);
 colour=vec4(c,1);
}`;
const screenVertex = `#version 300 es
out vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
const postFragment = `#version 300 es
precision highp float;
in vec2 uv;
uniform highp sampler2D image,depth;
uniform bool outlines;
out vec4 colour;
float distanceAt(vec2 p){float z=texture(depth,p).r;return 1.0/max(1.0-z,0.000001);}
void main(){vec3 c=texture(image,uv).rgb;
if(outlines && texture(depth,uv).r<1.0){vec2 px=1.0/vec2(textureSize(depth,0));float d=distanceAt(uv),edge=0.0;
for(int k=0;k<4;k++){vec2 o=k==0?vec2(1,0):k==1?vec2(-1,0):k==2?vec2(0,1):vec2(0,-1);float nextD=distanceAt(uv+o*px);edge=max(edge,smoothstep(0.06,0.22,(nextD-d)/max(d,1.0)));}
c*=1.0-edge*0.58;}
colour=vec4(c,texture(image,uv).a);}`;
function program(gl, vs, fs) {
  const shaders = [vs, fs].map((code, i) => { const s = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER); gl.shaderSource(s, code); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; });
  const p = gl.createProgram(); shaders.forEach((s) => gl.attachShader(p, s)); gl.linkProgram(p); shaders.forEach((s) => gl.deleteShader(s)); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
}
export function createTerrainRenderer(canvas, { shadowSize = 2048 } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('Terrain shading requires WebGL2');
  const scene = program(gl, vertex, fragment), shadow = program(gl, shadowVertex, shadowFragment), post = program(gl, screenVertex, postFragment);
  const empty = gl.createVertexArray();
  let meshes = [], framebuffer, image, depth, w = 0, h = 0, shadowKey = '', destroyed = false;
  const u = (p, name) => gl.getUniformLocation(p, name);
  function texture(internal, format, type, width, height) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t;
  }
  const shadowMaps = [7000, 225000].map((extent) => {
    const textureID = texture(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, shadowSize, shadowSize), fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, textureID, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Shadow framebuffer unavailable');
    return { extent, texture: textureID, fbo };
  });
  function drawMeshes() { for (const m of meshes) { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); } }
  function disposeMeshes() { for (const m of meshes) { gl.deleteVertexArray(m.vao); m.buffers.forEach((b) => gl.deleteBuffer(b)); } meshes = []; }
  return {
    setMeshes(data) {
      disposeMeshes(); shadowKey = '';
      meshes = data.map((m) => {
        const vao = gl.createVertexArray(), buffers = []; gl.bindVertexArray(vao);
        const packed=terrainGpuMesh(m),vertexBuffer=gl.createBuffer();buffers.push(vertexBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,packed.vertices,gl.STATIC_DRAW);
        for(const [i,size,offset]of [[0,3,0],[1,3,12],[2,1,24],[3,3,28]]){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,size,gl.FLOAT,false,40,offset);}
        const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,packed.indices,gl.STATIC_DRAW);
        return { vao, buffers, count: m.indices.length };
      });
    },
    draw({ W, H, radius, rotation, sun, moon, flux, lightingSunAlt = sun.alt, solarFlux = 1, shadows = true, paper = false, outlines = false, exposure = 1, nearField = 100, waterColor = true, observerWater = false }) {
      if (destroyed || gl.isContextLost()) return;
      const start = performance.now(), scale = Math.min(1.5, devicePixelRatio || 1), width = Math.max(1,Math.round(W * scale)), height = Math.max(1,Math.round(H * scale));
      if (width !== w || height !== h) {
        w = canvas.width = width; h = canvas.height = height;
        if (framebuffer) { gl.deleteFramebuffer(framebuffer); gl.deleteTexture(image); gl.deleteTexture(depth); }
        image = texture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, w, h); depth = texture(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, w, h);
        framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Scene framebuffer unavailable');
      }
      const moonSource = sun.alt < -6, source = moonSource ? moon : sun, light = lightVector(source.az, source.alt), mapLight = lightVector(Math.round(source.az*20)/20, Math.round(source.alt*20)/20), basis = shadowBasis(mapLight);
      const key = JSON.stringify([mapLight, shadows]);
      if (shadows && shadowKey !== key) {
        gl.useProgram(shadow); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(0, 1); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.CULL_FACE); gl.viewport(0, 0, shadowSize, shadowSize);
        gl.uniform3fv(u(shadow, 'right'), basis.right); gl.uniform3fv(u(shadow, 'up'), basis.up); gl.uniform3fv(u(shadow, 'light'), mapLight);
        for (const map of shadowMaps) { gl.bindFramebuffer(gl.FRAMEBUFFER, map.fbo); gl.clear(gl.DEPTH_BUFFER_BIT); gl.uniform1f(u(shadow, 'extent'), map.extent); drawMeshes(); }
        gl.disable(gl.POLYGON_OFFSET_FILL); shadowKey = key;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0,0,w,h); gl.disable(gl.DEPTH_TEST); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const r=rotation.slice(0,3), up=rotation.slice(3,6), forward=rotation.slice(6,9);
      gl.useProgram(scene); gl.enable(gl.DEPTH_TEST);
      for (const [name, v] of Object.entries({ right: r, up, forward, light, shadowLight: mapLight, lightRight: basis.right, lightUp: basis.up })) gl.uniform3fv(u(scene, name), v);
      // Shared sky camera; lighting directions are quantised to 0.05° so
      // ordinary playback reuses expensive shadow maps between updates.
      gl.uniform2f(u(scene,'size'),W,H); gl.uniform1f(u(scene,'radius'),radius);
      gl.uniform1f(u(scene,'shadowRasterStep'), 1 / 2 ** gl.getParameter(gl.SUBPIXEL_BITS));
      gl.uniform2f(u(scene, 'shadowExtents'), 7000, 225000); gl.uniform1f(u(scene, 'shadowDepthRange'), 500000);
      gl.uniform1f(u(scene, 'sunAlt'), lightingSunAlt); gl.uniform1f(u(scene, 'solarFlux'), sun.alt < -2 ? 0 : solarFlux); gl.uniform1f(u(scene, 'moonFlux'), source.alt < -2 ? 0 : flux); gl.uniform1f(u(scene, 'exposure'), exposure); gl.uniform1f(u(scene, 'nearField'), nearField);
      for (const [name, value] of Object.entries({ shadows, paper, moonSource, waterColor })) gl.uniform1i(u(scene, name), value);
      for (let i = 0; i < 2; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, shadowMaps[i].texture); gl.uniform1i(u(scene, i ? 'farShadow' : 'nearShadow'), i); }
      drawMeshes(); gl.disable(gl.DEPTH_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(empty); gl.useProgram(post);
      for (const [i, tex] of [image, depth].entries()) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u(post, i ? 'depth' : 'image'), i); }
      gl.uniform1i(u(post, 'outlines'), outlines); gl.drawArrays(gl.TRIANGLES, 0, 3);
      return { canvas, submitMs: performance.now() - start, width: w, height: h, shadowSize, glError: gl.getError() };
    },
    destroy() { destroyed = true; disposeMeshes(); [scene, shadow, post].forEach((p) => gl.deleteProgram(p)); gl.deleteVertexArray(empty); shadowMaps.forEach((m) => { gl.deleteTexture(m.texture); gl.deleteFramebuffer(m.fbo); }); if (framebuffer) { gl.deleteFramebuffer(framebuffer); gl.deleteTexture(image); gl.deleteTexture(depth); } },
  };
}
