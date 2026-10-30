// Physical quantities, units, prefixes and unit systems.
//
// This is a JavaScript port of the core of imks (units.py): a quantity (Q)
// is a number times a vector of exponents of the base units; an optional
// zero point makes the quantity "absolute" (e.g. temperatures); an optional
// display specification (set by the @ operator) controls how it is shown.

import { UNum, formatUNum } from "./unum.js";

class UnitError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "UnitError";
  }
}

// ---------------------------------------------------------------------
// Dimension vectors (arrays of exponents, missing entries are zero)

const EPS = 1e-9;

function dimGet(d, i) {
  return i < d.length ? d[i] : 0;
}

function dimAdd(a, b, k = 1) {
  const n = Math.max(a.length, b.length);
  const r = new Array(n);
  for (let i = 0; i < n; i++) r[i] = dimGet(a, i) + k * dimGet(b, i);
  return r;
}

function dimScale(a, k) {
  return a.map((x) => x * k);
}

function dimIsZero(a) {
  return a.every((x) => Math.abs(x) < EPS);
}

function dimEq(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (Math.abs(dimGet(a, i) - dimGet(b, i)) > EPS) return false;
  return true;
}

// ---------------------------------------------------------------------
// Small linear algebra helpers

function det(m) {
  const n = m.length;
  const a = m.map((r) => r.slice());
  let d = 1;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (Math.abs(a[p][i]) < 1e-14) return 0;
    if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; d = -d; }
    d *= a[i][i];
    for (let r = i + 1; r < n; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
    }
  }
  return d;
}

// Solve a x = b for square a; returns null if singular
function solve(a, b) {
  const n = a.length;
  const m = a.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    if (Math.abs(m[p][i]) < 1e-12) return null;
    [m[p], m[i]] = [m[i], m[p]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = m[r][i] / m[i][i];
      if (f) for (let c = i; c <= n; c++) m[r][c] -= f * m[i][c];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}

// Gram matrix of a set of row vectors
function gram(rows) {
  return rows.map((a) => rows.map((b) => a.reduce((s, x, i) => s + x * b[i], 0)));
}

// Least squares solution of sum_j x_j cols[j] = b; returns {x, residual}
function lstsq(cols, b) {
  const g = gram(cols);
  const rhs = cols.map((c) => c.reduce((s, x, i) => s + x * b[i], 0));
  const x = solve(g, rhs);
  if (!x) return null;
  let residual = 0;
  for (let i = 0; i < b.length; i++) {
    let r = b[i];
    for (let j = 0; j < cols.length; j++) r -= x[j] * cols[j][i];
    residual += r * r;
  }
  return { x, residual };
}

function* combinations(n, k, start = 0, prefix = []) {
  if (prefix.length === k) { yield prefix; return; }
  for (let i = start; i <= n - (k - prefix.length); i++) {
    yield* combinations(n, k, i + 1, [...prefix, i]);
  }
}

// Snap a floating exponent to a nearby simple fraction
function snap(e) {
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(e * q);
    if (Math.abs(e * q - p) < 1e-7) return p / q;
  }
  return e;
}

// Convert a number into a fraction [p, q]
function fraction(x, maxDen = 1000) {
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let y = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(y);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > maxDen) { h1 = h0; k1 = k0; break; }
    if (Math.abs(x - h1 / k1) < 1e-9) break;
    y = 1 / (y - a);
    if (!isFinite(y)) break;
  }
  return [h1, k1];
}

// ---------------------------------------------------------------------
// Quantities

class Q {
  constructor(x, d = [], zero = false, show = null) {
    this.x = UNum.of(x);   // value in base units
    this.d = d;            // dimension vector
    this.zero = zero;      // false (relative) or zero-point offset
    this.show = show;      // display specification (see convert)
    this.doc = "";
  }

  get pure() {
    return dimIsZero(this.d);
  }

  plain() {
    return new Q(this.x, this.d, this.zero);
  }

  withDoc(doc) {
    const q = new Q(this.x, this.d, this.zero, this.show);
    q.doc = doc;
    return q;
  }

