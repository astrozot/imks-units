// A planet and its moons as in a telescope, north up and east to the left,
// from the view of moons() in sky.js: lengths in planet radii, on axes to
// the west (x, to the right), to the north (y) and toward the Earth (z).
// The planet is traced pixel by pixel: its flattened globe with its bands,
// lit by the Sun, Saturn's rings with the shadows of the globe on them and
// theirs on the globe, and the shadows of the moons; the moons, their
// names and a scale go on top, in SVG. The tracing runs on the GPU (WebGL),
// four rays a pixel for smooth edges, at every frame; without WebGL, in
// JavaScript, a ray a pixel, after the view stops.

const FLAT = { mars: 0.00589, jupiter: 0.06487, saturn: 0.09796, uranus: 0.02293, neptune: 0.01708 };

// Saturn's rings (planet radii): from, to, opacity, color (C, B, the
// Cassini division, A)
const RINGS = [
  [1.239, 1.527, 0.15, [150, 140, 125]], [1.527, 1.951, 0.9, [232, 218, 184]],
  [1.951, 2.027, 0.08, [120, 115, 105]], [2.027, 2.269, 0.6, [205, 195, 168]],
];

// Bands: planetographic latitudes (degrees) where a color starts, from the
// south pole; for Jupiter its belts and zones
const BANDS = {
  jupiter: [[-90, [150, 142, 130]], [-48, [182, 166, 140]], [-36, [226, 213, 186]], [-28, [192, 170, 140]], [-22, [233, 221, 196]],
    [-19, [184, 142, 108]], [-7, [238, 228, 208]], [7, [180, 138, 104]], [18, [231, 219, 192]], [24, [192, 170, 140]],
    [31, [223, 209, 181]], [38, [182, 166, 140]], [48, [150, 142, 130]]],
  saturn: [[-90, [176, 166, 140]], [-60, [214, 194, 150]], [-22, [204, 180, 136]], [-10, [233, 216, 172]], [10, [204, 180, 136]],
    [22, [214, 194, 150]], [60, [176, 166, 140]]],
  uranus: [[-90, [182, 222, 228]], [-40, [170, 213, 222]], [40, [182, 222, 228]]],
  neptune: [[-90, [86, 124, 222]], [-40, [72, 106, 204]], [-20, [86, 124, 222]]],
  mars: [[-90, [236, 232, 226]], [-82, [196, 108, 68]], [82, [236, 232, 226]]],
  mercury: [[-90, [168, 160, 150]]],
  venus: [[-90, [240, 228, 196]]],
};

// the color at a latitude, the bands blended over 1.5° on each side of
// their edges
function bandColor(planet, lat) {
  const bands = BANDS[planet];
  let c = bands[0][1];
  for (let i = 1; i < bands.length; i++) {
    const w = Math.min(1, Math.max(0, (lat - bands[i][0] + 1.5) / 3));
    if (w > 0) c = c.map((v, k) => v + (bands[i][1][k] - v) * w);
  }
  return c;
}

const ringAt = (rho) => RINGS.find(([a, b]) => rho >= a && rho < b);

