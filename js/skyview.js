// A planet and its moons as in a telescope, north up and east to the left,
// from the view of moons() in sky.js: lengths in planet radii, on axes to
// the west (x, to the right), to the north (y) and toward the Earth (z).
// The planet is traced pixel by pixel: its flattened globe with its bands,
// lit by the Sun, Saturn's rings with the shadows of the globe on them and
// theirs on the globe, and the shadows of the moons; the moons, their
// names and a scale go on top, in SVG.

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
};

// the color at a latitude, the bands blended over 1.5°
function bandColor(planet, lat) {
  const bands = BANDS[planet];
  let i = 0;
  while (i + 1 < bands.length && lat >= bands[i + 1][0]) i++;
  const c = bands[i][1], next = bands[i + 1];
  if (!next || next[0] - lat > 1.5) return c;
  const w = (1.5 - (next[0] - lat)) / 3;
  return c.map((v, k) => v + (next[1][k] - v) * w);
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

// The planet as an image: the part of the sky from (x0, y0) (the top left
// corner, planet radii) over w × h pixels of scale s (pixels per radius),
// as a data URL, or null when the planet is not there
function planetImage(sky, x0, y0, w, h, s) {
  const { planet, pole, sun, moons } = sky, f = FLAT[planet] || 0;
  if (w < 1 || h < 1 || w * h > 4e6) return null;
  const [e1, e2, p] = axes(pole);
  const toP = (v) => [dot(v, e1), dot(v, e2), dot(v, p)];
  // the Earth's direction and the Sun's, on the planet's axes
  const view = toP([0, 0, 1]), light = toP(sun), sat = planet === "saturn";
  const shadows = moons.filter((m) => m.r > 0).map((m) => ({ c: toP([m.x, m.y, m.z]), r: Math.max(m.r, 0.7 / s) }));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d"), img = ctx.createImageData(w, h), px = img.data;
  const litFace = Math.sign(light[2]) === Math.sign(view[2]);
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
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
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

// The planet and its moons in an SVG of W × H, centered on (cx, cy) (planet
// radii), s pixels per radius; dpr pixels of the image per pixel; the
// moons' names in full, or their first two letters
function skySVG(sky, W, H, cx, cy, s, { dpr = 1, full = false } = {}) {
  const sat = sky.planet === "saturn", reach = sat ? 2.3 : 1.02;
  const f1 = (x) => x.toFixed(1);
  const X = (x) => W / 2 + (x - cx) * s, Y = (y) => H / 2 - (y - cy) * s;
  let svg = `<rect class="sky-bg" width="${W}" height="${H}" rx="10"/>`;
  // the image of the part of the planet in view
  const L = Math.max(0, X(-reach)), R = Math.min(W, X(reach)), T = Math.max(0, Y(reach)), B = Math.min(H, Y(-reach));
  if (R > L && B > T) {
    const k = dpr, w = Math.ceil((R - L) * k), h = Math.ceil((B - T) * k);
    const url = planetImage(sky, cx + (L - W / 2) / s, cy - (T - H / 2) / s, w, h, s * k);
    if (url) svg += `<image href="${url}" x="${f1(L)}" y="${f1(T)}" width="${f1(w / k)}" height="${f1(h / k)}"/>`;
  }
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
  const bar = scaleBar(sky.radius / s, W), bx = W / 2 - bar.px / 2, by = H - 10;
  svg += `<path class="sky-scale" d="M${f1(bx)} ${by - 4}v4h${f1(bar.px)}v-4"/><text class="sky-label" x="${f1(W / 2)}" y="${by - 7}" text-anchor="middle">${bar.text}</text>`;
  svg += `<path class="sky-scale" d="M${W - 14} 16v18h-18"/><text class="sky-label" x="${W - 14}" y="12" text-anchor="middle">N</text><text class="sky-label" x="${W - 38}" y="37" text-anchor="middle">E</text>`;
  return svg;
}

// The view that shows the planet and the moons within five times their
// median distance (those farther out at the edge), for W × H pixels
function fitView(sky, W, H) {
  const far = sky.moons.map((m) => Math.hypot(m.x, m.y)).sort((a, b) => a - b);
  const median = far[Math.floor((far.length - 1) / 2)];
  const reach = Math.max(sky.planet === "saturn" ? 2.4 : 1.3, ...far.filter((d) => d <= 5 * median));
  return { cx: 0, cy: 0, s: Math.min((W / 2 - 18) / reach, (H / 2 - 16) / 1.2) };
}

export { skySVG, fitView };
