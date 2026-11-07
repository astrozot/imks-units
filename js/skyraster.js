// Low-resolution backgrounds of the sky charts, filled pixel by pixel and
// scaled up smoothly: the Milky Way (the isophotes of skydata.js, drawn once
// into a J2000 texture) and, for the realistic view, the colour of the sky
// with the Sun's altitude, twilight glow, glare, moonlight and the ground.
import { MILKY_WAY } from './skydata.js';

const R = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A distant landscape: rolling hills with groves of rounded tree crowns,
// 0.3° to about 3° high, as altitudes (degrees) every quarter degree.
const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
export const HILL = (() => {
  const n = 1440, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i / 4 * R;
    out[i] = Math.max(0.3, 0.95 + 0.7 * Math.sin(2 * a + 1.3) + 0.38 * Math.sin(5 * a + 0.4) + 0.2 * Math.sin(11 * a + 2.1) + 0.08 * Math.sin(29 * a + 0.7));
  }
  // Trees every 0.2°–0.5°, only where the groves are.
  for (let az = 0, k = 0; az < 360; k++) {
    const width = 0.14 + 0.2 * hash(k + 0.3), height = 0.3 + 0.6 * hash(k + 0.7), grove = Math.sin(3 * az * R + 0.8) + 0.4 * Math.sin(7 * az * R);
    if (grove > 0.35) {
      for (let j = Math.floor((az - width) * 4); j <= Math.ceil((az + width) * 4); j++) {
        const u = (j / 4 - az) / width, i = ((j % n) + n) % n;
        if (Math.abs(u) < 1) out[i] = Math.max(out[i], out[i] * 0.95 + height * (1 - u * u) ** 0.6);
      }
    }
    az += width * (0.9 + 0.8 * hash(k + 0.9));
  }
  return out;
})();
export const hillAt = (az) => { const x = ((az % 360) + 360) % 360 * 4, i = Math.floor(x), u = x - i; return HILL[i % 1440] * (1 - u) + HILL[(i + 1) % 1440] * u; };

// The Milky Way in J2000 RA/Dec, 0.5° per texel, with a little mottling.
// Rings that go once around the sky (the edges of the band) are closed
// through the south pole; even-odd filling then leaves the band itself.
const TW = 720, TH = 360;
let texture = null;
function milkyWayTexture() {
  if (texture) return texture;
  const k = 4, w = 360 * k, h = 180 * k, big = document.createElement('canvas');
  big.width = w; big.height = h;
  const g = big.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const alphas = [0.2, 0.2, 0.22, 0.24, 0.26];
  MILKY_WAY.forEach((rings, level) => {
    const path = new Path2D();
    for (const ring of rings) {
      const pts = [];
      let ra = ((ring[0] % 360) + 360) % 360;
      for (let i = 0; i < ring.length; i += 2) {
        if (i) ra += ((ring[i] - ring[i - 2] + 540) % 360) - 180;
        pts.push([ra, ring[i + 1]]);
      }
      const wind = Math.round((pts.at(-1)[0] + (((ring[0] - ring.at(-2) + 540) % 360) - 180) - pts[0][0]) / 360);
      for (const offset of [-360, 0, 360]) {
        pts.forEach(([a, d], i) => path[i ? 'lineTo' : 'moveTo']((a + offset) * k, (90 - d) * k));
        if (wind) { path.lineTo((pts.at(-1)[0] + offset) * k, h); path.lineTo((pts[0][0] + offset) * k, h); }
        path.closePath();
      }
    }
    g.fillStyle = `rgba(255,255,255,${alphas[level]})`;
    g.fill(path, 'evenodd');
  });
  const small = document.createElement('canvas');
  small.width = TW; small.height = TH;
  const s = small.getContext('2d');
  s.imageSmoothingEnabled = true; s.imageSmoothingQuality = 'high';
  s.drawImage(big, 0, 0, TW, TH);
  const sharp = s.getImageData(0, 0, TW, TH).data;
  // A blurred copy (down to 2° and back) softens the isophotes' edges.
  const tiny = document.createElement('canvas');
  tiny.width = TW / 4; tiny.height = TH / 4;
  const ti = tiny.getContext('2d');
  ti.imageSmoothingEnabled = true; ti.imageSmoothingQuality = 'high';
  ti.drawImage(big, 0, 0, tiny.width, tiny.height);
  s.clearRect(0, 0, TW, TH); s.drawImage(tiny, 0, 0, TW, TH);
  const soft = s.getImageData(0, 0, TW, TH).data, out = new Float32Array(TW * TH);
  // Value noise on a 2° lattice, interpolated: star clouds and dark lanes.
  const lattice = (x, y) => hash(x * 157 + y * 311 + 0.5);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const fx = x / 4, fy = y / 4, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const n = (lattice(ix % 180, iy) * (1 - u) + lattice((ix + 1) % 180, iy) * u) * (1 - v) + (lattice(ix % 180, iy + 1) * (1 - u) + lattice((ix + 1) % 180, iy + 1) * u) * v;
    out[y * TW + x] = (0.35 * sharp[(y * TW + x) * 4] + 0.65 * soft[(y * TW + x) * 4]) / 255 * (0.65 + 0.7 * n);
  }
  texture = out;
  return out;
}
// Brightness (about 0…1) at a J2000 unit vector, bilinear.
function milkyWayAt(tex, x, y, z) {
  let ra = Math.atan2(y, x) / R; if (ra < 0) ra += 360;
  const u = ra * 2 - 0.5, v = Math.max(0, Math.min(TH - 1.001, (90 - Math.asin(z > 1 ? 1 : z < -1 ? -1 : z) / R) * 2 - 0.5));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, i0 = (i + TW) % TW, i1 = (i + 1) % TW;
  return (tex[j * TW + i0] * (1 - fu) + tex[j * TW + i1] * fu) * (1 - fv) + (tex[(j + 1) * TW + i0] * (1 - fu) + tex[(j + 1) * TW + i1] * fu) * fv;
}

