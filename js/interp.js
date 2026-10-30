// The imks expression language: tokenizer, parser, evaluator and the
// %commands used in definition files.

import { UNum, ufuncs, atan2, formatUNum, newSourceId, MC, sourceMark, sourceReset } from "./unum.js";
import { Env, Q, UnitError, dimAdd, dimEq, dimScale, dimIsZero, symbolSource } from "./units.js";

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

  // a name followed by parentheses is a function call, unless it is a value:
  // pi (2 m)^2 is pi (2 m)², and with a space, t (1 - t) also for names
  // still unknown here (function parameters and calculus variables)
  const isCall = (k, paren) => {
    if (env.isFunction && env.isFunction(k.v)) return true;
    if (env.isValue && env.isValue(k.v)) return false;
    return paren.pos === k.pos + k.v.length;
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

  // in an exponent, units belong to the base: c^2 R_Earth, 10^3 m
  const primary = (negate = false, inExp = false) => {
    const k = next();
    if (!k) throw new CalcError("Incomplete expression");
    switch (k.t) {
      case "num": {
        const node = { t: "num", x: negate ? k.x.neg() : k.x };
        const spec = inExp ? null : bareUnits();
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
        if (items.length === 1) return items[0];
        // a list takes bare units like a number: (30, 50) km/h
        const node = { t: "tuple", items };
        const spec = inExp ? null : bareUnits();
        return spec ? { t: "unit", target: node, raw: spec } : node;
      }
      case "bracket":
        return { t: "unit", target: { t: "num", x: new UNum(1) }, raw: k.raw };
      default:
        throw new CalcError(`Unexpected '${k.v || k.t}'`);
    }
  };

  const postfix = (negate, inExp) => {
    let node = primary(negate, inExp);
    for (;;) {
      if (at("(") && node.t === "name" && isCall(toks[pos - 1], peek())) {
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
      } else if (at("bracket") && !inExp) {
        node = { t: "unit", target: node, raw: next().raw };
      } else break;
    }
    return node;
  };

  const power = (negate = false, inExp = false) => {
    const base = postfix(negate, inExp);
    if (at("^")) {
      next();
      return { t: "bin", op: "^", a: base, b: unary(true) };
    }
    return base;
  };

  const unary = (inExp = false) => {
    // a negative number literal binds before its unit: -40 °F
    if (at("-") && peek(1) && peek(1).t === "num" && !(peek(2) && peek(2).t === "^")) {
      next();
      return power(true, inExp);
    }
    if (at("-") || at("+") || at("~")) {
      const op = next().t;
      return { t: "un", op, a: unary(inExp) };
    }
    if (at("root")) {
      // √x, ∛x: prefix roots
      const f = next().v;
      return { t: "call", f, args: [unary(inExp)] };
    }
    return power(false, inExp);
  };

  const product = () => {
    let a = unary();
    for (;;) {
      if (at("*") || at("/")) {
        const op = next().t;
        a = { t: "bin", op, a, b: unary() };
      } else if (at("id") && peek().v === "mod" && peek(1)) {
        // a mod b, the remainder, as tight as * and /
        next();
        a = { t: "bin", op: "mod", a, b: unary() };
      } else if (at("id") || at("(") || at("bracket") || at("root") || (at("num") && a.t !== "num")) {
        // implicit multiplication: 2 pi, (a+b)(c+d), k 300 K (but not 2 3)
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
  sqrt: "Square root", cbrt: "Cubic root", exp: "Exponential", log: "Natural logarithm; log(b, x) in base b",
  ln: "Natural logarithm", log10: "Decimal logarithm", log2: "Base-2 logarithm",
  sin: "Sine", cos: "Cosine", tan: "Tangent", asin: "Arc sine", acos: "Arc cosine",
  atan: "Arc tangent", atan2: "Arc tangent of y/x: atan2(y, x)", sinh: "Hyperbolic sine",
  cosh: "Hyperbolic cosine", tanh: "Hyperbolic tangent", asinh: "Inverse hyperbolic sine",
  acosh: "Inverse hyperbolic cosine", atanh: "Inverse hyperbolic tangent",
  abs: "Absolute value", gcd: "Greatest common divisor of integers", lcm: "Least common multiple of integers", sgn: "Sign: −1, 0 or 1", sign: "Sign: −1, 0 or 1", floor: "Round down (in base units)", ceil: "Round up (in base units)",
  round: "Round (in base units)", trunc: "Truncate (in base units)",
  min: "Minimum of the arguments", max: "Maximum of the arguments",
  hypot: "Square root of the sum of squares", gamma: "Gamma function",
  factorial: "Factorial", fraction: "fraction(a, b) = a/b",
  nominal: "Nominal value, without uncertainty", err: "Standard deviation (uncertainty)",
  solve: "Root of an equation in x: solve(f(x) = y, x, guess) or solve(f(x) = y, x, a, b)",
  roots: "All the roots of an equation in x, as a list: roots(f(x) = y, x), roots(f(x) = y, x, a, b); a or b can be ±inf",
  integrate: "Definite integral over x: integrate(f(x), x, a, b); a or b can be ±inf",
  diff: "Derivative with respect to x at x0: diff(f(x), x, x0)",
  limit: "Limit for x → x0: limit(f(x), x, x0); limit(f(x), x, x0, 1) from above, -1 from below; x0 can be ±inf",
};

Object.assign(functionDocs, {
  linspace: "List of n equally spaced values from a to b: linspace(a, b, n)",
  logspace: "List of n values from a to b in equal ratios: logspace(a, b, n)",
  sum: "Sum of a list, sum(list), or of an expression over whole numbers, sum(f(k), k, a, b); b can be inf",
  mean: "Mean of a list: mean(list)",
  len: "Number of values in a list: len(list)",
  dot: "Scalar product of two vectors: dot(a, b)",
  cross: "Vector product of two 3-vectors: cross(a, b)",
  norm: "Length of a vector: norm(v)",
  angle: "Angle between two vectors, in rad: angle(a, b)",
  polyroots: "Roots of a0 + a1 x + … + an x^n, complex ones too, as a table of real and imaginary parts: polyroots((a0, a1, …, an))",
  plot: "Plot: plot(f(x), x, a, b), plot(ys) or plot(xs, ys); a tuple of expressions or lists gives several curves",
});

// solve, integrate, diff, plot and sum see their first argument as an
// expression in the variable named by the second one, so their arguments
// are not evaluated in advance (plot and sum only in the forms
// plot(f(x), x, a, b) and sum(f(k), k, a, b))
const CALCULUS = new Set(["solve", "roots", "limit", "integrate", "diff", "plot", "sum"]);
const isCalculus = (node) => CALCULUS.has(node.f) &&
  (!["plot", "sum"].includes(node.f) || (node.args.length === 4 && node.args[1].t === "name"));

// built-in functions that take whole lists; the others apply elementwise
const LIST_FNS = new Set(["sum", "mean", "len", "min", "max", "linspace", "logspace", "plot", "polyroots", "hypot", "dot", "cross", "norm", "angle"]);

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
// quantities; heads are the expressions of the curves (nodes) when known.
// For plot(f(x), x, a, b), range is the x range computed, as numbers that
// a range override (Interpreter.plotRange) takes back, and asym the
// asymptotes if it asked for them (see plotAsymptotes)
class PlotData {
  constructor(xs, series, { heads = null, xname = "", range = null, asym = null } = {}) {
    this.xs = xs;
    this.asym = asym;
    this.series = series;
    this.heads = heads;
    this.xname = xname;
    this.range = range;
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
    // for the parser: whether name(…) is a call or a product
    const varOf = (n) => this.env.vars.get(this.env.vars.resolve ? this.env.vars.resolve(n) : n);
    this.env.isFunction = (n) => CALCULUS.has(n) || Boolean((varOf(n) || {}).fn) || typeof this.builtins[n] === "function";
    this.env.isValue = (n) => varOf(n) !== undefined || ["pi", "tau", "inf", "nan"].includes(n) || (this.env.isunit(n) || [])[1] > "";
    // {a, b, log}: replaces the range of plot(f(x), x, a, b), to zoom it
    this.plotRange = null;
  }

  makeBuiltins() {
    const env = this.env;
    const b = {};
    for (const f of pureFuncs) {
      b[f] = (a) => new Q(ufuncs[f](env.checkPure(a, f)));
    }
    b.ln = b.log;
    // log(b, x): logarithm in base b, the inverse of b^x
    b.log = (a, x) => (x === undefined ? b.ln(a)
      : new Q(ufuncs.log10(env.checkPure(x, "log")).div(ufuncs.log10(env.checkPure(a, "log")))));
    b.sqrt = (a) => { a = a.relative(); return new Q(ufuncs.sqrt(a.x), dimScale(a.d, 0.5)); };
    b.cbrt = (a) => { a = a.relative(); return new Q(ufuncs.cbrt(a.x), dimScale(a.d, 1 / 3)); };
    b.abs = (a) => { a = a.relative(); return new Q(a.x.abs(), a.d); };
    // the sign, a pure number: −1, 0 or 1
    b.sgn = (a) => new Q(a.relative().x.map(Math.sign, () => 0));
    b.sign = b.sgn;
    for (const f of ["floor", "ceil", "trunc"]) {
      b[f] = (a) => { a = a.relative(); return new Q(ufuncs[f](a.x), a.d); };
    }
    b.round = (a, n) => {
      a = a.relative();
      const k = n ? Math.pow(10, env.checkPure(n, "round").n) : 1;
      return new Q(new UNum(Math.round(a.x.n * k) / k), a.d);
    };
    // gcd and lcm of integers: gcd(12, 18) = 6
    const ints = (fn, xs) => {
      return xs.map((x) => {
        const n = env.checkPure(x, fn).n;
        if (!Number.isInteger(n)) throw new CalcError(`${fn}: expected integers, got ${n}`);
        return Math.abs(n);
      });
    };
    const gcd = (x, y) => { while (y) [x, y] = [y, x % y]; return x; };
    b.gcd = (...xs) => new Q(new UNum(ints("gcd", xs).reduce(gcd)));
    b.lcm = (...xs) => new Q(new UNum(ints("lcm", xs).reduce((x, y) => (x && y ? (x / gcd(x, y)) * y : 0))));
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
    b.polyroots = (...xs) => polyRoots(env, xs);
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
            case "mod": {
              // a − b ⌊a/b⌋, with the units of a
              env.checkCompatible(a, b, "mod");
              const k = new Q(ufuncs.floor(env.checkPure(env.div(a.relative(), b.relative()), "mod")));
              return env.sub(a, env.mul(b.relative(), k));
            }
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
    const [least, most] = { solve: [0, 2], roots: [0, 2], limit: [1, 2], integrate: [2, 2], diff: [1, 2], plot: [2, 2], sum: [2, 2] }[name];
    const usage = () => new CalcError(`Usage: ${functionDocs[name].replace(/^[^:]*:\s*/, "")}`);
    if (!body || !v || v.t !== "name" || rest.length < least || rest.length > most) throw usage();
    const expr = body.t === "eq" && (name === "solve" || name === "roots") ? { t: "bin", op: "-", a: body.a, b: body.b } : body;
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
        if (Array.isArray(r) && name !== "plot" && (name !== "sum" || element !== null)) {
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
        return calcPlot(env, f, limits, { heads: tuple.t === "tuple" ? tuple.items : [body], xname: v.v, shown, range: this.plotRange });
      }
      const r = broadcast(one, limits);
      return name === "solve" || name === "roots" ? broadcast(shown, [r]) : r;
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
  const br = nominally(() => {
    if (fr.us.length === 2) {
      const [a, b] = fr.us.map((u) => u.n);
      const br = { lo: a, hi: b, glo: gn(a), ghi: gn(b) };
      if (sgn(br.glo) * sgn(br.ghi) > 0) throw new CalcError(`${name}: no sign change between the two limits`);
      if (!isFinite(br.glo) || !isFinite(br.ghi)) throw new CalcError(`${name}: the expression is not finite at a limit`);
      return br;
    }
    const br = bracketRoot(gn, fr.us[0].n);
    if (!br) throw new CalcError(`${name}: no root found; give a range, as in solve(f(x) = y, x, a, b)`);
    return br;
  });
  const x = rootIn(g, br, name);
  if (!x) throw new CalcError(`${name}: no root, the expression jumps across zero`);
  return fr.mk(x);
}

// The root of g (u -> relative Q) in a bracket {lo, hi, glo, ghi}, as a
// UNum with linear errors and Monte Carlo samples; null where g jumps
// across zero instead (a pole)
function rootIn(g, br, name) {
  const gn = (u) => g(u).x.n;
  const r = nominally(() => {
    const root = brent(gn, br.lo, br.hi, br.glo, br.ghi);
    const gq = g(root);
    if (!(Math.abs(gq.x.n) <= Math.max(Math.abs(br.glo), Math.abs(br.ghi)))) return null;
    const h = 1e-6 * (Math.abs(root) || Math.abs(br.hi - br.lo) || 1);
    return { root, gq, slope: (gn(root + h) - gn(root - h)) / (2 * h) };
  });
  if (!r) return null;
  const { root, gq, slope } = r;
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
    x.s = solveSamples(G, root, Math.min(br.lo, br.hi), Math.max(br.lo, br.hi), slope, name);
  }
  return x;
}

// Minimum of |g| in [a, b] by golden-section search: [u, |g(u)|]
function minAbs(gn, a, b) {
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a), d = a + r * (b - a), fc = Math.abs(gn(c)), fd = Math.abs(gn(d));
  for (let it = 0; it < 200 && Math.abs(b - a) > 4 * EPS * Math.max(Math.abs(a), Math.abs(b)); it++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = Math.abs(gn(c)); }
    else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = Math.abs(gn(d)); }
  }
  return fc < fd ? [c, fc] : [d, fd];
}

