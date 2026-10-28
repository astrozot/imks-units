// The imks expression language: tokenizer, parser, evaluator and the
// %commands used in definition files.

import { UNum, ufuncs, atan2, formatUNum, newSourceId, MC, sourceMark, sourceReset } from "./unum.js";
import { Env, Q, UnitError, dimEq, dimScale, dimIsZero, symbolSource } from "./units.js";

class CalcError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "CalcError";
  }
}

// Lazily evaluated dictionary of NIST constants
class ConstDict {
  constructor(env, data = {}) {
    this.env = env;
    this.data = data;
    this.cache = new Map();
    this.corr = null;      // CODATA correlations as factor loadings
    this.factorIds = null;
  }

  // a value whose error is spread over shared CODATA factors, so that
  // correlated constants (m_e, m_p, ...) are correlated here too
  correlated(name, n, s) {
    const row = this.corr && this.corr.rows[name];
    if (!row || !s) return UNum.uncertain(n, s);
    if (!this.factorIds) this.factorIds = Array.from({ length: this.corr.factors }, () => newSourceId());
    const c = new Map();
    for (const [k, l] of row) c.set(this.factorIds[k], Math.abs(s) * l);
    return UNum.fromComponents(n, c);
  }

  has(name) {
    return Object.prototype.hasOwnProperty.call(this.data, name);
  }

  keys() {
    return Object.keys(this.data);
  }

  get(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    if (!this.has(name)) throw new CalcError(`Unknown constant "${name}"`);
    const [v, e, u] = this.data[name];
    const n = Number(String(v).replace(/\s|\.\.\./g, ""));
    const s = e === "(exact)" ? 0 : Number(String(e).replace(/\s|\.\.\./g, ""));
    // bare c in NIST units means the speed of light
    const unit = String(u).replace(/(^|[^\p{L}'])c(?![\p{L}'])/gu, "$1'c'");
    let q;
    try {
      const uq = this.env.unit(unit);
      q = this.env.mul(new Q(this.correlated(name, n, s)), uq);
    } catch (err) {
      q = new Q(NaN);
    }
    q.doc = `${name}\n\nNIST CODATA: ${e === "(exact)" ? `${v} [${u}] (exact)` : `(${v} ± ${e}) [${u}]`}`;
    this.cache.set(name, q);
    return q;
  }
}

// ---------------------------------------------------------------------
// Input normalization and transformers

const superscripts = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5",
  "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };

function normalize(line) {
  let s = line
    .replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")
    .replace(/[′’]/g, "'").replace(/[″”“]/g, '"')
    .replace(/[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => superscripts[c]).join(""));
  // dms: 18d 24' 32"  or  18° 24.5'
  s = s.replace(/(\d+)[°d]\s*(?:(\d\d?)'\s*(\d\d?(?:\.\d*)?)"|(\d\d?(?:\.\d*)?)')/g,
    (_, d, m, sec, M) => `(${d}[deg]+${m || M}[arcmin]+${sec || 0}[arcsec])`);
  // dhms: 1d 12h 30m 25.2s, 1d 12h 30m, 1d 12h
  s = s.replace(/\b(\d+)d\s+(\d+)h(?:\s+(\d\d?)m\s+(\d\d?(?:\.\d*)?)s\b|\s+(\d\d?(?:\.\d*)?)m\b)?/g,
    (_, d, h, m, sec, M) => `(${d}[day]+${h}[hour]+${m || M || 0}[min]+${sec || 0}[s])`);
  // hms: 12h 34m 56s  or  12h 34.5m
  s = s.replace(/\b(\d+)h\s+(?:(\d\d?)m\s+(\d\d?(?:\.\d*)?)s\b|(\d\d?(?:\.\d*)?)m\b)/g,
    (_, h, m, sec, M) => `(${h}[hour]+${m || M}[min]+${sec || 0}[s])`);
  return s;
}

// Split a trailing # "doc string" or # comment
function splitComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      // a quote right after a digit is a dms mark, not a string
      if (c === "'" && /\d\s*$/.test(line.slice(0, i))) continue;
      if (c === '"' && /\d'?\s*\d*(\.\d*)?$/.test(line.slice(0, i)) && /'/.test(line.slice(0, i))) continue;
      q = c;
    } else if (c === "#") {
      const comment = line.slice(i + 1).trim();
      const m = /^(["'])([\s\S]*)\1$/.exec(comment);
      return { code: line.slice(0, i), doc: m ? unescape(m[2]) : "" };
    }
  }
  return { code: line, doc: "" };
}

