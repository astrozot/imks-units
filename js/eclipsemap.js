// The map of a solar eclipse: the Earth as a globe (orthographic), the
// night at the greatest phase, the coastlines, the path of totality (or of
// the annular phase) with its central line, the limits of the partial
// eclipse, the point of greatest eclipse and a place; from the track of
// eclipseTrack() in astro.js.

import { COAST } from "./coast.js";

const RAD = Math.PI / 180;
let coastLines = null;
// the coastlines as [latitude, longitude] lines (coast.js stores tenths
// of degrees, after the first point as differences)
function coast() {
  if (!coastLines) {
    coastLines = COAST.map((l) => {
      const pts = [];
      let x = 0, y = 0;
      for (let i = 0; i < l.length; i += 2) {
        x += l[i];
        y += l[i + 1];
        pts.push([y / 10, x / 10]);
      }
      return pts;
    });
  }
  return coastLines;
}

const unit = ([lat, lon]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];

// The projection on a view: centered on (lat0, lon0), s pixels per Earth
// radius, W × H; a point is [x, y, visible]
function projector({ lat0, lon0, s }, W, H) {
  const c0 = Math.cos(lat0 * RAD), s0 = Math.sin(lat0 * RAD);
  return ([lat, lon]) => {
    const c = Math.cos(lat * RAD), dl = (lon - lon0) * RAD;
    const x = c * Math.sin(dl), y = c0 * Math.sin(lat * RAD) - s0 * c * Math.cos(dl), z = s0 * Math.sin(lat * RAD) + c0 * c * Math.cos(dl);
    return [W / 2 + s * x, H / 2 - s * y, z >= 0];
  };
}

// an SVG path of lines, broken where they go behind the Earth; smooth:
// curves through the points (Catmull–Rom, as cubic Béziers)
function linesPath(lines, P, smooth = false) {
  let d = "";
  const f = (x) => x.toFixed(1);
  const run = (pts) => {
    if (pts.length < 2) return;
    d += `M${f(pts[0][0])} ${f(pts[0][1])}`;
    if (!smooth || pts.length < 3) { for (const p of pts.slice(1)) d += `L${f(p[0])} ${f(p[1])}`; return; }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], e = pts[Math.min(pts.length - 1, i + 2)];
      d += `C${f(b[0] + (c[0] - a[0]) / 6)} ${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)} ${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])} ${f(c[1])}`;
    }
  };
  for (const line of lines) {
    let pts = [];
    for (const p of line) {
      const q = P(p);
      if (q[2]) pts.push(q);
      else { run(pts); pts = []; }
    }
    run(pts);
  }
  return d;
}