const MAX_ROOTS = 100;

// roots(f(x) = y, x, a, b): every root in [a, b] (which can reach ±inf),
// or with no range (or a value that sets the units and the scale) on the
// whole line. The expression is sampled on an even grid over a finite
// range and on a grid in equal ratios on both sides of 0 (from 1e-10 to
// 1e10 times the scale); each sign change is refined as in solve, poles
// left out, and a local minimum of |g| close to zero is a root where the
// curve only touches zero (it has no uncertainty). Roots closer than the
// grid spacing can be missed.
function calcRoots(env, f, limits, name) {
  const fr = varFrame(env, limits.length ? limits : [new Q(1)], name);
  const g = (u) => f(fr.mk(u)).relative();
  const gn = (u) => g(u).x.n;
  const [a, b] = fr.us.length === 2 ? fr.us.map((u) => u.n).sort((p, q) => p - q) : [-Infinity, Infinity];
  if (a === b) throw new CalcError(`${name}: the range is empty`);
  const finite = isFinite(a) && isFinite(b);
  let scale = 1;
  if (fr.us.length === 1) scale = Math.abs(fr.us[0].n) || 1;
  else if (!finite) scale = Math.abs(isFinite(a) ? a : b) || 1;

  const us = [];
  if (finite) for (let i = 0; i <= 1000; i++) us.push(a + (b - a) * (i / 1000));
  else for (const u of [a, b]) if (isFinite(u)) us.push(u);
  const PER = 60;
  us.push(0);
  for (let k = -10 * PER; k <= 10 * PER; k++) {
    const s = scale * 10 ** (k / PER);
    us.push(s, -s);
  }
  const xs = [...new Set(us.filter((u) => u >= a && u <= b))].sort((p, q) => p - q);
  let error = null;
  const safe = (u) => {
    try {
      const v = gn(u);
      return isFinite(v) ? v : NaN;
    } catch (e) {
      if (!(e instanceof CalcError || e instanceof UnitError)) throw e;
      error = error || e;
      return NaN;
    }
  };
  const gs = nominally(() => xs.map(safe));
  if (!gs.some((v) => !isNaN(v))) throw error || new CalcError(`${name}: the expression is not finite in the range`);

  const found = [];
  const add = (x) => {
    if (found.length >= MAX_ROOTS) throw new CalcError(`${name}: more than ${MAX_ROOTS} roots; give a smaller range`);
    found.push(x);
  };
  // a run of grid intervals that almost all change sign: the expression
  // oscillates faster than the grid
  let dense = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = gs[i];
    if (v === 0) {
      // on the grid: refined between the neighbours for its errors, unless it only touches zero
      const l = i > 0 ? gs[i - 1] : NaN, r = i + 1 < xs.length ? gs[i + 1] : NaN;
      const x = sgn(l) * sgn(r) < 0 ? rootIn(g, { lo: xs[i - 1], hi: xs[i + 1], glo: l, ghi: r }, name) : null;
      add(x || new UNum(xs[i]));
      dense = 0;
      continue;
    }
    if (i + 1 < xs.length) {
      const w = gs[i + 1];
      if (w !== 0 && sgn(v) * sgn(w) < 0) {
        dense = dense + 1;
        if (dense >= 6) throw new CalcError(`${name}: the expression changes sign too often near ${env.format(fr.mk(new UNum(xs[i])))} to find all the roots; give a smaller range`);
        const x = rootIn(g, { lo: xs[i], hi: xs[i + 1], glo: v, ghi: w }, name);
        if (x) add(x);
        continue;
      }
    }
    dense = 0;
    // a local minimum of |g| that is not a sign change: a touching root?
    if (i > 0 && i + 1 < xs.length && !isNaN(v)) {
      const l = gs[i - 1], r = gs[i + 1];
      if (sgn(l) === sgn(v) && sgn(r) === sgn(v) && Math.abs(v) < Math.abs(l) && Math.abs(v) <= Math.abs(r)) {
        const [u, m] = nominally(() => minAbs(safe, xs[i - 1], xs[i + 1]));
        if (m <= 1e-9 * Math.max(Math.abs(l), Math.abs(r))) add(new UNum(u));
      }
    }
  }
  if (!found.length) throw new CalcError(`${name}: no root found${finite ? " in the range" : ""}`);
  return found.map((x) => fr.mk(x));
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
// points where it fails or is not finite are left out (null). Where a
// curve jumps, the interval is halved towards the jump: a jump that does
// not shrink (a pole or a step) breaks the curve there. range, if given,
// replaces a and b (in the same frame) and the choice of spacing; its asym
// asks for the asymptotes too ("v": only the vertical ones)
function calcPlot(env, f, limits, { heads, xname, shown, range }) {
  const fr = varFrame(env, limits, "plot");
  let [a, b] = fr.us.map((u) => u.n);
  if (!isFinite(a) || !isFinite(b) || a === b) throw new CalcError("plot: the range must be finite and not empty");
  if (range) ({ a, b } = range);
  const n = MC.on ? 81 : 161;
  const logx = a > 0 && b > 0 && (range ? range.log : Math.max(a, b) / Math.min(a, b) >= 100);
  let error = null;
  // the point at t in [0, 1]: x, and the values of the curves (or null)
  const xAt = (t) => fr.mk(logx ? a * (b / a) ** t : a + (b - a) * t);
  const at = (t) => {
    const x = xAt(t);
    let row = null;
    try {
      const y = f(x);
      row = (Array.isArray(y) ? y : [y]).map((q) => (q instanceof Q && isFinite(q.x.n) ? q : null));
    } catch (e) {
      if (!(e instanceof CalcError || e instanceof UnitError)) throw e;
      error = error || e;
    }
    return { t, x: shown(x), row };
  };
  const pts = Array.from({ length: n }, (_, i) => at(i / (n - 1)));
  const k = Math.max(0, ...pts.map((p) => (p.row ? p.row.length : 0)));
  if (!k) throw error || new CalcError("plot: nothing to plot");
  const yv = (p, j) => (p.row && p.row[j] ? p.row[j].x.n : null);

  // jumps larger than a tenth of the spread of a curve, or much larger
  // than one of those next to them (a step after a flat part); largest first
  const jumps = [];
  for (let j = 0; j < k; j++) {
    const ys = pts.map((p) => yv(p, j)).filter((y) => y !== null).sort((u, v) => u - v);
    if (ys.length < 2) continue;
    const q = (s) => ys[Math.round(s * (ys.length - 1))];
    const w = q(0.95) - q(0.05) || ys.at(-1) - ys[0];
    const dy = pts.slice(1).map((p, i) => {
      const y0 = yv(pts[i], j), y1 = yv(p, j);
      return y0 === null || y1 === null ? null : Math.abs(y1 - y0);
    });
    dy.forEach((d, i) => {
      if (d === null || !(d > 1e-9 * w)) return;
      if (d > 0.1 * w || d > 3 * Math.min(dy[i - 1] || 0, dy[i + 1] || 0)) jumps.push({ i, j, size: d / w });
    });
  }
  jumps.sort((u, v) => v.size - u.size);
  const extra = [], poles = [];
  let budget = 6 * n;
  for (const { i, j } of jumps) {
    let p0 = pts[i], p1 = pts[i + 1];
    const jump = Math.abs(yv(p1, j) - yv(p0, j));
    let broken = true;
    for (let depth = 0; depth < 8 && budget > 0; depth++, budget--) {
      const m = at((p0.t + p1.t) / 2);
      extra.push(m);
      const ym = yv(m, j);
      if (ym === null) { broken = false; break; }
      // on to the half with the larger jump, until it shrinks
      if (Math.abs(ym - yv(p0, j)) > Math.abs(yv(p1, j) - ym)) p1 = m;
      else p0 = m;
      if (Math.abs(yv(p1, j) - yv(p0, j)) < jump / 4) { broken = false; break; }
    }
    if (broken && budget > 0) {
      const row = p0.row.map((q, jj) => (jj === j ? null : q));
      const t = (p0.t + p1.t) / 2;
      extra.push({ t, x: shown(xAt(t)), row, cut: true });
      if (Math.abs(yv(p1, j) - yv(p0, j)) > 2 * jump) poles.push({ j, t0: p0.t, t1: p1.t });
    }
    if (budget <= 0) break;
  }
  pts.push(...extra);
  pts.sort((u, v) => u.t - v.t);

  const xs = pts.map((p) => p.x);
  const series = Array.from({ length: k }, (_, j) => pts.map((p) => (p.row && p.row[j]) || null));
  const asym = range && range.asym
    ? nominally(() => plotAsymptotes(env, f, { fr, k, pts, poles, a, b, logx, shown, lines: range.asym === "all" }))
    : null;
  return makePlot(env, xs, series, { heads: heads.length === k ? heads : null, xname, range: { a, b, log: logx }, asym });
}

