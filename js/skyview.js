// A planet and its moons as in a telescope, north up and east to the left,
// from the view of moons() in sky.js: lengths in planet radii, on axes to
// the west (x, to the right), to the north (y) and toward the Earth (z).
// The planet is traced pixel by pixel: its flattened globe with its bands,
// lit by the Sun, Saturn's rings with the shadows of the globe on them and
// theirs on the globe, and the shadows of the moons (umbra and penumbra); the moons, their
// names and a scale go on top, in SVG. The planets have maps of their
// surfaces or clouds (img/planets), turned as they are seen. The
// tracing runs on the GPU (WebGL),
// four rays a pixel for smooth edges, at every frame; without WebGL, in
// JavaScript, a ray a pixel, after the view stops.

const FLAT = { mars: 0.00589, jupiter: 0.06487, saturn: 0.09796, uranus: 0.02293, neptune: 0.01708 };
// Keep the inner planets' dark silhouettes to show their crescent phases;
// blend the other planets' dark limbs into the sky behind them.
const skyBlend = (planet) => planet === 'venus' || planet === 'mercury' ? 'normal' : 'screen';

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

// The Sun's angular radius seen from the planets (radians), at their mean
// distances: their moons' shadows are an umbra narrowing with the distance
// from the moon, in a widening penumbra
const SUN_ANGLE = { mars: 0.0046505 / 1.5237, jupiter: 0.0046505 / 5.2028, saturn: 0.0046505 / 9.5388, uranus: 0.0046505 / 19.191, neptune: 0.0046505 / 30.069 };
// the part of a disk of radius a (the Sun) covered by one of radius b (a
// moon) d away
function covered(a, b, d) {
  if (d >= a + b) return 0;
  if (d <= Math.abs(a - b)) return Math.min(1, (b * b) / (a * a));
  const x = Math.min(1, Math.max(-1, (d * d + a * a - b * b) / (2 * d * a))), y = Math.min(1, Math.max(-1, (d * d + b * b - a * a) / (2 * d * b)));
  return (a * a * Math.acos(x) + b * b * Math.acos(y) - 0.5 * Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)))) / (Math.PI * a * a);
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