// The night side: the visible part of the hemisphere away from the Sun,
// bounded by the terminator and the limb
function nightPath(sun, view, W, H, P) {
  const s = unit(sun), cx = W / 2, cy = H / 2, R = view.s;
  const center = unit([view.lat0, view.lon0]), dc = center[0] * s[0] + center[1] * s[1] + center[2] * s[2];
  // two axes across the Sun's direction: the terminator
  const a0 = Math.abs(s[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let a = [s[1] * a0[2] - s[2] * a0[1], s[2] * a0[0] - s[0] * a0[2], s[0] * a0[1] - s[1] * a0[0]];
  const an = Math.hypot(...a);
  a = a.map((x) => x / an);
  const b = [s[1] * a[2] - s[2] * a[1], s[2] * a[0] - s[0] * a[2], s[0] * a[1] - s[1] * a[0]];
  const pts = [];
  for (let i = 0; i < 360; i += 2) {
    const q = [0, 1, 2].map((k) => Math.cos(i * RAD) * a[k] + Math.sin(i * RAD) * b[k]);
    pts.push(P([Math.asin(q[2]) / RAD, Math.atan2(q[1], q[0]) / RAD]));
  }
  const vis = pts.map((p) => p[2]);
  if (!vis.some(Boolean)) return dc < 0 ? `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0z` : "";
  // the visible arc of the terminator, from where it leaves the limb
  const start = vis.findIndex((v, i) => v && !vis[(i + vis.length - 1) % vis.length]);
  const arc = [];
  for (let i = 0; i < pts.length && start >= 0; i++) {
    const p = pts[(start + i) % pts.length];
    if (!p[2]) break;
    arc.push(p);
  }
  if (arc.length < 2) return "";
  const A = arc[0], B = arc[arc.length - 1];
  // back along the limb from B to A, on the side of the night
  const angA = Math.atan2(A[1] - cy, A[0] - cx), angB = Math.atan2(B[1] - cy, B[0] - cx);
  const anti = P([-sun[0], sun[1] + 180]);
  const dir = (from, to, sign) => {
    let d = to - from;
    while (sign > 0 && d < 0) d += 2 * Math.PI;
    while (sign < 0 && d > 0) d -= 2 * Math.PI;
    return d;
  };
  // the limb goes the way of the antisolar direction
  const toward = Math.atan2(anti[1] - cy, anti[0] - cx);
  const d1 = dir(angB, angA, 1), mid1 = angB + d1 / 2;
  const sign = Math.cos(mid1 - toward) > Math.cos(mid1 + Math.PI - toward) ? 1 : -1;
  const d = dir(angB, angA, sign);
  let path = `M${arc.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}`;
  for (let i = 1; i <= 48; i++) {
    const t = angB + (d * i) / 48;
    path += `L${(cx + R * Math.cos(t)).toFixed(1)} ${(cy + R * Math.sin(t)).toFixed(1)}`;
  }
  return path + "z";
}

// The map in an SVG of W × H for the view (centered on lat0, lon0, s pixels
// per Earth radius); place: [latitude, longitude] or null
function mapSVG(m, W, H, view, place = null) {
  const P = projector(view, W, H), R = view.s, cx = W / 2, cy = H / 2;
  const f1 = (x) => x.toFixed(1);
  let svg = `<rect class="map-bg" width="${W}" height="${H}" rx="10"/><circle class="map-sea" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R)}"/>`;
  const grid = [];
  for (let lat = -60; lat <= 60; lat += 30) grid.push(Array.from({ length: 73 }, (_, i) => [lat, -180 + 5 * i]));
  for (let lon = -180; lon < 180; lon += 30) grid.push(Array.from({ length: 37 }, (_, i) => [-90 + 5 * i, lon]));
  svg += `<path class="map-grid" d="${linesPath(grid, P)}"/>`;
  svg += `<path class="map-night" d="${nightPath(m.sun, view, W, H, P)}"/>`;
  svg += `<path class="map-coast" d="${linesPath(coast(), P)}"/>`;
  // where some of the eclipse is seen (older results: its limits north and south)
  svg += `<path class="map-partial" d="${linesPath(m.outline || [...m.penN, ...m.penS], P, true)}"/>`;
  // the band of the central phase: quadrilaterals between the pairs of its
  // limits and, at its ends, the footprints of the umbra, in one layer (so
  // that they do not darken where they overlap); the corners behind the
  // Earth brought to its edge; then its limits
  const edgeP = (p) => {
    const [x, y, v] = P(p);
    if (v) return [x, y];
    const r = Math.hypot(x - cx, y - cy) || 1;
    return [cx + ((x - cx) * R) / r, cy + ((y - cy) * R) / r];
  };
  const poly = (pts) => (pts.some((p) => P(p)[2]) ? `M${pts.map((p) => edgeP(p).map(f1).join(" ")).join("L")}z` : "");
  const pairs = m.band || [];
  let quads = "";
  for (let i = 1; i < pairs.length; i++) {
    const a = pairs[i - 1], b = pairs[i];
    if (a && b) quads += poly([[a[0], a[1]], [b[0], b[1]], [b[2], b[3]], [a[2], a[3]]]);
  }
  const feet = (m.ends || []).map((pts) => `<path d="${poly(pts)}"/>`).join("");
  if (quads || feet) svg += `<g class="map-path">${quads ? `<path d="${quads}"/>` : ""}${feet}</g>`;
  svg += `<path class="map-path-edge" d="${linesPath([...m.umbraN, ...m.umbraS], P, true)}"/>`;
  svg += `<path class="map-center" d="${linesPath(m.center, P, true)}"/>`;
  // the hours (UTC) when the partial eclipse begins and ends, labeled at
  // the visible middle of each line; the maximum at sunrise or sunset
  const hh = (h) => `${String(((Math.round(h) % 24) + 24) % 24).padStart(2, "0")}h`;
  const label = (line, text, cls) => {
    const vis = line.map(P).filter((p) => p[2] && p[0] > 12 && p[0] < W - 12 && p[1] > 10 && p[1] < H - 6);
    if (!vis.length) return "";
    const [x, y] = vis[Math.floor(vis.length / 2)];
    return `<text class="map-label ${cls}" x="${f1(x)}" y="${f1(y)}" text-anchor="middle">${text}</text>`;
  };
  for (const [kind, cls] of [["begin", "map-begin"], ["end", "map-end"]]) {
    for (const [h, lines] of m[kind] || []) {
      svg += `<path class="${cls}" d="${linesPath(lines, P, true)}"/>`;
      for (const line of lines) if (line.length > 8) svg += label(line, hh(h), cls);
    }
  }
  // where it begins, is greatest and ends at sunrise or sunset
  if (m.rise) {
    svg += `<path class="map-horizon faint" d="${linesPath([...m.rise.begin, ...m.rise.end], P, true)}"/>`;
    svg += `<path class="map-horizon" d="${linesPath(m.rise.max, P, true)}"/>`;
  } else if (m.horizon) svg += `<path class="map-horizon" d="${linesPath(m.horizon, P)}"/>`;
  // the times on the central line, every half hour
  for (const seg of m.center) {
    for (let i = 1; i < seg.length; i++) {
      const [a, b] = [seg[i - 1], seg[i]];
      if (a.length < 3 || Math.floor(a[2] * 2) === Math.floor(b[2] * 2)) continue;
      const [x, y, v] = P(b);
      if (!v) continue;
      const h = Math.floor(b[2] * 2) / 2, text = `${String(((Math.floor(h) % 24) + 24) % 24).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
      svg += `<circle class="map-tick" cx="${f1(x)}" cy="${f1(y)}" r="1.8"/><text class="map-label map-time" x="${f1(x + 5)}" y="${f1(y - 4)}">${text}</text>`;
    }
  }
  const mark = (p, cls) => {
    const [x, y, v] = P(p);
    return v ? `<circle class="${cls}" cx="${f1(x)}" cy="${f1(y)}" r="4"/>` : "";
  };
  if (m.greatest) svg += mark(m.greatest, "map-greatest");
  if (place) svg += mark(place, "map-place");
  return svg;
}

// the view of the whole Earth, centered on the greatest eclipse
function mapView(m, W, H) {
  const [lat0, lon0] = m.greatest || [0, 0];
  return { lat0, lon0, s: Math.min(W, H) / 2 - 8 };
}

export { mapSVG, mapView };