// The sky's look for the Sun's altitude (degrees) and the Moon.
export function skyLight(sunAlt, moon = null, atmosphere = true) {
  const day = smooth(-4, 10, sunAlt), twilight = smooth(-18, -3, sunAlt);
  const moonLight = moon && moon.alt > 0 ? moon.illum * smooth(0, 10, moon.alt) : 0;
  // Faintest star: 6.4 in a dark sky, about 2.7 at nautical twilight, 1 at
  // the end of civil twilight; brighter planets only by day; less moonlit.
  const L = smooth(-18, -6, sunAlt) * 0.3 + smooth(-6, 5, sunAlt) * 0.7;
  const limit = atmosphere ? 6.4 - 9.5 * Math.sqrt(L) - 1.4 * moonLight * (1 - day) : 6.6;
  return { day: atmosphere ? day : 0, twilight: atmosphere ? twilight : 0, moonLight: atmosphere ? moonLight : 0, limit };
}

const canvases = new WeakMap();
// One background: W×H CSS pixels, in about `samples` samples (fewer while
// the view moves).
//  kind 'chart': the Milky Way only, as transparent shading;
//  kind 'sky': opaque sky and, separately, the ground in front of objects.
// camera { rotation, stereographic } gives the horizontal unit vector
// [east, north, up] of each sample (as unprojectSky, inlined: this loop is
// most of a frame's work).
export function skyRaster(key, { W, H, radius, camera, samples = 45000, toJ2000, kind, milkyWay = true, ground = false, atmosphere = true, sun = null, moon = null, groundColor = null, hill = hillAt }) {
  const f = Math.max(2, Math.sqrt(W * H / samples)), w = Math.ceil(W / f), h = Math.ceil(H / f);
  let c = canvases.get(key);
  if (!c) { c = { sky: document.createElement('canvas'), ground: document.createElement('canvas') }; canvases.set(key, c); }
  for (const cv of [c.sky, c.ground]) if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = c.sky.getContext('2d'), image = g.createImageData(w, h), px = image.data;
  const groundImage = kind === 'sky' && ground ? c.ground.getContext('2d').createImageData(w, h) : null, gp = groundImage?.data;
  const tex = milkyWay ? milkyWayTexture() : null, A = toJ2000;
  const light = kind === 'sky' ? skyLight(sun.alt, moon, atmosphere) : null;
  const S = sun?.vector, M = moon?.vector;
  // Colours (linear-ish, 0…1) of the zenith and the horizon.
  let zenith, horizon, glow, sunUp, mwLight, groundRGB;
  if (light) {
    const { day, twilight } = light;
    zenith = mix(mix([0.006, 0.01, 0.026], [0.05, 0.085, 0.2], twilight), [0.13, 0.32, 0.72], day);
    horizon = mix(mix([0.032, 0.042, 0.075], [0.24, 0.25, 0.36], twilight), [0.6, 0.73, 0.88], day);
    glow = atmosphere ? Math.exp(-(((sun.alt + 1) / 6) ** 2)) : 0;
    sunUp = atmosphere ? smooth(-2, 1, sun.alt) : 0;
    mwLight = (1 - smooth(-18, -11, sun.alt) * (atmosphere ? 1 : 0)) * (1 - 0.75 * light.moonLight);
    groundRGB = groundColor || mix(mix([0.008, 0.01, 0.012], [0.05, 0.055, 0.06], twilight), [0.16, 0.18, 0.12], day);
  }
  const tone = (x) => { const y = x / (1 + 0.22 * x) * 1.22 * 255; return y > 255 ? 255 : y; };
  const rot = camera.rotation, stereo = camera.stereographic, v = [0, 0, 0];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = ((i + 0.5) * f - W / 2) / radius, sy = ((j + 0.5) * f - H / 2) / radius, o = (j * w + i) * 4;
    const rr = Math.sqrt(sx * sx + sy * sy), angle = stereo ? 2 * Math.atan(rr) : (rr < 1.999999 ? rr : 1.999999) * Math.PI / 2;
    const k = rr > 1e-12 ? -Math.sin(angle) / rr : 0, ux = sx * k, uy = sy * k, uz = Math.cos(angle);
    v[0] = rot[0] * ux + rot[3] * uy + rot[6] * uz; v[1] = rot[1] * ux + rot[4] * uy + rot[7] * uz; v[2] = rot[2] * ux + rot[5] * uy + rot[8] * uz;
    const mw = tex ? milkyWayAt(tex, A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]) : 0;
    if (!light) {
      px[o] = 150; px[o + 1] = 176; px[o + 2] = 232; px[o + 3] = Math.min(255, mw * 120);
      continue;
    }
    const up = v[2], alt = Math.asin(up > 1 ? 1 : up < -1 ? -1 : up);
    if (gp) {
      // Coverage of the sample by the ground: soft edges a sample wide.
      const az = Math.atan2(v[0], v[1]) / R, step = 2 * f / radius / (1 + sx * sx + sy * sy), cover = (hill(az) * R - alt) / step + 0.5;
      if (cover > 0) {
        const depth = 0.55 + 0.45 * Math.exp(Math.min(0, alt) / 0.12);
        gp[o] = tone(groundRGB[0] * depth); gp[o + 1] = tone(groundRGB[1] * depth); gp[o + 2] = tone(groundRGB[2] * depth); gp[o + 3] = cover >= 1 ? 255 : cover * 255;
      }
    }
    let r, gr, b;
    if (atmosphere) {
      const hgt = alt > 0 ? alt : 0, grad = Math.exp(-hgt / 0.3);
      r = zenith[0] + (horizon[0] - zenith[0]) * grad; gr = zenith[1] + (horizon[1] - zenith[1]) * grad; b = zenith[2] + (horizon[2] - zenith[2]) * grad;
      const d = 1 - (S[0] * v[0] + S[1] * v[1] + S[2] * v[2]);
      if (glow > 0.002) {
        const warm = glow * Math.exp(-d / 0.4) * Math.exp(-hgt / 0.16), band = glow * 0.22 * Math.exp(-hgt / 0.06) * (1.5 - d / 2);
        r += 1.05 * warm + 0.85 * band; gr += 0.45 * warm + 0.38 * band; b += 0.14 * warm + 0.3 * band;
      }
      if (sunUp > 0) { const e = sunUp * (0.9 * Math.exp(-d / 0.0015) + 0.35 * Math.exp(-d / 0.02) + 0.1 * Math.exp(-d / 0.15)); r += e; gr += 0.94 * e; b += 0.84 * e; }
      if (light.moonLight > 0) {
        const md = 1 - (M[0] * v[0] + M[1] * v[1] + M[2] * v[2]), e = light.moonLight * (1 - light.day) * (0.5 * Math.exp(-md / 0.0012) + 0.07 * Math.exp(-md / 0.03) + 0.025);
        r += 0.5 * e; gr += 0.56 * e; b += 0.68 * e;
      }
      if (alt < 0) { const k = 0.35 + 0.65 * Math.exp(alt / 0.08); r *= k; gr *= k; b *= k; }
    } else r = gr = b = 0;
    if (mw) {
      const m = mw * mwLight * (atmosphere ? clamp01(alt / 0.2) : 1) * 0.3;
      r += 0.82 * m; gr += 0.86 * m; b += m;
    }
    px[o] = tone(r); px[o + 1] = tone(gr); px[o + 2] = tone(b); px[o + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  if (groundImage) c.ground.getContext('2d').putImageData(groundImage, 0, 0);
  return { sky: c.sky, ground: groundImage ? c.ground : null, width: w * f, height: h * f };
}