// The maps of the surfaces (equirectangular, east to the right, from
// −180° in the middle of the far side; planetocentric latitudes) from
// Solar System Scope (CC BY 4.0, from NASA's missions; the Moon's from
// NASA's CGI Moon Kit, LRO's colours and LOLA's heights, public domain,
// with its heights: 0 to 255 for −9 to +11 km; Venus's clouds at a
// third of their contrast, as it looks in visible light; Uranus and
// Neptune made of their bands alone, without the spots Voyager saw in
// 1986 and 1989, long gone), fetched when a
// close-up first shows them and kept on the device (Cache Storage, left
// alone by the apps' updates). u0(t): where the longitude 0 is on the map
// (0 to 1), for the main and the equatorial zone. Jupiter's map is of its
// clouds, which drift: it is turned to put the Great Red Spot at its
// longitude (System II), measured by observers (JUPOS) and extrapolated
// by Sky & Telescope: 91° on 2026 June 1, 1.75° more a month (update
// GRS with their newer values). Its equatorial zone turns on System I,
// from the same map.
const MAP_CACHE = "imks-data-planets";
const GRS = { t: Date.UTC(2026, 5, 1) / 1000, lon: 91, perDay: 1.75 / 30.44, u: 0.366 };
const grsLon = (t) => GRS.lon + GRS.perDay * (t - GRS.t) / 86400;
// System I − System II at the GRS epoch (Meeus): the equatorial zone's map
// is placed as the rest there
const EZ = 23.75 + 7.63 * ((GRS.t - 946728000) / 86400);
const MAPS = {
  mercury: { file: "mercury.jpg", u0: () => [0.5, 0.5] },
  venus: { file: "venus.jpg", u0: () => [0.5, 0.5] },
  mars: { file: "mars.jpg", u0: () => [0.5, 0.5] },
  saturn: { file: "saturn.jpg", u0: () => [0.5, 0.5] },
  uranus: { file: "uranus.jpg", u0: () => [0.5, 0.5] },
  neptune: { file: "neptune.jpg", u0: () => [0.5, 0.5] },
  moon: { file: "moon.jpg", heights: "moon-heights.jpg", u0: () => [0.5, 0.5] },
  jupiter: { file: "jupiter.jpg", u0: (t) => [GRS.u + grsLon(t) / 360, GRS.u + (GRS.lon + EZ) / 360], zones: true },
};
const maps = new Map();
// { img, pixels (for the JavaScript tracer), ready (a promise) }, or null
function planetMap(planet) {
  const m = MAPS[planet];
  if (!m || typeof fetch === "undefined" || typeof createImageBitmap === "undefined") return null;
  if (!maps.has(planet)) {
    const e = { img: null, pixels: null };
    e.ready = (async () => {
      let cache = null;
      try { cache = await caches.open(MAP_CACHE); } catch { /* no Cache Storage */ }
      const load = async (file) => {
        const url = new URL(`../img/planets/${file}`, import.meta.url).href;
        let res = await cache?.match(url).catch(() => null);
        if (!res) {
          res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await cache?.put(url, res.clone()).catch(() => {});
        }
        return createImageBitmap(await res.blob());
      };
      [e.img, e.heights] = await Promise.all([load(m.file), m.heights ? load(m.heights) : null]);
      return e;
    })().catch(() => null);
    maps.set(planet, e);
  }
  return maps.get(planet);
}
// a map's pixels, for the JavaScript tracer
function mapPixels(e) {
  if (!e.pixels) {
    const c = document.createElement("canvas");
    c.width = e.img.width; c.height = e.img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(e.img, 0, 0);
    e.pixels = { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  }
  return e.pixels;
}

// The moons as the GPU draws them: their colours (as they look; Io's
// sulphur, Callisto dark), and how (0: a sphere, 1: Titan's haze, 2:
// Iapetus, dark on its leading side)
const MOON_LOOK = {
  Io: [[236, 214, 140], 0], Europa: [[226, 216, 198], 0], Ganymede: [[178, 168, 154], 0], Callisto: [[120, 108, 96], 0],
  Titan: [[214, 156, 78], 1], Iapetus: [[214, 208, 196], 2], Phobos: [[112, 102, 94], 0], Deimos: [[132, 122, 112], 0],
  Triton: [[222, 208, 202], 0], other: [[208, 206, 202], 0],
};

// The geometry of the planet for the tracing, at s pixels per radius: its
// flattening, its axes (e1, e2 in its equator, p to its north pole), the
// directions of the Earth and the Sun on them, the moons (at least 0.7
// pixels across, for their shadows), the Sun's angular radius, which face
// of the rings is lit, and the map with the longitudes below the Earth
// (east; for Jupiter, System II and System I) once loaded
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
  const bodies = moons.filter((m) => m.r > 0).map((m) => ({ c: toP([m.x, m.y, m.z]), r: m.r, look: MOON_LOOK[m.name] || MOON_LOOK.other }));
  const e = sky.facing && planetMap(planet), map = e?.img ? { e, lon0: [sky.facing.clouds ?? sky.facing.lon, sky.facing.lon1 ?? sky.facing.lon], u0: MAPS[planet].u0(sky.t), zones: Boolean(MAPS[planet].zones) } : null;
  return { planet, f, e1, e2, p, toP, view, light, shadows, bodies, map, sunAngle: SUN_ANGLE[planet] || 0, sat: planet === "saturn", litFace: Math.sign(light[2]) === Math.sign(view[2]) };
}

