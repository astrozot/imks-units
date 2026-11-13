// Geometry used only by planetary moon event searches. Lengths are km;
// vectors share one orthonormal frame. The planet is an oblate spheroid.
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Signed Euclidean distance to an ellipse (major semiaxis 1). Unlike a
// radial distance, this gives the correct contacts of a finite round moon
// against an oblate planet, including near the projected poles.
function ellipseDistance(x, y, b) {
  x = Math.abs(x); y = Math.abs(y);
  if (b === 1) return Math.hypot(x, y) - 1;
  if (x === 0) return y - b;
  const b2 = b * b;
  if (y < 1e-14) {
    if (x >= 1 - b2) return x - 1;
    const qx = x / (1 - b2), qy = b * Math.sqrt(1 - qx * qx);
    return -Math.hypot(qx - x, qy);
  }
  const outside = x * x + y * y / b2 >= 1;
  let lo = outside ? 0 : -b2 + b * y, hi = outside ? Math.hypot(x, y) : 0;
  for (let i = 0; i < 36; i++) {
    const t = (lo + hi) / 2;
    const q = (x / (1 + t)) ** 2 + (b * y / (b2 + t)) ** 2;
    if (q > 1) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  return (outside ? 1 : -1) * Math.hypot(x / (1 + t) - x, b2 * y / (b2 + t) - y);
}

// Clearance from the projected limb of an oblate planet along direction w.
function limbClearance(v, w, pole, radius, flattening) {
  const z = dot(pole, w), h = Math.sqrt(Math.max(0, 1 - z * z));
  const along = dot(v, w), q = v.map((x, k) => x - along * w[k]);
  const y = h > 1e-10 ? dot(q, pole) / h : 0;
  const x = Math.sqrt(Math.max(0, dot(q, q) - y * y));
  const b = Math.sqrt((1 - flattening) ** 2 * (1 - z * z) + z * z);
  return radius * ellipseDistance(x / radius, y / radius, b);
}

// A shadow on the far side of the globe is not a visible shadow transit.
// If the Sun-facing intersection is hidden from Earth, first/last visible
// contact occurs on Earth's projected limb, not the solar terminator.
function visibleShadow(v, w, observer, light, pole, radius, flattening, moonRadius, angle, global) {
  const stretch = (v, k) => {
    const z = dot(v, pole) * (k - 1);
    return v.map((x, i) => x + z * pole[i]);
  };
  const k = 1 / (1 - flattening), p = stretch(v, k), d = stretch(w, k);
  const a = dot(d, d), b = dot(p, d), disc = b * b - a * (dot(p, p) - radius * radius);
  let q;
  if (disc >= 0) q = stretch(p.map((x, i) => x + (-b - Math.sqrt(disc)) / a * d[i]), 1 / k);
  else {
    const foot = p.map((x, i) => x - b / a * d[i]), len = Math.hypot(...foot);
    q = stretch(foot.map((x) => radius * x / len), 1 / k);
  }
  const normal = stretch(q, k * k), visible = dot(normal, observer) < 0;
  // The center is visible and well inside both limbs: no limb search.
  if (visible && dot(observer, light) > 0.999999 && global < -2 * (moonRadius + angle * Math.hypot(...v))) return null;
  const o = stretch(observer, k), olen = Math.hypot(...o), u = o.map((x) => x / olen);
  let e = cross(u, Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]);
  const elen = Math.hypot(...e); e = e.map((x) => x / elen);
  const f = cross(u, e);
  const at = (theta) => {
    const point = stretch(e.map((x, i) => radius * (x * Math.cos(theta) + f[i] * Math.sin(theta))), 1 / k);
    const n = stretch(point, k * k);
    if (dot(n, light) > 1e-8 * radius) return [Infinity, Infinity];
    const ray = point.map((x, i) => x - v[i]), along = dot(ray, w);
    if (along <= 0) return [Infinity, Infinity];
    const distance = Math.hypot(...cross(ray, w)), spread = angle * along;
    return [distance - moonRadius - spread, distance - Math.max(0, moonRadius - spread)];
  };
  const step = 2 * Math.PI / 32, values = Array.from({ length: 32 }, (_, i) => at(i * step));
  const minima = [Infinity, Infinity];
  for (let key = 0; key < 2; key++) for (let i = 0; i < 32; i++) {
    if (!Number.isFinite(values[i][key]) || values[i][key] > values[(i + 31) % 32][key] || values[i][key] > values[(i + 1) % 32][key]) continue;
    let lo = (i - 1) * step, hi = (i + 1) * step;
    for (let j = 0; j < 28; j++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = hi - (hi - lo) * 0.382;
      if (at(m1)[key] < at(m2)[key]) hi = m2; else lo = m1;
    }
    minima[key] = Math.min(minima[key], at((lo + hi) / 2)[key]);
  }
  return { visible, penumbra: minima[0], umbra: minima[1] };
}