// The asymptotes of the curves of a plot. Vertical ones: where a limit
// from one side is ±∞, near the poles found in sampling, near peaks far
// out of the spread of a curve (found by ternary search) and at the edges
// of where it is defined (by bisection). With lines, also y = m x + q for
// x → ±∞, as m = lim y/x and q = lim y − m x. Returns {v: [[j, x]],
// lines: [{j, p: [[x, y], [x, y]]}] or null} (j: the curve)
function plotAsymptotes(env, f, { fr, k, pts, poles, a, b, logx, shown, lines }) {
  const quiet = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof CalcError || e instanceof UnitError)) throw e;
      return null;
    }
  };
  const uAt = (t) => (logx ? a * (b / a) ** t : a + (b - a) * t);
  const fj = (j) => (x) => { const y = f(x); return Array.isArray(y) ? y[j] : y; };
  const yAt = (j, t) => quiet(() => { const q = fj(j)(fr.mk(uAt(t))); return q instanceof Q && isFinite(q.x.n) ? q.x.n : null; });
  // ±∞ from a side (1 above, -1 below) at u rounded, as coarsely as can
  // be (where f overflows near 1/x → 0 is not the pole), or at u
  const pole = (j, u, sides) => {
    for (const u0 of [...[1e-3, 1e-6, 1e-9].map((e) => Math.round(u / (e * Math.abs(b - a))) * e * Math.abs(b - a)), u]) {
      for (const side of sides) {
        if (quiet(() => !isFinite(calcLimit(env, fj(j), [fr.mk(u0), new Q(side)], "plot").x.n))) return u0;
      }
    }
    return null;
  };
  const v = [], out = [];
  for (let j = 0; j < k; j++) {
    // without the points that break the curve at jumps
    const ps = pts.filter((p) => !p.cut);
    const ys = ps.map((p) => (p.row && p.row[j] ? p.row[j].x.n : null));
    const fin = ys.filter((y) => y !== null).sort((p, q) => p - q);
    if (fin.length < 2) continue;
    const qu = (s) => fin[Math.round(s * (fin.length - 1))];
    const med = qu(0.5), w = qu(0.95) - qu(0.05) || fin.at(-1) - fin[0] || Math.abs(med) || 1;
    const dev = (i) => (ys[i] === null || ys[i] === undefined ? 0 : Math.abs(ys[i] - med));
    const spans = poles.filter((p) => p.j === j).map((p) => [p.t0, p.t1]), edges = [];
    ys.forEach((y, i) => {
      if (y !== null && dev(i) > 10 * w && dev(i) >= dev(i - 1) && dev(i) >= dev(i + 1)) spans.push([ps[Math.max(0, i - 1)].t, ps[Math.min(ps.length - 1, i + 1)].t]);
      // [defined, not defined]
      if (i && (y === null) !== (ys[i - 1] === null)) edges.push(y === null ? [ps[i - 1].t, ps[i].t] : [ps[i].t, ps[i - 1].t]);
    });
    const near = (u) => v.some(([jj, uu]) => jj === j && Math.abs(uu - u) <= 1e-6 * Math.abs(b - a));
    const add = (u) => { if (u !== null && !near(u)) v.push([j, u]); };
    const h = (t) => { const y = yAt(j, t); return y === null ? Infinity : Math.abs(y - med); };
    for (let [L, R] of spans.slice(0, 20)) {
      for (let it = 0; it < 100 && R - L > 1e-16; it++) {
        const m1 = L + (R - L) / 3, m2 = R - (R - L) / 3;
        if (h(m1) > h(m2)) R = m2;
        else L = m1;
      }
      const u = uAt((L + R) / 2);
      if (!near(u) && Math.max(h(L), h(R)) > 1e6 * w) add(pole(j, u, [-1, 1]));
    }
    for (let [tf, tn] of edges.slice(0, 20)) {
      for (let it = 0; it < 60; it++) {
        const t = (tf + tn) / 2;
        if (yAt(j, t) === null) tn = t;
        else tf = t;
      }
      const u = uAt(tf);
      if (!near(u)) add(pole(j, u, [-sgn(uAt(tn) - u) || 1]));
    }
    if (!lines) continue;
    for (const s of [1, -1]) {
      const big = (i) => s * 2 ** i;
      const m = quiet(() => oneSide(env, (i) => env.div(fj(j)(fr.mk(big(i))), new Q(big(i))), "plot", null).q);
      if (!m || !isFinite(m.x.n)) continue;
      const c = quiet(() => oneSide(env, (i) => env.sub(fj(j)(fr.mk(big(i))), env.mul(m, new Q(big(i)))), "plot", null).q);
      if (!c || !isFinite(c.x.n)) continue;
      // f − (m x + q) shrinks also away from the powers of 2 limit took
      const gap = (x) => quiet(() => Math.abs(env.sub(fj(j)(fr.mk(x)), env.add(env.mul(m, new Q(x)), c)).x.n));
      const g3 = gap(s * Math.PI * 1e3), g6 = gap(s * Math.PI * 1e6);
      if (g3 === null || g6 === null || !(g6 <= 0.75 * g3 || g6 <= 1e-9 * (Math.abs(c.x.n) + w))) continue;
      const p = [a, b].map((u) => [shown(fr.mk(u)), env.add(env.mul(m, new Q(u)), c)]);
      // the same line both ways
      const same = (o) => o.j === j && o.p.every((pt, i) => Math.abs(pt[1].x.n - p[i][1].x.n) <= 1e-9 * (Math.abs(p[i][1].x.n) + w));
      if (!out.some(same)) out.push({ j, p });
    }
  }
  return { v: v.map(([j, u]) => [j, shown(fr.mk(u))]), lines: lines ? out : null };
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

