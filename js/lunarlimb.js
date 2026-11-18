// Visual lunar limb, in celestial west/north coordinates and mean Moon radii.
// Heights are physical (never the relief shader's exaggeration). The maximum
// spans both sides of the tangent plane: a far-side ridge can set the outline.
export const LUNAR_RADIUS_KM = 1737.4;
const TAU = 2 * Math.PI;
export function limbRadius(profile, angle) {
  const n = profile.length, x = ((angle / TAU % 1 + 1) % 1) * n;
  const i = Math.floor(x), f = x - i;
  return profile[i % n] * (1 - f) + profile[(i + 1) % n] * f;
}
export function elevationAt(field, u, v) {
  const { width: w, height: h, data } = field;
  const x = ((u % 1 + 1) % 1) * w - 0.5, y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const x0 = (ix + w) % w, x1 = (x0 + 1) % w, y1 = Math.min(h - 1, iy + 1);
  const a = data[iy * w + x0] * (1 - fx) + data[iy * w + x1] * fx;
  const b = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return -10 + (a * (1 - fy) + b * fy) * 0.0005;
}
export function buildLunarLimb(sky, field, { samples = 2 ** Math.ceil(Math.log2(field.width)), step = TAU / field.width } = {}) {
  const p = sky.pole.map((v) => v / Math.hypot(...sky.pole));
  const h = Math.hypot(p[0], p[1]);
  const e1 = h < 1e-6 ? [1, 0, 0] : [-p[1] / h, p[0] / h, 0];
  const e2 = [p[1] * e1[2] - p[2] * e1[1], p[2] * e1[0] - p[0] * e1[2], p[0] * e1[1] - p[1] * e1[0]];
  const lon0 = sky.facing.lon * Math.PI / 180, vx = e1[2], vy = e2[2];
  // This bound follows the actual data, including synthetic validation maps.
  let highest = -Infinity;
  for (const v of field.data) highest = Math.max(highest, -10 + v * 0.0005);
  const outer = 1 + highest / LUNAR_RADIUS_KM;
  // A finite observer sees the spherical tangent slightly toward the near
  // side. Normalize angular offsets by the same asin(R / distance) used by
  // Sky's mean disk. Without radius, retain the orthographic limit.
  const angular = (sky.radius || 0) * Math.PI / 180, parallax = Math.sin(angular);
  const projected = parallax > 0
    ? (r, c, s) => Math.atan2(r * c * parallax, 1 - r * s * parallax) / angular
    : (r, c) => r * c;
  const depths = [], count = Math.ceil(0.18 / step);
  for (let j = -count; j <= count; j++) {
    const d = angular + j * 0.18 / count, c = Math.cos(d), s = Math.sin(d);
    depths.push([c, s, projected(outer, c, s)]);
  }
  // The highest possible terrain gives a safe bound at each depth, even
  // with perspective. Test the largest bounds first to prune the rest.
  depths.sort((a, b) => b[2] - a[2]);
  const result = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const a = TAU * i / samples, cx = Math.cos(a), cy = Math.sin(a);
    let best = 0;
    for (const [c, s, bound] of depths) {
      if (bound < best) break;
      const x = cx * c, y = cy * c;
      const qx = e1[0] * x + e1[1] * y + vx * s;
      const qy = e2[0] * x + e2[1] * y + vy * s;
      const qz = p[0] * x + p[1] * y + p[2] * s;
      const u = 0.5 + (lon0 + Math.atan2(vx * qy - vy * qx, vx * qx + vy * qy)) / TAU;
      const v = 0.5 - Math.atan2(qz, Math.hypot(qx, qy)) / Math.PI;
      best = Math.max(best, projected(1 + elevationAt(field, u, v) / LUNAR_RADIUS_KM, c, s));
    }
    result[i] = best;
  }
  return result;
}
// Append a closed outline to a Canvas/Path2D path. North is up before the
// screen rotation; retain the same angular samples used by the GPU.
export function appendLunarLimb(path, profile, x, y, radius, north = 0) {
  const c = Math.cos(north), s = Math.sin(north);
  for (let i = 0; i < profile.length; i++) {
    const a = TAU * i / profile.length, dx = radius * profile[i] * Math.cos(a), dy = -radius * profile[i] * Math.sin(a);
    path[i ? 'lineTo' : 'moveTo'](x + c * dx - s * dy, y + s * dx + c * dy);
  }
  path.closePath();
}