// Finite moon and finite Sun. Penumbral contacts encompass any loss of
// direct sunlight; C1/C4 mark umbral contact, C2/C3 complete immersion.
// Shadows use the Sun's actual distance, not a cylindrical approximation.
function moonContactGeometry({ v, eclipseVector = v, shadowVector = v, observer, light, pole, radius, flattening, moonRadius, sunDistance, sunRadius = 695700 }) {
  const behind = dot(v, observer), along = dot(eclipseVector, light), shadowAlong = dot(shadowVector, light);
  const disk = limbClearance(v, observer, pole, radius, flattening);
  const spread = Math.abs(along) * sunRadius / sunDistance;
  // Section of the planet's shadow cone at the moon: the planet's finite
  // distance from the Sun also enlarges its projected silhouette slightly.
  const eclipse = limbClearance(eclipseVector, light, pole, radius * (1 + along / sunDistance), flattening);
  // Axis of the moon's shadow goes from the Sun through the moon.
  const ray = shadowVector.map((x, k) => x + sunDistance * light[k]);
  const len = Math.hypot(...ray), w = ray.map((x) => x / len);
  const shadow = limbClearance(shadowVector, w, pole, radius, flattening);
  const shadowSpread = Math.max(0, -dot(shadowVector, w)) * sunRadius / len;
  const umbraRadius = moonRadius - shadowSpread;
  const visibility = shadowAlong < 0 && shadow < 2 * (moonRadius + shadowSpread) ? visibleShadow(shadowVector, w, observer, light, pole, radius, flattening, moonRadius, sunRadius / len, shadow) : null;
  const shadowOuter = visibility && !visibility.visible ? visibility.penumbra : shadow - moonRadius - shadowSpread;
  const shadowUmbra = visibility && !visibility.visible ? visibility.umbra : shadow - umbraRadius;
  const shadowFull = visibility ? (visibility.visible ? Math.max(shadow + umbraRadius, -visibility.umbra) : radius) : shadow + umbraRadius;
  const off = (q, condition) => condition ? q : Math.abs(q) + radius;
  return {
    transit: off(disk - moonRadius, behind < 0),
    transitFull: off(disk + moonRadius, behind < 0),
    transitCenter: off(disk, behind < 0),
    occulted: off(disk - moonRadius, behind > 0),
    occultedFull: off(disk + moonRadius, behind > 0),
    occultedCenter: off(disk, behind > 0),
    eclipsed: off(eclipse - spread - moonRadius, along > 0),
    eclipsedUmbra: off(eclipse + spread - moonRadius, along > 0),
    eclipsedFull: off(eclipse + spread + moonRadius, along > 0),
    eclipsedCenter: off(eclipse + spread, along > 0),
    shadow: off(shadowOuter, shadowAlong < 0),
    shadowUmbra: off(shadowUmbra, shadowAlong < 0 && umbraRadius > 0),
    shadowFull: off(shadowFull, shadowAlong < 0 && umbraRadius > 0),
    shadowCenter: off(shadow, shadowAlong < 0 && (!visibility || visibility.visible)),
  };
}

// Negative intervals of a smooth clearance. Local minima are refined even
// when all coarse samples are positive: short grazing events need not
// happen to contain a sample. One minimum per step is assumed, so callers
// choose a step well below the shortest orbital period.
function contactIntervals(value, from, to, step = 300) {
  if (!(to > from && step > 0 && Number.isFinite(step))) return [];
  const samples = [];
  for (let t = from; t < to; t += step) samples.push([t, value(t)]);
  samples.push([to, value(to)]);
  const points = [...samples];
  const brackets = [[samples[0][0], samples[1][0]], [samples.at(-2)[0], samples.at(-1)[0]]];
  for (let i = 1; i + 1 < samples.length; i++) {
    if (samples[i][1] > samples[i - 1][1] || samples[i][1] > samples[i + 1][1]) continue;
    brackets.push([samples[i - 1][0], samples[i + 1][0]]);
  }
  for (let [a, b] of brackets) {
    for (let k = 0; k < 32 && b - a > 0.1; k++) {
      const m1 = a + (b - a) * 0.382, m2 = b - (b - a) * 0.382;
      if (value(m1) < value(m2)) b = m2; else a = m1;
    }
    const t = (a + b) / 2;
    points.push([t, value(t)]);
  }
  points.sort((a, b) => a[0] - b[0]);
  const out = [];
  let begin = points[0][1] < 0 ? from : null;
  for (let i = 1; i < points.length; i++) {
    const [t0, q0] = points[i - 1], [t1, q1] = points[i];
    if ((q0 < 0) === (q1 < 0)) continue;
    let a = t0, b = t1;
    while (b - a > 0.1) {
      const m = (a + b) / 2;
      if ((value(m) < 0) === (q0 < 0)) a = m; else b = m;
    }
    const t = (a + b) / 2;
    if (q1 < 0) begin = t;
    else { out.push([begin, t]); begin = null; }
  }
  if (begin !== null) out.push([begin, to]);
  return out;
}

export { ellipseDistance, limbClearance, moonContactGeometry, contactIntervals };