// sum(f(k), k, a, b): f at k = a, a + 1, …, b; a list f gives a list of
// sums. a can be -inf and b inf (see sumToInf)
function calcSum(env, f, limits, name) {
  const [a, b] = limits.map((q, i) => {
    const k = env.checkPure(q, `${name} (${i ? "last" : "first"} index)`).n;
    if (!Number.isInteger(k) && isFinite(k)) throw new CalcError(`${name}: the first and last index must be whole numbers`);
    return k;
  });
  if (a === Infinity || b === -Infinity) return new Q(0);
  if (!isFinite(a) && !isFinite(b)) {
    // both ways: k ≥ 0 and k ≤ −1
    return env.add(sumToInf(env, f, 0, name), sumToInf(env, (q) => f(env.neg(q)), 1, name));
  }
  if (b === Infinity) return sumToInf(env, f, a, name);
  if (a === -Infinity) return sumToInf(env, (q) => f(env.neg(q)), -b, name);
  if (b - a >= 100000) throw new CalcError(`${name}: at most 100000 terms`);
  let s = null;
  for (let k = a; k <= b; k++) {
    const t = f(new Q(k));
    s = s === null ? t : broadcast((x, y) => env.add(x, y), [s, t]);
  }
  return s === null ? new Q(0) : s;
}

