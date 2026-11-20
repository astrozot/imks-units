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
uniform float ringExtent[5],ringScale[5],ringOffset[5];
uniform int ringSize[5];
uniform int rings;
float curvature(vec2 q){return 0.87*dot(q,q)/(2.0*EARTH);}
float texelSize(int k){return 2.0*ringExtent[k]/float(ringSize[k]);}
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
float heightAt(int k,vec2 q){return gridHeight(k,q)-curvature(q);}`;
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
// finest ring that contains each sample (or a coarser one once the step has
// outgrown its texels). Visibility is the uncovered fraction of the source's
// disc above that horizon: a physical penumbra, not a filter width.
const shadowFragment = `#version 300 es
${RINGS}
uniform int ring,size;
uniform vec3 light;
uniform float sourceRadius,maxHeight,innerSkip,stepGrowth;
out vec4 colour;
void main(){
 float E=ringExtent[ring],horizontal=length(light.xy),alt=atan(light.z,horizontal);
 vec2 q0=gl_FragCoord.xy/float(size)*2.0*E-E;
 if(max(abs(q0.x),abs(q0.y))<innerSkip||horizontal<1e-5){colour=vec4(1);return;}
 int k0=rings-1;
 for(int k=0;k<5;k++)if(k<rings&&max(abs(q0.x),abs(q0.y))<ringExtent[k]){k0=k;break;}
 float z0=heightAt(k0,q0);
 if(z0<-1.0e5){colour=vec4(1);return;}
 vec2 dir=light.xy/horizontal;
 float tanTop=tan(alt+sourceRadius),tanBottom=tan(alt-sourceRadius);
 // Samples sit on a world-aligned lattice along the light direction, with
 // power-of-two spacing growing with distance. Neighbouring receivers on the
 // same light line then test identical occluder points: a sharp crest is never
 // hit by one texel and missed by the next, which showed as striped shadows.
 float unit=texelSize(0),minStep=texelSize(k0),s0=dot(q0,dir),t=0.0,best=-1.0e9,limit=ringExtent[rings-1];
 for(int s=0;s<640;s++){
  float step=unit*exp2(ceil(log2(max(minStep,t*stepGrowth)/unit)-1e-4));
  t=(floor((s0+t)/step+1e-4)+1.0)*step-s0;
  if(t<minStep*0.5)t+=step;
  vec2 q=q0+dir*t;float m=max(abs(q.x),abs(q.y));
  // Beyond the data, or the ray has climbed above every possible occluder.
  if(m>=limit||z0+t*tanBottom>maxHeight)break;
  int k=0;
  for(;k<rings-1;k++)if(m<ringExtent[k]&&texelSize(k)*2.0>=step)break;
  best=max(best,(heightAt(k,q)-z0)/t);
  if(best>=tanTop)break;
 }
 float x=clamp((alt-atan(best))/sourceRadius,-1.0,1.0);
 colour=vec4((3.14159265-acos(x)+x*sqrt(1.0-x*x))/3.14159265);
}`;
const fragment = `#version 300 es
${RINGS}
in vec3 P;
uniform vec3 light, forward;
uniform highp sampler2D normalMap,nextNormalMap,shadowMap,nextShadowMap,levelMap;
uniform float extent,nextExtent,waterTolerance;
uniform int ringIndex;
uniform float sunAlt, moonFlux, exposure, nearField, farField, solarFlux;
uniform bool shadows, paper, moonSource, waterColor;
out vec4 colour;
vec3 srgb(vec3 c){return mix(12.92*c,1.055*pow(max(c,vec3(0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
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
 float visible=shadows?mix(texture(shadowMap,uv).r,texture(nextShadowMap,nextUV).r,edge):1.0;
 // Water is where the DEM lies at the local lake (or sea) level: the shoreline
 // is that DEM contour, never the coarse source outline. Level surfaces shade
 // flat so DEM noise over water cannot look like waves.
 bool lake=false;
 if(ringIndex>=0){float level=texture(levelMap,uv).r;lake=level>-1.0e5&&abs(gridHeight(ringIndex,P.xy)-level)<waterTolerance;}
 if(lake)n=vec3(0,0,1);
 float day=smoothstep(-5.0,6.0,sunAlt),twilight=smoothstep(-18.0,-3.0,sunAlt);
 float direct=max(0.0,dot(n,light))*visible;
 float diffuse=0.16*day+0.008*twilight*(1.0-day);
 diffuse*=0.65+0.35*max(n.z,0.0);
 if(paper)diffuse+=0.34*day*(0.8+0.2*max(n.z,0.0));
 float strength=moonSource?moonFlux:solarFlux;
 vec3 albedo=paper?vec3(0.79):mix(vec3(0.18,0.21,0.16),vec3(0.27,0.26,0.24),(1.0-smoothstep(0.15,0.65,n.z)));
 if(lake)albedo=waterColor?vec3(0.035,0.14,0.34):(paper?vec3(0.83):vec3(0.10,0.19,0.21));
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
export const terrainShadowSize = gridSize => Math.min(1024, gridSize);
export function createTerrainRenderer(canvas, { antialias = true, shadowStep = 0.0125 } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('Terrain shading requires WebGL2');
  const scene = program(gl, vertex, fragment), post = program(gl, screenVertex, postFragment);
  const normalPass = program(gl, screenVertex, normalFragment), shadowPass = program(gl, screenVertex, shadowFragment);
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
  const noWater = texture(gl.R32F, gl.RED, gl.FLOAT, 1, 1, { data: new Float32Array([-1e6]) });
  function target(tex) { const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Terrain texture framebuffer unavailable'); return fbo; }
  function ringUniforms(p, rings) {
    gl.useProgram(p);
    gl.uniform1fv(u(p, 'ringExtent'), Float32Array.from({ length: 5 }, (_, k) => rings[k]?.extent ?? 1));
    gl.uniform1fv(u(p, 'ringScale'), Float32Array.from({ length: 5 }, (_, k) => rings[k]?.scale ?? 1));
    gl.uniform1fv(u(p, 'ringOffset'), Float32Array.from({ length: 5 }, (_, k) => rings[k]?.offset ?? 0));
    gl.uniform1iv(u(p, 'ringSize'), Int32Array.from({ length: 5 }, (_, k) => rings[k]?.size ?? 1));
    gl.uniform1i(u(p, 'rings'), rings.length); gl.uniform1i(u(p, 'heights'), 0);
  }
  function drawMeshes(forward=null,viewAngle=0) {
    let triangles=0;
    meshes.forEach((m,i)=>{
      const next=m.grid&&meshes[i+1]?.grid?meshes[i+1]:m;
      [[m.normal,m.grid?m.normal:flatNormal],[next.normal,next.grid?next.normal:flatNormal],[m.shadow,m.grid?m.shadow:fullLight],[next.shadow,next.grid?next.shadow:fullLight]].forEach(([,tex],unit)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);});
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
    for (const m of meshes) { gl.deleteVertexArray(m.vao); m.buffers.forEach((b) => gl.deleteBuffer(b)); if (m.level) gl.deleteTexture(m.level); for (const name of ['normal', 'shadow', 'shadowBack']) if (m[name]) { gl.deleteTexture(m[name]); gl.deleteFramebuffer(m[name + 'Target']); } }
    if (heights) gl.deleteTexture(heights);
    meshes = []; heights = null;
  }
  // Light-dependent pass: one horizon march per shadow texel, then mipmaps.
  // Work is split into horizontal bands rendered into back textures; a
  // finished set replaces the visible one at once. Progressive drawing spreads
  // the bands over frames within a GPU budget, using each ring's own cost per
  // texel measured on this device (rings differ several-fold), and a started
  // update finishes with its own light before the next one begins.
  let shownKey = '', job = null, rates = [];
  const sync = () => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  function shadowJob(light, sourceRadius, key) {
    const rings = meshes.filter(m => m.grid), bands = [];
    rings.forEach((m, k) => { const S = m.shadowSize, rows = Math.max(8, Math.ceil(S / 32)); for (let y = 0; y < S; y += rows) bands.push({ m, k, y, rows: Math.min(rows, S - y) }); });
    return { light, sourceRadius, key, rings, bands };
  }
  // budgetMs: Infinity for a complete update; calibrate times every ring.
  function runShadowJob(budgetMs, calibrate = false) {
    const { rings } = job;
    gl.disable(gl.DEPTH_TEST); gl.useProgram(shadowPass); gl.bindVertexArray(empty);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, heights);
    gl.uniform3fv(u(shadowPass, 'light'), job.light); gl.uniform1f(u(shadowPass, 'sourceRadius'), job.sourceRadius); gl.uniform1f(u(shadowPass, 'maxHeight'), maxHeight); gl.uniform1f(u(shadowPass, 'stepGrowth'), shadowStep);
    gl.enable(gl.SCISSOR_TEST);
    let done = 0, spent = 0, ring = job.bands[0]?.k, ringTexels = 0, ringStart = 0;
    const measure = () => { sync(); const now = performance.now(); if (ringTexels) rates[ring] = ringTexels / Math.max(0.05, now - ringStart); ringStart = now; ringTexels = 0; };
    if (calibrate) { sync(); ringStart = performance.now(); }
    while (job.bands.length) {
      const { m, k, y, rows } = job.bands[0], S = m.shadowSize, cost = rates[k] ? S * rows / rates[k] : 0;
      if (calibrate && k !== ring) { gl.bindFramebuffer(gl.FRAMEBUFFER, rings[ring].shadowBackTarget); measure(); ring = k; }
      if (done && spent + cost > budgetMs) break;
      job.bands.shift();
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.shadowBackTarget); gl.viewport(0, 0, S, S); gl.scissor(0, y, S, rows);
      gl.uniform1i(u(shadowPass, 'ring'), k); gl.uniform1i(u(shadowPass, 'size'), S);
      // Hollow centres are never drawn, except where the finer ring fades in.
      gl.uniform1f(u(shadowPass, 'innerSkip'), k ? rings[k - 1].grid.extent * 0.75 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3); done += S * rows; spent += cost; ringTexels += S * rows;
    }
    if (calibrate) measure();
    gl.disable(gl.SCISSOR_TEST);
    if (!job.bands.length) {
      for (const m of rings) {
        [m.shadow, m.shadowBack] = [m.shadowBack, m.shadow]; [m.shadowTarget, m.shadowBackTarget] = [m.shadowBackTarget, m.shadowTarget];
        gl.bindTexture(gl.TEXTURE_2D, m.shadow); gl.generateMipmap(gl.TEXTURE_2D);
      }
      shownKey = job.key; job = null;
    }
    return done;
  }
  return {
    setMeshes(data) {
      disposeMeshes(); shownKey = ''; job = null; rates = [];
      if (data.filter(m => m.grid).length > 5) throw new Error('At most five terrain rings are supported');
      meshes = data.map((m) => {
        const vao = gl.createVertexArray(), buffers = []; gl.bindVertexArray(vao);
        const packed=terrainGpuMesh(m),vertexBuffer=gl.createBuffer();buffers.push(vertexBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,packed.vertices,gl.STATIC_DRAW);
        const stride=TERRAIN_VERTEX_STRIDE*4;
        gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0);
        const grouped=m.groups?{indices:packed.indices,groups:m.groups}:terrainDrawGroups(packed),b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,grouped.indices,gl.STATIC_DRAW);
        return { vao, buffers, count: m.indices.length, groups:grouped.groups, grid: m.grid ? { size: m.grid.size, extent: m.grid.extent, scale: m.grid.scale, offset: m.grid.offset } : null, source: m.grid, waterSource: m.water };
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
        m.shadow = texture(gl.R8, gl.RED, gl.UNSIGNED_BYTE, m.shadowSize, m.shadowSize, { mipmaps: true, filter: gl.LINEAR }); m.shadowTarget = target(m.shadow);
        m.shadowBack = texture(gl.R8, gl.RED, gl.UNSIGNED_BYTE, m.shadowSize, m.shadowSize, { mipmaps: true, filter: gl.LINEAR }); m.shadowBackTarget = target(m.shadowBack);
        // Water levels: nearest lookup, so neighbouring lakes never blend.
        if (m.waterSource) { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); m.level = texture(gl.R32F, gl.RED, gl.FLOAT, m.waterSource.size, m.waterSource.size, { data: Float32Array.from(m.waterSource.levels, v => Number.isFinite(v) ? v : -1e6) }); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2); }
        m.ringIndex = k;
        delete m.source; delete m.waterSource;
      });
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      for (const p of [normalPass, shadowPass, scene]) ringUniforms(p, rings.map(m => m.grid));
      gl.useProgram(normalPass); gl.bindVertexArray(empty); gl.disable(gl.DEPTH_TEST);
      rings.forEach((m, k) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.normalTarget); gl.viewport(0, 0, m.grid.size, m.grid.size);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, heights);
        gl.uniform1i(u(normalPass, 'ring'), k); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, m.normal); gl.generateMipmap(gl.TEXTURE_2D);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    // profile: wait for the GPU after each pass (diagnostics only: it stalls).
    draw({ W, H, radius, rotation, sun, moon, flux, lightingSunAlt = sun.alt, solarFlux = 1, shadows = true, paper = false, outlines = false, exposure = 1, nearField = 100, farField = 150000, waterColor = true, cull = true, profile = false, progressive = false, shadowBudgetMs = 3 }) {
      if (destroyed || gl.isContextLost()) return;
      const start = performance.now(), scale = Math.min(1.5, devicePixelRatio || 1), width = Math.max(1,Math.round(W * scale)), height = Math.max(1,Math.round(H * scale));
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
        if (!job) job = shadowJob(mapLight, moonSource ? MOON_RADIUS : SUN_RADIUS, key);
        // The first shadows of a surface appear complete, and time each ring.
        const calibrate = progressive && !rates.length, full = !progressive || !shownKey || calibrate;
        shadowTexels = runShadowJob(full ? Infinity : shadowBudgetMs, calibrate);
        if (profile) { sync(); shadowGpuMs = performance.now() - t0; }
        shadowMs = performance.now() - t0;
      }
      const sceneStart = performance.now();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const r=rotation.slice(0,3), up=rotation.slice(3,6), forward=rotation.slice(6,9);
      gl.useProgram(scene); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.CULL_FACE);
      for (const [name, v] of Object.entries({ right: r, up, forward, light })) gl.uniform3fv(u(scene, name), v);
      gl.uniform2f(u(scene,'size'),W,H); gl.uniform1f(u(scene,'radius'),radius);
      gl.uniform1f(u(scene, 'sunAlt'), lightingSunAlt); gl.uniform1f(u(scene, 'solarFlux'), sun.alt < -2 ? 0 : solarFlux); gl.uniform1f(u(scene, 'moonFlux'), source.alt < -2 ? 0 : flux); gl.uniform1f(u(scene, 'exposure'), exposure); gl.uniform1f(u(scene, 'nearField'), nearField);
      gl.uniform1f(u(scene,'farField'),farField);
      for (const [name, value] of Object.entries({ shadows, paper, moonSource, waterColor })) gl.uniform1i(u(scene, name), value);
      ['normalMap','nextNormalMap','shadowMap','nextShadowMap','heights','levelMap'].forEach((name,i)=>gl.uniform1i(u(scene,name),i));gl.uniform1f(u(scene,'waterTolerance'),WATER_TOLERANCE);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D_ARRAY,heights);
      const drawnTriangles=drawMeshes(cull?forward:null,2*Math.atan(Math.hypot(W,H)/(2*radius))); gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,w,h); gl.bindVertexArray(empty); gl.useProgram(post);
      for (const [i, tex] of [image, depth].entries()) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u(post, i ? 'depth' : 'image'), i); }
      gl.uniform1i(u(post, 'outlines'), outlines);gl.uniform1i(u(post,'edgeAA'),antialias===true); gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (profile) sync();
      return { canvas, submitMs: performance.now() - start, shadowMs, shadowGpuMs, shadowTexels, shadowsPending: !!job, texelsPerMs: rates.length ? rates.reduce((a, r) => a + r, 0) / rates.length : 0, sceneGpuMs: profile ? performance.now() - sceneStart : 0, width: w, height: h, antialias, drawnTriangles, glError: profile ? gl.getError() : 0 };
    },
    // Diagnostics: the current visibility texture of grid ring k (row-major,
    // texel centres as for the height grid, 0 = fully shadowed, 255 = lit).
    readShadow(k) {
      const m = meshes.filter(m => m.grid)[k], n = m.shadowSize, rgba = new Uint8Array(n * n * 4), values = new Uint8Array(n * n);
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.shadowTarget); gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, rgba); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (let i = 0; i < values.length; i++) values[i] = rgba[i * 4];
      return { size: n, extent: m.grid.extent, values };
    },
    destroy() { destroyed = true; disposeMeshes(); [scene, post, normalPass, shadowPass].forEach((p) => gl.deleteProgram(p)); gl.deleteVertexArray(empty); gl.deleteTexture(flatNormal); gl.deleteTexture(fullLight); gl.deleteTexture(noWater); disposeFrame(); },
  };
}
