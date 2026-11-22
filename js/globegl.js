// GPU orthographic globe. Geographic vertices stay in VBOs; rotation and
// projection are uniforms. Only a completed tap reads a small picking target.
import { COAST_LEVELS, COAST_SCALE } from './coast.js';
const RAD = Math.PI / 180, EMPTY = [], segmentCache = new WeakMap(), coastCache = new WeakMap(), pickCache = new WeakMap();
const unit = (lat, lon) => { const c = Math.cos(lat * RAD); return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)]; };
function segments(lines, tolerance = 0) {
  if (!segmentCache.has(lines)) segmentCache.set(lines, new Map());
  const cache = segmentCache.get(lines);
  if (cache.has(tolerance)) return cache.get(tolerance);
  const out = new Float32Array(lines.reduce((n, line) => n + Math.max(0, line.length - 1) * 6, 0)); let at = 0;
  const threshold = (tolerance / 6371000) ** 2;
  for (const line of lines) {
    let previous = null;
    for (let i=0;i<line.length;i++) {
      const next = unit(line[i][0], line[i][1]);
      if (!previous) { previous=next; continue; }
      if (i+1<line.length && (next[0]-previous[0])**2+(next[1]-previous[1])**2+(next[2]-previous[2])**2 < threshold) continue;
      out.set(previous, at); out.set(next, at+3); at+=6; previous=next;
    }
  }
  const result=out.slice(0,at); cache.set(tolerance,result); return result;
}
const rangeCache = new WeakMap();
function geometryRanges(data) {
  if (rangeCache.has(data)) return rangeCache.get(data);
  const ranges=[];
  for(let first=0;first<data.length/6;first+=128){
    const count=Math.min(128,data.length/6-first), start=first*6, end=(first+count)*6, center=[0,0,0];
    for(let i=start;i<end;i+=3){center[0]+=data[i];center[1]+=data[i+1];center[2]+=data[i+2];}
    const length=Math.hypot(...center);if(length)for(let i=0;i<3;i++)center[i]/=length;
    let radius=0;for(let i=start;i<end;i+=3)radius=Math.max(radius,Math.hypot(data[i]-center[0],data[i+1]-center[1],data[i+2]-center[2]));
    ranges.push({first,count,center,radius});
  }
  rangeCache.set(data,ranges);return ranges;
}

