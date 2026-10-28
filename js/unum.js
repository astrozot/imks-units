// Numbers with (optional) linear error propagation, in the spirit of the
// Python `uncertainties` package used by imks' umath engine.
//
// A UNum holds a nominal value `n` and a map `c` of error components:
// c[id] = (df/dx_id) * sigma_id, where id labels an independent source of
// uncertainty.  The standard deviation is sqrt(sum c^2); correlations are
// handled automatically because identical sources share the same id.

let nextId = 1;

// ---------------------------------------------------------------------
// Monte Carlo mode: every uncertain value also carries N samples. A source
// of uncertainty (id) is a standard normal drawn with Latin hypercube
// sampling from a seed derived from the id, so the same source always gets
// the same samples and correlations follow automatically.

const MC = { on: false, N: 4096, seed: 20260424 };

function newSourceId() {
  return nextId++;
}

// The next source id, and a way to rewind it: an expression evaluated
// many times (by solve, integrate, diff) then reuses the same sources.
function sourceMark() {
  return nextId;
}

function sourceReset(id) {
  nextId = id;
}

// small deterministic generator
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// inverse standard normal CDF (Acklam, relative error < 1.2e-9)
function normInv(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - 0.02425) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Latin hypercube strata u_i in (0, 1), shuffled, for a seed
function lhsUniform(N, seed) {
  const r = rng(seed);
  const perm = new Int32Array(N);
  for (let i = 0; i < N; i++) perm[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const u = new Float64Array(N);
  for (let i = 0; i < N; i++) u[i] = (perm[i] + r()) / N;
  return u;
}

const zCache = new Map();
function zSamples(id) {
  let z = zCache.get(id);
  if (z) return z;
  const u = lhsUniform(MC.N, (MC.seed ^ Math.imul(id, 2654435761)) >>> 0);
  z = new Float64Array(MC.N);
  for (let i = 0; i < MC.N; i++) z[i] = normInv(u[i]);
  if (zCache.size > 400) zCache.delete(zCache.keys().next().value);
  zCache.set(id, z);
  return z;
}

function mcConfigure(on, N) {
  MC.on = Boolean(on);
  MC.N = Math.max(100, Math.min(200000, Math.round(N) || 4096));
  zCache.clear();
}

// median and the 15.87 % and 84.13 % quantiles of the samples
function mcStats(u) {
  const s = u.samples();
  if (!s) return null;
  const v = Float64Array.from(s).sort();
  const q = (p) => {
    const x = p * (v.length - 1), i = Math.floor(x), f = x - i;
    return i + 1 < v.length ? v[i] * (1 - f) + v[i + 1] * f : v[i];
  };
  let sum = 0;
  for (const x of v) sum += x;
  const mean = sum / v.length;
  let ss = 0;
  for (const x of v) ss += (x - mean) * (x - mean);
  return { med: q(0.5), lo: q(0.158655), hi: q(0.841345), mean, sd: Math.sqrt(ss / (v.length - 1)), n: v.length };
}

class UNum {
  constructor(n, c = null, s = null) {
    this.n = n;
    this.c = c && c.size ? c : null;
    this.s = s;        // Monte Carlo samples (Float64Array) or null
  }

  // samples of this value (Monte Carlo mode), built from the linear
  // components when needed; null for exact values
  samples() {
    if (this.s) return this.s;
    if (!MC.on || !this.c) return null;
    const s = new Float64Array(MC.N).fill(this.n);
    for (const [k, v] of this.c) {
      const z = zSamples(k);
      for (let i = 0; i < s.length; i++) s[i] += v * z[i];
    }
    this.s = s;
    return s;
  }

  // a value built from the linear parts r, with samples f(a_i, b_i)
  static withSamples(r, a, b, f) {
    if (!MC.on) return r;
    const sa = a.samples(), sb = b ? b.samples() : null;
    if (!sa && !sb) return r;
    const N = (sa || sb).length;
    const s = new Float64Array(N);
    if (b) for (let i = 0; i < N; i++) s[i] = f(sa ? sa[i] : a.n, sb ? sb[i] : b.n);
    else for (let i = 0; i < N; i++) s[i] = f(sa[i]);
    r.s = s;
    return r;
  }

  // a new value with given linear components (correlated sources)
  static fromComponents(n, c) {
    return new UNum(n, c);
  }

  static of(x) {
    return x instanceof UNum ? x : new UNum(Number(x));
  }

  // A new independent quantity with nominal value n and standard deviation s
  static uncertain(n, s) {
    if (!s) return new UNum(n);
    const c = new Map();
    c.set(nextId++, Math.abs(s));
    return new UNum(n, c);
  }

  get std() {
    if (MC.on && (this.s || this.c)) {
      const s = this.samples();
      let m = 0;
      for (const x of s) m += x;
      m /= s.length;
      let v = 0;
      for (const x of s) v += (x - m) * (x - m);
      return Math.sqrt(v / (s.length - 1));
    }
    if (!this.c) return 0;
    let s = 0;
    for (const v of this.c.values()) s += v * v;
    return Math.sqrt(s);
  }

  get exact() {
    return this.c === null && this.s === null;
  }

  // Apply a function with derivative dfdx: result keeps first-order errors
  map(f, dfdx) {
    const n = f(this.n);
    if (!this.c && !this.s) return new UNum(n);
    let c = null;
    if (this.c) {
      const d = dfdx(this.n);
      c = new Map();
      for (const [k, v] of this.c) c.set(k, v * d);
    }
    return UNum.withSamples(new UNum(n, c), this, null, f);
  }

  static combine(a, b, n, da, db) {
    if (!a.c && !b.c) return new UNum(n);
    const c = new Map();
    if (a.c) for (const [k, v] of a.c) c.set(k, v * da);
    if (b.c) for (const [k, v] of b.c) c.set(k, (c.get(k) || 0) + v * db);
    return new UNum(n, c);
  }

  add(y) {
    y = UNum.of(y);
    return UNum.withSamples(UNum.combine(this, y, this.n + y.n, 1, 1), this, y, (a, b) => a + b);
  }

  sub(y) {
    y = UNum.of(y);
    return UNum.withSamples(UNum.combine(this, y, this.n - y.n, 1, -1), this, y, (a, b) => a - b);
  }

  mul(y) {
    y = UNum.of(y);
    return UNum.withSamples(UNum.combine(this, y, this.n * y.n, y.n, this.n), this, y, (a, b) => a * b);
  }

  div(y) {
    y = UNum.of(y);
    return UNum.withSamples(UNum.combine(this, y, this.n / y.n, 1 / y.n, -this.n / (y.n * y.n)), this, y, (a, b) => a / b);
  }

  pow(y) {
    y = UNum.of(y);
    const n = Math.pow(this.n, y.n);
    let r;
    if (!y.c) {
      r = !this.c ? new UNum(n) : UNum.combine(this, y, n, y.n === 0 ? 0 : y.n * Math.pow(this.n, y.n - 1), 0);
    } else {
      r = UNum.combine(this, y, n,
        this.n === 0 ? 0 : y.n * Math.pow(this.n, y.n - 1),
        this.n > 0 ? n * Math.log(this.n) : 0);
    }
    return UNum.withSamples(r, this, y, Math.pow);
  }

  neg() {
    return this.map((x) => -x, () => -1);
  }

  abs() {
    return this.map(Math.abs, (x) => (x < 0 ? -1 : 1));
  }

  scale(k) {
    return this.map((x) => x * k, () => k);
  }

  // Strip uncertainties
  nominal() {
    return new UNum(this.n);
  }
}

// Mathematical functions acting on UNum, with their derivatives
const ufuncs = {
  sqrt: (x) => x.map(Math.sqrt, (v) => 0.5 / Math.sqrt(v)),
  cbrt: (x) => x.map(Math.cbrt, (v) => 1 / (3 * Math.cbrt(v) ** 2)),
  exp: (x) => x.map(Math.exp, Math.exp),
  log: (x) => x.map(Math.log, (v) => 1 / v),
  log10: (x) => x.map(Math.log10, (v) => 1 / (v * Math.LN10)),
  log2: (x) => x.map(Math.log2, (v) => 1 / (v * Math.LN2)),
  sin: (x) => x.map(Math.sin, Math.cos),
  cos: (x) => x.map(Math.cos, (v) => -Math.sin(v)),
  tan: (x) => x.map(Math.tan, (v) => 1 / Math.cos(v) ** 2),
  asin: (x) => x.map(Math.asin, (v) => 1 / Math.sqrt(1 - v * v)),
  acos: (x) => x.map(Math.acos, (v) => -1 / Math.sqrt(1 - v * v)),
  atan: (x) => x.map(Math.atan, (v) => 1 / (1 + v * v)),
  sinh: (x) => x.map(Math.sinh, Math.cosh),
  cosh: (x) => x.map(Math.cosh, Math.sinh),
  tanh: (x) => x.map(Math.tanh, (v) => 1 / Math.cosh(v) ** 2),
  asinh: (x) => x.map(Math.asinh, (v) => 1 / Math.sqrt(v * v + 1)),
  acosh: (x) => x.map(Math.acosh, (v) => 1 / Math.sqrt(v * v - 1)),
  atanh: (x) => x.map(Math.atanh, (v) => 1 / (1 - v * v)),
  floor: (x) => UNum.withSamples(new UNum(Math.floor(x.n)), x, null, Math.floor),
  ceil: (x) => UNum.withSamples(new UNum(Math.ceil(x.n)), x, null, Math.ceil),
  round: (x) => UNum.withSamples(new UNum(Math.round(x.n)), x, null, Math.round),
  trunc: (x) => UNum.withSamples(new UNum(Math.trunc(x.n)), x, null, Math.trunc),
  gamma: (x) => x.map(gamma, (v) => gamma(v) * digamma(v)),
  factorial: (x) => x.map((v) => gamma(v + 1), (v) => gamma(v + 1) * digamma(v + 1)),
};

function atan2(y, x) {
  const r2 = x.n * x.n + y.n * y.n;
  return UNum.withSamples(UNum.combine(y, x, Math.atan2(y.n, x.n), x.n / r2, -y.n / r2), y, x, Math.atan2);
}

// Lanczos approximation of the gamma function
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

function gamma(z) {
  if (Number.isInteger(z) && z > 0 && z < 171) {
    let r = 1;
    for (let i = 2; i < z; i++) r *= i;
    return r;
  }
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = LG[0];
  for (let i = 1; i < 9; i++) x += LG[i] / (z + i);
  const t = z + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function digamma(x) {
  let r = 0;
  while (x < 6) { r -= 1 / x; x += 1; }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))));
}