  // Value relative to the true zero (makes absolute quantities relative)
  relative() {
    if (this.zero === false) return this;
    return new Q(this.x.add(this.zero), this.d);
  }
}

// ---------------------------------------------------------------------
// The unit environment

const currencySymbols = {
  EUR: "€", GBP: "£", JPY: "¥", USD: "$", INR: "₹", KRW: "₩", ILS: "₪",
  NGN: "₦", PHP: "₱", PLN: "zł", THB: "฿", UAH: "₴", VND: "₫", CRC: "₡",
  GHS: "₵", LAK: "₭", MNT: "₮", PYG: "₲", CZK: "Kč", TRY: "₺", RUB: "₽",
};

const symbolChars = [...new Set(Object.values(currencySymbols))]
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(/[$]/g, "\\$"));

// A unit name: letters (possibly separated by dashes), a degree sign
// followed by letters, or a currency symbol.  Digits are not allowed.
const symbolSource = "°[\\p{L}_]*|" + symbolChars.join("|");
const unitNameSource = "(?:[\\p{L}_]+(?:-[\\p{L}_]+)*|" + symbolSource + ")";
const unitNameRe = new RegExp("^" + unitNameSource, "u");

class Env {
  constructor() {
    this.reset();
  }

  reset() {
    this.baseunits = [];
    this.units = new Map();      // name -> Q (with doc)
    this.prefixes = new Map();   // name -> {x: UNum, doc}
    this.systems = new Map();    // name -> {args, doc}
    this.formats = new Map();    // name -> {fn, doc}
    this.vars = new Map();       // user namespace (Q, functions, objects)
    this.defaultsystem = null;   // list of args
    this.prefixonly = true;
    this.sortunits = true;
    this.tolerant = true;
    this.digits = 15;
    this.showErrors = true;
    this.utc = false;            // dates on the UTC wall clock instead of the local one
    this.dateText = null;        // (q, plain) → text of an absolute time, set by addDates
    this.location = null;        // [latitude, longitude] in degrees, for sunrise(t)…
    this.afterSunset = null;     // (t, start of day) → bool, set by skyBuiltins
    this.readings = new Map();   // the last sensor readings by variable (here, tilt…), set by the app
    this.version = 0;
    this.prefixes.set("", { x: new UNum(1), doc: "" });
  }

  touch() {
    this.version++;
  }

  // -------------------------------------------------------------------
  // Definitions

  newbaseunit(name, doc = "") {
    if (this.baseunits.includes(name)) throw new UnitError(`Base unit ${name} already defined`);
    this.baseunits.push(name);
    const d = new Array(this.baseunits.length).fill(0);
    d[d.length - 1] = 1;
    this.units.set(name, new Q(1, d).withDoc(doc));
    this.touch();
  }

  newprefix(name, value, doc = "") {
    const q = value instanceof Q ? value : new Q(value);
    if (!q.pure) throw new UnitError(`Prefix ${name} must be a pure number`);
    this.prefixes.set(name, { x: q.x, doc });
    this.touch();
  }

  newunit(name, value, doc = "") {
    let q;
    if (Array.isArray(value)) {
      if (value.length !== 2) throw new UnitError(`The absolute unit ${name} is not a 2-tuple`);
      const [z, v] = value.map((t) => (t instanceof Q ? t : new Q(t)));
      this.checkCompatible(z, v);
      q = new Q(v.x, v.d, z.x.n);
    } else {
      q = value instanceof Q ? new Q(value.x, value.d, value.zero) : new Q(value);
    }
    this.units.set(name, q.withDoc(doc));
    this.touch();
  }

  newsystem(name, args, doc = "") {
    this.systems.set(name, { args: this.expandSystem(args), doc });
    this.touch();
  }