// Σ t(k) for k = a, a + 1, … (t takes k as a quantity): the terms are added directly until they
// fall faster than geometrically and no longer count. Otherwise, from the
// first 1000 terms,
// - terms of one sign: Euler–Maclaurin, Σ_{k≥N} f(k) = ∫_N^∞ f dx + f(N)/2
//   − f′(N)/12 + …, which needs f between whole numbers; N = 500 and 1000
//   must agree;
// - alternating terms (or if that fails): Levin's u transform of the
//   partial sums, at the order where successive orders agree best;
// - signs that change irregularly, as sin(k)/k (or if that fails): Wynn's
//   ε algorithm on the partial sums, where neighbouring estimates agree.
// Terms that do not decrease (as k^−1 for terms of one sign) diverge.
// Errors propagate: the integral and derivative carry them, the Levin
// weights (from nominal values) combine the partial sums as quantities,
// and ε is differentiated along each error source (in Monte Carlo mode,
// applied to every sample).
const SUM_N = 1000;
function sumToInf(env, t, a, name) {
  const vals = [], partial = [];
  let s = null;
  const fail = (why) => new CalcError(`${name}: ${why}`);
  for (let i = 0; i < SUM_N; i++) {
    const q = t(new Q(a + i));
    if (Array.isArray(q)) throw new ListValue(q.length);
    const v = q.x.n;
    if (!isFinite(v)) throw fail(`the term at ${a + i} is not finite`);
    s = s === null ? q : env.add(s, q);
    vals.push(v);
    if (i < 60) partial.push(s);
    // fast convergence: the last 10 ratios at most 0.9, the term negligible
    if (i >= 10 && Math.abs(v) <= EPS * Math.abs(s.x.n) / 8) {
      let fast = true;
      for (let j = i - 9; j <= i && fast; j++) fast = Math.abs(vals[j]) <= 0.9 * Math.abs(vals[j - 1]);
      if (fast || vals.slice(i - 9).every((x) => x === 0)) return s;
    }
  }
  // the decay of the terms, as a power of k, from k − a ≈ 250 to 950 (the
  // mean size of the terms near there, for terms that oscillate)
  const top = (i) => vals.slice(i - 50, i + 50).reduce((t, v) => t + Math.abs(v), 0);
  const decay = Math.log(top(250) / top(SUM_N - 50)) / Math.log((a + SUM_N - 50) / (a + 250));
  const tail = vals.slice(SUM_N / 2);
  const oneSign = tail.every((v) => v > 0) || tail.every((v) => v < 0);
  const alternating = tail.every((v, i) => !i || sgn(v) * sgn(tail[i - 1]) < 0);
  if (!(decay > (oneSign ? 1.02 : 0.05))) throw fail("the terms do not decrease fast enough: the sum diverges (or converges too slowly)");

  if (oneSign) {
    try {
      // the sum from k = N on
      const em = (N) => {
        const r = env.add(calcIntegrate(env, t, [new Q(N), new Q(Infinity)], name), env.mul(t(new Q(N)), new Q(0.5)));
        return env.sub(r, env.mul(calcDiff(env, t, [new Q(N)], name), new Q(1 / 12)));
      };
      // the sums of the terms before N = a + 500 and a + 1000
      const N1 = a + SUM_N / 2, N2 = a + SUM_N;
      const e1 = nominally(() => em(N1).x.n), e2 = nominally(() => em(N2).x.n);
      let h1 = 0;
      for (let i = 0; i < SUM_N / 2; i++) h1 += vals[i];
      let h2 = h1;
      for (let i = SUM_N / 2; i < SUM_N; i++) h2 += vals[i];
      const scale = Math.abs(h2) + Math.abs(e2);
      if (Math.abs(h1 + e1 - (h2 + e2)) <= 1e-9 * scale) return env.add(s, em(N2));
    } catch (e) {
      if (!(e instanceof CalcError || e instanceof UnitError)) throw e;
    }
  }
  if (oneSign || alternating) {
    const r = levinSum(env, vals, partial);
    if (r) return r;
  }
  const r = epsSum(env, partial);
  if (r) return r;
  throw fail("no convergence (the sum may diverge)");
}


// Levin u transform of the partial sums (quantities) of the terms vals:
// L = Σ w_j s_j with w_j ∝ (−1)^j C(k, j) ((1 + j)/(1 + k))^(k−1) / ω_j,
// ω_j = (1 + j) t_j; null if no order converges
function levinSum(env, vals, partial) {
  const levin = (k) => {
    const w = [];
    let c = 1, sum = 0;
    for (let j = 0; j <= k; j++) {
      if (j) c = c * (k - j + 1) / j;
      const om = (1 + j) * vals[j];
      if (!om) return null;
      w.push(((j % 2 ? -1 : 1) * c * ((1 + j) / (1 + k)) ** (k - 1)) / om);
      sum += w[j];
    }
    let L = 0;
    for (let j = 0; j <= k; j++) { w[j] /= sum; L += w[j] * partial_n[j]; }
    return { w, L };
  };
  const partial_n = [];
  for (let j = 0, x = 0; j < partial.length; j++) partial_n.push((x += vals[j]));
  let best = null, prev = levin(4);
  for (let k = 5; k <= 30 && prev; k++) {
    const cur = levin(k);
    if (!cur) break;
    const d = Math.abs(cur.L - prev.L);
    if (!best || d < best.d) best = { d, ...cur };
    prev = cur;
  }
  const scale = Math.max(...partial_n.slice(0, 31).map(Math.abs));
  if (!best || !(best.d <= 1e-9 * scale)) return null;
  return best.w.map((w, j) => env.mul(partial[j], new Q(w))).reduce((x, y) => env.add(x, y));
}

// Wynn's ε algorithm: E[c + 1][n] is ε_c of S_n … S_(n+c), an estimate of
// the limit for even c
function epsTable(S, cmax) {
  const E = [new Array(S.length + 1).fill(0), S.slice()];
  for (let c = 1; c <= Math.min(cmax, S.length - 1); c++) {
    const prev = E[c - 1], cur = E[c], next = [];
    for (let n = 0; n + 1 < cur.length; n++) next.push(prev[n + 1] + 1 / (cur[n + 1] - cur[n]));
    E.push(next);
  }
  return E;
}

// The limit of the partial sums (quantities) by ε, where the neighbouring
// estimates agree best; null if none agree well enough
function epsSum(env, partial) {
  const S = partial.map((q) => q.x.n), CMAX = 24;
  const E = epsTable(S, CMAX);
  let best = null;
  for (let c = 2; c + 1 < E.length; c += 2) {
    const col = E[c + 1], lower = E[c - 1];
    for (let n = 1; n < col.length; n++) {
      const v = col[n];
      const err = Math.max(Math.abs(v - col[n - 1]), Math.abs(v - lower[n + 1]), Math.abs(v - lower[n + 2]));
      if (isFinite(v) && err < (best ? best.err : Infinity)) best = { v, err, c, n };
    }
  }
  const scale = Math.max(...S.map(Math.abs));
  if (!best || !(best.err <= 1e-9 * scale)) return null;
  // the same estimate of other partial sums: for the errors
  const { c, n } = best;
  const at = (xs) => epsTable(xs.slice(n, n + c + 1), c)[c + 1][0];
  const last = partial[n + c];
  let cmap = null;
  const ids = new Set(partial.slice(n, n + c + 1).flatMap((q) => (q.x.c ? [...q.x.c.keys()] : [])));
  for (const id of ids) {
    const d = S.map((_, j) => (partial[j].x.c && partial[j].x.c.get(id)) || 0);
    const size = Math.max(...d.map(Math.abs));
    if (!size) continue;
    const eta = 1e-6 * scale / size;
    const g = (at(S.map((x, j) => x + eta * d[j])) - at(S.map((x, j) => x - eta * d[j]))) / (2 * eta);
    if (isFinite(g)) (cmap = cmap || new Map()).set(id, g);
  }
  let samples = null;
  const ss = MC.on ? partial.map((q) => q.x.samples()) : [];
  if (ss.some(Boolean)) {
    samples = new Float64Array(MC.N);
    for (let i = 0; i < MC.N; i++) {
      const v = at(S.map((x, j) => (ss[j] ? ss[j][i] : x)));
      samples[i] = isFinite(v) ? v : best.v;
    }
  }
  return new Q(new UNum(best.v, cmap, samples), last.d, last.zero, last.show);
}