// ---------------------------------------------------------------------
// Formatting

// Format a plain number with a given number of significant digits,
// imitating Python's repr (fixed notation for moderate magnitudes).
function formatNumber(x, digits = 15) {
  if (!isFinite(x)) return isNaN(x) ? "nan" : (x > 0 ? "inf" : "-inf");
  if (x === 0) return "0";
  const ax = Math.abs(x);
  let s;
  if (ax >= 1e-4 && ax < 1e16) {
    s = x.toPrecision(digits);
    if (s.includes("e")) s = Number(s).toString();
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  } else {
    s = x.toExponential(digits - 1);
    let [m, e] = s.split("e");
    if (m.includes(".")) m = m.replace(/0+$/, "").replace(/\.$/, "");
    s = m + "e" + (e[0] === "-" ? "-" : "+") + e.replace(/^[-+]/, "").padStart(2, "0");
  }
  return s;
}

// Format a value with uncertainty using two significant digits for the
// error: "45.0±3.0" for large relative errors, or the compact notation
// "0.51099895069(16)" and "6.67430(15)e-11" for small ones.
function formatUNum(u, digits = 15, showErrors = true) {
  if (MC.on && showErrors && (u.s || u.c)) {
    // Monte Carlo: median and half the central 68 % interval
    const st = mcStats(u);
    if (st && st.hi > st.lo) u = { n: st.med, std: (st.hi - st.lo) / 2 };
    else if (st) u = { n: st.med, std: 0 };
  }
  const s = u.std;
  if (!s || !showErrors || !isFinite(s) || !isFinite(u.n)) return formatNumber(u.n, digits);
  const es = Math.floor(Math.log10(s)) - 1;  // exponent of last significant digit
  const ax = Math.abs(u.n);
  const ev = ax > 0 ? Math.floor(Math.log10(ax)) : es + 1;
  const top = Math.max(ev, es + 1);
  const compact = ax > 0 && s / ax < 1e-4;
  const digitsOf = (x, dec) => String(Math.round(x * Math.pow(10, dec)));
  if (top >= -4 && top < 16) {
    const dec = Math.max(0, -es);
    const n = u.n.toFixed(Math.min(dec, 20));
    if (compact) return `${n}(${digitsOf(s, dec)})`;
    return n + "±" + s.toFixed(Math.min(dec, 20));
  }
  const scale = Math.pow(10, top);
  const dec = Math.max(0, top - es);
  const ex = "e" + (top < 0 ? "-" : "+") + String(Math.abs(top)).padStart(2, "0");
  if (compact) return `${(u.n / scale).toFixed(dec)}(${digitsOf(s / scale, dec)})${ex}`;
  return "(" + (u.n / scale).toFixed(dec) + "±" + (s / scale).toFixed(dec) + ")" + ex;
}