function unescape(s) {
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\(["'\\])/g, "$1");
}

// Split @-specifications into a list of units, e.g. "[km|hour]", "[m], [s]"
function splitSpec(spec) {
  let s = spec.trim();
  const parts = [];
  let depth = 0, q = null, cur = "";
  for (const c of s) {
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0 && (c === "|" || c === ",")) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim().replace(/^\[/, "").replace(/\]$/, "").trim()).filter((p) => p);
}

// ---------------------------------------------------------------------
// Tokenizer

const identRe = new RegExp("^(?:[\\p{L}_][\\p{L}\\p{N}_]*|" + symbolSource + ")", "u");
const numRe = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/;

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    if (/\s/.test(c)) { i++; continue; }
    let m;
    if ((m = numRe.exec(rest))) {
      let text = m[0];
      let n = Number(text);
      let std = 0;
      let j = i + text.length;
      // short uncertainty notation: 3.0(1) or 1.234(5)e5
      let mm = /^\((\d+)\)([eE][-+]?\d+)?/.exec(src.slice(j));
      if (mm) {
        const mant = m[1];
        const dec = mant.includes(".") ? mant.length - mant.indexOf(".") - 1 : 0;
        const e = mm[2] ? Number(mm[2].slice(1)) : (m[2] ? Number(m[2].slice(1)) : 0);
        std = Number(mm[1]) * Math.pow(10, e - dec);
        if (mm[2]) n = Number(mant) * Math.pow(10, e);
        j += mm[0].length;
      } else if ((mm = /^\s*(?:±|\+\/-)\s*(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(j)))) {
        std = Number(mm[1] + (mm[2] || ""));
        j += mm[0].length;
      }
      toks.push({ t: "num", x: UNum.uncertain(n, std), pos: i });
      i = j;
      continue;
    }
    if (c === "@") {
      // the conversion spec extends to the end (or the closing parenthesis)
      let j = i + 1, depth = 0, q = null;
      for (; j < src.length; j++) {
        const d = src[j];
        if (q) { if (d === q) q = null; continue; }
        if (d === "'" || d === '"') q = d;
        else if (d === "(" || d === "[") depth++;
        else if (d === ")" || d === "]") {
          if (depth === 0) break;
          depth--;
        } else if (d === "," && depth === 0 &&
                   toks.filter((t) => t.t === "(").length > toks.filter((t) => t.t === ")").length) break;
      }
      toks.push({ t: "@", spec: src.slice(i + 1, j), pos: i });
      i = j;
      continue;
    }
    if (c === "[") {
      let j = i + 1, depth = 1, q = null;
      for (; j < src.length; j++) {
        const d = src[j];
        if (q) { if (d === q) q = null; continue; }
        if (d === "'" || d === '"') q = d;
        else if (d === "[") depth++;
        else if (d === "]" && --depth === 0) break;
      }
      if (j >= src.length) throw new CalcError("Missing ]");
      toks.push({ t: "bracket", raw: src.slice(i + 1, j), pos: i });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new CalcError("Unterminated string");
      toks.push({ t: "str", v: src.slice(i + 1, j), pos: i });
      i = j + 1;
      continue;
    }
    if ((m = identRe.exec(rest))) {
      toks.push({ t: "id", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (rest.startsWith("**")) { toks.push({ t: "^", pos: i }); i += 2; continue; }
    if (rest.startsWith("+/-") || c === "±") {
      toks.push({ t: "±", pos: i });
      i += c === "±" ? 1 : 3;
      continue;
    }
    if ("+-*/^(),=~;".includes(c)) {
      toks.push({ t: c, pos: i });
      i++;
      continue;
    }
    if (c === "√" || c === "∛") {
      toks.push({ t: "root", v: c === "√" ? "sqrt" : "cbrt", pos: i });
      i++;
      continue;
    }
    throw new CalcError(`Unexpected character '${c}'`);
  }
  return toks;
}

// ---------------------------------------------------------------------
// Parser

function parse(src, env) {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (k = 0) => toks[pos + k];
  const next = () => toks[pos++];
  const at = (t) => peek() && peek().t === t;
  const expect = (t) => {
    const k = next();
    if (!k || k.t !== t) throw new CalcError(k ? `Unexpected '${k.v || k.t}'` : `Missing '${t}'`);
    return k;
  };

  // a bare prefix (k, c, G...) is never taken as a unit outside brackets
  const isUnitTok = (k, k1) => {
    if (!k || k.t !== "id" || (k1 && k1.t === "(")) return false;
    const iu = env.isunit(k.v);
    return iu && iu[1] !== "";
  };

  // Bare units after a number: 9.8 m/s^2, 12 km/h, 2 m^2
  const bareUnits = () => {
    if (!isUnitTok(peek(), peek(1))) return null;
    let spec = "";
    for (;;) {
      spec += next().v;
      if (at("^")) {
        const sign = peek(1) && peek(1).t === "-" ? 1 : 0;
        const nk = peek(1 + sign);
        if (nk && nk.t === "num" && nk.x.exact) {
          pos += 2 + sign;
          spec += "^" + (sign ? "-" : "") + nk.x.n;
        }
      }
      if (isUnitTok(peek(), peek(1))) { spec += " "; continue; }
      if (at("/") && isUnitTok(peek(1), peek(2))) { next(); spec += "/"; continue; }
      break;
    }
    return spec;
  };

  const primary = (negate = false) => {
    const k = next();
    if (!k) throw new CalcError("Incomplete expression");
    switch (k.t) {
      case "num": {
        const node = { t: "num", x: negate ? k.x.neg() : k.x };
        const spec = bareUnits();
        return spec ? { t: "unit", target: node, raw: spec } : node;
      }
      case "id":
        return { t: "name", v: k.v };
      case "str":
        return { t: "str", v: k.v };
      case "(": {
        const items = [expr()];
        while (at(",")) { next(); items.push(expr()); }
        expect(")");
        return items.length === 1 ? items[0] : { t: "tuple", items };
      }
      case "bracket":
        return { t: "unit", target: { t: "num", x: new UNum(1) }, raw: k.raw };
      default:
        throw new CalcError(`Unexpected '${k.v || k.t}'`);
    }
  };

  const postfix = (negate) => {
    let node = primary(negate);
    for (;;) {
      if (at("(") && node.t === "name") {
        next();
        const args = [];
        // an argument can be an equation, as in solve(x^2 = 2, x)
        const arg = () => {
          const a = expr();
          if (!at("=")) return a;
          next();
          return { t: "eq", a, b: expr() };
        };
        if (!at(")")) {
          args.push(arg());
          while (at(",")) { next(); args.push(arg()); }
        }
        expect(")");
        node = { t: "call", f: node.v, args };
      } else if (at("bracket")) {
        node = { t: "unit", target: node, raw: next().raw };
      } else break;
    }
    return node;
  };

  const power = (negate = false) => {
    const base = postfix(negate);
    if (at("^")) {
      next();
      return { t: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  };

  const unary = () => {
    // a negative number literal binds before its unit: -40 °F
    if (at("-") && peek(1) && peek(1).t === "num" && !(peek(2) && peek(2).t === "^")) {
      next();
      return power(true);
    }
    if (at("-") || at("+") || at("~")) {
      const op = next().t;
      return { t: "un", op, a: unary() };
    }
    if (at("root")) {
      // √x, ∛x: prefix roots
      const f = next().v;
      return { t: "call", f, args: [unary()] };
    }
    return power();
  };

  const product = () => {
    let a = unary();
    for (;;) {
      if (at("*") || at("/")) {
        const op = next().t;
        a = { t: "bin", op, a, b: unary() };
      } else if (at("id") || at("(") || at("bracket") || at("root")) {
        // implicit multiplication: 2 pi, (a+b)(c+d)
        a = { t: "bin", op: "*", a, b: unary() };
      } else break;
    }
    return a;
  };

  const pm = () => {
    let a = product();
    while (at("±")) {
      next();
      a = { t: "bin", op: "±", a, b: product() };
    }
    return a;
  };

  const sum = () => {
    let a = pm();
    while (at("+") || at("-")) {
      const op = next().t;
      a = { t: "bin", op, a, b: pm() };
    }
    return a;
  };

  const expr = () => {
    let a = sum();
    while (at("@")) a = { t: "convert", a, spec: next().spec };
    return a;
  };

  // statements: name = expr, f(x, y) = expr, expr
  const statement = () => {
    if (at("id") && peek(1) && peek(1).t === "=") {
      const name = next().v;
      next();
      return { t: "assign", name, value: expr() };
    }
    if (at("id") && peek(1) && peek(1).t === "(") {
      // look for f(a, b) = ...
      let j = 2;
      const params = [];
      let ok = true;
      for (;;) {
        const k = peek(j);
        if (!k) { ok = false; break; }
        if (k.t === ")") { j++; break; }
        if (k.t === "id") { params.push(k.v); j++; }
        else if (k.t === ",") j++;
        else { ok = false; break; }
      }
      if (ok && peek(j) && peek(j).t === "=") {
        const name = next().v;
        pos += j;
        return { t: "def", name, params, body: expr() };
      }
    }
    return expr();
  };

  if (!toks.length) return null;
  const node = statement();
  if (pos < toks.length) {
    const k = peek();
    throw new CalcError(`Unexpected '${k.v || k.t}'`);
  }
  return node;
}

// ---------------------------------------------------------------------
// The interpreter

const pureFuncs = ["exp", "log", "log10", "log2", "sin", "cos", "tan", "asin", "acos",
  "atan", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "gamma", "factorial"];

const functionDocs = {
  sqrt: "Square root", cbrt: "Cubic root", exp: "Exponential", log: "Natural logarithm",
  ln: "Natural logarithm", log10: "Decimal logarithm", log2: "Base-2 logarithm",
  sin: "Sine", cos: "Cosine", tan: "Tangent", asin: "Arc sine", acos: "Arc cosine",
  atan: "Arc tangent", atan2: "Arc tangent of y/x: atan2(y, x)", sinh: "Hyperbolic sine",
  cosh: "Hyperbolic cosine", tanh: "Hyperbolic tangent", asinh: "Inverse hyperbolic sine",
  acosh: "Inverse hyperbolic cosine", atanh: "Inverse hyperbolic tangent",
  abs: "Absolute value", floor: "Round down (in base units)", ceil: "Round up (in base units)",
  round: "Round (in base units)", trunc: "Truncate (in base units)",
  min: "Minimum of the arguments", max: "Maximum of the arguments",
  hypot: "Square root of the sum of squares", gamma: "Gamma function",
  factorial: "Factorial", fraction: "fraction(a, b) = a/b",
  nominal: "Nominal value, without uncertainty", err: "Standard deviation (uncertainty)",
  solve: "Root of an equation in x: solve(f(x) = y, x, guess) or solve(f(x) = y, x, a, b)",
  integrate: "Definite integral over x: integrate(f(x), x, a, b); a or b can be ±inf",
  diff: "Derivative with respect to x at x0: diff(f(x), x, x0)",
};

Object.assign(functionDocs, {
  linspace: "List of n equally spaced values from a to b: linspace(a, b, n)",
  logspace: "List of n values from a to b in equal ratios: logspace(a, b, n)",
  sum: "Sum of a list, sum(list), or of an expression over whole numbers, sum(f(k), k, a, b)",
  mean: "Mean of a list: mean(list)",
  len: "Number of values in a list: len(list)",
  dot: "Scalar product of two vectors: dot(a, b)",
  cross: "Vector product of two 3-vectors: cross(a, b)",
  norm: "Length of a vector: norm(v)",
  angle: "Angle between two vectors, in rad: angle(a, b)",
  plot: "Plot: plot(f(x), x, a, b), plot(ys) or plot(xs, ys); a tuple of expressions or lists gives several curves",
});

// solve, integrate, diff, plot and sum see their first argument as an
// expression in the variable named by the second one, so their arguments
// are not evaluated in advance (plot and sum only in the forms
// plot(f(x), x, a, b) and sum(f(k), k, a, b))
const CALCULUS = new Set(["solve", "integrate", "diff", "plot", "sum"]);
const isCalculus = (node) => CALCULUS.has(node.f) &&
  (!["plot", "sum"].includes(node.f) || (node.args.length === 4 && node.args[1].t === "name"));

// built-in functions that take whole lists; the others apply elementwise
const LIST_FNS = new Set(["sum", "mean", "len", "min", "max", "linspace", "logspace", "plot", "hypot", "dot", "cross", "norm", "angle"]);

// f applied elementwise where args are lists (several lists must have the
// same length); nested lists are tables
function broadcast(f, args) {
  let n = -1;
  for (const a of args) {
    if (!Array.isArray(a)) continue;
    if (n >= 0 && a.length !== n) throw new CalcError(`Lists of different lengths: ${n} and ${a.length}`);
    n = a.length;
  }
  if (n < 0) return f(...args);
  return Array.from({ length: n }, (_, i) => broadcast(f, args.map((a) => (Array.isArray(a) ? a[i] : a))));
}

// what plot returns: the x values and one list of y values per curve, as
// quantities; heads are the expressions of the curves (nodes) when known
class PlotData {
  constructor(xs, series, { heads = null, xname = "" } = {}) {
    this.xs = xs;
    this.series = series;
    this.heads = heads;
    this.xname = xname;
  }
}

// a list of quantities, or of lists of them (a table)
const isQList = (v) => v.length > 0 && v.every((x) => x instanceof Q || (Array.isArray(x) && isQList(x)));

// thrown by the expression of solve, integrate or diff when it gives a list
class ListValue extends Error {
  constructor(n) {
    super("list");
    this.n = n;
  }
}

class Interpreter {
  constructor() {
    this.env = new Env();
    this.const = new ConstDict(this.env);
    this.builtins = this.makeBuiltins();
  }

  makeBuiltins() {
    const env = this.env;
    const b = {};
    for (const f of pureFuncs) {
      b[f] = (a) => new Q(ufuncs[f](env.checkPure(a, f)));
    }
    b.ln = b.log;
    b.sqrt = (a) => { a = a.relative(); return new Q(ufuncs.sqrt(a.x), dimScale(a.d, 0.5)); };
    b.cbrt = (a) => { a = a.relative(); return new Q(ufuncs.cbrt(a.x), dimScale(a.d, 1 / 3)); };
    b.abs = (a) => { a = a.relative(); return new Q(a.x.abs(), a.d); };
    for (const f of ["floor", "ceil", "trunc"]) {
      b[f] = (a) => { a = a.relative(); return new Q(ufuncs[f](a.x), a.d); };
    }
    b.round = (a, n) => {
      a = a.relative();
      const k = n ? Math.pow(10, env.checkPure(n, "round").n) : 1;
      return new Q(new UNum(Math.round(a.x.n * k) / k), a.d);
    };
    b.atan2 = (y, x) => {
      env.checkCompatible(y, x, "atan2");
      return new Q(atan2(y.relative().x, x.relative().x));
    };
    // lists: min(list), or elementwise min(list, 0)
    const values = (fn, xs) => {
      if (xs.length !== 1 || !Array.isArray(xs[0])) throw new CalcError(`${fn} expects one list`);
      if (!xs[0].length) throw new CalcError(`${fn}: the list is empty`);
      if (xs[0].some(Array.isArray)) throw new CalcError(`${fn}: expected a list of values, not a table`);
      return xs[0];
    };
    // hypot(x, y, …) or hypot(list), the length of a vector
    const hypot = (...xs) => {
      let s = env.mul(xs[0], xs[0]);
      for (const x of xs.slice(1)) s = env.add(s, env.mul(x, x));
      return b.sqrt(s);
    };
    b.hypot = (...xs) => (xs.length === 1 && Array.isArray(xs[0]) ? hypot(...values("hypot", xs)) : broadcast(hypot, xs));

    // vectors: lists of components with compatible units
    const vec = (fn, v, n = 0) => {
      if (!Array.isArray(v) || v.some(Array.isArray)) throw new CalcError(`${fn}: expected vectors, as (1, 2, 3) m`);
      if (!v.length) throw new CalcError(`${fn}: the vector is empty`);
      if (n && v.length !== n) throw new CalcError(`${fn}: expected vectors of ${n} components, got ${v.length}`);
      for (const c of v) env.checkCompatible(c, v[0], fn);
      return v;
    };
    const pair = (fn, xs, n = 0) => {
      if (xs.length !== 2) throw new CalcError(`${fn} expects two vectors`);
      const [a, c] = [vec(fn, xs[0], n), vec(fn, xs[1], n)];
      if (a.length !== c.length) throw new CalcError(`${fn}: vectors of different lengths: ${a.length} and ${c.length}`);
      return [a, c];
    };
    const dot = (a, c) => a.map((x, i) => env.mul(x, c[i])).reduce((s, t) => env.add(s, t));
    const cross = (a, c) => [[1, 2], [2, 0], [0, 1]].map(([i, j]) => env.sub(env.mul(a[i], c[j]), env.mul(a[j], c[i])));
    b.dot = (...xs) => dot(...pair("dot", xs));
    b.cross = (...xs) => cross(...pair("cross", xs, 3));
    b.norm = (...xs) => {
      if (xs.length !== 1) throw new CalcError("norm expects one vector");
      return hypot(...vec("norm", xs[0]));
    };
    // atan2(|a × c|, a · c), accurate also for nearly parallel vectors
    b.angle = (...xs) => {
      const [a, c] = pair("angle", xs);
      const d = dot(a, c);
      let s;
      if (a.length === 3) s = hypot(...cross(a, c));
      else if (a.length === 2) s = b.abs(env.sub(env.mul(a[0], c[1]), env.mul(a[1], c[0])));
      else {
        // Lagrange's identity: |a × c|² = |a|² |c|² − (a · c)²
        const s2 = env.sub(env.mul(dot(a, a), dot(c, c)), env.mul(d, d));
        s = b.sqrt(s2.x.n < 0 ? env.mul(s2, new Q(0)) : s2);
      }
      return b.atan2(s, d);
    };
    const extreme = (fn, sgn) => (...xs) => {
      const pick = (...ys) => ys.reduce((a, c) => (env.compare(c, a) * sgn > 0 ? c : a));
      if (xs.length === 1 && Array.isArray(xs[0])) return pick(...values(fn, xs));
      return broadcast(pick, xs);
    };
    b.min = extreme("min", -1);
    b.max = extreme("max", 1);
    b.sum = (...xs) => {
      if (xs.length !== 1) throw new CalcError("Usage: sum(list) or sum(f(k), k, a, b)");
      return values("sum", xs).reduce((a, c) => env.add(a, c));
    };
    b.mean = (...xs) => env.div(b.sum(...xs), new Q(xs[0].length));
    b.len = (...xs) => {
      if (xs.length !== 1 || !Array.isArray(xs[0])) throw new CalcError("len expects one list");
      return new Q(xs[0].length);
    };
    const count = (fn, n) => {
      if (Array.isArray(n)) throw new CalcError(`${fn}: the number of values must be a number`);
      const k = env.checkPure(n, `${fn} (n)`).n;
      if (!(Number.isInteger(k) && k >= 2 && k <= 10000)) throw new CalcError(`${fn}: n must be a whole number from 2 to 10000`);
      return k;
    };
    const ends = (fn, a, c) => {
      if (Array.isArray(a) || Array.isArray(c) || !(a instanceof Q) || !(c instanceof Q)) throw new CalcError(`Usage: ${functionDocs[fn].replace(/^[^:]*:\s*/, "")}`);
      env.checkCompatible(a, c, fn);
    };
    b.linspace = (a, c, n) => {
      ends("linspace", a, c);
      const k = count("linspace", n), w = env.sub(c, a);
      return Array.from({ length: k }, (_, i) => (i === k - 1 ? c : env.add(a, env.mul(w, new Q(i / (k - 1))))));
    };
    b.logspace = (a, c, n) => {
      ends("logspace", a, c);
      const k = count("logspace", n), r = env.div(c, a);
      if (!(env.checkPure(r, "logspace").n > 0)) throw new CalcError("logspace: a and b must have the same sign and not be zero");
      return Array.from({ length: k }, (_, i) => (i === k - 1 ? c : env.mul(a, env.pow(r, new Q(i / (k - 1))))));
    };
    // plot(ys) or plot(xs, ys); plot(f(x), x, a, b) is evaluated in calculus
    b.plot = (...xs) => {
      if (xs.length < 1 || xs.length > 2) throw new CalcError(`Usage: ${functionDocs.plot.replace(/^[^:]*:\s*/, "")}`);
      const ys = xs.at(-1);
      if (!Array.isArray(ys)) throw new CalcError("plot: give lists of values, or plot(f(x), x, a, b)");
      const series = ys.some(Array.isArray) ? ys.map((s) => (Array.isArray(s) ? s : [s])) : [ys];
      const n = series[0].length;
      if (series.some((s) => s.length !== n)) throw new CalcError("plot: the curves have different lengths");
      const x = xs.length === 2 ? xs[0] : Array.from({ length: n }, (_, i) => new Q(i + 1));
      if (!Array.isArray(x) || x.some(Array.isArray)) throw new CalcError("plot: the x values must be a list");
      if (x.length !== n) throw new CalcError(`plot: ${x.length} x values for ${n} y values`);
      return makePlot(env, x, series.map((s) => s.map((q) => (q instanceof Q && isFinite(q.x.n) ? q : null))), {});
    };
    b.fraction = (a, c) => env.div(a, c);
    b.nominal = (a) => new Q(a.x.nominal(), a.d, a.zero);
    b.err = (a) => new Q(new UNum(a.x.std), a.d);
    // evaluated in evalNode; listed here for help and suggestions
    for (const f of CALCULUS) b[f] = b[f] || (() => { throw new CalcError(`Usage: ${functionDocs[f].replace(/^[^:]*:\s*/, "")}`); });
    return b;
  }

  // -------------------------------------------------------------------
  // Evaluation

  lookup(name, scope) {
    if (scope && scope.has(name)) return scope.get(name);
    const env = this.env;
    if (env.vars.resolve) name = env.vars.resolve(name);
    if (env.vars.has(name)) {
      const v = env.vars.get(name);
      if (v && v.lazy) return v.lazy();
      return v;
    }
    if (name === "pi") return new Q(Math.PI);
    if (name === "tau") return new Q(2 * Math.PI);
    if (name === "inf") return new Q(Infinity);
    if (name === "nan") return new Q(NaN);
    if (name === "const") return this.const;
    if (env.isunit(name)) return env.unitValue(name);
    throw new CalcError(`Unknown name '${name}'`);
  }

  evalNode(node, scope = null) {
    const env = this.env;
    const ev = (n) => this.evalNode(n, scope);
    const asQ = (v) => {
      if (v instanceof Q) return v;
      if (typeof v === "number") return new Q(v);
      if (Array.isArray(v)) throw new CalcError("Expected a quantity, not a list");
      throw new CalcError("Expected a quantity");
    };
    // a quantity, or a list of them (possibly nested)
    const val = (v) => (Array.isArray(v) ? v.map(val) : asQ(v));
    switch (node.t) {
      case "num":
        return new Q(node.x);
      case "str":
        return node.v;
      case "name":
        return this.lookup(node.v, scope);
      case "tuple":
        return node.items.map(ev);
      case "unit": {
        const target = ev(node.target);
        if (target instanceof ConstDict) {
          const key = this.evalNode(parse(node.raw, env), scope);
          if (typeof key !== "string") throw new CalcError("Constant names are strings");
          return target.get(key);
        }
        const u = env.unit(node.raw);
        return broadcast((t) => env.mul(t, u), [val(target)]);
      }
      case "un":
        return broadcast((a) => {
          if (node.op === "-") return env.neg(a);
          if (node.op === "~") return env.tilde(a);
          return a;
        }, [val(ev(node.a))]);
      case "bin":
        return broadcast((a, b) => {
          switch (node.op) {
            case "+": return env.add(a, b);
            case "-": return env.sub(a, b);
            case "*": return env.mul(a, b);
            case "/": return env.div(a, b);
            case "^": return env.pow(a, b);
            case "±": {
              env.checkCompatible(a, b, "±");
              return new Q(a.x.add(UNum.uncertain(0, b.relative().x.n)), a.d, a.zero);
            }
          }
          throw new CalcError("Cannot evaluate expression");
        }, [val(ev(node.a)), val(ev(node.b))]);
      case "eq":
        throw new CalcError("An equation (=) can only be an argument of solve");
      case "call": {
        if (isCalculus(node) && !(scope && scope.has(node.f)) && !(env.vars.get(node.f) || {}).fn) {
          return this.calculus(node, scope);
        }
        const args = node.args.map(ev);
        let f = scope && scope.has(node.f) ? scope.get(node.f) : env.vars.get(node.f);
        // user functions see lists as they are, and apply to them elementwise
        // as far as their body does
        if (f && f.fn) return this.callUser(f.fn, args.map(val));
        f = this.builtins[node.f];
        if (!f && args.length === 1 && !(scope && scope.has(node.f))) {
          // a value followed by parentheses multiplies: pi (2 m)^2
          let v = null;
          try { v = this.lookup(node.f, scope); } catch { v = null; }
          if (v instanceof Q || Array.isArray(v)) return broadcast((a, b) => env.mul(a, b), [val(v), val(args[0])]);
        }
        if (!f) throw new CalcError(`Unknown function '${node.f}'`);
        if (!args.length) throw new CalcError(`${node.f} needs an argument`);
        if (LIST_FNS.has(node.f)) return f(...args.map(val));
        return broadcast(f, args.map(val));
      }
      case "convert": {
        const spec = splitSpec(node.spec);
        if (!spec.length) throw new CalcError("Missing unit after @");
        return broadcast((a) => env.convert(a, spec), [val(ev(node.a))]);
      }
    }
    throw new CalcError("Cannot evaluate expression");
  }

  callUser(fn, args) {
    if (args.length !== fn.params.length) {
      throw new CalcError(`Function expects ${fn.params.length} argument(s)`);
    }
    const scope = new Map(fn.params.map((p, i) => [p, args[i]]));
    if (++this.depth > 200) { this.depth = 0; throw new CalcError("Recursion too deep"); }
    try {
      return this.evalNode(fn.body, scope);
    } finally {
      this.depth--;
    }
  }

  // solve, integrate, diff: the first argument is evaluated many times,
  // with the variable named by the second one bound in a local scope
  calculus(node, scope) {
    const env = this.env;
    const name = node.f;
    const [body, v, ...rest] = node.args;
    const [least, most] = { solve: [0, 2], integrate: [2, 2], diff: [1, 2], plot: [2, 2], sum: [2, 2] }[name];
    const usage = () => new CalcError(`Usage: ${functionDocs[name].replace(/^[^:]*:\s*/, "")}`);
    if (!body || !v || v.t !== "name" || rest.length < least || rest.length > most) throw usage();
    const expr = body.t === "eq" && name === "solve" ? { t: "bin", op: "-", a: body.a, b: body.b } : body;
    const limits = rest.map((n) => {
      const q = this.evalNode(n, scope);
      if (!(q instanceof Q) && !(Array.isArray(q) && name !== "plot")) throw usage();
      return q;
    });
    // the units the limits are written in, as in solve(…, x, 1 Gpc)
    const spec = rest.map((n) => (n.t === "unit" ? n.raw : n.t === "convert" ? n.spec : null)).find(Boolean);
    const shown = (q) => {
      if (!spec) return q;
      try { return env.convert(q, splitSpec(spec)); } catch { return q; }
    };
    // every evaluation reuses the same uncertainty sources, so that
    // x (2 ± 0.1) is one uncertain factor at all points
    const local = new Map(scope || []);
    const id0 = sourceMark();
    let idMax = id0, element = null;
    const f = (x) => {
      sourceReset(id0);
      local.set(v.v, x);
      try {
        let r = this.evalNode(expr, local);
        if (Array.isArray(r) && name !== "plot" && name !== "sum") {
          // an expression giving a list is solved (integrated…) per element
          if (element === null) throw new ListValue(r.length);
          r = r[element];
        }
        const ok = (q) => q instanceof Q || (Array.isArray(q) && q.length && q.every((y) => y instanceof Q));
        if (!ok(r)) throw new CalcError(`${name}: the expression is not a quantity`);
        return r;
      } finally {
        idMax = Math.max(idMax, sourceMark());
      }
    };
    const one = (...lims) => {
      try {
        return CALCULUS_FNS[name](env, f, lims, name);
      } catch (e) {
        if (!(e instanceof ListValue)) throw e;
        const out = [];
        for (element = 0; element < e.n; element++) out.push(CALCULUS_FNS[name](env, f, lims, name));
        element = null;
        return out;
      }
    };
    try {
      if (name === "plot") {
        const tuple = body.t === "convert" ? body.a : body;
        return calcPlot(env, f, limits, { heads: tuple.t === "tuple" ? tuple.items : [body], xname: v.v, shown });
      }
      const r = broadcast(one, limits);
      return name === "solve" ? broadcast(shown, [r]) : r;
    } finally {
      sourceReset(Math.max(idMax, sourceMark()));
    }
  }

  evalExpr(src) {
    const node = parse(normalize(src), this.env);
    if (!node) throw new CalcError("Empty expression");
    return this.evalNode(node);
  }

  // -------------------------------------------------------------------
  // Statements and commands.  Returns
  //   {kind: "value", q, name?}  for expressions and assignments
  //   {kind: "info", title, text} for help and commands
  //   {kind: "list", title, items: [{name, doc}]}
  //   {kind: "none"}

  run(line) {
    this.depth = 0;
    const trimmed = line.trim();
    if (!trimmed) return { kind: "none" };
    try {
      if (trimmed[0] === "%") return this.command(trimmed);
      let m;
      if ((m = /^(.*?)\s*!!$/.exec(trimmed))) return this.search(m[1]);
      if ((m = /^(.+?)\s*!$/.exec(trimmed))) return this.info(m[1]);
      if (trimmed === "!") return { kind: "info", title: "Help", text: "help" };
      const { code, doc } = splitComment(trimmed);
      return this.runCode(code, doc);
    } catch (e) {
      return this.wrapError(e);
    }
  }

  wrapError(e) {
    if (e instanceof UnitError || e instanceof CalcError) return { kind: "error", message: e.message };
    if (e instanceof RangeError) return { kind: "error", message: "Recursion too deep" };
    throw e;
  }

  runCode(code, doc = "") {
    try {
      const node = parse(normalize(code), this.env);
      if (!node) return { kind: "none" };
      if (node.t === "assign") {
        let v = this.evalNode(node.value);
        if (v instanceof PlotData) throw new CalcError("A plot cannot be assigned to a variable");
        if (v instanceof Q && doc) v = v.withDoc(doc);
        this.env.vars.set(node.name, v);
        this.env.touch();
        return { kind: "value", q: v, name: node.name, define: true };
      }
      if (node.t === "def") {
        this.env.vars.set(node.name, { fn: { params: node.params, body: node.body }, doc, src: code.trim() });
        this.env.touch();
        return { kind: "info", title: `${node.name}(${node.params.join(", ")})`, text: "Function defined", define: true };
      }
      let v = this.evalNode(node);
      if (v instanceof PlotData) return { kind: "plot", plot: v };
      if (v instanceof Q || (Array.isArray(v) && isQList(v))) {
        if (doc && v instanceof Q) v = v.withDoc(doc);
        this.env.vars.set("ans", v);
        return { kind: "value", q: v };
      }
      if (Array.isArray(v)) return { kind: "info", title: "Tuple", text: v.map((x) => (x instanceof Q ? this.env.format(x) : String(x))).join(", ") };
      if (typeof v === "string") return { kind: "info", title: "String", text: v };
      if (v instanceof ConstDict) return this.search("", true);
      return { kind: "info", title: "", text: String(v) };
    } catch (e) {
      return this.wrapError(e);
    }
  }

  // Run a whole definition file (lines starting with # are comments)
  runScript(text, { strict = false } = {}) {
    const errors = [];
    text.split(/\r?\n/).forEach((line, n) => {
      if (/^\s*(#|$)/.test(line)) return;
      const r = this.run(line);
      if (r.kind === "error") {
        errors.push(`line ${n + 1}: ${r.message}`);
        if (strict) throw new CalcError(errors.at(-1));
      }
    });
    return errors;
  }

  command(line) {
    const env = this.env;
    const m = /^%(\w+)\s*([\s\S]*)$/.exec(line);
    if (!m) throw new CalcError("Invalid command");
    const cmd = m[1];
    const { code, doc } = splitComment(m[2]);
    const arg = code.trim();
    const defn = () => {
      const parts = arg.split("=");
      if (parts.length < 2) throw new CalcError(`Usage: %${cmd} name=value`);
      const value = parts.pop();
      return { names: parts.map((p) => p.trim()), value: value.trim() };
    };
    const evalDef = (src) => {
      const node = parse(normalize(src), env);
      return this.evalNode(node);
    };
    switch (cmd) {
      case "newbaseunit":
      case "newbasecurrency":
        env.newbaseunit(arg, doc);
        if (cmd === "newbasecurrency") env.basecurrency = arg;
        return { kind: "none", define: true };
      case "newprefix": {
        const { names, value } = defn();
        const v = evalDef(value);
        for (const n of names) env.newprefix(n, v, doc);
        return { kind: "none", define: true };
      }
      case "newunit": {
        const { names, value } = defn();
        const v = evalDef(value);
        for (const n of names) env.newunit(n, v, doc);
        return { kind: "none", define: true };
      }
      case "newsystem": {
        const { names, value } = defn();
        for (const n of names) env.newsystem(n, splitSpec(value), doc);
        return { kind: "none", define: true };
      }
      case "defaultsystem":
        env.defaultsystem = arg ? env.expandSystem(splitSpec(arg)) : null;
        env.defaultsystemName = arg;
        return { kind: "none", define: true };
      case "let": {
        const r = this.runCode(arg, doc);
        return r.kind === "error" ? r : { ...r, define: true };
      }
      case "lazy":
      case "lazyvalue": {
        const { names, value } = defn();
        const node = parse(normalize(value), env);
        let busy = false;
        const lazy = () => {
          if (busy) throw new CalcError(`Recursive definition of ${names[0]}`);
          busy = true;
          try {
            const v = this.evalNode(node);
            return v instanceof Q ? v.withDoc(doc) : v;
          } finally {
            busy = false;
          }
        };
        for (const n of names) env.vars.set(n, { lazy, doc, src: value });
        env.touch();
        return { kind: "none", define: true };
      }
      case "delunit": env.units.delete(arg); env.touch(); return { kind: "none", define: true };
      case "delprefix": env.prefixes.delete(arg); env.touch(); return { kind: "none", define: true };
      case "delsystem": env.systems.delete(arg); env.touch(); return { kind: "none", define: true };
      case "del":
      case "dellazy": env.vars.delete(arg); env.touch(); return { kind: "none", define: true };
      case "compatible":
        return this.compatibleList(arg);
      case "uinfo":
        return /^-a\s+/.test(arg) ? this.search(arg.replace(/^-a\s+/, "")) : this.info(arg);
      default:
        throw new CalcError(`Unknown command %${cmd}`);
    }
  }

  // Dimensions of a unit spec or an expression
  dimsOf(arg) {
    const s = arg.trim();
    if (/^\[.*\]$/.test(s)) return this.env.unit(s.slice(1, -1));
    const v = this.evalExpr(s);
    if (!(v instanceof Q)) throw new CalcError("Not a quantity");
    return v;
  }

  // Units and variables compatible with a quantity
  compatible(q, { variables = true } = {}) {
    const env = this.env;
    const units = [], vars = [];
    for (const [k, v] of env.units) if (dimEq(v.d, q.d)) units.push(k);
    if (variables) {
      for (const [k, v] of env.vars) {
        if (k === "ans") continue;
        if (v instanceof Q && dimEq(v.d, q.d)) vars.push(k);
      }
    }
    return { units, vars };
  }

  compatibleList(arg) {
    const q = this.dimsOf(arg);
    const { units, vars } = this.compatible(q);
    const items = [
      ...units.map((u) => ({ name: u, doc: firstLine(this.env.units.get(u).doc), kind: "unit" })),
      ...vars.map((v) => ({ name: v, doc: firstLine(this.env.vars.get(v).doc), kind: "variable" })),
    ];
    return { kind: "list", title: `Compatible with [${this.env.dimString(q.d)}]`, items };
  }

  // Help on a name (the imks ! operator)
  info(name) {
    const env = this.env;
    name = name.trim();
    const out = [];
    const fmt = (q) => (Array.isArray(q) ? "(" + q.map(fmt).join(", ") + ")" : env.format(q));
    if (env.systems.has(name)) {
      const s = env.systems.get(name);
      out.push({ title: `${name} — unit system`, text: (s.doc ? s.doc + "\n\n" : "") + "[" + s.args.join("|") + "]" });
    }
    if (env.units.has(name)) {
      const u = env.units.get(name);
      const base = env.baseunits.includes(name);
      const absolute = u.zero !== false && u.zero !== 0;
      let text = u.doc || name;
      if (!base) {
        text += "\n\n1[" + name + "] = " + fmt(new Q(u.x, u.d));
        if (absolute) text += `\nZero point: ${fmt(new Q(u.zero, u.d))}`;
      } else text += "\n\nBase unit";
      out.push({ title: `${name} — unit`, text });
    } else if (env.isunit(name) && env.isunit(name)[0] && env.isunit(name)[1]) {
      const [p, u] = env.isunit(name);
      out.push({
        title: `${name} — prefixed unit`,
        text: `${firstLine(env.prefixes.get(p).doc) || p} + ${firstLine(env.units.get(u).doc) || u}\n\n1[${name}] = ${fmt(env.unitValue(name).plain())}`,
      });
    }
    if (env.prefixes.has(name) && name) {
      const p = env.prefixes.get(name);
      out.push({ title: `${name} — prefix`, text: (p.doc || name) + "\n\n" + formatUNum(p.x, env.digits) });
    }
    if (env.vars.has(name)) {
      const v = env.vars.get(name);
      if (v.fn) out.push({ title: `${name} — function`, text: (v.doc ? v.doc + "\n\n" : "") + v.src });
      else {
        const val = v.lazy ? v.lazy() : v;
        out.push({
          title: `${name} — ${v.lazy ? "lazy variable" : "variable"}`,
          text: ((val.doc || v.doc) ? (val.doc || v.doc) + "\n\n" : "") + (val instanceof Q || Array.isArray(val) ? fmt(val) : String(val)) +
            (v.lazy ? `\n\n= ${v.src}` : ""),
        });
      }
    }
    if (this.builtins[name]) out.push({ title: `${name} — function`, text: functionDocs[name] || name });
    if (env.formats.has(name)) out.push({ title: `${name} — format`, text: env.formats.get(name).doc });
    if (this.const.has(name)) out.push({ title: `const["${name}"]`, text: this.const.get(name).doc + "\n\n" + fmt(this.const.get(name)) });
    if (!out.length) return { kind: "error", message: `No information on '${name}'` };
    return { kind: "info", title: out.map((o) => o.title).join(" · "), text: out.map((o) => o.text).join("\n\n———\n\n"), entries: out };
  }

  // Search documentation strings (the imks !! operator)
  search(text, constsOnly = false) {
    const env = this.env;
    const t = text.trim().toLowerCase();
    const items = [];
    const match = (name, doc) => !t || name.toLowerCase().includes(t) || (doc || "").toLowerCase().includes(t);
    if (!constsOnly) {
      for (const [k, v] of env.units) if (match(k, v.doc)) items.push({ name: k, doc: firstLine(v.doc), kind: "unit" });
      for (const [k, v] of env.prefixes) if (k && match(k, v.doc)) items.push({ name: k, doc: firstLine(v.doc), kind: "prefix" });
      for (const [k, v] of env.systems) if (match(k, v.doc)) items.push({ name: k, doc: firstLine(v.doc), kind: "system" });
      for (const [k, v] of env.vars) if (k !== "ans" && match(k, v.doc)) items.push({ name: k, doc: firstLine(v.doc), kind: v.fn ? "function" : "variable" });
    }
    for (const k of this.const.keys()) if (match(k, "")) items.push({ name: `const["${k}"]`, doc: k, kind: "constant" });
    return { kind: "list", title: t ? `Matching “${text.trim()}”` : "Constants", items };
  }
}

// ---------------------------------------------------------------------
// Calculus: solve, integrate, diff
//
// f(x) evaluates the expression for a quantity x. Bracketing, adaptive
// subdivision and convergence use nominal values only (Monte Carlo off);
// the result is then computed with quantities, so that the errors of the
// limits and of everything in the expression propagate. In Monte Carlo
// mode integrals and derivatives reuse the final nodes for every sample,
// and solve finds the root of every sample.

const EPS = Number.EPSILON;

// The variable as plain numbers: u stands for new Q(u, d, zero), with the
// dimensions and zero point of the limits; returns the limits as UNum
function varFrame(env, qs, name) {
  const finite = qs.filter((q) => isFinite(q.x.n));
  const ref = finite.find((q) => q.x.n !== 0) || finite[0] || new Q(0);
  const z = ref.zero === false ? 0 : UNum.of(ref.zero).n;
  const us = qs.map((q) => {
    if (!isFinite(q.x.n) && q.pure) return q.x;
    env.checkCompatible(q, ref, name);
    return q.relative().x.sub(z);
  });
  return { d: ref.d, us, mk: (u) => new Q(u, ref.d, ref.zero) };
}

// with nominal values only (bracketing and adaptivity)
function nominally(fn) {
  const on = MC.on;
  MC.on = false;
  try {
    return fn();
  } finally {
    MC.on = on;
  }
}

// a result whose variable is a pure number keeps the display units of the
// expression: integrate(D_L(z), z, 0, 1) is still in Mpc
function keepShow(r, q, d) {
  return dimIsZero(d) && q && q.show && dimEq(q.d, r.d) ? new Q(r.x, r.d, r.zero, q.show) : r;
}

const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

// Search outwards from u0 for a sign change of g: {lo, hi, glo, ghi} or null
function bracketRoot(g, u0) {
  const g0 = g(u0);
  if (!isFinite(g0)) return null;
  if (g0 === 0) return { lo: u0, hi: u0, glo: 0, ghi: 0 };
  const safe = (u) => { try { return g(u); } catch { return NaN; } };
  let step = Math.abs(u0) * 0.1 || 0.1;
  let r = u0, gr = g0, l = u0, gl = g0, right = true, left = true;
  for (let k = 0; k < 200 && (right || left); k++, step *= 2) {
    if (right) {
      const u = u0 + step, v = safe(u);
      if (!isFinite(v)) right = false;
      else if (sgn(v) !== sgn(g0)) return { lo: r, hi: u, glo: gr, ghi: v };
      else { r = u; gr = v; }
    }
    if (left) {
      const u = u0 - step, v = safe(u);
      if (!isFinite(v)) left = false;
      else if (sgn(v) !== sgn(g0)) return { lo: u, hi: l, glo: v, ghi: gl };
      else { l = u; gl = v; }
    }
  }
  return null;
}

// Brent's method on a bracket with fa, fb of opposite signs
function brent(f, a, b, fa, fb) {
  if (fa === 0) return a;
  if (fb === 0) return b;
  const xtol = 1e-15 * Math.abs(b - a);
  let c = b, fc = fb, d = b - a, e = d;
  for (let it = 0; it < 300; it++) {
    if (sgn(fb) === sgn(fc)) { c = a; fc = fa; d = e = b - a; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol = 2 * EPS * Math.abs(b) + 0.5 * xtol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      // inverse quadratic interpolation, or secant
      const s = fb / fa;
      let p, q;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const t = fa / fc, r = fb / fc;
        p = s * (2 * xm * t * (t - r) - (b - a) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; }
      else { d = xm; e = d; }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : (xm > 0 ? tol : -tol);
    fb = f(b);
  }
  return b;
}

// The root of every Monte Carlo sample: G(xs) gives the samples of the
// expression at the sample values xs. Each sample keeps its own bracket,
// widened where the nominal one does not hold its root, and is refined by
// secant steps that fall back to bisection.
function solveSamples(G, root, lo, hi, slope, name) {
  const N = MC.N;
  const LO = new Float64Array(N).fill(lo), HI = new Float64Array(N).fill(hi);
  let gl = G(LO), gh = G(HI);
  const open = (i) => isNaN(gl[i]) || isNaN(gh[i]) || sgn(gl[i]) * sgn(gh[i]) > 0;
  for (let k = 0; k < 60; k++) {
    let any = false;
    for (let i = 0; i < N; i++) {
      if (!open(i)) continue;
      any = true;
      const w = 1.6 * (HI[i] - LO[i]);
      if (Math.abs(gl[i]) < Math.abs(gh[i]) || !isFinite(gh[i])) LO[i] -= w;
      else HI[i] += w;
    }
    if (!any) break;
    gl = G(LO);
    gh = G(HI);
  }
  let missing = 0;
  for (let i = 0; i < N; i++) if (open(i)) missing++;
  if (missing) throw new CalcError(`${name}: ${missing} of ${N} Monte Carlo samples have no root`);

  const xtol = 1e-15 * Math.abs(hi - lo);
  const done = new Uint8Array(N);
  let X = new Float64Array(N).fill(root), gx = G(X), Xp = null, gp = null;
  for (let it = 0; it < 100; it++) {
    let all = true;
    const Xn = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      Xn[i] = X[i];
      if (done[i]) continue;
      if (gx[i] === 0) { done[i] = 1; continue; }
      if (sgn(gx[i]) === sgn(gl[i])) { LO[i] = X[i]; gl[i] = gx[i]; } else { HI[i] = X[i]; gh[i] = gx[i]; }
      const inv = Xp ? (X[i] - Xp[i]) / (gx[i] - gp[i]) : 1 / slope;
      let xn = X[i] - gx[i] * inv;
      const a = Math.min(LO[i], HI[i]), b = Math.max(LO[i], HI[i]);
      if (!(xn > a && xn < b) || it >= 40) xn = 0.5 * (a + b);
      const tol = 4 * EPS * Math.abs(xn) + xtol;
      if (Math.abs(xn - X[i]) <= tol || b - a <= tol) done[i] = 1;
      else all = false;
      Xn[i] = xn;
    }
    if (all) return Xn;
    Xp = X;
    gp = gx;
    X = Xn;
    gx = G(X);
  }
  return X;
}

function calcSolve(env, f, limits, name) {
  const fr = varFrame(env, limits.length ? limits : [new Q(1)], name);
  if (fr.us.some((u) => !isFinite(u.n))) throw new CalcError(`${name}: the starting value and the range must be finite`);
  const g = (u) => f(fr.mk(u)).relative();
  const gn = (u) => g(u).x.n;
  const { root, lo, hi, gq, slope } = nominally(() => {
    let br;
    if (fr.us.length === 2) {
      const [a, b] = fr.us.map((u) => u.n);
      br = { lo: a, hi: b, glo: gn(a), ghi: gn(b) };
      if (sgn(br.glo) * sgn(br.ghi) > 0) throw new CalcError(`${name}: no sign change between the two limits`);
      if (!isFinite(br.glo) || !isFinite(br.ghi)) throw new CalcError(`${name}: the expression is not finite at a limit`);
    } else {
      br = bracketRoot(gn, fr.us[0].n);
      if (!br) throw new CalcError(`${name}: no root found; give a range, as in solve(f(x) = y, x, a, b)`);
    }
    const root = brent(gn, br.lo, br.hi, br.glo, br.ghi);
    const gq = g(root);
    if (!(Math.abs(gq.x.n) <= Math.max(Math.abs(br.glo), Math.abs(br.ghi)))) {
      throw new CalcError(`${name}: no root, the expression jumps across zero`);
    }
    const h = 1e-6 * (Math.abs(root) || Math.abs(br.hi - br.lo) || 1);
    return { root, lo: br.lo, hi: br.hi, gq, slope: (gn(root + h) - gn(root - h)) / (2 * h) };
  });
  // linear errors: g(root) = 0 moves by dg, so the root moves by −dg/g'
  let c = null;
  if (gq.x.c && slope && isFinite(1 / slope)) {
    c = new Map();
    for (const [k, v] of gq.x.c) c.set(k, -v / slope);
  }
  const x = new UNum(root, c);
  if (MC.on && g(root).x.samples()) {
    const G = (xs) => {
      const r = g(new UNum(root, null, xs)).x;
      return r.samples() || new Float64Array(xs.length).fill(r.n);
    };
    x.s = solveSamples(G, root, Math.min(lo, hi), Math.max(lo, hi), slope, name);
  }
  return fr.mk(x);
}

// Gauss–Kronrod 15-point rule (QUADPACK): nodes, Kronrod weights, and the
// weights of the embedded 7-point Gauss rule (on nodes 1, 3, 5, 7)
const GK_X = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851,
  0.864864423359769072789712788640926, 0.741531185599394439863864773280788,
  0.586087235467691130294144845693013, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0];
const GK_WK = [0.022935322010529224963732008058970, 0.063092092629978553290700663189204,
  0.104790010322250183839876322541518, 0.140653259715525918745189590510238,
  0.169004726639267902826583426598550, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
const GK_WG = [0.129484966168869693270611432679082, 0.279705391489276667901467771423780,
  0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

function calcIntegrate(env, f, limits, name) {
  const fr = varFrame(env, limits, name);
  let [a, b] = fr.us, sign = 1;
  const at = (u) => f(fr.mk(u)).relative();
  if (a.n === b.n) return env.mul(at(isFinite(a.n) ? a : new UNum(0)), new Q(0, fr.d));
  if (!isFinite(a.n) || !isFinite(b.n)) {
    if (a.n > b.n) { [a, b] = [b, a]; sign = -1; }
  }
  const fn = (u) => at(u).x.n;

  // integration over t: x(t) and dx/dt as UNum, for t in [t0, t1]
  let X, J, t0 = 0, t1 = 1;
  if (isFinite(a.n) && isFinite(b.n)) {
    const w = b.sub(a);
    X = (t) => a.add(w.scale(t));
    J = () => w;
  } else {
    // infinite ranges: x = a + L t/(1 − t), with a length scale L where
    // |f(x)| x is largest
    const two = !isFinite(a.n) && !isFinite(b.n);
    const base = two ? 0 : isFinite(a.n) ? a.n : b.n;
    const dir = !isFinite(a.n) && !two ? -1 : 1;
    let L = Math.abs(base) || 1, best = 0;
    nominally(() => {
      for (let k = -40; k <= 40; k++) {
        const s = 10 ** k;
        let v;
        try {
          v = Math.abs(fn(base + dir * s)) + (two ? Math.abs(fn(base - s)) : 0);
        } catch { continue; }
        if (isFinite(v) && v * s > best) { best = v * s; L = s; }
      }
    });
    if (two) {
      t0 = -1;
      X = (t) => new UNum(L * t / (1 - t * t));
      J = (t) => new UNum(L * (1 + t * t) / (1 - t * t) ** 2);
    } else {
      const origin = isFinite(a.n) ? a : b;
      X = (t) => origin.add(dir * L * t / (1 - t));
      J = (t) => new UNum(L / (1 - t) ** 2);
    }
  }

  // one panel: the Kronrod sum as a quantity, its error estimate and ∫|f|
  let shown = null;
  const panel = (lo, hi) => {
    const c = (lo + hi) / 2, h = (hi - lo) / 2;
    let sum = null, rk = 0, rg = 0, rabs = 0;
    const vals = [];
    for (let i = 0; i < 8; i++) {
      for (const side of i < 7 ? [-1, 1] : [0]) {
        const t = c + side * h * GK_X[i];
        const x = X(t), j = J(t);
        if (!isFinite(x.n) || !isFinite(j.n)) continue;
        const q = at(x);
        shown = shown || q;
        const v = env.mul(q, new Q(j, fr.d));
        const y = v.x.n;
        if (!isFinite(y)) throw new CalcError(`${name}: the expression is not finite at a point of the range`);
        const term = new Q(v.x.scale(GK_WK[i] * h), v.d);
        sum = sum ? env.add(sum, term) : term;
        rk += GK_WK[i] * y;
        if (i % 2) rg += GK_WG[(i - 1) / 2] * y;
        else if (i === 7) rg += GK_WG[3] * y;
        rabs += GK_WK[i] * Math.abs(y);
        vals.push([i, y]);
      }
    }
    // QUADPACK's error estimate
    const mean = rk / 2;
    let rasc = 0;
    for (const [i, y] of vals) rasc += GK_WK[i] * Math.abs(y - mean);
    let err = Math.abs((rk - rg) * h);
    rasc *= Math.abs(h);
    if (rasc && err) err = rasc * Math.min(1, (200 * err / rasc) ** 1.5);
    err = Math.max(err, 50 * EPS * rabs * Math.abs(h));
    return { lo, hi, sum, value: rk * h, err, abs: rabs * Math.abs(h) };
  };

  // adaptive subdivision of the panel with the largest error
  const total = (ps, k) => ps.reduce((s, p) => s + p[k], 0);
  const panels = nominally(() => {
    const ps = [panel(t0, t1)];
    while (ps.length < 200) {
      const I = Math.abs(total(ps, "value")), err = total(ps, "err");
      if (err <= Math.max(1e-12 * I, 1e-14 * total(ps, "abs"))) break;
      let k = 0;
      for (let i = 1; i < ps.length; i++) if (ps[i].err > ps[k].err) k = i;
      const p = ps[k], m = (p.lo + p.hi) / 2;
      if (!(m > p.lo && m < p.hi)) break;
      ps.splice(k, 1, panel(p.lo, m), panel(m, p.hi));
    }
    return ps;
  });
  const I = total(panels, "value"), err = total(panels, "err");
  if (!(err <= Math.max(1e-6 * Math.abs(I), 1e-9 * total(panels, "abs")))) {
    throw new CalcError(`${name}: no convergence (the integral may diverge)`);
  }
  const sums = MC.on ? panels.map((p) => panel(p.lo, p.hi).sum) : panels.map((p) => p.sum);
  let r = sums.filter(Boolean).reduce((s, q) => env.add(s, q));
  if (sign < 0) r = env.neg(r);
  return keepShow(r, shown, fr.d);
}

function calcDiff(env, f, limits, name) {
  const [x0, step] = limits;
  const fr = varFrame(env, [x0], name);
  const u0 = fr.us[0];
  if (!isFinite(u0.n)) throw new CalcError(`${name}: the point must be finite`);
  if (step) env.checkCompatible(step, x0, name);
  const h = step ? Math.abs(step.x.n) : Math.abs(u0.n) * 1e-3 || 1e-3;
  if (!(h > 0 && isFinite(h))) throw new CalcError(`${name}: the step must be finite and not zero`);
  // five-point central difference, error O(h⁴)
  let s = null, q0 = null;
  for (const [k, w] of [[-2, 1], [-1, -8], [1, 8], [2, -1]]) {
    const q = f(fr.mk(u0.add(k * h))).relative();
    q0 = q0 || q;
    const t = new Q(q.x.scale(w), q.d);
    s = s ? env.add(s, t) : t;
  }
  return keepShow(env.div(s, new Q(12 * h, fr.d)), q0, fr.d);
}

// plot(f(x), x, a, b): the expression at n points, equally spaced, or in
// equal ratios when a and b are positive and at least a factor 100 apart;
// points where it fails or is not finite are left out (null)
function calcPlot(env, f, limits, { heads, xname, shown }) {
  const fr = varFrame(env, limits, "plot");
  const [a, b] = fr.us.map((u) => u.n);
  if (!isFinite(a) || !isFinite(b) || a === b) throw new CalcError("plot: the range must be finite and not empty");
  const n = MC.on ? 81 : 161;
  const logx = a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) >= 100;
  const xs = [], rows = [];
  let error = null;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = fr.mk(logx ? a * (b / a) ** t : a + (b - a) * t);
    xs.push(shown(x));
    try {
      const y = f(x);
      rows.push(Array.isArray(y) ? y : [y]);
    } catch (e) {
      if (!(e instanceof CalcError || e instanceof UnitError)) throw e;
      error = error || e;
      rows.push(null);
    }
  }
  const k = Math.max(0, ...rows.map((r) => (r ? r.length : 0)));
  if (!k) throw error || new CalcError("plot: nothing to plot");
  const series = Array.from({ length: k }, (_, j) => rows.map((r) => (r && r[j] && isFinite(r[j].x.n) ? r[j] : null)));
  return makePlot(env, xs, series, { heads: heads.length === k ? heads : null, xname });
}

// checks that the x values, and all the curves, have consistent units
function makePlot(env, xs, series, opts) {
  const same = (qs, what) => {
    const ok = qs.filter(Boolean);
    if (!ok.length) return;
    for (const q of ok) {
      if (!dimEq(q.d, ok[0].d)) throw new CalcError(`plot: the ${what} have different units: [${env.dimString(ok[0].d)}] and [${env.dimString(q.d)}]`);
    }
  };
  same(xs, "x values");
  same(series.flat(), "curves");
  if (!series.flat().some(Boolean)) throw new CalcError("plot: no finite values to plot");
  return new PlotData(xs, series, opts);
}

// sum(f(k), k, a, b): f at k = a, a + 1, …, b; a list f gives a list of sums
function calcSum(env, f, limits, name) {
  const [a, b] = limits.map((q, i) => {
    const k = env.checkPure(q, `${name} (${i ? "last" : "first"} index)`).n;
    if (!Number.isInteger(k)) throw new CalcError(`${name}: the first and last index must be whole numbers`);
    return k;
  });
  if (b - a >= 100000) throw new CalcError(`${name}: at most 100000 terms`);
  let s = null;
  for (let k = a; k <= b; k++) {
    const t = f(new Q(k));
    s = s === null ? t : broadcast((x, y) => env.add(x, y), [s, t]);
  }
  return s === null ? new Q(0) : s;
}

const CALCULUS_FNS = { solve: calcSolve, integrate: calcIntegrate, diff: calcDiff, sum: calcSum };

function firstLine(doc) {
  return (doc || "").split("\n")[0];
}

export { CalcError, ConstDict, normalize, splitComment, splitSpec, tokenize, parse, functionDocs, Interpreter, firstLine, PlotData };