// limit(f(x), x, x0): the limit for x → x0, from both sides; limit(f(x),
// x, x0, 1) from above, limit(f(x), x, x0, -1) from below; x0 can be ±inf.
// f is evaluated at x0 ± h for h = h0/2^i (at ±2^i towards ±inf) and
// extrapolated to h = 0 by Richardson's method (as for a series in h), as
// long as rounding has not taken over, by Wynn's ε algorithm (for powers
// of h that are not whole), and as a polynomial in 1/i (for values that
// settle as slowly as 1/log h); the estimate whose
// neighbours in the tables agree best is taken. The Richardson weights
// (from the nominal values) combine the values as quantities, so errors
// propagate; an ε estimate takes the errors of the value closest to the
// point. Two sides must agree; a side where f is not defined is left out.
function calcLimit(env, f, limits, name) {
  const [x0, side] = limits;
  let dir = 0;
  if (side) {
    const v = env.checkPure(side, `${name} (side)`).n;
    if (!v || !isFinite(v)) throw new CalcError(`${name}: the side is 1 (from above) or -1 (from below)`);
    dir = sgn(v);
  }
  const inf = !isFinite(x0.x.n);
  if (inf) {
    if (isNaN(x0.x.n)) throw new CalcError(`${name}: the point is not a number`);
    if (dir && dir === sgn(x0.x.n)) throw new CalcError(`${name}: ${x0.x.n > 0 ? "inf" : "-inf"} can only be approached from ${x0.x.n > 0 ? "below" : "above"}`);
    const s = sgn(x0.x.n);
    return oneSide(env, (i) => f(new Q(new UNum(s * 2 ** i), x0.d)), name, null).q;
  }
  const fr = varFrame(env, [x0], name);
  const u0 = fr.us[0];
  const h0 = 0.1 * (Math.abs(u0.n) || 1);
  const hmin = 2 ** 20 * EPS * Math.abs(u0.n);
  const at = (d) => (i) => (h0 / 2 ** i >= hmin ? f(fr.mk(u0.add(d * h0 / 2 ** i))) : null);
  if (dir) return oneSide(env, at(dir), name, null).q;
  const up = oneSide(env, at(1), name, "above"), down = oneSide(env, at(-1), name, "below");
  if (!up.defined && !down.defined) throw up.error || down.error || new CalcError(`${name}: the expression is not defined near the point`);
  if (!up.defined) return down.q;
  if (!down.defined) return up.q;
  if (up.v === down.v && !isFinite(up.v)) return up.q;
  if (!isFinite(up.v) || !isFinite(down.v)) {
    throw new CalcError(`${name}: the limits from the two sides differ: ${env.format(down.q)} from below, ${env.format(up.q)} from above`);
  }
  const tol = Math.max(1e3 * (up.err + down.err), 1e-8 * Math.max(Math.abs(up.v), Math.abs(down.v)));
  if (!(Math.abs(up.v - down.v) <= tol)) {
    throw new CalcError(`${name}: the limits from the two sides differ: ${env.format(down.q)} from below, ${env.format(up.q)} from above`);
  }
  return env.mul(env.add(up.q, down.q), new Q(0.5));
}