// The pixels of the planet, for the context ctx: the part of the sky from
// (x0, y0) (the top left corner, planet radii) over w × h pixels of scale s
// (pixels per radius)
function planetPixels(ctx, sky, x0, y0, w, h, s) {
  const { planet, f, toP, view, light, shadows, map, sunAngle, sat, litFace } = planetModel(sky, s);
  const img = ctx.createImageData(w, h), px = img.data;
  // the map's color at a point q of the surface (planet axes): its
  // longitude east of the one below the Earth, its latitude
  const pixels = map && mapPixels(map.e), sE = view;
  const sample = (q, k) => {
    const lon = map.lon0[k] + Math.atan2(sE[0] * q[1] - sE[1] * q[0], sE[0] * q[0] + sE[1] * q[1]) * 180 / Math.PI;
    const u = map.u0[k] + lon / 360, v = 0.5 - Math.atan2(q[2], Math.hypot(q[0], q[1])) / Math.PI;
    const x = Math.floor((u - Math.floor(u)) * pixels.w) % pixels.w, y = Math.min(pixels.h - 1, Math.max(0, Math.floor(v * pixels.h))), at = 4 * (y * pixels.w + x);
    return [pixels.data[at], pixels.data[at + 1], pixels.data[at + 2]];
  };
  const surface = (q, lat) => {
    if (!map) return bandColor(planet, lat);
    if (!map.zones) return sample(q, 0);
    const w = Math.min(1, Math.max(0, (Math.abs(lat) - 7) / 5));
    const a = w < 1 ? sample(q, 1) : null, b = w > 0 ? sample(q, 0) : null;
    return !a ? b : !b ? a : a.map((c, i) => c + (b[i] - c) * w);
  };
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
        // the moons' shadows: the part of the Sun each covers, seen from
        // here (the Sun's radius and the moon's off its center, at the
        // moon's distance)
        for (const m of shadows) {
          const v = m.c.map((c, k) => c - q[k]), along = dot(v, light);
          if (along <= 0) continue;
          const off = Math.hypot(v[1] * light[2] - v[2] * light[1], v[2] * light[0] - v[0] * light[2], v[0] * light[1] - v[1] * light[0]);
          shade *= 1 - covered(Math.max(sunAngle * along, 1e-9), m.r, off);
        }
        rgb = surface(q, lat).map((c) => c * shade);
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
uniform float scale, flattening, reach, sunAngle;
uniform mat3 toP;
uniform vec3 view, light;
uniform bool saturn, litFace;
uniform vec4 shadows[${MAX_SHADOWS}];
uniform int nShadows;
uniform vec4 moonsAt[${MAX_SHADOWS}], moonsLook[${MAX_SHADOWS}];
uniform int nMoons;
uniform float near;
uniform vec4 bands[${MAX_BANDS}];
uniform int nBands;
uniform vec4 rings[4];
uniform vec2 ringEdges[4];
uniform sampler2D surface, heights;
uniform bool mapped, zones, lunar, relief;
uniform float earthshine;
uniform vec2 lon0, u0;

vec2 hitGlobe(vec3 o, vec3 d, out bool hit) {
  float k = 1.0 / (1.0 - flattening);
  vec3 a = vec3(o.xy, o.z * k), b = vec3(d.xy, d.z * k);
  float A = dot(b, b), B = dot(a, b), C = dot(a, a) - 1.0, disc = B * B - A * C;
  hit = disc >= 0.0;
  float q = sqrt(max(disc, 0.0));
  return vec2(-B - q, -B + q) / A;
}
// the part of a disk of radius a (the Sun) covered by one of radius b (a
// moon) d away
float covered(float a, float b, float d) {
  if (d >= a + b) return 0.0;
  if (d <= abs(a - b)) return min(1.0, b * b / (a * a));
  float x = clamp((d * d + a * a - b * b) / (2.0 * d * a), -1.0, 1.0), y = clamp((d * d + b * b - a * a) / (2.0 * d * b), -1.0, 1.0);
  return (a * a * acos(x) + b * b * acos(y) - 0.5 * sqrt(max(0.0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)))) / (3.14159265 * a * a);
}
// the ring at a distance from the center: its color and opacity (0: none)
vec4 ringAt(float rho) {
  for (int i = 0; i < 4; i++) if (rho >= ringEdges[i].x && rho < ringEdges[i].y) return rings[i];
  return vec4(0.0);
}
// the map's color at a point q of the surface: its longitude east of the
// one below the Earth (the seam of the map on the far side), its latitude
vec2 mapAt(vec3 q, int k) {
  vec2 s = view.xy;
  float lon = (k == 0 ? lon0.x : lon0.y) + degrees(atan(s.x * q.y - s.y * q.x, dot(s, q.xy)));
  return vec2((k == 0 ? u0.x : u0.y) + lon / 360.0, 0.5 - atan(q.z, length(q.xy)) / 3.14159265);
}
vec3 sampleMap(vec3 q, int k) {
  return texture2D(surface, mapAt(q, k)).rgb;
}
// The Moon: the heights (km) of its map
float heightAt(vec2 uv) {
  return -9.0 + 20.0 * texture2D(heights, uv).r;
}
// The Moon at a point q of its surface, lit by the Sun as the Moon is
// (Lommel–Seeliger: its full disk as bright at the limb as in the middle),
// on its slopes (the heights, twice as steep: those of the map are
// smoothed over 8 km); near the terminator the shadows of its mountains
// and crater walls, the Sun's disk hidden by the heights toward it (half
// a degree across); the night side faint with earthshine
const float MOON_KM = 1737.4, RELIEF = 2.0;
vec3 lunarColor(vec3 q) {
  vec2 uv = mapAt(q, 0);
  vec3 albedo = texture2D(surface, uv).rgb, n = q;
  // (the relief fading toward the limb, where its slopes are not seen and
  // would only turn the surface away from a Sun behind the observer)
  float sphere = dot(q, light), edge = smoothstep(0.0, 0.3, dot(q, view));
  if (relief) {
    vec3 E = normalize(vec3(-q.y, q.x, 0.0) + vec3(1e-6, 0.0, 0.0)), N = cross(q, E);
    float du = 1.0 / 1440.0, dv = 1.0 / 720.0, coslat = max(length(q.xy), 0.05);
    float sE = (heightAt(uv + vec2(du, 0.0)) - heightAt(uv - vec2(du, 0.0))) / (2.0 * du * 6.2831853 * coslat * MOON_KM);
    float sN = (heightAt(uv - vec2(0.0, dv)) - heightAt(uv + vec2(0.0, dv))) / (2.0 * dv * 3.14159265 * MOON_KM);
    n = normalize(q - RELIEF * edge * (sE * E + sN * N));
  }
  float mu0 = dot(n, light), mu = max(dot(n, view), 0.0);
  float lit = mu0 > 0.0 && sphere > -0.03 ? min(1.6, 2.6 * mu0 / (mu0 + mu + 1e-4)) : 0.0;
  if (relief && lit > 0.0 && sphere < 0.35) {
    float h0 = 1.0 + RELIEF * heightAt(uv) / MOON_KM, dist = 0.0, step = 0.0012, seen = 1.0;
    vec3 p = q * h0;
    for (int i = 0; i < 18; i++) {
      dist += step;
      step *= 1.25;
      vec3 r = p + light * dist;
      float rl = length(r), ground = 1.0 + RELIEF * heightAt(mapAt(r / rl, 0)) / MOON_KM;
      seen = min(seen, (rl - ground) / (0.00465 * dist));
    }
    lit *= mix(1.0, clamp(0.5 + 0.5 * seen, 0.0, 1.0), edge);
  }
  return albedo * (lit + earthshine);
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
  // the ray from toward the Earth (beyond the moons in front)
  vec3 o = toP * vec3(xy, near), d = -view;
  // the nearest moon on it: a sphere lit by the Sun (its phase), dark in
  // the planet's shadow; Titan's haze, bright to its limb and past its
  // terminator; Iapetus dark on the side leading in its orbit
  float tMoon = 1e9;
  vec4 mAt = vec4(0.0), mLook = vec4(0.0), c = vec4(0.0);
  for (int i = 0; i < ${MAX_SHADOWS}; i++) {
    if (i >= nMoons) break;
    // (by the closest approach: precise for small moons far away)
    vec3 oc = o - moonsAt[i].xyz;
    float b = dot(oc, d);
    vec3 off = oc - b * d;
    float disc = moonsAt[i].w * moonsAt[i].w - dot(off, off);
    if (disc > 0.0) {
      float t = -b - sqrt(disc);
      if (t > 0.0 && t < tMoon) { tMoon = t; mAt = moonsAt[i]; mLook = moonsLook[i]; }
    }
  }
  if (tMoon < 1e8) {
    vec3 p = o + d * tMoon, n = normalize(p - mAt.xyz);
    float mu0 = dot(n, light), mu = dot(n, view), shade;
    vec3 color = mLook.rgb;
    if (mLook.a > 0.5 && mLook.a < 1.5) shade = pow(clamp((mu0 + 0.12) / 1.12, 0.0, 1.0), 0.6) * (0.85 + 0.25 * (1.0 - mu));
    else shade = mu0 > 0.0 ? pow(mu0, 0.75) * (0.7 + 0.3 * mu) : 0.0;
    if (mLook.a > 1.5) color *= mix(1.0, 0.12, smoothstep(-0.25, 0.25, dot(n, normalize(cross(vec3(0.0, 0.0, 1.0), mAt.xyz)))));
    bool inShadow;
    vec2 gs = hitGlobe(p, light, inShadow);
    if (inShadow && gs.y > 0.0) shade *= 0.02;
    c = vec4(color * shade, 1.0);
  }
  if (dot(xy, xy) > reach * reach) return c;
  bool hit;
  vec2 g = hitGlobe(o, d, hit);
  hit = hit && g.x < tMoon;
  float tGlobe = hit ? g.x : 1e9;
  if (hit && lunar) c = vec4(lunarColor(o + d * tGlobe), 1.0);
  else if (hit) {
    vec3 q = o + d * tGlobe, n = vec3(q.xy, q.z / ((1.0 - flattening) * (1.0 - flattening)));
    float nn = length(n), lat = degrees(atan(n.z, length(n.xy)));
    float mu = -dot(n, d) / nn, lit = dot(n, light) / nn;
    float shade = lit > 0.0 ? pow(lit, 0.75) * (0.7 + 0.3 * mu) : 0.0;
    // the rings' shadow on the globe
    if (saturn && shade > 0.0 && abs(light.z) > 1e-6) {
      float t = -q.z / light.z;
      if (t > 0.0) shade *= 1.0 - 0.85 * ringAt(length(q.xy + t * light.xy)).a;
    }
    // the moons' shadows: the part of the Sun each covers, seen from here
    for (int i = 0; i < ${MAX_SHADOWS}; i++) {
      if (i >= nShadows) break;
      vec3 v = shadows[i].xyz - q;
      float along = dot(v, light);
      if (along > 0.0) shade *= 1.0 - covered(max(sunAngle * along, 1e-9), shadows[i].w, length(cross(v, light)));
    }
    vec3 color = bandColor(lat);
    if (mapped) {
      color = sampleMap(q, 0);
      // Jupiter's equatorial zone, on System I
      if (zones) color = mix(sampleMap(q, 1), color, clamp((abs(lat) - 7.0) / 5.0, 0.0, 1.0));
    }
    c = vec4(color * shade, 1.0);
  }
  // the rings, in front of the globe or where it is not
  if (saturn && abs(d.z) > 1e-9) {
    float t = -o.z / d.z;
    if (t < min(tGlobe, tMoon)) {
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
  for (const name of ["origin", "size", "scale", "flattening", "reach", "sunAngle", "toP", "view", "light", "saturn", "litFace", "shadows", "nShadows", "bands", "nBands", "rings", "ringEdges", "surface", "mapped", "zones", "lon0", "u0", "heights", "lunar", "relief", "earthshine", "moonsAt", "moonsLook", "nMoons", "near"]) u[name] = gl.getUniformLocation(prog, name);
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
      if (gl) r = { gl, u: planetProgram(gl), textures: new Map() };
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
  gl.uniform1f(u.sunAngle, m.sunAngle);
  gl.uniformMatrix3fv(u.toP, false, [0, 1, 2].flatMap((k) => [m.e1[k], m.e2[k], m.p[k]]));
  gl.uniform3fv(u.view, m.view);
  gl.uniform3fv(u.light, m.light);
  gl.uniform1i(u.saturn, m.sat ? 1 : 0);
  gl.uniform1i(u.litFace, m.litFace ? 1 : 0);
  const shadows = m.shadows.slice(0, MAX_SHADOWS);
  gl.uniform1i(u.nShadows, shadows.length);
  if (shadows.length) gl.uniform4fv(u.shadows, shadows.flatMap((x) => [...x.c, x.r]));
  const bodies = m.bodies.slice(0, MAX_SHADOWS);
  gl.uniform1i(u.nMoons, bodies.length);
  gl.uniform1f(u.near, Math.max(10, ...sky.moons.map((x) => x.z + 2)));
  if (bodies.length) {
    gl.uniform4fv(u.moonsAt, bodies.flatMap((x) => [...x.c, x.r]));
    gl.uniform4fv(u.moonsLook, bodies.flatMap((x) => [...x.look[0].map((v) => v / 255), x.look[1]]));
  }
  const bands = (BANDS[m.planet] || BANDS.mercury).slice(0, MAX_BANDS);
  gl.uniform1i(u.nBands, bands.length);
  gl.uniform4fv(u.bands, bands.flatMap(([lat, c]) => [lat, ...c.map((x) => x / 255)]));
  // the map as a texture of this canvas, at the resolution of the view:
  // about two texels a pixel at the center, the four rays smoothing it
  // (no mipmaps: they would draw the seam, where the longitude jumps, as a
  // line, on the disk when a pole is turned to the Earth); made once
  gl.uniform1i(u.mapped, m.map ? 1 : 0);
  if (m.map) {
    const img = m.map.e.img;
    let tw = img.width;
    while (tw > 64 && tw / 2 >= 2 * Math.PI * s * 2) tw /= 2;
    const key = `${m.planet}:${tw}`;
    let tex = r.textures.get(key);
    if (!tex) {
      let source = img;
      if (tw < img.width) {
        source = document.createElement("canvas");
        source.width = tw; source.height = Math.max(1, Math.round(tw * img.height / img.width));
        const g = source.getContext("2d");
        g.imageSmoothingQuality = "high";
        g.drawImage(img, 0, 0, source.width, source.height);
      }
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      r.textures.set(key, tex);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.surface, 0);
    gl.uniform1i(u.zones, m.map.zones ? 1 : 0);
    gl.uniform2fv(u.lon0, m.map.lon0);
    gl.uniform2fv(u.u0, m.map.u0);
  }
  // the Moon: its heights (once), and its earthshine
  const lunar = m.planet === "moon" && Boolean(m.map), hm = lunar && m.map.e.heights;
  gl.uniform1i(u.lunar, lunar ? 1 : 0);
  gl.uniform1i(u.relief, hm ? 1 : 0);
  gl.uniform1f(u.earthshine, sky.earthshine ?? 0.03);
  if (hm) {
    gl.activeTexture(gl.TEXTURE1);
    let tex = r.textures.get("moon:heights");
    if (!tex) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, hm);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      r.textures.set("moon:heights", tex);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.heights, 1);
    gl.activeTexture(gl.TEXTURE0);
  }
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
  return `<image style="mix-blend-mode:${skyBlend(sky.planet)}" href="${canvas.toDataURL()}" x="${L.toFixed(1)}" y="${T.toFixed(1)}" width="${(w / k).toFixed(1)}" height="${(h / k).toFixed(1)}"/>`;
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
function overlaySVG(sky, W, H, cx, cy, s, full = false, bar = true, top = 0, traced = false) {
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
    } else if (!traced || p.m.r * s < 2) svg += `<circle class="sky-moon${hidden ? " off" : ""}" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"/>`;
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
    const was = gpu;
    canvas.style.mixBlendMode = skyBlend(sky.planet);
    gpu = drawPlanet(canvas, sky, W, H, v.cx, v.cy, v.s, quick && !gpu ? 1 : k());
    // the moons are traced too: their circles go
    if (gpu !== was) overlay();
    drawn = { ...v };
    canvas.style.transform = "";
  };
  // the canvas of the view drawn moved and scaled to the view v
  const follow = () => {
    const m = v.s / drawn.s;
    const tx = W / 2 + (drawn.cx - v.cx) * v.s - (W / 2) * m, ty = H / 2 - (drawn.cy - v.cy) * v.s - (H / 2) * m;
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${m})`;
  };
  // the planet's map, drawn when it arrives
  const awaitMap = () => planetMap(sky.planet)?.ready.then((e) => { if (e && v && canvas.isConnected) sharp(); });
  awaitMap();
  const overlay = () => { svg.innerHTML = overlaySVG(sky, W, H, v.cx, v.cy, v.s, true, bar, top, gpu); onScale?.(sky.radius / v.s); };
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
      if (next.planet !== sky.planet) { sky = next; awaitMap(); }
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

export { skySVG, overlaySVG, drawPlanet, tracePlanet, fitView, moonsView, covered, planetMap };