function coastSegments(level) {
  if (coastCache.has(level)) return coastCache.get(level);
  const out = new Float32Array(level.lines.reduce((n, line) => n + Math.max(0, line.length / 2 - 1) * 6, 0)); let at = 0;
  for (const line of level.lines) {
    let lon = 0, lat = 0, previous = null;
    for (let i = 0; i < line.length; i += 2) {
      lon += line[i]; lat += line[i + 1]; const next = unit(lat / COAST_SCALE, lon / COAST_SCALE);
      if (previous) { out.set(previous, at); out.set(next, at + 3); at += 6; } previous = next;
    }
  }
  coastCache.set(level, out); return out;
}
function pickMesh(data) {
  if (pickCache.has(data)) return pickCache.get(data);
  // An even/odd triangle fan works for concave rings and holes using stencil
  // inversion. It avoids triangulation and preserves the polygon coordinates.
  const count = data.polygons.reduce((n, p) => n + p.rings.reduce((m, ring) => m + Math.max(0, ring.length - 2) * 3, 0), 0);
  const xy = new Float32Array(count * 2), ranges = new Map(); let at = 0;
  for (const polygon of data.polygons) {
    const first = at / 2;
    for (const ring of polygon.rings) for (let i = 1; i + 1 < ring.length; i++) {
      for (const p of [ring[0], ring[i], ring[i + 1]]) { xy[at++] = p[1]; xy[at++] = p[0]; }
    }
    ranges.set(polygon, { first, count: at / 2 - first });
  }
  const mesh = { xy, ranges }; pickCache.set(data, mesh); return mesh;
}
const GRID = [];
for (let lat = -60; lat <= 60; lat += 30) GRID.push(Array.from({ length: 73 }, (_, i) => [lat, -180 + i * 5]));
for (let lon = -180; lon < 180; lon += 30) GRID.push(Array.from({ length: 37 }, (_, i) => [-90 + i * 5, lon]));
const lineVS = `attribute vec3 a_start,a_end;attribute vec2 a_corner;uniform mat3 u_rotation;uniform vec2 u_size;uniform float u_radius,u_width;varying mediump float v_front;
void main(){vec3 a=u_rotation*a_start,b=u_rotation*a_end;vec2 delta=b.xy-a.xy;vec2 normal=vec2(-delta.y,delta.x)/max(length(delta),.0000001);vec2 p=mix(a.xy,b.xy,a_corner.x)*u_radius+normal*a_corner.y*u_width*.5;gl_Position=vec4(p*2./u_size,0.,1.);v_front=mix(a.z,b.z,a_corner.x);}`;
const lineFS = `precision mediump float;uniform vec4 u_color;varying mediump float v_front;void main(){if(v_front<0.)discard;gl_FragColor=u_color;}`;
const quadVS = `attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.,1.);}`;
const backgroundFS = `precision mediump float;uniform vec2 u_buffer,u_size;uniform float u_radius,u_dpr;void main(){vec2 p=(gl_FragCoord.xy/u_buffer-.5)*u_size;float edge=length(p)-u_radius;float a=1.-smoothstep(-.7/u_dpr,.7/u_dpr,edge);gl_FragColor=vec4(mix(vec3(.043,.059,.102),vec3(.075,.192,.310),a),1.);}`;
const pointVS = `attribute vec3 a_position;uniform mat3 u_rotation;uniform vec2 u_size;uniform float u_radius,u_dpr;varying mediump float v_front;void main(){vec3 p=u_rotation*a_position;gl_Position=vec4(p.xy*u_radius*2./u_size,0.,1.);gl_PointSize=10.*u_dpr;v_front=p.z;}`;
const pointFS = `precision mediump float;varying mediump float v_front;void main(){float r=length(gl_PointCoord-.5);if(v_front<0.||r>.5)discard;gl_FragColor=r<.28?vec4(1.):vec4(.55,.72,1.,1.);}`;
const pickVS = `attribute vec2 a_position;uniform vec2 u_query;uniform float u_slot,u_columns;void main(){vec2 p=(a_position-u_query)*1000.;gl_Position=vec4((u_slot+.5+p.x)*2./u_columns-1.,p.y*2.,0.,1.);}`;
const whiteFS = `precision mediump float;void main(){gl_FragColor=vec4(1.);}`;
export function createGlobeGL(svg, { boundaries = null, selected = () => '', onLost = () => {} } = {}) {
  const canvas = document.createElement('canvas'); canvas.className = 'map-webgl'; canvas.setAttribute('aria-hidden', 'true');
  let gl, disposed = false, lost = false, picker = null;
  const buffers = [], programs = [], shaders = [], extra = [];
  const destroy = () => {
    if (disposed) return; disposed = true;
    canvas.remove(); svg.style.opacity = ''; delete svg.dataset.renderer; delete svg.dataset.picking;
    if (gl && !gl.isContextLost()) {
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      for (const program of programs) gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
      for (const [kind, object] of extra) gl[kind](object);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: true, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) { svg.dataset.gpuFallback = 'WebGL unavailable'; return null; }
    const instanced = gl.getExtension('ANGLE_instanced_arrays');
    if (!instanced) { destroy(); svg.dataset.gpuFallback = 'Instanced drawing unavailable'; return null; }
    const program = (vs, fs, attributes) => {
      const p = gl.createProgram(); programs.push(p);
      for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type); shaders.push(s); gl.shaderSource(s, code); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); gl.attachShader(p, s);
      }
      attributes.forEach((name, i) => gl.bindAttribLocation(p, i, name)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const uniforms = new Map(); return { p, u: name => { if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(p, name)); return uniforms.get(name); } };
    };
    const buffer = data => { const b = gl.createBuffer(); buffers.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const geometry = data => ({buffer:buffer(data),count:data.length/6,ranges:geometryRanges(data)});
    const lines = program(lineVS, lineFS, ['a_start', 'a_end', 'a_corner']);
    const background = program(quadVS, backgroundFS, ['a_position']), point = program(pointVS, pointFS, ['a_position']);
    const quad = buffer(new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
    const corners = buffer(new Float32Array([0,-1,1,-1,0,1,0,1,1,-1,1,1]));
    const grid = geometry(segments(GRID));
    const coasts = new Map(), outlines = new Map();
    const highlight = { buffer: buffer(new Float32Array()), count: 0, ranges: [] };
    const marker = buffer(new Float32Array(3));
    let highlightZone = null, ratio = 1;
    const attributes2D = b => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); instanced.vertexAttribDivisorANGLE(0, 0);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    };
    if (boundaries) {
      try {
        const mesh = pickMesh(boundaries), geometry = buffer(mesh.xy), fan = program(pickVS, whiteFS, ['a_position']), white = program(quadVS, whiteFS, ['a_position']);
        const fbo = gl.createFramebuffer(), image = gl.createTexture(), stencil = gl.createRenderbuffer();
        extra.push(['deleteFramebuffer', fbo], ['deleteTexture', image], ['deleteRenderbuffer', stencil]);
        let capacity = 0;
        picker = (lat, lon) => {
          if (disposed || lost) return null;
          const candidates = boundaries.candidates(lat, lon);
          if (!candidates.length) return [];
          const n = candidates.length;
          if (n > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return null;
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          if (capacity < n) {
            capacity = 2 ** Math.ceil(Math.log2(n));
            gl.bindTexture(gl.TEXTURE_2D, image); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, capacity, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0);
            gl.bindRenderbuffer(gl.RENDERBUFFER, stencil); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, capacity, 1); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencil);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); svg.dataset.picking='cpu'; picker=null; return null; }
          }
          gl.viewport(0, 0, n, 1); gl.disable(gl.BLEND); gl.disable(gl.DITHER); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
          gl.colorMask(true,true,true,true); gl.stencilMask(255); gl.clearColor(0,0,0,0); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
          gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.ALWAYS, 0, 1); gl.stencilOp(gl.KEEP,gl.KEEP,gl.INVERT); gl.colorMask(false,false,false,false);
          gl.useProgram(fan.p); attributes2D(geometry); gl.uniform2f(fan.u('u_query'), lon, lat); gl.uniform1f(fan.u('u_columns'), n); gl.enable(gl.SCISSOR_TEST);
          candidates.forEach((polygon, i) => { const range = mesh.ranges.get(polygon); gl.scissor(i,0,1,1); gl.uniform1f(fan.u('u_slot'), i); gl.drawArrays(gl.TRIANGLES, range.first, range.count); });
          gl.disable(gl.SCISSOR_TEST); gl.colorMask(true,true,true,true); gl.stencilFunc(gl.NOTEQUAL,0,1); gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP);
          gl.useProgram(white.p); attributes2D(quad); gl.drawArrays(gl.TRIANGLES,0,6);
          const pixels = new Uint8Array(n * 4); gl.readPixels(0,0,n,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          gl.disable(gl.STENCIL_TEST); gl.enable(gl.DITHER); gl.bindFramebuffer(gl.FRAMEBUFFER,null);
          const zones = new Set(); candidates.forEach((polygon,i) => { if (pixels[i*4]) zones.add(polygon.zone); }); return [...zones];
        };
      } catch { picker = null; }
    }
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if (!disposed) { lost = true; onLost(); } });
    svg.before(canvas); svg.style.opacity = '0'; svg.dataset.renderer = 'webgl'; svg.dataset.picking = picker ? 'gpu' : 'cpu';
    const render = (view, W, H, place) => {
      if (disposed || lost || gl.isContextLost()) return false;
      ratio = Math.min(2, window.devicePixelRatio || 1);
      const bw = Math.max(1,Math.round(W*ratio)), bh = Math.max(1,Math.round(H*ratio));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width=bw; canvas.height=bh; }
      canvas.style.height = `${H}px`; gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,bw,bh); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true,true,true,true); gl.disable(gl.BLEND);
      const la=view.lat0*RAD, lo=view.lon0*RAD, sl=Math.sin(la),cl=Math.cos(la),sn=Math.sin(lo),cn=Math.cos(lo);
      const rotation=new Float32Array([-sn,-sl*cn,cl*cn,cn,-sl*sn,cl*sn,0,cl,sl]);
      gl.useProgram(background.p); attributes2D(quad); gl.uniform2f(background.u('u_buffer'),bw,bh); gl.uniform2f(background.u('u_size'),W,H); gl.uniform1f(background.u('u_radius'),view.s); gl.uniform1f(background.u('u_dpr'),ratio); gl.drawArrays(gl.TRIANGLES,0,6);
      const layer = (geometry, color, stroke) => {
        if (!geometry.count) return;
        gl.useProgram(lines.p); gl.uniformMatrix3fv(lines.u('u_rotation'),false,rotation); gl.uniform2f(lines.u('u_size'),W,H); gl.uniform1f(lines.u('u_radius'),view.s); gl.uniform1f(lines.u('u_width'),stroke); gl.uniform4fv(lines.u('u_color'),color);
        gl.bindBuffer(gl.ARRAY_BUFFER,geometry.buffer); gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0); gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12); instanced.vertexAttribDivisorANGLE(0,1); instanced.vertexAttribDivisorANGLE(1,1);
        gl.bindBuffer(gl.ARRAY_BUFFER,corners); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,2,gl.FLOAT,false,0,0); instanced.vertexAttribDivisorANGLE(2,0);
        const drawRange=(first,count)=>{gl.bindBuffer(gl.ARRAY_BUFFER,geometry.buffer);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,first*24);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,first*24+12);instanced.drawArraysInstancedANGLE(gl.TRIANGLES,0,6,count);};
        if(view.s<=Math.min(W,H)/2 || geometry.count<1024){drawRange(0,geometry.count);return;}
        let first=-1,count=0;
        const flush=()=>{if(count)drawRange(first,count);first=-1;count=0;};
        for(const range of geometry.ranges){const c=range.center,r=range.radius;const x=rotation[0]*c[0]+rotation[3]*c[1]+rotation[6]*c[2],y=rotation[1]*c[0]+rotation[4]*c[1]+rotation[7]*c[2],z=rotation[2]*c[0]+rotation[5]*c[1]+rotation[8]*c[2];
          if(z+r<0 || (Math.abs(x)-r)*view.s>W/2+stroke || (Math.abs(y)-r)*view.s>H/2+stroke){flush();continue;}
          if(first<0)first=range.first;count+=range.count;
        }flush();
      };
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      layer(grid,[.32,.40,.50,.35],.65);
      const tolerance=6371000/Math.max(1,view.s)*.65, detail=tolerance>=20000?20000:tolerance>=2000?2000:0;
      if(boundaries){if(!outlines.has(detail))outlines.set(detail,geometry(segments(boundaries.lines,detail)));layer(outlines.get(detail),[.47,.55,.67,.65],.65);}
      const zone=selected();
      if (zone !== highlightZone) { highlightZone=zone; const data=segments(boundaries?.byZone.get(zone)||EMPTY); gl.bindBuffer(gl.ARRAY_BUFFER,highlight.buffer); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW); highlight.count=data.length/6;highlight.ranges=geometryRanges(data); }
      layer(highlight,[.61,.77,1,1],1.8);
      const level=COAST_LEVELS.find(level=>level.tolerance<=tolerance)||COAST_LEVELS.at(-1);
      if (!coasts.has(level)) { const data=coastSegments(level); coasts.set(level,geometry(data)); }
      layer(coasts.get(level),[.71,.78,.85,1],.8);
      if (place) {
        gl.useProgram(point.p); gl.bindBuffer(gl.ARRAY_BUFFER,marker); gl.bufferSubData(gl.ARRAY_BUFFER,0,new Float32Array(unit(place[0],place[1]))); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0); instanced.vertexAttribDivisorANGLE(0,0); gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
        gl.uniformMatrix3fv(point.u('u_rotation'),false,rotation); gl.uniform2f(point.u('u_size'),W,H); gl.uniform1f(point.u('u_radius'),view.s); gl.uniform1f(point.u('u_dpr'),ratio); gl.drawArrays(gl.POINTS,0,1);
      }
      return true;
    };
    return { draw:render, pick: (lat,lon) => { const result=picker?.(lat,lon); return result ?? null; }, destroy, canvas };
  } catch (error) { destroy(); svg.dataset.gpuFallback = error.message; return null; }
}