// The limit of the values at(0), at(1), … (at(i) is null when the steps
// are too small): {q, v, err, defined}
function oneSide(env, at, name, which, inverse = false) {
  const COLS = 8, ROWS = 60;
  const qs = [], T = [], W = [], P = [], PW = [];
  let best = null, start = 0, error = null;
  // an estimate is good when its error is small against the values it
  // combines, or (a limit 0) when those values are negligible against the
  // earlier ones
  const mag = (m) => (qs[m] ? Math.abs(qs[m].x.n) : 0);
  const good = (e) => {
    if (!e) return false;
    let win = 0, last = 0, pre = 0;
    for (const m of e.w.keys()) { win = Math.max(win, mag(m)); last = Math.max(last, m); }
    for (let m = 0; m <= last; m++) pre = Math.max(pre, mag(m));
    e.zero = (win <= 1e-10 * pre && e.err <= 1e-10 * pre) || (Math.abs(e.v) <= 1e-12 * pre && e.err <= 1e-8 * Math.max(win, Math.abs(e.v)));
    return e.err <= 1e-8 * Math.max(Math.abs(e.v), win) || e.zero;
  };
  for (let i = 0; i < ROWS; i++) {
    let q;
    try {
      q = at(i);
    } catch (e) {
      if (!(e instanceof CalcError || e instanceof UnitError)) throw e;
      error = error || e;
      q = undefined;
    }
    if (q === null) break;
    if (q !== undefined && !(q instanceof Q)) throw new CalcError(`${name}: the expression is not a quantity`);
    if (q === undefined || !isFinite(q.x.n)) {
      // not defined here: a fresh table from the next value on
      qs.push(null); T.push(null); W.push(null); P.push(null); PW.push(null);
      start = i + 1;
      continue;
    }
    qs.push(q);
    const row = [q.x.n], wrow = [new Map([[i, 1]])];
    let rowErr = Infinity;
    for (let j = 1; j <= Math.min(i - start, COLS); j++) {
      const k = 2 ** j - 1, a = row[j - 1], b = T[i - 1][j - 1];
      row.push(a + (a - b) / k);
      const w = new Map(wrow[j - 1]);
      for (const [m, c] of w) w.set(m, c * (1 + 1 / k));
      for (const [m, c] of W[i - 1][j - 1]) w.set(m, (w.get(m) || 0) - c / k);
      wrow.push(w);
      // against its neighbours in the table: left, up-left and up
      const up = j < T[i - 1].length ? Math.abs(row[j] - T[i - 1][j]) : Infinity;
      const err = Math.max(Math.abs(row[j] - row[j - 1]), Math.abs(row[j] - b), up);
      rowErr = Math.min(rowErr, err);
      if (!best || err < best.err) best = { v: row[j], w, err };
    }
    T.push(row);
    W.push(wrow);
    // polynomial extrapolation in u = 1/(i + 1), to u = 0 (Neville), for
    // values that settle as a series in 1/i, as 1/log(h) does
    const prow = [q.x.n], pwrow = [new Map([[i, 1]])];
    for (let j = 1; j <= Math.min(i - start, 12); j++) {
      const um = 1 / (i - j + 1), un = 1 / (i + 1), a = prow[j - 1], b = P[i - 1][j - 1];
      // P(0) = (u_m P_(m+1..n) − u_n P_(m..n−1)) / (u_m − u_n)
      const ca = um / (um - un), cb = -un / (um - un);
      prow.push(ca * a + cb * b);
      const w = new Map();
      for (const [m, c] of pwrow[j - 1]) w.set(m, c * ca);
      for (const [m, c] of PW[i - 1][j - 1]) w.set(m, (w.get(m) || 0) + c * cb);
      pwrow.push(w);
      const up = j < P[i - 1].length ? Math.abs(prow[j] - P[i - 1][j]) : Infinity;
      const err = Math.max(Math.abs(prow[j] - prow[j - 1]), Math.abs(prow[j] - b), up);
      if (!best || err < best.err) best = { v: prow[j], w, err };
    }
    P.push(prow);
    PW.push(pwrow);
    // rounding has taken over: the table no longer improves
    if (rowErr > 1e3 * best?.err && good(best)) break;
  }
  if (!qs.some(Boolean)) {
    if (which) return { defined: false, error };
    throw error || new CalcError(`${name}: the expression is not defined near the point`);
  }
  // Wynn's ε on the last run of defined values: E[c][n] uses s_n … s_(n+c)
  const s0 = start, sv = qs.slice(s0).map((q) => q.x.n), L = sv.length;
  if (L >= 5) {
    const E = [new Array(L + 1).fill(0), sv.slice()];
    for (let c = 1; c <= Math.min(12, L - 1); c++) {
      const prev = E[c - 1], cur = E[c], next = [];
      for (let n = 0; n + c < L; n++) next.push(prev[n + 1] + 1 / (cur[n + 1] - cur[n]));
      E.push(next);
    }
    // even columns c = 2, 4, … (E[c + 1]) are estimates
    for (let c = 2; c + 1 < E.length; c += 2) {
      const col = E[c + 1], lower = E[c - 1];
      for (let n = 1; n < col.length; n++) {
        const v = col[n];
        if (!isFinite(v)) continue;
        const err = Math.max(Math.abs(v - col[n - 1]), Math.abs(v - lower[n + 1]), Math.abs(v - lower[n + 2]));
        if (!(err < (best ? best.err : Infinity))) continue;
        // only for converging values: a diverging geometric sequence has an ε "antilimit"
        if (!(Math.abs(sv[n + c] - sv[n + c - 1]) < Math.abs(sv[n + 1] - sv[n]))) continue;
        const last = s0 + n + c;
        best = { v, err, w: new Map([[last, 1]]), eps: true };
        for (let m = s0 + n; m <= last; m++) best.w.set(m, best.w.get(m) || 0);
      }
    }
  }
  const from = which ? ` from ${which}` : "";
  if (!good(best)) {
    // f → ±∞ where 1/f → 0 and f keeps its sign
    if (!inverse) {
      let r = null;
      try {
        r = oneSide(env, (i) => { const q = at(i); return q instanceof Q ? env.div(new Q(1), q) : q; }, name, which, true);
      } catch (e) {
        if (!(e instanceof CalcError || e instanceof UnitError)) throw e;
      }
      if (r && r.defined && r.v === 0) {
        const tail = qs.filter(Boolean).slice(-10).map((q) => sgn(q.x.n));
        const last = qs.filter(Boolean).at(-1);
        if (tail.every((x) => x === tail[0]) && tail[0]) {
          const v = tail[0] * Infinity;
          return { q: new Q(new UNum(v), last.d, last.zero, last.show), v, err: 0, defined: true };
        }
        throw new CalcError(`${name}: no limit${from}: the expression grows without bound, with changing sign`);
      }
    }
    throw new CalcError(`${name}: no limit found${from} (the expression may diverge or oscillate)`);
  }
  let q;
  if (best.eps) {
    // the value, with the errors of f nearest to the point
    const near = qs[Math.max(...best.w.keys())];
    q = env.add(env.sub(near, new Q(new UNum(near.x.n), near.d, near.zero)), new Q(new UNum(best.v), near.d, near.zero));
  } else {
    q = [...best.w].map(([m, c]) => env.mul(qs[m], new Q(c))).reduce((x, y) => env.add(x, y));
  }
  // indistinguishable from zero
  if (best.zero || Math.abs(best.v) <= 4 * best.err) q = env.mul(q, new Q(0));
  return { q, v: q.x.n, err: best.err, defined: true };
}

// ---------------------------------------------------------------------
// Polynomial roots: polyroots((a0, a1, …, an)) gives the n roots of
// a0 + a1 x + … + an x^n as a table of real and imaginary parts. The
// coefficients can have units, consistent with a single unit for x.
// Roots are found by Aberth's method in complex arithmetic; errors
// propagate as dz = −Σ z^k da_k / p′(z), and in Monte Carlo mode every
// sample is solved again starting from the nominal roots. Multiple roots
// have no linear errors (use Monte Carlo).

// p(z) and p'(z) by Horner's rule, for real coefficients a (ascending)
function polyAt(a, zr, zi) {
  let pr = a[a.length - 1], pi = 0, dr = 0, di = 0;
  for (let k = a.length - 2; k >= 0; k--) {
    const tr = dr * zr - di * zi + pr, ti = dr * zi + di * zr + pi;
    dr = tr; di = ti;
    const ur = pr * zr - pi * zi + a[k], ui = pr * zi + pi * zr;
    pr = ur; pi = ui;
  }
  return [pr, pi, dr, di];
}

// Aberth–Ehrlich iteration from the starting roots zs ([re, im] pairs), in
// place; false if the steps do not become small
function aberth(a, zs, maxIt = 500) {
  const n = zs.length;
  let worst = Infinity;
  for (let it = 0; it < maxIt; it++) {
    worst = 0;
    for (let i = 0; i < n; i++) {
      const [zr, zi] = zs[i];
      const [pr, pi, dr, di] = polyAt(a, zr, zi);
      if (pr === 0 && pi === 0) continue;
      // ratio = p / p'
      const dd = dr * dr + di * di;
      if (!dd) { zs[i] = [zr + 1e-8 * (1 + Math.abs(zr)), zi + 1e-8]; worst = Infinity; continue; }
      const rr = (pr * dr + pi * di) / dd, ri = (pi * dr - pr * di) / dd;
      // s = Σ 1/(z_i − z_j)
      let sr = 0, si = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const xr = zr - zs[j][0], xi = zi - zs[j][1], xx = xr * xr + xi * xi;
        if (xx) { sr += xr / xx; si -= xi / xx; }
      }
      // w = ratio / (1 − ratio s)
      const qr = 1 - (rr * sr - ri * si), qi = -(rr * si + ri * sr), qq = qr * qr + qi * qi;
      const wr = (rr * qr + ri * qi) / qq, wi = (ri * qr - rr * qi) / qq;
      if (!isFinite(wr) || !isFinite(wi)) continue;
      zs[i] = [zr - wr, zi - wi];
      worst = Math.max(worst, Math.hypot(wr, wi) / (Math.hypot(zr, zi) || 1e-300));
    }
    if (worst <= 1e-14) return true;
  }
  return worst <= 1e-7;
}