// Monte Carlo values with clearly different upper and lower errors:
// { val, plus, minus, exp } strings with two significant digits on the
// smaller error, or null when the errors are about symmetric (within 10 %)
function formatAsym(u, threshold = 0.1) {
  if (!MC.on || !(u.s || u.c)) return null;
  const st = mcStats(u);
  if (!st) return null;
  const ep = st.hi - st.med, em = st.med - st.lo;
  if (!(ep > 0 && em > 0) || Math.abs(ep - em) <= threshold * Math.max(ep, em)) return null;
  const small = Math.min(ep, em);
  const ax = Math.abs(st.med);
  const ev = ax > 0 ? Math.floor(Math.log10(ax)) : Math.floor(Math.log10(small));
  const scaleExp = ev >= 6 || ev <= -5 ? ev : 0;
  const k = Math.pow(10, scaleExp);
  const es = Math.floor(Math.log10(small / k)) - 1;
  const dec = Math.max(0, -es);
  const f = (x) => (es > 0 ? String(Math.round(x / k / 10 ** es) * 10 ** es) : (x / k).toFixed(Math.min(dec, 20)));
  return { val: f(st.med), plus: f(ep), minus: f(em), exp: scaleExp };
}

export { MC, newSourceId, sourceMark, sourceReset, rng, normInv, lhsUniform, mcConfigure, mcStats, UNum, ufuncs, atan2, gamma, formatNumber, formatUNum, formatAsym };