  // Expand system names within a list of @-arguments
  expandSystem(args) {
    const out = [];
    for (const raw of args) {
      const sarg = raw.trim().replace(/^\[|\]$/g, "").trim();
      if (!sarg) continue;
      const ssarg = sarg.replace(/^\*+|\*+$/g, "");
      let name = ssarg, quote = "";
      if (ssarg.length > 1 && (ssarg[0] === '"' || ssarg[0] === "'") &&
          ssarg[0] === ssarg.at(-1) && !ssarg.slice(1, -1).includes(ssarg[0])) {
        name = ssarg.slice(1, -1);
        quote = ssarg[0];
      }
      const sys = this.systems.get(name);
      if (sys) {
        let tmp = sys.args;
        if (quote === "'") tmp = tmp.map((a) => a.replaceAll('"', "'"));
        if (quote === '"') tmp = tmp.map((a) => a.replaceAll("'", '"'));
        out.push(...tmp);
        if (sarg[0] === "*" || sarg.at(-1) === "*") out.push("*");
      } else {
        out.push(sarg);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------
  // Unit lookup

  // Split a unit name into [prefix, unit]; returns null if not a unit
  isunit(name) {
    if (this.units.has(name)) return ["", name];
    if (this.prefixonly && name && this.prefixes.has(name)) return [name, ""];
    if (name.endsWith("*") && this.prefixes.has(name.slice(0, -1))) return [name.slice(0, -1), ""];
    for (const k of this.prefixes.keys()) {
      if (k && name.startsWith(k) && this.units.has(name.slice(k.length))) {
        return [k, name.slice(k.length)];
      }
    }
    return null;
  }

  unitValue(name) {
    const iu = this.isunit(name);
    if (!iu) throw new UnitError(`Unknown unit '${name}'`);
    const [p, u] = iu;
    const px = this.prefixes.get(p).x;
    if (!u) return new Q(px);
    const uq = this.units.get(u);
    return new Q(px.mul(uq.x), uq.d, uq.zero);
  }

  varValue(name) {
    let v = this.vars.get(name);
    if (v && v.lazy) v = v.lazy();
    if (v instanceof Q) return v;
    if (typeof v === "number") return new Q(v);
    throw new UnitError(`Unknown variable '${name}' in unit`);
  }

  // -------------------------------------------------------------------
  // Unit algebra (used to build values of unit specifications: zero
  // points survive only for a lone unit, as in imks)

  umul(a, b) {
    let zero = false;
    if (b.pure) zero = a.zero;
    else if (a.pure) zero = b.zero;
    return new Q(a.x.mul(b.x), dimAdd(a.d, b.d), zero);
  }

  upow(a, e) {
    if (e === 1) return a;
    return new Q(a.x.pow(e), dimScale(a.d, e));
  }

  // Value represented by a unit tree
  treeValue(tree) {
    let r = new Q(1);
    for (const [u, e] of tree) {
      if (Math.abs(e) < EPS) continue;
      let x;
      if (Array.isArray(u)) x = this.treeValue(u);
      else if (u[0] === '"' || u[0] === "'") x = this.varValue(u.slice(1, -1));
      else x = this.unitValue(u);
      r = this.umul(r, this.upow(x, e));
    }
    return r;
  }

  // -------------------------------------------------------------------
  // Parsing of unit specifications, e.g. "kg m/s^2", "m/(s K)", "'c' s"

  parseUnit(spec) {
    const toks = this.lexUnit(spec);
    let pos = 0;
    const peek = () => toks[pos];
    const next = () => toks[pos++];
    const expect = (t) => {
      const k = next();
      if (!k || k.t !== t) throw new UnitError(`Syntax error in unit [${spec}]`);
      return k;
    };
    const isNum = (k) => k && k.t === "num";

    const treePow = (tree, f) => {
      if (tree.length === 1 && tree[0][1] === 1) return [[tree[0][0], f]];
      if (f === 1) return tree;
      return [[tree, f]];
    };

    const exponent = () => {
      const k = peek();
      if (k && k.t === "(") {
        next();
        const e = exponent();
        expect(")");
        return e;
      }
      const n = expect("num").v;
      if (peek() && peek().t === "numdiv") {
        next();
        return n / expect("num").v;
      }
      return n;
    };

    const atom = () => {
      const k = next();
      if (!k) throw new UnitError(`Incomplete unit [${spec}]`);
      if (k.t === "unit") {
        const iu = this.isunit(k.v);
        if (!iu) throw new UnitError(`Unknown unit '${k.v}'`);
        return { q: this.unitValue(k.v), tree: [[iu[0] + iu[1], 1]] };
      }
      if (k.t === "quoted") {
        return { q: this.varValue(k.v.slice(1, -1)), tree: [[k.v, 1]] };
      }
      if (k.t === "(") {
        const r = expr();
        expect(")");
        return r;
      }
      throw new UnitError(`Syntax error in unit [${spec}]`);
    };

    const factor = () => {
      let r = atom();
      for (;;) {
        const k = peek();
        let e;
        if (k && k.t === "^") { next(); e = exponent(); }
        else if (isNum(k)) { next(); e = k.v; }
        else break;
        r = { q: this.upow(r.q, e), tree: treePow(r.tree, e) };
      }
      return r;
    };

    const startsFactor = (k) => k && (k.t === "unit" || k.t === "quoted" || k.t === "(");

    const term = () => {
      let r = factor();
      for (;;) {
        const k = peek();
        if (k && k.t === ".") next();
        else if (!startsFactor(k)) break;
        const f = factor();
        r = { q: this.umul(r.q, f.q), tree: [...r.tree, ...f.tree] };
      }
      return r;
    };

    const expr = () => {
      let r = term();
      while (peek() && peek().t === "/") {
        next();
        const f = term();
        r = {
          q: new Q(r.q.x.div(f.q.x), dimAdd(r.q.d, f.q.d, -1)),
          tree: [...r.tree, ...f.tree.map(([u, e]) => [u, -e])],
        };
      }
      return r;
    };

    if (!toks.length) return { q: new Q(1), tree: [] };
    const r = expr();
    if (pos < toks.length) throw new UnitError(`Syntax error in unit [${spec}]`);
    return r;
  }

  lexUnit(spec) {
    const toks = [];
    let i = 0;
    const s = spec;
    while (i < s.length) {
      const c = s[i];
      if (c === " " || c === "\t" || c === "*" || c === "·") { i++; continue; }
      let m;
      if ((m = /^[-+]?\d+(\.\d+)?/.exec(s.slice(i)))) {
        toks.push({ t: "num", v: Number(m[0]) });
        i += m[0].length;
        continue;
      }
      if (c === "/") {
        toks.push({ t: /^\/\s*\d/.test(s.slice(i)) && toks.length && toks.at(-1).t === "num" ? "numdiv" : "/" });
        i++;
        continue;
      }
      if ("^().".includes(c)) {
        toks.push({ t: c });
        i++;
        continue;
      }
      if (c === "'" || c === '"') {
        const j = s.indexOf(c, i + 1);
        if (j < 0) throw new UnitError(`Unterminated quote in unit [${spec}]`);
        toks.push({ t: "quoted", v: s.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
      if ((m = unitNameRe.exec(s.slice(i)))) {
        toks.push({ t: "unit", v: m[0] });
        i += m[0].length;
        continue;
      }
      throw new UnitError(`Illegal character '${c}' in unit [${spec}]`);
    }
    return toks;
  }

  // Q for a unit specification
  unit(spec) {
    return this.parseUnit(spec).q;
  }

  // -------------------------------------------------------------------
  // Physical arithmetic (zero points are taken into account)

  dimString(d) {
    const parts = [];
    for (let i = 0; i < d.length; i++) {
      const e = snap(d[i]);
      if (Math.abs(e) < EPS) continue;
      const [p, q] = fraction(e);
      parts.push(this.baseunits[i] + (e === 1 ? "" : "^" + (q === 1 ? p : p + "/" + q)));
    }
    return parts.length ? parts.join(" ") : "1";
  }

  checkCompatible(a, b, where = "") {
    if (dimEq(a.d, b.d)) return;
    if (this.tolerant && (a.x.n === 0 || b.x.n === 0)) return;
    throw new UnitError(`Incompatible units${where ? " in " + where : ""}: [${this.dimString(a.d)}] and [${this.dimString(b.d)}]`);
  }

  checkPure(a, where = "") {
    if (a.pure || (this.tolerant && a.x.n === 0)) return a.relative().x;
    throw new UnitError(`${where ? where + ": e" : "E"}xpected a pure number, got [${this.dimString(a.d)}]`);
  }

  add(a, b) {
    this.checkCompatible(a, b, "sum");
    if (a.zero !== false && b.zero !== false) {
      throw new UnitError("Cannot add two absolute quantities (use ~ to make one relative)");
    }
    const d = a.x.n === 0 && b.x.n !== 0 ? b.d : a.d;
    return new Q(a.x.add(b.x), d, a.zero !== false ? a.zero : b.zero);
  }

  sub(a, b) {
    this.checkCompatible(a, b, "difference");
    const offset = (a.zero || 0) - (b.zero || 0);
    const abs = (a.zero !== false ? 1 : 0) - (b.zero !== false ? 1 : 0);
    if (abs < 0) throw new UnitError("Cannot subtract an absolute quantity from a relative one");
    const d = a.x.n === 0 && b.x.n !== 0 ? b.d : a.d;
    if (abs) return new Q(a.x.sub(b.x), d, offset);
    return new Q(a.x.sub(b.x).add(offset), d);
  }

  mul(a, b) {
    if (a.zero !== false && !b.pure) a = a.relative();
    if (b.zero !== false && !a.pure) b = b.relative();
    let zero = false;
    if (a.zero !== false && b.pure) zero = a.zero;
    else if (b.zero !== false && a.pure) zero = b.zero;
    if (a.zero !== false && b.zero !== false) { a = a.relative(); b = b.relative(); zero = false; }
    return new Q(a.x.mul(b.x), dimAdd(a.d, b.d), zero);
  }

  div(a, b) {
    b = b.relative();
    if (a.zero !== false && !b.pure) a = a.relative();
    return new Q(a.x.div(b.x), dimAdd(a.d, b.d, -1), a.zero);
  }

  pow(a, b) {
    const e = this.checkPure(b, "exponent");
    if (e.n === 1 && e.exact) return a;
    a = a.relative();
    if (!a.pure && !e.exact) throw new UnitError("Uncertain exponent of a quantity with units");
    return new Q(a.x.pow(e), dimScale(a.d, e.n));
  }

  neg(a) {
    return new Q(a.x.neg(), a.d, a.zero === false ? false : -a.zero);
  }

  tilde(a) {
    if (a.zero !== false) return new Q(a.x.add(a.zero), a.d);
    return new Q(a.x, a.d, 0);
  }

  compare(a, b) {
    this.checkCompatible(a, b, "comparison");
    const x = a.relative().x.n, y = b.relative().x.n;
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // -------------------------------------------------------------------
  // Conversion: the @ operator (port of imks' Value.set_units)

  isQuoted(u) {
    return u.length > 1 && (u[0] === "'" || u[0] === '"') && u[0] === u.at(-1) &&
      !u.slice(1, -1).includes(u[0]);
  }

  convert(q, rawArgs) {
    const args = this.expandSystem(rawArgs);
    const s = new Q(q.x, q.d, q.zero, { tree: null, prefixes: [], format: null });
    s.doc = q.doc;
    if (args.length === 1 && this.formats.has(args[0])) {
      s.show.format = args[0];
      return s;
    }
    // Separate prefixes from units and values
    let nunits = 0, nvalues = 0;
    const us = [];
    // the * wildcard selects engineering prefixes (powers of 1000)
    const seen = new Set();
    const allPrefixes = [...this.prefixes.keys()].filter((k) => {
      const e = Math.log10(this.prefixes.get(k).x.n);
      const r = Math.round(e);
      if (Math.abs(e - r) > 1e-9 || r % 3 !== 0 || seen.has(r)) return false;
      seen.add(r);
      return true;
    });
    for (let u of args) {
      if (u.endsWith("*")) {
        if (u === "*") s.show.prefixes.push(...allPrefixes);
        else {
          if (!this.prefixes.has(u.slice(0, -1))) throw new UnitError(`Unknown prefix '${u.slice(0, -1)}'`);
          s.show.prefixes.push(u.slice(0, -1));
        }
      } else if (u === ".") {
        s.show.prefixes.push("");
      } else if (this.isQuoted(u)) {
        us.push(u);
        nvalues++;
      } else {
        if (u[0] === "*") {
          s.show.prefixes.push(...allPrefixes);
          u = u.slice(1);
        }
        const iu = this.isunit(u);
        if (iu && iu[1] === "") s.show.prefixes.push(u);
        else {
          nunits++;
          us.push(u);
        }
      }
    }
    // Parse units and values
    const trees = [], vals = [];
    for (const u of us) {
      if (this.isQuoted(u)) {
        trees.push([[u, 1]]);
        vals.push(this.varValue(u.slice(1, -1)));
      } else {
        const p = this.parseUnit(u);
        trees.push(p.tree);
        vals.push(p.q);
      }
    }
    const nb = this.baseunits.length;
    const dimsOf = (v) => Array.from({ length: nb }, (_, i) => dimGet(v.d, i));
    if (trees.length === 1 && q.pure && vals[0].pure) {
      s.show.tree = trees[0];
      return s;
    }
    let maxrank = false;
    if (trees.length === 0) maxrank = true;
    else if (trees.length <= nb) {
      const m = vals.map(dimsOf);
      if (Math.abs(det(gram(m))) > 1e-7) maxrank = true;
    }
    let tree = null;
    if (maxrank) {
      const newTrees = trees.slice(), newVals = vals.slice();
      for (let n = 0; newTrees.length < nb && n < nb; n++) {
        const b = this.baseunits[n];
        const cand = [...newVals, this.units.get(b)].map(dimsOf);
        if (Math.abs(det(gram(cand))) > 1e-7) {
          newTrees.push([[b, 1]]);
          newVals.push(this.units.get(b));
        }
      }
      const m = newVals.map(dimsOf);
      const mt = Array.from({ length: nb }, (_, i) => m.map((r) => r[i]));
      const x = solve(mt, dimsOf(q));
      if (!x) throw new UnitError("Cannot solve unit conversion");
      tree = this.combine(newTrees, x.map(snap));
    } else {
      if (nunits === 1 && nvalues > 0 && !this.isQuoted(us[0])) {
        // A specific unit in a natural system, e.g. 6.2e34 @ [m|planck]
        const target = vals[0];
        const ratio = this.div(q.plain(), target.relative());
        const conv = this.convert(ratio, us.slice(1));
        const flat = this.applyShow(conv);
        const out = this.mul(flat, target.relative());
        out.show = { tree: [...(flat.show?.tree || []), ...trees[0]], prefixes: s.show.prefixes, format: null };
        out.doc = q.doc;
        return out;
      }
      if (q.pure) {
        s.show.tree = null;
        return s;
      }
      const target = dimsOf(q);
      const cols = vals.map(dimsOf);
      const maxLevel = Math.min(cols.length, nb);
      const key = `${this.version}|${us.join("|")}|${target.join(",")}`;
      this.searchCache ||= new Map();
      if (this.searchCache.has(key)) tree = this.searchCache.get(key);
      else search: for (let level = 1; level <= maxLevel; level++) {
        for (const c of combinations(cols.length, level)) {
          const r = lstsq(c.map((i) => cols[i]), target);
          if (r && r.residual < 1e-7 && Math.min(...r.x.map(Math.abs)) > 1e-5) {
            tree = this.combine(c.map((i) => trees[i]), r.x.map(snap));
            break search;
          }
        }
      }
      if (this.searchCache.size > 500) this.searchCache.clear();
      this.searchCache.set(key, tree);
      if (!tree) s.show.failed = true;
    }
    s.show.tree = tree;
    return this.applyShow(s);
  }

  // Build the unit tree sum(trees[i] * exps[i]), positive exponents first
  combine(trees, exps) {
    let pairs = trees.map((t, i) => [t, exps[i]]).filter(([, e]) => Math.abs(e) > EPS);
    if (this.sortunits) pairs = [...pairs.filter(([, e]) => e > 0), ...pairs.filter(([, e]) => e < 0)];
    const out = [];
    for (const [t, e] of pairs) {
      if (t.length === 1 && t[0][1] === 1) out.push([t[0][0], e]);
      else if (e === 1) out.push(...t);
      else out.push([t, e]);
    }
    return out;
  }

  // Remove double quoted units from the display tree, transforming the value
  applyShow(s) {
    if (!s.show || !s.show.tree) return s;
    const { factor, tree } = this.removeVariableUnits(s.show.tree);
    if (!factor) return s;
    const out = this.div(s, factor);
    out.show = { ...s.show, tree };
    out.doc = s.doc;
    // Fix rounding in dimensions
    out.d = out.d.map((e) => (Math.abs(e) < 1e-9 ? 0 : e));
    return out;
  }

  removeVariableUnits(tree) {
    let factor = null;
    const out = [];
    for (const [u, e] of tree) {
      if (Array.isArray(u)) {
        const r = this.removeVariableUnits(u);
        if (r.tree.length) out.push([r.tree, e]);
        if (r.factor) {
          const f = this.upow(r.factor, e);
          factor = factor ? this.umul(factor, f) : f;
        }
      } else if (u[0] === '"' && u.at(-1) === '"') {
        const f = this.upow(this.varValue(u.slice(1, -1)).plain(), e);
        factor = factor ? this.umul(factor, f) : f;
      } else out.push([u, e]);
    }
    return { factor, tree: out };
  }

  // -------------------------------------------------------------------
  // Display

  // Returns {num: UNum, tree, tilde, text} or {text} for formats
  display(q) {
    let tilde = false, num, tree;
    if (this.dateText) {
      const t = this.dateText(q);
      if (t !== null) return { text: t, format: true };
    }
    if (q.show && q.show.format) {
      const f = this.formats.get(q.show.format);
      if (f) {
        try {
          return { text: f.fn(q, this), format: true };
        } catch (e) {
          if (!(e instanceof UnitError)) throw e;
          // a date that a calendar cannot show: as a date, and why
          const t = this.dateText && this.dateText(q.plain());
          if (t) return { text: `${t} (${e.message.toLowerCase()})`, format: true };
        }
      }
    }
    if (q.show && q.show.tree) {
      tree = q.show.tree;
      const u0 = this.treeValue(tree);
      if (q.zero !== false) {
        num = q.x.add(q.zero - (u0.zero || 0)).div(u0.x);
      } else {
        if (u0.zero !== false) tilde = true;
        num = q.x.div(u0.x);
      }
    } else if (this.defaultsystem && !q.pure) {
      const c = this.convert(q.plain(), this.defaultsystem);
      if (q.show && q.show.prefixes.length) c.show.prefixes = q.show.prefixes;
      if (c.show && c.show.tree) return this.display(c);
      num = q.x;
      tree = this.baseTree(q.d);
    } else {
      num = q.zero !== false ? q.x.add(q.zero) : q.x;
      tree = this.baseTree(q.d);
    }
    if (q.show && q.show.prefixes && q.show.prefixes.length) {
      ({ num, tree } = this.applyPrefix(num, tree, q.show.prefixes));
    }
    return { num, tree, tilde };
  }

  baseTree(d) {
    const t = [];
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > EPS) t.push([this.baseunits[i], d[i]]);
    if (this.sortunits) return [...t.filter(([, e]) => e > 0), ...t.filter(([, e]) => e < 0)];
    return t;
  }

  applyPrefix(num, tree, prefixes) {
    let myunit = null, myexp = 1, fprefix = "";
    for (const [u, e] of tree) {
      if (typeof u === "string" && Math.abs(e) > EPS && !this.isQuoted(u)) {
        myunit = u;
        myexp = e;
        break;
      }
    }
    if (myunit !== null) {
      fprefix = this.isunit(myunit)?.[0] || "";
      if (fprefix) num = num.mul(Math.pow(this.prefixes.get(fprefix).x.n, myexp));
    } else {
      myunit = "";
      fprefix = "";
      tree = [["", 1]];
    }
    const avalue = Math.abs(num.n);
    if (avalue === 0 || !isFinite(avalue)) {
      return { num, tree: myunit === "" ? [] : tree.map(([u, e]) => [u === myunit ? myunit : u, e]) };
    }
    const base = myunit.slice(fprefix.length);
    const ok = (k) => (base !== "" || !this.units.has(k)) && this.prefixes.has(k) && (base === "" || this.units.has(base));
    const pv = (k) => Math.pow(this.prefixes.get(k).x.n, myexp);
    let dexes = prefixes.filter(ok).filter((k) => pv(k) <= avalue * (1 + 1e-12)).map((k) => [k, avalue / pv(k)]);
    if (!dexes.length) dexes = prefixes.filter(ok).map((k) => [k, -avalue / pv(k)]);
    if (!dexes.length) return { num, tree };
    const [dex] = dexes.reduce((a, b) => (b[1] < a[1] ? b : a));
    num = num.div(pv(dex));
    tree = tree.map(([u, e]) => [u === myunit ? dex + base : u, e]);
    if (myunit === "" && dex === "") tree = [];
    return { num, tree };
  }

  // Plain text for a unit tree (imks notation)
  treeText(tree) {
    const unit = [];
    for (const [u, e] of tree) {
      if (Math.abs(e) < EPS) continue;
      let base;
      if (typeof u === "string") {
        if (u[0] === '"' && u.at(-1) === '"') continue;
        base = u;
        if (/[ ^/]/.test(base)) base = "(" + base + ")";
      } else {
        base = this.treeText(u);
        if (u.length > 1 || Math.abs(e - 1) > EPS) base = "(" + base + ")";
      }
      if (Math.abs(e - 1) < EPS) unit.push(base);
      else {
        const [p, q] = fraction(e);
        unit.push(q === 1 ? `${base}^${p}` : `${base}^${p}/${q}`);
      }
    }
    if (unit.length === 1 && unit[0][0] === "(" && unit[0].at(-1) === ")") return unit[0].slice(1, -1);
    return unit.join(" ");
  }

  // HTML for a unit tree (superscript exponents)
  treeHTML(tree) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const parts = [];
    for (const [u, e] of tree) {
      if (Math.abs(e) < EPS) continue;
      let base;
      if (typeof u === "string") {
        if (u[0] === '"' && u.at(-1) === '"') continue;
        base = u[0] === "'" ? `<i>${esc(u.slice(1, -1))}</i>` : esc(u);
      } else {
        base = this.treeHTML(u);
        if (u.length > 1) base = "(" + base + ")";
      }
      if (Math.abs(e - 1) < EPS) parts.push(base);
      else {
        const [p, q] = fraction(e);
        const exp = (q === 1 ? String(p) : `${p}/${q}`).replace("-", "−");
        parts.push(`${base}<sup>${exp}</sup>`);
      }
    }
    return parts.join("·");
  }

  // Plain text representation of a quantity, e.g. "72[km hour^-1]"
  format(q) {
    if (this.dateText) {
      const t = this.dateText(q, true);
      if (t !== null) return t;
    }
    const r = this.display(q);
    if (r.format) return r.text;
    let v = formatUNum(r.num, this.digits, this.showErrors);
    const u = this.treeText(r.tree);
    if (v.includes("±") && !v.startsWith("(") && u) v = "(" + v + ")";
    return (r.tilde ? "~" : "") + v + (u ? "[" + u + "]" : "");
  }
}

export { UnitError, dimAdd, dimScale, dimIsZero, dimEq, fraction, Q, currencySymbols, symbolSource, unitNameSource, Env };