// The axes of the planet (e1, e2 in its equator, p to its north pole), in
// the view
function axes(p) {
  let e1 = [-p[1], p[0], 0];
  const h = Math.hypot(e1[0], e1[1]);
  e1 = h < 1e-6 ? [1, 0, 0] : e1.map((x) => x / h);
  const e2 = [p[1] * e1[2] - p[2] * e1[1], p[2] * e1[0] - p[0] * e1[2], p[0] * e1[1] - p[1] * e1[0]];
  return [e1, e2, p];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The first hit of the ray from o along d (planet axes) on the globe, of
// polar radius 1 − f: the distance along d, or null
function hitGlobe(o, d, f) {
  const k = 1 / (1 - f);
  const a = [o[0], o[1], o[2] * k], b = [d[0], d[1], d[2] * k];
  const A = dot(b, b), B = dot(a, b), C = dot(a, a) - 1, disc = B * B - A * C;
  if (disc < 0) return null;
  const q = Math.sqrt(disc);
  return [(-B - q) / A, (-B + q) / A];
}

// The geometry of the planet for the tracing, at s pixels per radius: its
// flattening, its axes (e1, e2 in its equator, p to its north pole), the
// directions of the Earth and the Sun on them, the moons' shadows (at
// least 0.7 pixels across), and which face of the rings is lit
function planetModel(sky, s) {
  const { planet, moons } = sky, f = FLAT[planet] || 0;
  // the pole and the Sun made unit vectors again: rounded to 1e-5 in the
  // view, their lengths off by 1e-5 would shift a moon's shadow, 15 radii
  // away, by as much as its size
  const unit = (v) => v.map((x) => x / Math.hypot(...v)), pole = unit(sky.pole), sun = unit(sky.sun);
  const [e1, e2, p] = axes(pole);
  const toP = (v) => [dot(v, e1), dot(v, e2), dot(v, p)];
  // the Earth's direction and the Sun's, on the planet's axes
  const view = toP([0, 0, 1]), light = toP(sun);
  const shadows = moons.filter((m) => m.r > 0).map((m) => ({ c: toP([m.x, m.y, m.z]), r: Math.max(m.r, 0.7 / s) }));
  return { planet, f, e1, e2, p, toP, view, light, shadows, sat: planet === "saturn", litFace: Math.sign(light[2]) === Math.sign(view[2]) };
}

// The pixels of the planet, for the context ctx: the part of the sky from
// (x0, y0) (the top left corner, planet radii) over w × h pixels of scale s
// (pixels per radius)
function planetPixels(ctx, sky, x0, y0, w, h, s) {
  const { planet, f, toP, view, light, shadows, sat, litFace } = planetModel(sky, s);
  const img = ctx.createImageData(w, h), px = img.data;
  for (let j = 0; j < h; j++) {
    const y = y0 - (j + 0.5) / s;
    for (let i = 0; i < w; i++) {
      const x = x0 + (i + 0.5) / s;
      // the point of the sky, far toward the Earth, and the ray to the planet
      const o = toP([x, y, 10]), d = view.map((v) => -v);
      let rgb = null, alpha = 0;
      const g = hitGlobe(o, d, f);
      const tGlobe = g ? g[0] : Infinity;
      if (g) {
        const q = o.map((v, k) => v + d[k] * tGlobe), k2 = 1 / (1 - f) ** 2;
        const n = [q[0], q[1], q[2] * k2], nn = Math.hypot(...n);
        const lat = Math.atan2(n[2], Math.hypot(n[0], n[1])) * 180 / Math.PI;
        const mu = -dot(n, d) / nn, lit = dot(n, light) / nn;
        let shade = lit > 0 ? Math.pow(lit, 0.75) * (0.7 + 0.3 * mu) : 0;
        // the rings' shadow on the globe
        if (sat && shade > 0 && Math.abs(light[2]) > 1e-6) {
          const t = -q[2] / light[2];
          if (t > 0) {
            const r = ringAt(Math.hypot(q[0] + t * light[0], q[1] + t * light[1]));
            if (r) shade *= 1 - 0.85 * r[2];
          }
        }
        // the moons' shadows
        for (const m of shadows) {
          const v = m.c.map((c, k) => c - q[k]), along = dot(v, light);
          if (along > 0 && dot(v, v) - along * along < m.r * m.r) shade *= 0.08;
        }
        rgb = bandColor(planet, lat).map((c) => c * shade);
        alpha = 1;
      }
      // the rings, in front of the globe or where it is not
      if (sat && Math.abs(d[2]) > 1e-9) {
        const t = -o[2] / d[2];
        if (t < tGlobe) {
          const q = o.map((v, k) => v + d[k] * t), r = ringAt(Math.hypot(q[0], q[1]));
          if (r) {
            let b = litFace ? 1 : 0.3;
            // the globe's shadow on the rings
            const gs = hitGlobe(q, light, f);
            if (gs && gs[1] > 0) b *= 0.06;
            const ring = r[3].map((c) => c * b), a = r[2];
            rgb = rgb ? rgb.map((c, k) => c * (1 - a) + ring[k] * a) : ring;
            alpha = alpha + a * (1 - alpha);
          }
        }
      }
      if (rgb) {
        const at = 4 * (j * w + i);
        px[at] = rgb[0];
        px[at + 1] = rgb[1];
        px[at + 2] = rgb[2];
        px[at + 3] = 255 * alpha;
      }
    }
  }
  return img;
}

// The same tracing on the GPU: a fragment shader over the canvas, four
// rays a pixel (a rotated grid), the colors premultiplied by their
// opacity. A renderer per canvas, or null without WebGL.
const MAX_SHADOWS = 16, MAX_BANDS = 16;
const FRAGMENT = `precision highp float;
uniform vec2 origin, size;
uniform float scale, flattening, reach;
uniform mat3 toP;
uniform vec3 view, light;
uniform bool saturn, litFace;
uniform vec4 shadows[${MAX_SHADOWS}];
uniform int nShadows;
uniform vec4 bands[${MAX_BANDS}];
uniform int nBands;
uniform vec4 rings[4];
uniform vec2 ringEdges[4];

vec2 hitGlobe(vec3 o, vec3 d, out bool hit) {
  float k = 1.0 / (1.0 - flattening);
  vec3 a = vec3(o.xy, o.z * k), b = vec3(d.xy, d.z * k);
  float A = dot(b, b), B = dot(a, b), C = dot(a, a) - 1.0, disc = B * B - A * C;
  hit = disc >= 0.0;
  float q = sqrt(max(disc, 0.0));
  return vec2(-B - q, -B + q) / A;
}
// the ring at a distance from the center: its color and opacity (0: none)
vec4 ringAt(float rho) {
  for (int i = 0; i < 4; i++) if (rho >= ringEdges[i].x && rho < ringEdges[i].y) return rings[i];
  return vec4(0.0);
}
vec3 bandColor(float lat) {
  vec3 c = bands[0].yzw;
  for (int i = 1; i < ${MAX_BANDS}; i++) {
    if (i >= nBands) break;
    c = mix(c, bands[i].yzw, clamp((lat - bands[i].x + 1.5) / 3.0, 0.0, 1.0));
  }
  return c;
}
// a ray through the point (x, y) of the sky (planet radii): its color,
// premultiplied, and its opacity
vec4 trace(vec2 xy) {
  if (dot(xy, xy) > reach * reach) return vec4(0.0);
  vec3 o = toP * vec3(xy, 10.0), d = -view;
  vec4 c = vec4(0.0);
  bool hit;
  vec2 g = hitGlobe(o, d, hit);
  float tGlobe = hit ? g.x : 1e9;
  if (hit) {
    vec3 q = o + d * tGlobe, n = vec3(q.xy, q.z / ((1.0 - flattening) * (1.0 - flattening)));
    float nn = length(n), lat = degrees(atan(n.z, length(n.xy)));
    float mu = -dot(n, d) / nn, lit = dot(n, light) / nn;
    float shade = lit > 0.0 ? pow(lit, 0.75) * (0.7 + 0.3 * mu) : 0.0;
    // the rings' shadow on the globe
    if (saturn && shade > 0.0 && abs(light.z) > 1e-6) {
      float t = -q.z / light.z;
      if (t > 0.0) shade *= 1.0 - 0.85 * ringAt(length(q.xy + t * light.xy)).a;
    }
    // the moons' shadows
    for (int i = 0; i < ${MAX_SHADOWS}; i++) {
      if (i >= nShadows) break;
      vec3 v = shadows[i].xyz - q;
      float along = dot(v, light);
      if (along > 0.0 && dot(v, v) - along * along < shadows[i].w * shadows[i].w) shade *= 0.08;
    }
    c = vec4(bandColor(lat) * shade, 1.0);
  }
  // the rings, in front of the globe or where it is not
  if (saturn && abs(d.z) > 1e-9) {
    float t = -o.z / d.z;
    if (t < tGlobe) {
      vec3 q = o + d * t;
      vec4 r = ringAt(length(q.xy));
      if (r.a > 0.0) {
        float b = litFace ? 1.0 : 0.3;
        // the globe's shadow on the rings
        bool shadowed;
        vec2 gs = hitGlobe(q, light, shadowed);
        if (shadowed && gs.y > 0.0) b *= 0.06;
        c = vec4(r.rgb * b * r.a, r.a) + c * (1.0 - r.a);
      }
    }
  }
  return c;
}
void main() {
  // the pixel from the top left corner, and the sky there
  vec2 px = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  vec4 c = vec4(0.0);
  c += trace(origin + vec2(px.x + 0.125, -(px.y - 0.375)) / scale);
  c += trace(origin + vec2(px.x - 0.375, -(px.y - 0.125)) / scale);
  c += trace(origin + vec2(px.x - 0.125, -(px.y + 0.375)) / scale);
  c += trace(origin + vec2(px.x + 0.375, -(px.y + 0.125)) / scale);
  gl_FragColor = c / 4.0;
}`;
const VERTEX = "attribute vec2 at; void main() { gl_Position = vec4(at, 0.0, 1.0); }";

// the program on a WebGL context, its uniforms (an error if it fails)
function planetProgram(gl) {
  const shader = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(prog, "at");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = {};
  for (const name of ["origin", "size", "scale", "flattening", "reach", "toP", "view", "light", "saturn", "litFace", "shadows", "nShadows", "bands", "nBands", "rings", "ringEdges"]) u[name] = gl.getUniformLocation(prog, name);
  gl.uniform4fv(u.rings, RINGS.flatMap(([, , a, c]) => [...c.map((x) => x / 255), a]));
  gl.uniform2fv(u.ringEdges, RINGS.flatMap(([a, b]) => [a, b]));
  return u;
}
// Tried first on a canvas of its own: a canvas given a WebGL context
// cannot be drawn in 2D any more
const GL_OPTIONS = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true };
let glWorks = null;
function webglWorks() {
  if (glWorks === null) {
    try {
      const gl = document.createElement("canvas").getContext("webgl", GL_OPTIONS);
      glWorks = Boolean(gl && planetProgram(gl));
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch { glWorks = false; }
  }
  return glWorks;
}
const renderers = new WeakMap();
function glRenderer(canvas) {
  if (renderers.has(canvas)) return renderers.get(canvas);
  let r = null;
  if (webglWorks()) {
    try {
      const gl = canvas.getContext("webgl", GL_OPTIONS);
      if (gl) r = { gl, u: planetProgram(gl) };
    } catch { r = null; }
  }
  renderers.set(canvas, r);
  return r;
}

// The planet traced on the GPU over the canvas, w × h pixels whose top left
// corner is the point (x0, y0) of the sky, s pixels per radius; false
// without WebGL
function tracePlanet(canvas, sky, x0, y0, w, h, s) {
  const r = glRenderer(canvas);
  if (!r || r.gl.isContextLost()) return false;
  const { gl, u } = r, m = planetModel(sky, s);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.uniform2f(u.origin, x0, y0);
  gl.uniform2f(u.size, w, h);
  gl.uniform1f(u.scale, s);
  gl.uniform1f(u.flattening, m.f);
  gl.uniform1f(u.reach, m.sat ? 2.3 : 1.02);
  gl.uniformMatrix3fv(u.toP, false, [0, 1, 2].flatMap((k) => [m.e1[k], m.e2[k], m.p[k]]));
  gl.uniform3fv(u.view, m.view);
  gl.uniform3fv(u.light, m.light);
  gl.uniform1i(u.saturn, m.sat ? 1 : 0);
  gl.uniform1i(u.litFace, m.litFace ? 1 : 0);
  const shadows = m.shadows.slice(0, MAX_SHADOWS);
  gl.uniform1i(u.nShadows, shadows.length);
  if (shadows.length) gl.uniform4fv(u.shadows, shadows.flatMap((x) => [...x.c, x.r]));
  const bands = BANDS[m.planet].slice(0, MAX_BANDS);
  gl.uniform1i(u.nBands, bands.length);
  gl.uniform4fv(u.bands, bands.flatMap(([lat, c]) => [lat, ...c.map((x) => x / 255)]));
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return true;
}

// the part of the view (W × H, centered on cx, cy, s pixels per radius)
// where the planet and its rings can be: left, top, right, bottom
function planetBox(sky, W, H, cx, cy, s) {
  const reach = sky.planet === "saturn" ? 2.3 : 1.02;
  return [Math.max(0, W / 2 + (-reach - cx) * s), Math.max(0, H / 2 - (reach - cy) * s),
    Math.min(W, W / 2 + (reach - cx) * s), Math.min(H, H / 2 - (-reach - cy) * s)];
}

// The planet in a canvas covering the view, k pixels per pixel of the view:
// on the GPU (then true), or else in JavaScript
function drawPlanet(canvas, sky, W, H, cx, cy, s, k) {
  if (tracePlanet(canvas, sky, cx - W / 2 / s, cy + H / 2 / s, Math.round(W * k), Math.round(H * k), s * k)) return true;
  canvas.width = Math.round(W * k);
  canvas.height = Math.round(H * k);
  const ctx = canvas.getContext("2d");
  const [L, T, R, B] = planetBox(sky, W, H, cx, cy, s);
  if (R <= L || B <= T) return;
  const x = Math.floor(L * k), y = Math.floor(T * k), w = Math.ceil(R * k) - x, h = Math.ceil(B * k) - y;
  ctx.putImageData(planetPixels(ctx, sky, cx + (x / k - W / 2) / s, cy - (y / k - H / 2) / s, w, h, s * k), x, y);
  return false;
}

// the planet as an image (a data URL) at (L, T) of the view, or "" (traced
// on a canvas kept for them)
let imageCanvas = null;
function planetImage(sky, W, H, cx, cy, s, k) {
  const [L, T, R, B] = planetBox(sky, W, H, cx, cy, s);
  if (R <= L || B <= T) return "";
  const w = Math.ceil((R - L) * k), h = Math.ceil((B - T) * k);
  if (w * h > 4e6) return "";
  const x0 = cx + (L - W / 2) / s, y0 = cy - (T - H / 2) / s;
  imageCanvas ??= document.createElement("canvas");
  let canvas = imageCanvas;
  if (!tracePlanet(canvas, sky, x0, y0, w, h, s * k)) {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(planetPixels(ctx, sky, x0, y0, w, h, s * k), 0, 0);
  }
  return `<image href="${canvas.toDataURL()}" x="${L.toFixed(1)}" y="${T.toFixed(1)}" width="${(w / k).toFixed(1)}" height="${(h / k).toFixed(1)}"/>`;
}

// a round length for the scale, about a fifth of the width, in arcseconds
function scaleBar(arcsecPerPx, W) {
  const target = arcsecPerPx * W / 5;
  const unit = target >= 60 ? 60 : 1, v = target / unit;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  const len = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p * unit;
  return { px: len / arcsecPerPx, text: unit === 60 ? `${len / 60}′` : `${len}″` };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The moons, their names, the scale and the directions over a view of
// W × H centered on (cx, cy) (planet radii), s pixels per radius: SVG; the
// moons' names in full, or their first two letters; the scale unless bar
// is false; the directions top pixels lower (under controls)
function overlaySVG(sky, W, H, cx, cy, s, full = false, bar = true, top = 0) {
  const f1 = (x) => x.toFixed(1);
  const X = (x) => W / 2 + (x - cx) * s, Y = (y) => H / 2 - (y - cy) * s;
  let svg = "";
  // the moons, those hidden behind the planet or in its shadow as rings;
  // the labels above and below in turn, from left to right
  const pts = sky.moons.map((m) => ({ m, x: X(m.x), y: Y(m.y) })).sort((a, b) => a.x - b.x);
  pts.forEach((p, i) => {
    const x = Math.max(6, Math.min(W - 6, p.x)), y = Math.max(6, Math.min(H - 6, p.y)), out = x !== p.x || y !== p.y;
    const hidden = p.m.doing.includes("occulted") || p.m.doing.includes("eclipsed");
    const r = Math.max(2.4, p.m.r * s);
    if (out) {
      const a = Math.atan2(p.y - y, p.x - x), c = Math.cos(a), sn = Math.sin(a);
      svg += `<path class="sky-moon" d="M${f1(x + 5 * c)} ${f1(y + 5 * sn)}L${f1(x - 3 * c - 4 * sn)} ${f1(y - 3 * sn + 4 * c)}L${f1(x - 3 * c + 4 * sn)} ${f1(y - 3 * sn - 4 * c)}z"/>`;
    } else svg += `<circle class="sky-moon${hidden ? " off" : ""}" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"/>`;
    // at the edges, the labels inside, beside the arrows
    const name = full ? p.m.name : p.m.name.slice(0, 2), up = i % 2 === 0;
    const left = x < 40, right = x > W - 40;
    const ty = out && (left || right) ? y + 3.5 : Math.max(10, Math.min(H - 4, y + (up ? -r - 4 : r + 11)));
    const tx = left ? x + 9 : right ? x - 9 : x, anchor = left ? "start" : right ? "end" : "middle";
    svg += `<text class="sky-label" x="${f1(tx)}" y="${f1(ty)}" text-anchor="${anchor}">${esc(name)}</text>`;
  });
  // the scale and the directions
  // the scale at the bottom, in the middle; north and east at the top right
  if (bar) {
    const b = scaleBar(sky.radius / s, W), bx = W / 2 - b.px / 2, by = H - 10;
    svg += `<path class="sky-scale" d="M${f1(bx)} ${by - 4}v4h${f1(b.px)}v-4"/><text class="sky-label" x="${f1(W / 2)}" y="${by - 7}" text-anchor="middle">${b.text}</text>`;
  }
  svg += `<path class="sky-scale" d="M${W - 14} ${16 + top}v18h-18"/><text class="sky-label" x="${W - 14}" y="${12 + top}" text-anchor="middle">N</text><text class="sky-label" x="${W - 38}" y="${37 + top}" text-anchor="middle">E</text>`;
  return svg;
}

// All in one SVG, the planet as an image of dpr pixels per pixel (for the
// history)
function skySVG(sky, W, H, cx, cy, s, { dpr = 1, full = false } = {}) {
  return `<rect class="sky-bg" width="${W}" height="${H}" rx="10"/>` + planetImage(sky, W, H, cx, cy, s, dpr) + overlaySVG(sky, W, H, cx, cy, s, full);
}

// The view that shows the planet and the moons within five times their
// median distance (those farther out at the edge), for W × H pixels
function fitView(sky, W, H) {
  const far = sky.moons.map((m) => Math.hypot(m.x, m.y)).sort((a, b) => a - b);
  const median = far[Math.floor((far.length - 1) / 2)];
  const reach = Math.max(sky.planet === "saturn" ? 2.4 : 1.3, ...far.filter((d) => d <= 5 * median));
  return { cx: 0, cy: 0, s: Math.min((W / 2 - 18) / reach, (H / 2 - 16) / 1.2) };
}

// The zoom view of a planet and its moons in a stage holding a canvas
// (.sky-canvas) under an SVG (.sky-svg): drag to move, pinch or scroll to
// zoom, double-tap to fit, onTap(moon) for a tap on a moon. The planet is
// a canvas under the moons, traced again at every move on the GPU; without
// it, while the view moves it is only moved and scaled, then drawn again
// sharp. size(W, H) lays it out; set(sky, quick) shows the moons at
// another time, the planet (without the GPU) ten times a second if quick. Without a bar, onScale(arcseconds per pixel) gives the scale;
// top moves the directions down
function moonsView(stage, sky, { onTap = null, bar = true, onScale = null, top = 0 } = {}) {
  const svg = stage.querySelector(".sky-svg"), canvas = stage.querySelector(".sky-canvas");
  let W = 320, H = 400, v = null, drawn = null, idle = 0, quick = false, planetAt = 0, gpu = false;
  const k = () => Math.min(gpu ? 3 : 2, window.devicePixelRatio || 1);
  // the planet sharp for the view, and the canvas back in place
  const sharp = () => {
    gpu = drawPlanet(canvas, sky, W, H, v.cx, v.cy, v.s, quick && !gpu ? 1 : k());
    drawn = { ...v };
    canvas.style.transform = "";
  };
  // the canvas of the view drawn moved and scaled to the view v
  const follow = () => {
    const m = v.s / drawn.s;
    const tx = W / 2 + (drawn.cx - v.cx) * v.s - (W / 2) * m, ty = H / 2 - (drawn.cy - v.cy) * v.s - (H / 2) * m;
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${m})`;
  };
  const overlay = () => { svg.innerHTML = overlaySVG(sky, W, H, v.cx, v.cy, v.s, true, bar, top); onScale?.(sky.radius / v.s); };
  const moved = () => {
    overlay();
    if (gpu) { sharp(); return; }
    follow();
    clearTimeout(idle);
    idle = setTimeout(sharp, 120);
  };

  const local = (ev) => {
    const b = svg.getBoundingClientRect();
    return { x: ((ev.clientX - b.left) * W) / b.width, y: ((ev.clientY - b.top) * H) / b.height };
  };
  // the view with the sky under the point p (of the view base) under q, at scale s
  const keep = (base, p, q, s) => {
    const sx = base.cx + (p.x - W / 2) / base.s, sy = base.cy - (p.y - H / 2) / base.s;
    return { cx: sx - (q.x - W / 2) / s, cy: sy + (q.y - H / 2) / s, s };
  };
  // from all the moons in view to a planet radius of four times the view
  const clampS = (s) => {
    const all = Math.max(2.5, ...sky.moons.map((m) => Math.hypot(m.x, m.y)));
    return Math.min(4 * Math.min(W, H), Math.max(Math.min(W, H) / 2 / (1.1 * all), s));
  };
  const pts = new Map();
  let base = null, dragged = false, lastTap = 0, moving = 0;
  const start = () => { base = { v: { ...v }, pts: new Map([...pts].map(([id, p]) => [id, { ...p }])) }; };
  svg.addEventListener("pointerdown", (ev) => {
    // a new first finger: those of before were lost
    if (ev.isPrimary) pts.clear();
    svg.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, local(ev));
    dragged = false;
    start();
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, local(ev));
    const ids = [...pts.keys()].filter((id) => base.pts.has(id));
    if (ids.length === 1) {
      const p0 = base.pts.get(ids[0]), p1 = pts.get(ids[0]);
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 4) dragged = true;
      if (dragged) v = keep(base.v, p0, p1, base.v.s);
    } else if (ids.length >= 2) {
      const [a0, b0] = ids.slice(0, 2).map((id) => base.pts.get(id)), [a1, b1] = ids.slice(0, 2).map((id) => pts.get(id));
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
      const s = clampS(base.v.s * (d0 > 20 ? d1 / d0 : 1));
      v = keep(base.v, { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }, s);
      dragged = true;
    }
    if (!moving) moving = requestAnimationFrame(() => { moving = 0; moved(); });
  });
  const up = (ev) => {
    if (!pts.delete(ev.pointerId)) return;
    if (ev.type === "pointerup" && !dragged && !pts.size) {
      // a moon under the finger
      const p = local(ev), X = (x) => W / 2 + (x - v.cx) * v.s, Y = (y) => H / 2 - (y - v.cy) * v.s;
      const near = onTap && sky.t !== undefined ? sky.moons.find((m) => Math.hypot(X(m.x) - p.x, Y(m.y) - p.y) < 16) : null;
      if (near) { onTap(near); return; }
      if (ev.timeStamp - lastTap < 350) { v = fitView(sky, W, H); moved(); lastTap = 0; } else lastTap = ev.timeStamp;
    }
    start();
  };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("touchmove", (ev) => ev.preventDefault(), { passive: false });
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const p = local(ev);
    v = keep(v, p, p, clampS(v.s * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.002))));
    if (!moving) moving = requestAnimationFrame(() => { moving = 0; moved(); });
  }, { passive: false });

  return {
    size(w, h) {
      W = w;
      H = h;
      stage.style.height = `${H}px`;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      if (!v) v = fitView(sky, W, H);
      overlay();
      sharp();
    },
    set(next, fast = false) {
      sky = next;
      quick = fast;
      if (!v) return;
      overlay();
      const now = performance.now();
      if (gpu || !fast || now - planetAt > 100) { planetAt = now; sharp(); }
    },
    fit() { v = fitView(sky, W, H); moved(); },
    get sky() { return sky; },
  };
}

export { skySVG, overlaySVG, drawPlanet, fitView, moonsView };