function polyRoots(env, args) {
  const name = "polyroots";
  const cs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (cs.some((c) => !(c instanceof Q))) throw new CalcError(`${name}: the coefficients must be quantities, as polyroots((a0, a1, a2))`);
  const zero = (q) => q.x.n === 0 && q.x.exact;
  let lo = 0, hi = cs.length - 1;
  while (hi >= 0 && zero(cs[hi])) hi--;
  while (lo < hi && zero(cs[lo])) lo++;
  if (hi - lo < 1) throw new CalcError(`${name}: the polynomial has no roots; give the coefficients from a0 up, as polyroots((-2, 0, 1)) for x^2 − 2`);
  if (hi > 100) throw new CalcError(`${name}: at most degree 100`);
  const q = cs.map((c) => c.relative());
  // units of x from the lowest and highest coefficients
  const dx = dimScale(dimAdd(q[lo].d, q[hi].d, -1), 1 / (hi - lo));
  for (let k = lo; k <= hi; k++) {
    if (!zero(q[k]) && !dimEq(q[k].d, dimAdd(q[hi].d, dx, hi - k))) {
      throw new CalcError(`${name}: the coefficients do not have consistent units (a_k must have the units of a_n x^(n−k))`);
    }
  }
  const coef = (pick) => q.slice(lo, hi + 1).map(pick);
  const a = coef((c) => c.x.n);
  if (!(a[a.length - 1] !== 0) || a.some((v) => !isFinite(v))) throw new CalcError(`${name}: the coefficients must be finite, the last one not zero`);
  const n = a.length - 1;

  // start on a circle of the size of the roots (Fujiwara's bound)
  let r = 0;
  for (let k = 0; k < n; k++) r = Math.max(r, Math.abs(a[k] / a[n]) ** (1 / (n - k)));
  r = r || 1;
  const zs = Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n + 0.4;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  if (!aberth(a, zs)) throw new CalcError(`${name}: no convergence`);

  // a root of multiplicity m comes out as a cluster of m nearby roots
  // (about ε^(1/m) apart): where p, p′, … p^(m−2) vanish to rounding at
  // the root of p^(m−1) next to them, they are replaced by that root
  const size = Math.max(...zs.map(([x, y]) => Math.hypot(x, y)), 1e-300);
  const group = zs.map((_, i) => i);
  const top = (i) => (group[i] === i ? i : (group[i] = top(group[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(zs[i][0] - zs[j][0], zs[i][1] - zs[j][1]);
      if (d <= 1e-2 * Math.max(Math.hypot(...zs[i]), Math.hypot(...zs[j]), 1e-9 * size)) group[top(j)] = top(i);
    }
  }
  const derivs = [a];
  for (let k = 1; k < n; k++) derivs.push(derivs[k - 1].slice(1).map((c, i) => c * (i + 1)));
  const absAt = (c, r) => c.reduceRight((t, x) => t * r + Math.abs(x), 0);
  const multiple = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const m = zs.map((_, j) => j).filter((j) => top(j) === top(i));
    if (m.length < 2 || m[0] !== i) continue;
    let re = m.reduce((t, j) => t + zs[j][0], 0) / m.length, im = m.reduce((t, j) => t + zs[j][1], 0) / m.length;
    // Newton on p^(m−1), which has a simple root there
    const q = derivs[m.length - 1];
    for (let it = 0; it < 20; it++) {
      const [pr, pi, dr, di] = polyAt(q, re, im);
      const dd = dr * dr + di * di;
      if (!dd) break;
      const wr = (pr * dr + pi * di) / dd, wi = (pi * dr - pr * di) / dd;
      re -= wr; im -= wi;
      if (Math.hypot(wr, wi) <= 4 * EPS * Math.hypot(re, im)) break;
    }
    const r = Math.hypot(re, im);
    const ok = derivs.slice(0, m.length - 1).every((c) => Math.hypot(...polyAt(c, re, im).slice(0, 2)) <= 1e3 * EPS * absAt(c, r));
    if (!ok) continue;
    if (Math.abs(im) <= 1e-12 * r) im = 0;
    for (const j of m) { zs[j] = [re, im]; multiple[j] = true; }
  }
  zs.forEach((z, i) => z.push(multiple[i]));

  // tidy: nearly real roots made real, complex pairs exact conjugates
  for (const z of zs) if (Math.abs(z[1]) <= 1e-12 * Math.max(Math.hypot(z[0], z[1]), size * 1e-3)) z[1] = 0;
  zs.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const used = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (used[i] || zs[i][1] >= 0) continue;
    let best = -1;
    for (let j = 0; j < n; j++) {
      if (!used[j] && j !== i && zs[j][1] > 0 && (best < 0 || Math.hypot(zs[j][0] - zs[i][0], zs[j][1] + zs[i][1]) < Math.hypot(zs[best][0] - zs[i][0], zs[best][1] + zs[i][1]))) best = j;
    }
    if (best < 0) continue;
    const re = (zs[i][0] + zs[best][0]) / 2, im = (zs[best][1] - zs[i][1]) / 2;
    zs[i] = [re, -im, zs[i][2]];
    zs[best] = [re, im, zs[best][2]];
    used[i] = used[best] = true;
  }
  // order: by real part, + imaginary part first in a pair
  zs.sort((u, v) => u[0] - v[0] || v[1] - u[1]);

  // linear errors: dz = −Σ z^k da_k / p′(z)
  const cmaps = coef((c) => c.x.c);
  const lin = (zr, zi, mult) => {
    const [, , dr, di] = polyAt(a, zr, zi);
    if (mult || !(dr || di)) return [null, null];
    const cr = new Map(), ci = new Map();
    const dd = dr * dr + di * di;
    let wr = 1, wi = 0;
    for (let k = 0; k <= n; k++) {
      // −z^k / p′
      const fr = -(wr * dr + wi * di) / dd, fi = -(wi * dr - wr * di) / dd;
      if (cmaps[k]) {
        for (const [id, v] of cmaps[k]) {
          cr.set(id, (cr.get(id) || 0) + v * fr);
          ci.set(id, (ci.get(id) || 0) + v * fi);
        }
      }
      [wr, wi] = [wr * zr - wi * zi, wr * zi + wi * zr];
    }
    return [cr, ci];
  };
  const roots = zs.map(([zr, zi, mult]) => {
    const [cr, ci] = lin(zr, zi, mult);
    return [new UNum(zr, cr), new UNum(zi, zi === 0 && ci && [...ci.values()].every((v) => Math.abs(v) < 1e-300) ? null : ci)];
  });

  // Monte Carlo: every sample from the nominal roots
  const samples = MC.on ? coef((c) => c.x.samples()) : [];
  if (samples.some(Boolean)) {
    const N = MC.N;
    const sr = roots.map(() => new Float64Array(N)), si = roots.map(() => new Float64Array(N));
    const ak = new Array(n + 1);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k <= n; k++) ak[k] = samples[k] ? samples[k][i] : a[k];
      // a multiple root splits: its copies start a little apart
      const z = zs.map(([x, y, m], j) => (m ? [x + 1e-4 * size * Math.cos(j), y + 1e-4 * size * Math.sin(j)] : [x, y]));
      aberth(ak, z, 100);
      for (let j = 0; j < n; j++) {
        sr[j][i] = z[j][0];
        si[j][i] = Math.abs(z[j][1]) <= 1e-12 * Math.hypot(z[j][0], z[j][1]) ? 0 : z[j][1];
      }
    }
    roots.forEach(([x, y], j) => { x.s = sr[j]; y.s = si[j]; });
  }
  // the roots at 0 from the coefficients left out at the start
  const zeros = Array.from({ length: lo }, () => [new UNum(0), new UNum(0)]);
  const all = [...zeros, ...roots].sort((u, v) => u[0].n - v[0].n || v[1].n - u[1].n);
  return [all.map(([x]) => new Q(x, dx)), all.map(([, y]) => new Q(y, dx))];
}

const CALCULUS_FNS = { solve: calcSolve, roots: calcRoots, limit: calcLimit, integrate: calcIntegrate, diff: calcDiff, sum: calcSum };

function firstLine(doc) {
  return (doc || "").split("\n")[0];
}

export { CalcError, ConstDict, normalize, splitComment, splitSpec, tokenize, parse, functionDocs, Interpreter, firstLine, PlotData };
