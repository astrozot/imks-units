// User interface of the unit calculator.
//
// The expression is owned by the app (state.text / state.caret) and drawn
// in a plain element: no text field ever receives focus, so the system
// keyboard never opens. Hardware keyboards are handled through keydown.

import { createCalculator, loadCurrencies } from "./defs.js";
import { parse, normalize, splitComment, firstLine, functionDocs, tokenize } from "./interp.js";
import { Q, dimEq, fraction, UnitError } from "./units.js";
import { formatUNum, formatNumber, UNum, ufuncs, MC, newSourceId, rng, normInv, lhsUniform, mcConfigure, mcStats, formatAsym } from "./unum.js";

const ARTIFACT = Boolean(window.IMKS_ARTIFACT);

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------
// Storage (per-device conveniences; failures are ignored)

const store = {
  get(key, def) {
    try {
      const v = localStorage.getItem("imks." + key);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("imks." + key, JSON.stringify(value));
    } catch { /* storage unavailable */ }
  },
};

const DEFAULT_SETTINGS = {
  system: "si",
  digits: 12,
  errors: true,
  autoCurrency: true,
  oxrId: "",
  theme: "auto",
  palette: "classic",
  mc: false,
  mcN: 5000,
  typeset: true,
  brackets: true,
  bracketMatch: "fill",  // fill, underline, box, none
  rainbow: false,
  cosmo: { preset: "concordance", H0: 70, Om: 0.3, Ob: 0.05, OL: 0.7, OR: 0, flat: true, errors: false, sH0: 0, sOm: 0, rho: 0 },
};

// Cosmologies offered in Settings (radiation neglected)
const COSMO_PRESETS = {
  concordance: { name: "Concordance (70, 0.3, 0.7)", H0: 70, Om: 0.3, Ob: 0.05, OL: 0.7, OR: 0, flat: true, sH0: 0, sOm: 0, rho: 0 },
  // H0, Omega_M, Omega_b (and Omega_K) with their full covariance, from the chains
  // (omega_b h^2, omega_c h^2, h, Omega_K) summaries; 16384 scrambled Sobol draws.
  // Planck: one massive neutrino (0.06 eV) in Omega_M; WMAP 9: massless neutrinos.
  planck18: {
    name: "Planck 2018 (flat ΛCDM)", H0: 67.3599, Om: 0.315282, Ob: 0.0493147, Ok: 0, OL: 0.6846385, OR: 7.966e-05, flat: true,
    cov: {params: ["H0", "Om", "Ob"], m: [[0.286634, -0.00389021, -0.000298439], [-0.00389021, 5.37098e-05, 4.22653e-06], [-0.000298439, 4.22653e-06, 3.62675e-07]]},
  },
  planck18k: {
    name: "Planck 2018 + BAO (curved)", H0: 67.8615, Om: 0.309991, Ob: 0.0486416, Ok: 0.000729453, OL: 0.6892012, OR: 7.848e-05, flat: false,
    cov: {params: ["H0", "Om", "Ob", "Ok"], m: [[0.42823, -0.00367935, -0.000603921, 0.000942374], [-0.00367935, 3.92231e-05, 4.7145e-06, -4.80781e-06], [-0.000603921, 4.7145e-06, 9.60253e-07, -1.63777e-06], [0.000942374, -4.80781e-06, -1.63777e-06, 3.6713e-06]]},
  },
  wmap9: {
    name: "WMAP 9 (flat ΛCDM)", H0: 70.0333, Om: 0.279427, Ob: 0.0462525, Ok: 0, OL: 0.7204877, OR: 8.529e-05, flat: true,
    cov: {params: ["H0", "Om", "Ob"], m: [[4.77999, -0.0547272, -0.00491152], [-0.0547272, 0.000656073, 5.9655e-05], [-0.00491152, 5.9655e-05, 5.69836e-06]]},
  },
  wmap9k: {
    name: "WMAP 9 + BAO (curved)", H0: 68.188, Om: 0.293047, Ob: 0.0486975, Ok: -0.00365548, OL: 0.7105187, OR: 8.997e-05, flat: false,
    cov: {params: ["H0", "Om", "Ob", "Ok"], m: [[1.15313, -0.00762969, -0.00134499, 0.00245769], [-0.00762969, 0.00012737, 7.48339e-06, 1.06568e-05], [-0.00134499, 7.48339e-06, 2.53427e-06, -5.14909e-06], [0.00245769, 1.06568e-05, -5.14909e-06, 1.94742e-05]]},
  },
  custom: { name: "Custom" },
};

const COSMO_NAMES = ["H_0", "Omega_M", "Omega_L", "Omega_R"];

const state = {
  calc: null,
  constants: {},
  currencies: null,
  history: store.get("history", []),
  session: store.get("session", []),
  defs: store.get("defs", ""),
  settings: { ...DEFAULT_SETTINGS, ...store.get("settings", {}) },
  startupErrors: [],
  userErrors: [],
  tab: store.get("tab", "num"),
  unitCat: store.get("unitCat", "SI"),
  fnCat: store.get("fnCat", "Math"),
  constCat: store.get("constCat", "Physics"),
  picks: store.get("picks", {}),
  prefix: "",
  shift: 0,          // abc keyboard: 0 lower, 1 one capital, 2 caps lock
  second: 0,         // 123 keypad: 0 off, 1 2nd for one key, 2 locked
  layer: "abc",      // abc keyboard layer: abc, sym, greek
  text: "",
  caret: 0,
  recall: -1,
};

// ---------------------------------------------------------------------
// Unit catalogs

// Conversion targets offered in the suggestion bar, by kind of quantity
const CATEGORIES = [
  ["Length", ["m", "km", "cm", "mm", "µm", "nm", "in", "ft", "yd", "mi", "nmi", "au", "ly", "pc", "Å"]],
  ["Area", ["m^2", "km^2", "cm^2", "ha", "acre", "ft^2", "in^2", "mi^2", "barn"]],
  ["Volume", ["L", "mL", "m^3", "cm^3", "gal", "qt", "pt", "cup", "ozfl", "tbsp", "tsp"]],
  ["Mass", ["kg", "g", "mg", "t", "lb", "oz", "carat", "u", "M_Earth", "M_Jupiter", "M_Sun"]],
  ["Time", ["s", "ms", "µs", "ns", "min", "h", "day", "week", "yr"]],
  ["Speed", ["m/s", "km/h", "mph", "knot", "km/s", "ft/s"]],
  ["Accel.", ["m/s^2", "ga", "ft/s^2"]],
  ["Temp.", ["K", "°C", "°F"]],
  ["Energy", ["J", "kJ", "MJ", "cal", "kcal", "Wh", "kWh", "eV", "keV", "MeV", "GeV", "erg", "BTU"]],
  ["Power", ["W", "mW", "kW", "MW", "GW", "hp", "L_Sun"]],
  ["Pressure", ["Pa", "hPa", "kPa", "MPa", "bar", "mbar", "atm", "psi", "mmHg", "torr"]],
  ["Force", ["N", "kN", "dyn", "lbf", "kgf"]],
  ["Electric", ["A", "mA", "V", "mV", "kV", "Ω", "kΩ", "MΩ", "C", "F", "µF", "nF", "pF", "H", "S", "T", "Gs", "Wb"]],
  ["Freq.", ["Hz", "kHz", "MHz", "GHz", "rpm", "Bq", "Ci"]],
  ["Angle", ["rad", "deg", "arcmin", "arcsec", "sr"]],
  ["Light", ["cd", "lm", "lx"]],
  ["Amount", ["mol", "mmol"]],
  ["Money", ["EUR", "USD", "GBP", "CHF", "JPY", "CNY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK", "INR", "BRL", "BTC"]],
  ["Astro", ["au", "ly", "pc", "kpc", "Mpc", "M_Sun", "M_Jupiter", "M_Earth", "R_Sun", "R_Jupiter", "R_Earth", "L_Sun", "Jy"]],
];

const POPULAR = CATEGORIES.flatMap(([, us]) => us);

// Units on the keypad. Prefixes are separate keys, so the lists hold
// unprefixed units (plus the kilogram, the SI base unit of mass).
const SI_GROUPS = [
  ["Base units", ["m", "kg", "s", "A", "K", "mol", "cd", "g"]],
  ["Derived units", ["Hz", "N", "Pa", "J", "W", "C", "V", "Ω", "S", "F", "Wb", "T", "H", "lm", "lx", "Bq", "Gy", "Sv", "rad", "sr", "°C"]],
  ["Accepted with SI", ["min", "h", "day", "L", "t", "eV", "deg", "arcmin", "arcsec", "ha", "bar", "au"]],
];

const KEY_CATS = [
  ["Length", ["m", "in", "ft", "yd", "mi", "nmi", "fath", "point", "Å", "fermi", "au", "ly", "pc"]],
  ["Area", ["m^2", "ha", "acre", "barn", "in^2", "ft^2", "yd^2", "mi^2"]],
  ["Volume", ["L", "m^3", "gal", "qt", "pt", "cup", "ozfl", "tbsp", "tsp", "in^3", "ft^3"]],
  ["Mass", ["kg", "g", "t", "lb", "oz", "carat", "u", "M_Sun"]],
  ["Time", ["s", "min", "h", "day", "week", "yr", "Cy"]],
  ["Speed", ["m/s", "km/h", "mph", "knot", "ft/s"]],
  ["Accel.", ["m/s^2", "ga", "ft/s^2"]],
  ["Temp.", ["K", "°C", "°F"]],
  ["Energy", ["J", "Wh", "cal", "eV", "erg", "BTU", "E_h"]],
  ["Power", ["W", "hp", "L_Sun"]],
  ["Pressure", ["Pa", "bar", "atm", "psi", "mmHg", "torr"]],
  ["Force", ["N", "dyn", "lbf", "kgf"]],
  ["Electric", ["A", "V", "Ω", "C", "F", "H", "S", "T", "Gs", "Wb"]],
  ["Freq.", ["Hz", "rpm", "Bq", "Ci"]],
  ["Angle", ["rad", "deg", "arcmin", "arcsec", "sr"]],
  ["Light", ["cd", "lm", "lx", "ph"]],
  ["Amount", ["mol"]],
  ["Viscosity", ["P", "St"]],
  ["Money", ["EUR", "USD", "GBP", "CHF", "JPY", "CNY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK", "INR", "BRL", "BTC"]],
  ["Astro", ["au", "ly", "pc", "M_Sun", "R_Sun", "L_Sun", "M_Jupiter", "R_Jupiter", "M_Earth", "R_Earth", "Jy", "yr"]],
];

// SI units offered right after a bare number
const SI_SUGGEST = ["m", "kg", "s", "A", "K", "mol", "cd", "N", "J", "W", "Pa", "Hz", "C", "V", "Ω", "T", "eV", "°C", "L", "min", "h"];

const UNIT_LABELS = { deg: "°", arcmin: "′", arcsec: "″", M_Sun: "M☉", L_Sun: "L☉", R_Sun: "R☉", M_Earth: "M⊕", R_Earth: "R⊕", E_h: "Eₕ" };

// ---------------------------------------------------------------------
// Typeset names: hbar -> ħ, Msun -> M☉ (subscript), m_e -> mₑ, epsilon0 -> ε₀.
// Only the display changes; the text keeps the names that can be typed.

const GREEK = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ",
  sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ",
  Phi: "Φ", Psi: "Ψ", Omega: "Ω", Beta: "Β",
};
const GREEK_NAMES = Object.keys(GREEK).sort((a, b) => b.length - a.length);

const sub = (s) => `<sub>${s}</sub>`;
const SUBDIGITS = (d) => [...d].map((c) => "₀₁₂₃₄₅₆₇₈₉"[c]).join("");

// Names with their own glyph; everything else follows the rules below
const NAME_HTML = { hbar: "ħ", euler: "ℯ", inf: "∞", Omega_L: "Ω" + "<sub>Λ</sub>" };
const FN_HTML = { sqrt: "√", cbrt: "∛" };
const UNIT_HTML = { deg: "°", arcmin: "′", arcsec: "″", ohm: "Ω", Ang: "Å" };
const BASE_HTML = { sin2theta: "sin²θ" };
const SUB_WORDS = { Sun: "☉", Earth: "⊕", half: "½" };
const CHARGE = { 0: "⁰", plus: "⁺", minus: "⁻" };

// One subscript component: Sun -> ☉, mu -> μ, pi0 -> π⁰, C14 -> ¹⁴C, H2O -> H₂O
function subPart(s, base) {
  if (SUB_WORDS[s]) return SUB_WORDS[s];
  if (GREEK[s]) return GREEK[s];
  const ch = /^([A-Za-z]+?)(0|plus|minus)$/.exec(s);
  if (ch && GREEK[ch[1]]) return GREEK[ch[1]] + CHARGE[ch[2]];
  const sq = /^([a-z]+)([23])$/.exec(s);
  if (sq && GREEK[sq[1]]) return GREEK[sq[1]] + "²³"[sq[2] - 2];
  if (typeof NUCLIDE_NAMES !== "undefined" && NUCLIDE_NAMES.has(s)) return isoHTML(s);
  if (typeof CHEM_NAMES !== "undefined" && CHEM_NAMES.has(s)) return esc(s.replace(/\d+/g, SUBDIGITS));
  return esc(s);
}

// base_sub1_sub2: a Greek word becomes its letter, "_" parts become one
// comma-separated subscript, and a final _inv becomes ⁻¹
function prettyParts(w) {
  const parts = w.split("_");
  if (parts.some((x) => !x)) return null;
  if (parts.length === 1) return GREEK[w] || null;
  let inv = false;
  if (parts.at(-1) === "inv") { inv = true; parts.pop(); }
  const base = parts[0];
  let html = BASE_HTML[base] || GREEK[base] || esc(base);
  if (parts.length > 1) html += sub(parts.slice(1).map((s) => subPart(s, base)).join(","));
  if (inv) html += "<sup>−1</sup>";
  return html;
}

// HTML for an identifier, or null when it is shown as typed
function prettyName(w, { fn = false, unit = null } = {}) {
  if (fn) return FN_HTML[w] || prettyParts(w);
  if (unit === null) unit = state.calc ? isBareUnit(w) : false;
  if (unit) {
    if (UNIT_HTML[w]) return UNIT_HTML[w];
    const iu = state.calc && env().isunit(w);
    if (iu && iu[0] && iu[1]) {
      if (UNIT_HTML[iu[1]]) return esc(iu[0]) + UNIT_HTML[iu[1]];
      if (iu[1].includes("_")) { const h = prettyParts(iu[1]); return h ? esc(iu[0]) + h : null; }
      return null;
    }
    return w.includes("_") ? prettyParts(w) : null;
  }
  if (NAME_HTML[w]) return NAME_HTML[w];
  return prettyParts(w);
}

// A unit specification like "m/s^2" or "Msun", for keys and chips
function unitLabelHTML(u) {
  return u.split(/([/ ])/).map((part) => {
    const m = /^([^^]+)(?:\^(-?\d+))?$/.exec(part);
    if (!m || part === "/" || part === " ") return esc(part);
    return (prettyName(m[1], { unit: true }) || esc(m[1])) + (m[2] ? `<sup>${m[2].replace("-", "−")}</sup>` : "");
  }).join("");
}

const constLabel = (label, expr) =>
  prettyName(expr, { unit: false }) || (label.includes("<") ? label : esc(label));

// Unit tree of a result, typeset (replaces Env.treeHTML)
function treeHTML(tree) {
  const parts = [];
  for (const [u, ex] of tree) {
    if (Math.abs(ex) < 1e-9) continue;
    let base;
    if (typeof u === "string") {
      if (u[0] === '"' && u.at(-1) === '"') continue;
      if (u[0] === "'") {
        const n = env().vars.resolve ? env().vars.resolve(u.slice(1, -1)) : u.slice(1, -1);
        base = `<i>${prettyName(n, { unit: false }) || esc(n)}</i>`;
      } else base = prettyName(u, { unit: true }) || esc(u);
    } else {
      base = treeHTML(u);
      if (u.length > 1) base = "(" + base + ")";
    }
    if (Math.abs(ex - 1) < 1e-9) parts.push(`<span class="uf">${base}</span>`);
    else {
      const [p, q] = fraction(ex);
      parts.push(`<span class="uf">${base}<sup>${(q === 1 ? String(p) : `${p}/${q}`).replace("-", "−")}</sup></span>`);
    }
  }
  return parts.join("\u2009");   // SI: a thin space between units
}

const PREFIXES = ["y", "z", "a", "f", "p", "n", "µ", "m", "c", "d", "da", "h", "k", "M", "G", "T", "P", "E", "Z", "Y"];
const PREFIX_EXP = { y: -24, z: -21, a: -18, f: -15, p: -12, n: -9, "µ": -6, m: -3, c: -2, d: -1, da: 1, h: 2, k: 3, M: 6, G: 9, T: 12, P: 15, E: 18, Z: 21, Y: 24 };

// Constants keypad: [label, expression, description]
const CONSTS = [
  ["π", "pi", "Pi"],
  ["c", "c", "Speed of light"],
  ["g", "g", "Standard gravity"],
  ["G", "G", "Gravitational constant"],
  ["h", "h", "Planck constant"],
  ["ħ", "hbar", "Reduced Planck constant"],
  ["k", "k", "Boltzmann constant"],
  ["e", "e", "Elementary charge"],
  ["Nₐ", "N_A", "Avogadro constant"],
  ["R", "R", "Molar gas constant"],
  ["σ", "sigma_SB", "Stefan–Boltzmann constant"],
  ["ε₀", "epsilon_0", "Vacuum permittivity"],
  ["μ₀", "mu_0", "Vacuum permeability"],
  ["α", "alpha", "Fine-structure constant"],
  ["mₑ", "m_e", "Electron mass"],
  ["mₚ", "m_p", "Proton mass"],
  ["mₙ", "m_n", "Neutron mass"],
  ["μ_B", "mu_B", "Bohr magneton"],
  ["a<sub>0</sub>", 'const["Bohr radius"]', "Bohr radius"],
  ["R<sub>∞</sub>", 'const["Rydberg constant"]', "Rydberg constant"],
  ["M☉", "M_Sun", "Solar mass"],
  ["R☉", "R_Sun", "Solar radius"],
  ["L☉", "L_Sun", "Solar luminosity"],
  ["H₀", "H_0", "Hubble constant"],
  ["T_CMB", "T_CMB", "CMB temperature"],
  ["ρ_c", "rho_c", "Critical density"],
  ["d_H", "d_H", "Hubble distance"],
];

// ---------------------------------------------------------------------
// Calculator construction

function applySettings(calc) {
  const s = state.settings;
  calc.env.digits = s.digits;
  calc.env.showErrors = s.errors;
  if (s.system && s.system !== "none") calc.run(`%defaultsystem ${s.system}`);
  else calc.env.defaultsystem = null;
  const c = { ...DEFAULT_SETTINGS.cosmo, ...(s.cosmo || {}) };
  const num = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const om = num(c.Om, 0.3), or = num(c.OR, 0);
  const ol = c.flat ? 1 - om - or : num(c.OL, 0.7);
  calc.run(`%let H_0 = ${num(c.H0, 70)}[km s^-1 Mpc^-1]   # "Hubble's constant"`);
  calc.run(`%let Omega_M = ${om}   # "Mass density parameter"`);
  calc.run(`%let Omega_L = ${ol}   # "Cosmological constant parameter"`);
  calc.run(`%let Omega_R = ${or}   # "Radiation density parameter"`);
  calc.run(`%let Omega_b = ${num(c.Ob, 0.05)}   # "Baryon density parameter"`);
  if (c.flat) calc.run('%let Omega_K = 0   # "Curvature parameter (flat model)"');
  else calc.run('%lazy Omega_K = 1 - Omega_M - Omega_L - Omega_R   # "Curvature parameter"');
  const cov = cosmoCovariance(c);
  if (c.errors && cov) {
    // correlated errors: one source per parameter, mixed by the Cholesky factor
    const e = calc.env;
    const L = cholesky(cov.m);
    const ids = cov.params.map(() => newSourceId());
    const value = (p, i) => {
      const comps = new Map();
      for (let k = 0; k <= i; k++) if (L[i][k]) comps.set(ids[k], L[i][k]);
      return UNum.fromComponents(p, comps);
    };
    const mean = { H0: num(c.H0, 70), Om: om, Ob: num(c.Ob, 0.05), Ok: num(c.Ok, 0) };
    const set = (name, q) => {
      const old = e.vars.get(name);
      if (old && old.doc) q.doc = old.doc;
      e.vars.set(name, q);
    };
    cov.params.forEach((p, i) => {
      if (p === "H0") set("H_0", e.mul(new Q(value(mean.H0, i)), e.unit("km s^-1 Mpc^-1")));
      if (p === "Om") set("Omega_M", new Q(value(mean.Om, i)));
      if (p === "Ob") set("Omega_b", new Q(value(mean.Ob, i)));
      if (p === "Ok") set("Omega_K", new Q(value(mean.Ok, i)));
    });
    if (cov.params.includes("Ok")) calc.run('%lazy Omega_L = 1 - Omega_M - Omega_K - Omega_R   # "Cosmological constant parameter"');
    else if (c.flat) calc.run('%lazy Omega_L = 1 - Omega_M - Omega_R   # "Cosmological constant parameter (flat model)"');
  }
  if (calc.systemNames) { calc.systemNames.add("Omega_R"); calc.systemNames.add("Omega_b"); }
}

// covariance of the cosmological parameters: a preset's matrix, or the
// two errors and correlation given in Settings
function cosmoCovariance(c) {
  if (c.cov && c.cov.params) return c.cov;
  const sH = Math.abs(Number(c.sH0) || 0), sO = Math.abs(Number(c.sOm) || 0);
  const rho = Math.max(-1, Math.min(1, Number(c.rho) || 0));
  if (!(sH > 0 || sO > 0)) return null;
  return { params: ["H0", "Om"], m: [[sH * sH, rho * sH * sO], [rho * sH * sO, sO * sO]] };
}

function cholesky(A) {
  const n = A.length, L = A.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 0)) : (L[j][j] ? s / L[j][j] : 0);
    }
  }
  return L;
}

function build() {
  mcConfigure(state.settings.mc, state.settings.mcN);
  const { calc, errors, userErrors } = createCalculator({
    constants: state.constants,
    currencies: state.currencies,
    extra: state.defs,
    correlations: state.corr || null,
  });
  installAliases(calc);
  addScience(calc);
  addPlanets(calc);
  addExtras(calc);
  addDistributions(calc);
  installFunctionAliases(calc);
  state.startupErrors = errors;
  state.userErrors = userErrors;
  applySettings(calc);
  resultNames = [];
  installResults(calc);
  for (const line of state.session) calc.run(line);
  resampleResults(calc);
  state.calc = calc;
  categoryDims = null;
  if (pagesEl.childElementCount) { renderConstGrid(); renderFnGrid(); }
}

const env = () => state.calc.env;

// ---------------------------------------------------------------------
// Rendering of quantities

function numHTML(u, digits = env().digits) {
  // Monte Carlo with clearly different upper and lower errors: 12.24⁺⁰·³²₋₀.₂₇
  const asym = env().showErrors ? formatAsym(u) : null;
  if (asym) {
    const neg = (t) => t.replace(/^-/, "−");
    const body = `${neg(asym.val)}<span class="asym"><span>+${asym.plus}</span><span>−${asym.minus}</span></span>`;
    return asym.exp ? `(${body})×10<sup>${String(asym.exp).replace("-", "−")}</sup>` : body;
  }
  let s = formatUNum(u, digits, env().showErrors);
  let exp = null;
  const em = /e([-+]\d+)$/.exec(s);
  if (em) { exp = em[1]; s = s.slice(0, em.index); }
  let out = esc(s)
    .replace("±", '<span class="pm">±</span>')
    .replace(/\((\d+)\)$/, '<span class="pm">($1)</span>')
    .replace(/^(\(?)-/, "$1−")
    .replace(/^(\(?−?)inf$/, "$1∞");
  if (exp) out += `×10<sup>${String(Number(exp)).replace("-", "−")}</sup>`;
  return out;
}

function qHTML(q) {
  const html = qHTMLraw(q);
  return MC.on && env().showErrors && q.x && (q.x.s || q.x.c) && q.x.std > 0 ? html + '<wbr><span class="mcb" title="Monte Carlo">MC</span>' : html;
}

function qHTMLraw(q) {
  const r = env().display(q);
  if (r.format) return esc(r.text);
  const unit = treeHTML(r.tree);
  let num = numHTML(r.num);
  if (unit && num.includes("±") && !num.startsWith("(")) num = `(${num})`;
  return `<span class="nb">${r.tilde ? '<span class="tilde">~</span>' : ""}${num}</span>` + (unit ? `<wbr><span class="u">${unit}</span>` : "");
}

function qText(q) {
  return env().format(q);
}

// Short text of a quantity for toasts
function qShort(q) {
  try { return Array.isArray(q) ? listText(q) : qText(q); } catch { return ""; }
}

// ---------------------------------------------------------------------
// Tables and plots
//
// A list result is a column of values, a list of lists, as (z, D_L(z)),
// one column per list. Values of a column share the unit in the head when
// they are shown in the same one. A plot is kept in the history as plain
// numbers in the units of its axes, and drawn as SVG at render time.

function listText(v) {
  return "(" + v.map((x) => (Array.isArray(x) ? listText(x) : qText(x))).join(", ") + ")";
}

// the items of a top-level tuple in src: "(z, D_L(z) @ Gpc)" -> ["z", "D_L(z) @ Gpc"]
function tupleParts(src) {
  let t = splitComment(src).code.trim();
  const m = /^[\p{L}_][\p{L}\p{N}_]*\s*=(?!=)/u.exec(t);
  if (m) t = t.slice(m[0].length).trim();
  if (t[0] !== "(" || t.at(-1) !== ")") return null;
  const parts = [];
  let depth = 0, cur = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (depth === 0 && i < t.length - 1) return null;
    if (ch === "," && depth === 1) { parts.push(cur.trim()); cur = ""; }
    else if (i > 0 && i < t.length - 1) cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

// the head of a column: its expression without the conversion
function headText(s) {
  const k = lastAt(s);
  return (k >= 0 ? s.slice(0, k) : s).trim();
}

// how to show a column of quantities
function columnFormat(qs) {
  const e = env();
  const ds = qs.map((q) => { try { return q instanceof Q ? e.display(q) : null; } catch { return null; } });
  const key = (r) => (r && !r.format ? (r.tilde ? "~" : "") + e.treeText(r.tree) : null);
  const k0 = key(ds[0]);
  const common = k0 !== null && ds.every((r) => key(r) === k0);
  const tilde = common && ds[0].tilde ? '<span class="tilde">~</span>' : "";
  return {
    common,
    unit: common ? treeHTML(ds[0].tree) : "",
    unitText: common ? e.treeText(ds[0].tree) : "",
    html: (i) => (i >= qs.length ? "" : common ? tilde + numHTML(ds[i].num, Math.min(env().digits, 6)) : qs[i] instanceof Q ? qHTMLraw(qs[i]) : esc(listText(qs[i]))),
    text: (i) => (i >= qs.length ? "" : qs[i] instanceof Q ? qText(qs[i]) : listText(qs[i])),
    num: (i) => (common && i < qs.length ? ds[i].num : null),
  };
}

// a short list (a vector) on one line, its unit once: (3, 4, 0) N
function inlineList(v) {
  if (v.length > 4 || !v.every((q) => q instanceof Q)) return null;
  const f = columnFormat(v);
  if (!f.common) return `(${v.map(qHTMLraw).join(", ")})`;
  const nums = v.map((_, i) => `<span class="nb">${numHTML(f.num(i))}</span>`).join(",<wbr> ");
  return `(${nums})` + (f.unit ? `<wbr><span class="u">${f.unit}</span>` : "");
}

const TABLE_ROWS = 500;

function tableOf(v, src) {
  const cols = v.some(Array.isArray) ? v.map((c) => (Array.isArray(c) ? c : [c])) : [v];
  const n = Math.max(...cols.map((c) => c.length));
  const fmts = cols.map(columnFormat);
  const parts = cols.length === 2 && /^\s*(?:[\p{L}_][\p{L}\p{N}_]*\s*=(?!=)\s*)?polyroots\s*\(/u.test(splitComment(src || "").code) ? ["Re", "Im"] : tupleParts(src);
  const heads = cols.length > 1 && parts && parts.length === cols.length ? parts.map(headText) : cols.map(() => "");
  const th = fmts.map((f, j) =>
    `<th>${heads[j] ? `<span class="h">${exprHTML(heads[j])}</span>` : ""}${f.unit ? `<span class="u">${f.unit}</span>` : ""}</th>`).join("");
  const rows = [];
  for (let i = 0; i < Math.min(n, TABLE_ROWS); i++) {
    rows.push(`<tr><td class="ix">${i + 1}</td>${fmts.map((f) => `<td data-v="${esc(f.text(i))}">${f.html(i)}</td>`).join("")}</tr>`);
  }
  const more = n > TABLE_ROWS ? `<p class="tbl-more">${n - TABLE_ROWS} more rows: long-press to copy them all</p>` : "";
  const html = `<div class="tbl-wrap"><table class="vals"><thead><tr><th class="ix">#</th>${th}</tr></thead><tbody>${rows.join("")}</tbody></table></div>${more}`;
  // CSV: values in the unit of the head, with a σ column where needed
  const q = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const hcells = [], getters = [];
  fmts.forEach((f, j) => {
    const name = heads[j] || (cols.length > 1 ? `column ${j + 1}` : "value");
    hcells.push(q(name + (f.unitText ? ` [${f.unitText}]` : "")));
    if (!f.common) { getters.push((i) => q(f.text(i))); return; }
    getters.push((i) => { const u = f.num(i); return u ? String(u.n) : ""; });
    if (cols[j].some((x, i) => f.num(i) && f.num(i).std > 0)) {
      hcells.push(q(`${name} σ`));
      getters.push((i) => { const u = f.num(i); return u ? String(u.std) : ""; });
    }
  });
  const csv = [hcells.join(","), ...Array.from({ length: n }, (_, i) => getters.map((g) => g(i)).join(","))].join("\n");
  return { html, csv };
}

// The unit an axis is drawn in: the one its largest value is shown in, or
// fix ({s, z0, unit}, from an earlier axis) when given
function axisOf(qs, fix = null) {
  if (!fix) {
    const e = env();
    const rep = qs.reduce((a, q) => (Math.abs(q.x.n) > Math.abs(a.x.n) ? q : a), qs[0]);
    let tree = null;
    try {
      const r = e.display(new Q(new UNum(rep.x.n), rep.d, rep.zero, rep.show));
      if (!r.format && !r.tilde) tree = r.tree;
    } catch { /* base units */ }
    if (!tree) tree = e.baseTree(rep.d);
    const u0 = e.treeValue(tree);
    fix = { s: u0.x.n, z0: u0.zero === false || u0.zero == null ? 0 : UNum.of(u0.zero).n, unit: e.treeText(tree) };
  }
  const { s, z0 } = fix;
  return {
    val: (n, q) => ((q.zero !== false ? n + UNum.of(q.zero).n - z0 : n) / s),
    unit: fix.unit,
    fix,
  };
}

// A plot as plain numbers: x, and per curve y with the 68 % band lo–hi.
// A plot recomputed over a new range (see replot) keeps the axes, log
// scales and view of prev
function plotOf(p, prev = null) {
  const r7 = (x) => (x === null || !isFinite(x) ? null : Number(x.toPrecision(7)));
  const xq = p.xs.filter(Boolean), yq = p.series.flat().filter(Boolean);
  const ax = axisOf(xq, prev && prev.xaxis), ay = axisOf(yq, prev && prev.yaxis);
  let banded = false;
  const series = p.series.map((s, j) => {
    const y = [], lo = [], hi = [];
    for (const q of s) {
      if (!q) { y.push(null); lo.push(null); hi.push(null); continue; }
      const st = MC.on && q.x.samples() ? mcStats(q.x) : null;
      const sd = st ? 0 : q.x.std;
      y.push(r7(ay.val(st ? st.med : q.x.n, q)));
      const l = st ? st.lo : sd > 0 ? q.x.n - sd : null, h = st ? st.hi : sd > 0 ? q.x.n + sd : null;
      if (l !== null && h > l) banded = true;
      lo.push(l === null ? null : r7(ay.val(l, q)));
      hi.push(h === null ? null : r7(ay.val(h, q)));
    }
    let head = "";
    if (p.heads && p.heads[j]) {
      try { head = `<math>${nodeMath(p.heads[j].t === "convert" ? p.heads[j].a : p.heads[j]).m}</math>`; } catch { head = ""; }
    }
    return { head: head || (p.series.length > 1 ? `${j + 1}` : ""), y, lo, hi };
  });
  if (!banded) for (const s of series) { delete s.lo; delete s.hi; }
  const x = p.xs.map((q, i) => r7(ax.val(q.x.n, q)));
  const pos = (vs) => vs.every((v) => v === null || v > 0);
  const span = (vs) => {
    const f = vs.filter((v) => v !== null && v > 0);
    return f.length ? Math.max(...f) / Math.min(...f) : 1;
  };
  const ys = series.flatMap((s) => [...s.y, ...(s.lo || []), ...(s.hi || [])]);
  const out = {
    x, xname: p.xname || "", xunit: ax.unit, yunit: ay.unit, series,
    logx: pos(x) && span(x) >= 100, logy: pos(ys) && span(ys) >= 1000,
    canlogx: pos(x) && span(x) > 1, canlogy: pos(ys) && span(ys) > 1,
    xaxis: ax.fix, yaxis: ay.fix,
  };
  if (p.range) {
    // the range computed (home: the first one), and where its ends are
    // on the axis, to map the axis back to it
    const end = (q) => ax.val(q.x.n, q);
    Object.assign(out, { range: p.range, home: prev ? prev.home : p.range, xr: [end(p.xs[0]), end(p.xs.at(-1))] });
  }
  // the asymptotes, if asked: x of the vertical ones (null: not computed
  // for this range) and two points of each line, kept from prev as they do
  // not depend on the range
  const lines = p.asym && p.asym.lines
    ? p.asym.lines.map(({ p: pts }) => pts.map(([xq, yq]) => [r7(ax.val(xq.x.n, xq)), r7(ay.val(yq.x.n, yq))]))
    : prev && prev.asym ? prev.asym.lines : null;
  if (p.asym || lines) out.asym = { v: p.asym ? p.asym.v.map(([, q]) => r7(ax.val(q.x.n, q))) : null, lines };
  if (prev) {
    out.logx = prev.logx;
    out.logy = prev.logy;
    if (prev.view) out.view = prev.view;
    if (prev.showAsym) out.showAsym = true;
  }
  return out;
}

// ¹²³ for unit exponents in SVG text: "km s^-1" -> "km s⁻¹"
const SUP = { "-": "⁻", "/": "ᐟ", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const supText = (s) => s.replace(/\^(-?[\d/]+)/g, (_, e) => [...e].map((c) => SUP[c]).join(""));

// tick positions and labels for [lo, hi]; linear ticks share a power of
// ten written once next to the unit
function axisTicks(lo, hi, log) {
  if (log) {
    const a = Math.floor(Math.log10(lo) + 1e-9), b = Math.ceil(Math.log10(hi) - 1e-9);
    const step = Math.max(1, Math.ceil((b - a) / 5));
    const ticks = [];
    for (let k = a; k <= b; k += step) {
      const v = 10 ** k;
      if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push({ v, label: k === 0 ? "1" : k === 1 ? "10" : "10" + supText("^" + k) });
    }
    if (ticks.length < 2) {
      // less than a decade: 1, 2, 5 steps
      ticks.length = 0;
      for (let k = a - 1; k <= b; k++) {
        for (const m of [1, 2, 5]) {
          const v = m * 10 ** k;
          if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push({ v, label: String(Number(v.toPrecision(3))) });
        }
      }
    }
    return { ticks, scale: "" };
  }
  const raw = (hi - lo) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.999);
  const big = Math.max(Math.abs(lo), Math.abs(hi));
  const e = big >= 1e5 || big < 1e-3 ? Math.floor(Math.log10(big)) : 0;
  const ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) {
    const x = Math.abs(v) < step * 1e-9 ? 0 : v;
    ticks.push({ v: x, label: String(Number((x / 10 ** e).toPrecision(6))).replace("-", "−") });
  }
  return { ticks, scale: e ? "×10" + supText("^" + e) : "" };
}

const PLOT_W = 340, PLOT_H = 200;
const PLOT_COLORS = ["var(--accent-ink)", "var(--tab)", "var(--danger)", "var(--unit)"];
let plotClip = 0;

// scales of a plot: data -> SVG coordinates. A view {x0, x1, y0?, y1?}
// (zoomed) fixes the range of x, and of y when it has y0; else y fits the
// values in the x range
function plotGeom(p, W = PLOT_W, H = PLOT_H) {
  const L = 46, R = 10, T = 20, B = 34;
  const range = (vs, log) => {
    let f = vs.filter((v) => v !== null && isFinite(v) && (!log || v > 0));
    if (!f.length) f = [log ? 1 : 0];
    let lo = Math.min(...f), hi = Math.max(...f);
    if (log) {
      if (hi === lo) { lo /= 2; hi *= 2; }
      return [lo, hi];
    }
    if (hi === lo) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
    else { const pad = (hi - lo) * 0.04; if (lo !== 0) lo -= pad; if (hi !== 0) hi += pad; }
    return [lo, hi];
  };
  const logx = p.logx && p.canlogx, logy = p.logy && p.canlogy;
  const v = p.view;
  const [x0, x1] = v ? [v.x0, v.x1] : range(p.x, logx);
  const xlo = Math.min(x0, x1), xhi = Math.max(x0, x1);
  const inx = (i) => !v || (p.x[i] !== null && p.x[i] >= xlo && p.x[i] <= xhi);
  const tx = (v) => (logx ? Math.log10(v) : v), ty = (v) => (logy ? Math.log10(v) : v);
  const ok = (v, log) => v !== null && isFinite(v) && (!log || v > 0);
  let ys = p.series.flatMap((s) => [s.y, s.lo || [], s.hi || []].flatMap((a) => a.filter((_, i) => inx(i))));
  if (p.range) {
    // near a pole a computed curve would squeeze the rest: y fits where
    // the curves are over 90 % of the x range in view, widened 3 times
    const pts = [], n = p.x.length;
    p.x.forEach((xv, i) => {
      if (!inx(i) || !ok(xv, logx)) return;
      const nb = (k) => (k >= 0 && k < n && ok(p.x[k], logx) ? tx(p.x[k]) : tx(xv));
      const w = (nb(i + 1) - nb(i - 1)) / 2;
      for (const s of p.series) for (const a of [s.y, s.lo, s.hi]) if (a && ok(a[i], logy)) pts.push([ty(a[i]), w]);
    });
    pts.sort((u, v) => u[0] - v[0]);
    const tot = pts.reduce((t, q) => t + q[1], 0);
    const q = (f) => {
      let c = 0;
      return (pts.find((pt) => (c += pt[1]) >= f * tot) || pts.at(-1))[0];
    };
    if (pts.length && tot > 0) {
      const m = q(0.5), s = q(0.95) - q(0.05);
      const lo = m - 3 * s, hi = m + 3 * s;
      if (s > 0) ys = ys.map((y) => (ok(y, logy) ? (logy ? 10 ** Math.min(hi, Math.max(lo, ty(y))) : Math.min(hi, Math.max(lo, y))) : y));
    }
  }
  const [y0, y1] = v && v.y0 !== undefined ? [v.y0, v.y1] : range(ys, logy);
  const pw = W - L - R, ph = H - T - B;
  // far outside the frame (clipped) the coordinates are capped
  const cap = (c) => Math.max(-1e4, Math.min(1e4, c));
  const sx = (v) => cap(L + ((tx(v) - tx(x0)) / (tx(x1) - tx(x0))) * pw);
  const sy = (v) => cap(H - B - ((ty(v) - ty(y0)) / (ty(y1) - ty(y0))) * ph);
  return {
    L, R, T, B, W, H, pw, ph, x0, x1, y0, y1, logx, logy, sx, sy, tx, ty,
    ux: (t) => (logx ? 10 ** t : t), uy: (t) => (logy ? 10 ** t : t),
    okx: (v) => ok(v, logx), oky: (v) => ok(v, logy), inx,
  };
}

// what is inside the <svg> of a plot, W × H
function plotSVG(p, W = PLOT_W, H = PLOT_H) {
  const g = plotGeom(p, W, H);
  const f1 = (v) => v.toFixed(1);
  const xt = axisTicks(Math.min(g.x0, g.x1), Math.max(g.x0, g.x1), g.logx), yt = axisTicks(Math.min(g.y0, g.y1), Math.max(g.y0, g.y1), g.logy);
  const grid = [
    ...xt.ticks.map((t) => `<line x1="${f1(g.sx(t.v))}" x2="${f1(g.sx(t.v))}" y1="${g.T}" y2="${H - g.B}"/>`),
    ...yt.ticks.map((t) => `<line x1="${g.L}" x2="${W - g.R}" y1="${f1(g.sy(t.v))}" y2="${f1(g.sy(t.v))}"/>`),
  ].join("");
  const labels = [
    ...xt.ticks.map((t) => `<text x="${f1(g.sx(t.v))}" y="${H - g.B + 14}" text-anchor="middle">${esc(t.label)}</text>`),
    ...yt.ticks.map((t) => `<text x="${g.L - 4}" y="${f1(g.sy(t.v) + 4)}" text-anchor="end">${esc(t.label)}</text>`),
  ].join("");
  const xlab = [p.xname, [xt.scale, supText(p.xunit)].filter(Boolean).join(" ")].filter(Boolean).join(" / ");
  const ylab = [yt.scale, supText(p.yunit)].filter(Boolean).join(" ");
  // curves, split where values are missing; bands behind them
  const curves = p.series.map((s, j) => {
    const color = PLOT_COLORS[j % PLOT_COLORS.length];
    const dash = j >= PLOT_COLORS.length ? ' stroke-dasharray="5 3"' : "";
    let line = "", band = "", seg = [], bseg = [];
    const flush = () => {
      if (seg.length === 1) line += `<circle cx="${seg[0][0]}" cy="${seg[0][1]}" r="2.5" fill="${color}"/>`;
      else if (seg.length) line += `<path d="M${seg.map((pt) => pt.join(",")).join("L")}" stroke="${color}"${dash}/>`;
      if (bseg.length > 1) band += `<path d="M${bseg.map((b) => `${b[0]},${b[1]}`).join("L")}L${bseg.reverse().map((b) => `${b[0]},${b[2]}`).join("L")}Z" fill="${color}"/>`;
      seg = [];
      bseg = [];
    };
    p.x.forEach((xv, i) => {
      const yv = s.y[i];
      if (!g.okx(xv) || !g.oky(yv)) { flush(); return; }
      const X = f1(g.sx(xv));
      seg.push([X, f1(g.sy(yv))]);
      if (s.lo && g.oky(s.lo[i]) && g.oky(s.hi[i])) bseg.push([X, f1(g.sy(s.lo[i])), f1(g.sy(s.hi[i]))]);
    });
    flush();
    return { line, band };
  });
  const few = p.x.filter((_, i) => g.inx(i)).length <= 30;
  const dots = few ? p.series.map((s, j) => p.x.map((xv, i) => (g.okx(xv) && g.oky(s.y[i]) ? `<circle cx="${f1(g.sx(xv))}" cy="${f1(g.sy(s.y[i]))}" r="2.2" fill="${PLOT_COLORS[j % PLOT_COLORS.length]}"/>` : "")).join("")).join("") : "";
  const asym = p.showAsym && p.asym ? asymSVG(p, g) : "";
  const clip = `plot-clip-${++plotClip}`;
  return `<defs><clipPath id="${clip}"><rect x="${g.L}" y="${g.T}" width="${g.pw}" height="${g.ph}"/></clipPath></defs>
    <g class="grid">${grid}</g>
    <rect class="frame" x="${g.L}" y="${g.T}" width="${g.pw}" height="${g.ph}"/>
    <g clip-path="url(#${clip})"><g class="bands">${curves.map((c) => c.band).join("")}</g>
    ${asym}<g class="curves">${curves.map((c) => c.line).join("")}${dots}</g></g>
    <g class="ticks">${labels}</g>
    <text class="axis-label" x="${g.L}" y="${g.T - 7}">${esc(ylab)}</text>
    <text class="axis-label" x="${W - g.R}" y="${H - 4}" text-anchor="end">${esc(xlab)}</text>
    <g class="cursor" visibility="hidden"><line y1="${g.T}" y2="${H - g.B}"/>${p.series.map((s, j) => `<circle r="3.5" fill="${PLOT_COLORS[j % PLOT_COLORS.length]}"/>`).join("")}</g>`;
}

// the asymptotes of a plot in view, dashed: the lines are drawn through
// points across the view, for log axes
function asymSVG(p, g) {
  const f1 = (v) => v.toFixed(1);
  let out = (p.asym.v || []).filter((x) => g.okx(x)).map((x) => `<line x1="${f1(g.sx(x))}" x2="${f1(g.sx(x))}" y1="${g.T}" y2="${g.H - g.B}"/>`).join("");
  for (const [[xa, ya], [xb, yb]] of p.asym.lines || []) {
    if ([xa, ya, xb, yb].includes(null) || xa === xb) continue;
    const T0 = g.tx(g.x0), T1 = g.tx(g.x1);
    let seg = [];
    const flush = () => {
      if (seg.length > 1) out += `<path d="M${seg.join("L")}"/>`;
      seg = [];
    };
    for (let i = 0; i <= 64; i++) {
      const x = g.ux(T0 + ((T1 - T0) * i) / 64), y = ya + ((x - xa) * (yb - ya)) / (xb - xa);
      if (g.okx(x) && g.oky(y)) seg.push(`${f1(g.sx(x))},${f1(g.sy(y))}`);
      else flush();
    }
    flush();
  }
  return `<g class="asym">${out}</g>`;
}

// the chips below a plot: log scales, and in the zoom view fit and reset
function plotChips(p, full) {
  const g = plotGeom(p);
  const tog = (ax, can, on) => (can ? `<button class="chip${on ? " on" : ""}" data-plotlog="${ax}" aria-pressed="${on}">log ${ax}</button>` : "");
  const extra = !full ? ""
    : (p.range ? `<button class="chip${p.showAsym ? " on" : ""}" data-plotasym aria-pressed="${Boolean(p.showAsym)}">Asymptotes</button>` : "") +
      (p.view && p.view.y0 !== undefined ? '<button class="chip" data-plotfit>Fit y</button>' : "") +
      (p.view ? '<button class="chip" data-plotreset>Reset</button>' : "");
  return `${tog("x", p.canlogx, g.logx)}${tog("y", p.canlogy, g.logy)}${extra}`;
}

function plotLegend(p) {
  return p.series.length > 1 ? `<div class="plot-legend">${p.series.map((s, j) =>
    `<span class="lg"><i style="background:${PLOT_COLORS[j % PLOT_COLORS.length]}"></i>${s.head}</span>`).join("")}</div>` : "";
}

function plotHTML(p) {
  return `<svg class="plot-svg" viewBox="0 0 ${PLOT_W} ${PLOT_H}" role="img" aria-label="Plot">${plotSVG(p)}</svg>${plotLegend(p)}
    <div class="plot-bar"><div class="plot-read">Tap the plot to zoom, drag to read values</div>${plotChips(p, false)}</div>`;
}

// the point nearest to clientX: moves the cursor and writes its values
function plotRead(svg, p, clientX) {
  const vb = svg.viewBox.baseVal;
  const g = plotGeom(p, vb.width, vb.height);
  const box = svg.getBoundingClientRect();
  const vx = ((clientX - box.left) / box.width) * vb.width;
  let best = -1, bd = Infinity;
  p.x.forEach((xv, i) => {
    if (!g.okx(xv) || !g.inx(i) || !p.series.some((s) => g.oky(s.y[i]))) return;
    const d = Math.abs(g.sx(xv) - vx);
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0) return;
  const cur = svg.querySelector(".cursor");
  const X = g.sx(p.x[best]);
  cur.setAttribute("visibility", "visible");
  const line = cur.querySelector("line");
  line.setAttribute("x1", X);
  line.setAttribute("x2", X);
  cur.querySelectorAll("circle").forEach((c, j) => {
    const y = p.series[j].y[best];
    const shown = g.oky(y) && g.sy(y) >= g.T && g.sy(y) <= g.H - g.B;
    c.setAttribute("visibility", shown ? "visible" : "hidden");
    if (shown) { c.setAttribute("cx", X); c.setAttribute("cy", g.sy(y)); }
  });
  const num = (v) => esc(formatNumber(v, 5)).replace(/^-/, "−");
  const val = (s) => {
    const y = s.y[best];
    if (y === null) return "–";
    let err = "";
    if (s.lo && s.lo[best] !== null) {
      const up = s.hi[best] - y, dn = y - s.lo[best], e2 = (v) => esc(formatNumber(v, 2));
      err = ` <span class="pm">${Math.abs(up - dn) <= 0.05 * Math.max(up, dn) ? `±${e2(up)}` : `+${e2(up)} −${e2(dn)}`}</span>`;
    }
    return num(y) + err;
  };
  const xs = `${p.xname ? exprHTML(p.xname) + " = " : ""}${num(p.x[best])}${p.xunit ? ` <span class="u">${esc(p.xunit)}</span>` : ""}`;
  const ys = p.series.map((s, j) => `<span class="lg"><i style="background:${PLOT_COLORS[j % PLOT_COLORS.length]}"></i>${val(s)}</span>`).join(" ");
  svg.closest(".plot").querySelector(".plot-read").innerHTML = `${xs} → ${ys}${p.yunit ? ` <span class="u">${esc(p.yunit)}</span>` : ""}`;
}

function plotCSV(p) {
  const cols = [[`${p.xname || "x"}${p.xunit ? ` [${p.xunit}]` : ""}`, p.x]];
  p.series.forEach((s, j) => {
    const name = p.series.length > 1 ? `y${j + 1}` : "y";
    const u = p.yunit ? ` [${p.yunit}]` : "";
    cols.push([name + u, s.y]);
    if (s.lo) { cols.push([`${name} low${u}`, s.lo]); cols.push([`${name} high${u}`, s.hi]); }
  });
  return [cols.map((c) => `"${c[0]}"`).join(","), ...p.x.map((_, i) => cols.map((c) => (c[1][i] ?? "")).join(","))].join("\n");
}

// ---------------------------------------------------------------------
// History

const historyEl = $("#history");

function saveHistory() {
  if (state.history.length > 300) state.history = state.history.slice(-300);
  store.set("history", state.history);
}

function renderEntry(e, i) {
  const div = document.createElement("div");
  div.className = "entry" + (e.kind === "error" ? " error" : "");
  div.dataset.i = i;
  let out = "";
  if (e.kind === "value") {
    const rid = hasResult(e) ? `<span class="rid" title="Tap to insert ans_${e.rid}">${(state.calc && prettyName(`ans_${e.rid}`, { unit: false })) || `ans_${e.rid}`}</span>` : "";
    const name = e.name ? `<span class="name">${(state.calc && prettyName(e.name, { unit: false })) || esc(e.name)} =</span>` : "";
    out = e.table
      ? `<div class="out tbl"><div class="tbl-head">${rid}${name}</div>${e.html}</div>`
      : `<div class="out">${rid}${name}${e.html}</div>`;
  } else if (e.kind === "plot") {
    out = `<div class="out plot">${plotHTML(e.plot)}</div>`;
  } else if (e.kind === "error") {
    out = `<div class="out">${esc(e.message)}</div>`;
  } else if (e.kind === "info") {
    out = `<div class="out small info">${e.title ? `<h3>${esc(e.title)}</h3>` : ""}${esc(e.text)}</div>`;
  } else if (e.kind === "list") {
    const items = e.items.slice(0, 120).map((it) =>
      `<button class="chip" data-insert="${esc(it.name)}" title="${esc(it.doc || "")}">${esc(it.name)}</button>`).join("");
    out = `<div class="out small info"><h3>${esc(e.title)} (${e.items.length})</h3></div><div class="list">${items}</div>`;
  } else if (e.kind === "done") {
    out = `<div class="out small">${esc(e.text)}</div>`;
  }
  const m2 = state.settings.typeset && state.calc ? mathML(e.input, { always: true }) : "";
  div.innerHTML = `<div class="in${m2 ? " in2d" : ""}" title="${esc(e.input)}">${m2 || exprHTML(e.input)}</div>${out}`;
  return div;
}

// Examples on the empty history: a few at a time, one replaced every few seconds
const EXAMPLES = [
  // everyday conversions
  "100 km/h @ mph", "37 °C @ °F", "12 m + 3 cm @ km", "20 m/s @ km|hour", "5 ft + 10 in @ cm",
  "1 atm @ psi|mmHg", "42.195 km / 2h 1m 9s @ km/h", "(30, 50, 90, 130)[km/h] @ mph", "(1, 5, 10, 42.195) km @ mi", "1 ft / c @ ns",
  "-40 °F @ °C", "~10 °C @ °F", "20 °C + ~5 K @ °C", "3[kW] 8[hour] 0.25[EUR/kWh]",
  "1[kg] 4.186[J/g K] 80[K] @ kWh", "1/2 1200[kg] (100[km/h])^2 @ kJ", "1 GiB / (100[Mbit/s]) @ s",
  // mechanics and gravitation
  "√(2 g (10 m)) @ km/h", "2 π sqrt((1.00 ± 0.01) m / g)", "(9.81 ± 0.02) m/s^2 (2.0 ± 0.1 s)^2 / 2",
  "sqrt(2 G M_Earth / R_Earth) @ km/s", "∛(G M_Earth siderealday^2 / (4 π^2)) @ km",
  "2 π sqrt(a_Moon^3 / (G M_Earth)) @ day", "4.4[km/s] ln(20) @ km/s", "rho_H2O g 10[m] @ atm",
  "sqrt(E_steel / rho_steel) @ km/s", "GM_Earth / a_WGS84^2", "1000[kg/m^3] g 10[m] @ bar", "9.8[m s^-2] (3[s])^2 / 2", "3.0(1)[m] 2.00(5)[m]",
  // thermal physics and chemistry
  "k 300[K] @ meV", "R 273.15[K] / 1[atm] @ l/mol", "1[atm] / (k 273.15[K]) @ cm^-3",
  "sqrt(3 k 300 K / (2 m_p)) @ m/s", "sqrt(1.4 R 293[K] / 28.97[g/mol]) @ m/s",
  "k 288 K / (28.97[u] g) @ km", "1 l rho_H2O / M_H2O @ mol", "H_vap_H2O / M_H2O @ MJ/kg",
  "T_b_C2H5OH @ °C", "T_m_W @ °C", "E_ion_H N_A @ kJ/mol", "chi_O - chi_H", "T_half_C14 log2(1 / 0.3) @ yr",
  // electromagnetism
  "epsilon0 1[m^2] / 1[mm] @ nF", "1[kΩ] 1[µF] @ ms", "1 / (2 π sqrt(10[µH] 100[pF])) @ MHz",
  "e 1[T] / (2 π m_e) @ GHz", "muBohr 1[T] / h @ GHz", "ke e^2 / 1 Å @ eV", "k 300[K] / e @ mV",
  // light and quantum physics
  "h c / (500 nm) @ eV", "h c / ((400, 550, 700) nm) @ eV", "c / 1420.405751 MHz @ cm",
  "h c / (k 5772[K]) @ *m", "exp(-10.2[eV] / (k 5772[K]))", "656.28[nm] 250[km/s] / c @ Å",
  "h / (m_e 1e6[m/s]) @ nm", "h / (m_e c) @ pm", "hbar / (m_e c alpha) @ pm", "1/2 m_e c^2 alpha^2 @ eV",
  "1 / alpha", "m_p / m_e", "ke e^2 / (G m_p^2)",
  // particles and relativity
  "m_e c^2 @ MeV", "(m_n - m_p) c^2 @ MeV", "m_Z c^2 @ GeV", "m_tau / m_mu", "hbar / (m_W c) @ am",
  "2.197[µs] c / sqrt(1 - 0.995^2) @ km", "1 / sqrt(1 - (0.90 ± 0.01)^2)",
  "G M_Earth / (c^2 R_Earth) 1[day] @ µs",
  // natural units
  "1 eV @ K|\"k\"", "m_e @ keV|\"c\"", "1 fm @ MeV|\"hbar\"|\"c\"", "1e30 kg @ \"c\"|\"G\"", "1 au @ s 'c'",
  "5[s 'c'] @ km", "1 m @ planck", "sqrt(hbar G / c^3)", "sqrt(hbar c / G) @ µg", "sqrt(hbar c^5 / G) @ GeV",
  // Sun and solar system
  "1 au / c @ min", "1 au / c @ hms", "L_Sun / (4 π au^2) @ W/m^2", "L_Sun / c^2 @ t/s", "L_Sun / (4 π 1[au]^2) @ kW/m^2", "L_Sun @ *W",
  "4 π R_Sun^2 sigma T_eff_Sun^4 @ L_Sun", "2 π au / yr @ km/s", "2 atan(R_Sun / au) @ dms",
  "2 R_Moon / a_Moon @ dms", "g_Mars / g_Earth", "(g_Venus, g_Mars, g_Jupiter) / g_Earth",
  "rho_Saturn @ g/cm^3", "M_Jupiter @ M_Earth", "P_Neptune @ yr", "v_esc_Moon @ km/h", "a_Mars / c @ min",
  "siderealday @ hms", "360 deg / siderealday @ arcsec/s", "1 yr @ dhms",
  // stars, black holes, cosmology and lensing
  "2 G M_Sun / c^2 @ km", "2 G M_Sun / (c^2 R_Sun)", "6.63e-34[kg m^2 s^-1] @ easy", "hbar c^3 / (8 π G M_Sun k) @ nK", "1.4[M_Sun] / (4/3 π (12[km])^3) @ g/cm^3",
  "L_Edd(10 M_Sun) @ L_Sun", "1 pc @ ly", "1 Jy @ erg/s cm^2 Hz", "H_0 100[Mpc] @ km/s", "1 / H_0 @ Gyr",
  "rho_c / m_p @ m^-3", "T_CMB (1 + 1100)", "D_L(1) @ Gpc", "D_A((0.5, 1, 2, 4)) @ Gpc", "scale(0.5)",
  "age(0)", "age(1100) @ kyr", "theta_E(1e12 M_Sun, 0.5, 2)", "theta_E_SIS(250 km/s, 0.5, 2)",
  "solve(D_L(z) = 1 Gpc, z, 0, 5)", "solve(age(z) = 1 Gyr, z, 1)", "diff(age(z), z, 1) @ Gyr",
  // mathematics
  "solve(x = 5(1 - exp(-x)), x, 1, 10)", "solve(E - 0.2 sin(E) = 1, E, 0, 2)", "solve(tan(x) = x, x, 4, 4.6)",
  "solve(cos(x) = x, x, 0, 1)", "roots(x^3 - 6x^2 + 11x = 6, x)", "polyroots((1, 0, 1))",
  "integrate(x^3/(exp(x) - 1), x, 0, inf)", "integrate(exp(-x^2), x, -inf, inf)",
  "integrate(9.81 m/s^2, t, 0 s, 2 s)", "limit(sin(x)/x, x, 0)", "limit((1 + 1/x)^x, x, inf)",
  "sum(1/k^2, k, 1, inf)", "sum(1/k^3, k, 1, inf)", "1 rad @ dms", "0.375 @ frac",
  // lists, vectors and statistics
  "linspace(0 m, 10 m, 6)", "logspace(1, 1000, 4)", "mean((9.79, 9.82, 9.81) m/s^2)", "norm((3, 4, 0) N)",
  "dot((3, 4, 0) N, (2, 0, 1) m)", "cross((1, 0, 0) m, (0, 2, 0) N)", "angle((1, 1, 0), (1, 0, 0)) @ deg",
  "e cross((1e6, 0, 0) m/s, (0, 0, 1) T)", "pvalue(5)", "nsigma(0.05)", "conf(2)", "chi2_p(12.3, 5)",
  "2.3 nm fwhm", "N(1, 0.1)",
  // plots
  "plot(sin(x), x, 0, 2 pi)", "plot(tan(x), x, -pi, pi)", "plot(x^3/(exp(x) - 1), x, 0, 12)",
  "plot(1/sqrt(1 - v^2/c^2), v, 0, 0.99 c)", "plot(g t^2 / 2, t, 0 s, 5 s)", "plot(sin(x)/x, x, -20, 20)",
  "plot((D_L(z), D_A(z)) @ Gpc, z, 0, 5)", "plot(age(z), z, 0.01, 100)",
  // help and discovery
  "pc!", "light!!", "%compatible [Pa]",
];
const EXAMPLES_SHOWN = 6, EXAMPLES_EVERY = 5000;
let exampleTimer = 0;

function pickExamples(n, avoid = []) {
  const pool = EXAMPLES.filter((x) => !avoid.includes(x));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

const exampleHTML = (x) => `<button data-try="${esc(x)}">${exprHTML(x)}</button>`;

function rotateExample() {
  const box = historyEl.querySelector(".empty .try");
  if (!box) { clearInterval(exampleTimer); exampleTimer = 0; return; }
  if (document.hidden) return;
  const btns = [...box.children];
  const old = btns[Math.floor(Math.random() * btns.length)];
  const [x] = pickExamples(1, btns.map((b) => b.dataset.try));
  old.classList.add("leaving");
  setTimeout(() => {
    if (!old.isConnected) return;
    old.insertAdjacentHTML("afterend", exampleHTML(x));
    old.nextElementSibling.classList.add("arriving");
    old.remove();
  }, 300);
}

function renderHistory() {
  historyEl.innerHTML = "";
  clearInterval(exampleTimer);
  exampleTimer = 0;
  if (!state.history.length) {
    historyEl.innerHTML = `<div class="empty"><p>Enter a number, add units from the <b>Units</b> keys, then convert with <b>@</b>. Your calculations stay here: scroll back and tap one to reuse it.</p>
      <div class="try">${pickExamples(EXAMPLES_SHOWN).map(exampleHTML).join("")}</div></div>`;
    exampleTimer = setInterval(rotateExample, EXAMPLES_EVERY);
    return;
  }
  const frag = document.createDocumentFragment();
  const hint = document.createElement("div");
  hint.className = "hist-hint";
  hint.textContent = "Tap an expression to reuse it, a result to insert it as ans_n";
  frag.appendChild(hint);
  state.history.forEach((e, i) => frag.appendChild(renderEntry(e, i)));
  historyEl.appendChild(frag);
  scrollHistory();
}

function appendEntry(e) {
  if (!state.history.length) {
    state.history.push(e);
    saveHistory();
    return renderHistory();
  }
  state.history.push(e);
  saveHistory();
  historyEl.appendChild(renderEntry(e, state.history.length - 1));
  scrollHistory();
}

function scrollHistory() {
  requestAnimationFrame(() => { historyEl.scrollTop = historyEl.scrollHeight; });
}

const lastValue = () => state.history.some((e) => e.kind === "value");

// Results: the n-th one since the last clear is ans_n, the latest also ans.
// The value lives in memory with its samples and correlations; each entry
// keeps a copy (value, linear errors, units) so that it survives a reload.
let results = new Map();       // rid -> Q
let restoredIds = new Map();   // error source ids of a saved session -> new ids
let resultNames = [];          // the ans_n now defined in the calculator
const restored = new Set();    // rids restored from their saved copy

function packResult(q) {
  if (Array.isArray(q)) {
    const vs = q.map(packResult);
    return vs.every(Boolean) && q.length <= 2000 ? { list: vs } : null;
  }
  if (!Number.isFinite(q.x.n)) return null;
  try {
    return JSON.parse(JSON.stringify({ n: q.x.n, c: q.x.c ? [...q.x.c] : null, d: q.d, zero: q.zero, show: q.show }));
  } catch {
    return null;
  }
}

function unpackResult(v) {
  if (v.list) return v.list.map(unpackResult);
  const id = (k) => restoredIds.get(k) ?? restoredIds.set(k, newSourceId()).get(k);
  const c = v.c ? new Map(v.c.map(([k, s]) => [id(k), s])) : null;
  return new Q(new UNum(v.n, c), v.d, v.zero, v.show || null);
}

function newRid() {
  const rid = Math.max(store.get("rid", 0), ...state.history.map((e) => e.rid || 0)) + 1;
  store.set("rid", rid);
  return rid;
}

const hasResult = (e) => e.rid && (results.has(e.rid) || e.val);

// define ans_n and ans for the results in the history (and only those)
function installResults(calc = state.calc) {
  if (!calc) return;
  const vars = calc.env.vars;
  for (const k of resultNames) vars.delete(k);
  resultNames = [];
  const live = new Map();
  let last = null;
  for (const e of state.history) {
    if (e.kind !== "value" || !e.rid) continue;
    let q = results.get(e.rid);
    if (!q && e.val) {
      q = unpackResult(e.val);
      if (e.val.c) restored.add(e.rid);
    }
    if (!q) continue;
    // samples from another sample size are redrawn from the linear errors
    const fit = (v) => (Array.isArray(v) ? v.map(fit) : v.x.s && v.x.s.length !== MC.N ? new Q(new UNum(v.x.n, v.x.c), v.d, v.zero, v.show) : v);
    q = fit(q);
    live.set(e.rid, q);
    const name = `ans_${e.rid}`;
    vars.set(name, q);
    calc.systemNames.add(name);
    resultNames.push(name);
    last = q;
  }
  results = live;
  for (const rid of restored) if (!live.has(rid)) restored.delete(rid);
  if (last) vars.set("ans", last);
  else vars.delete("ans");
}

// Restored Monte Carlo results have no samples: evaluate their expressions
// again, in order, and keep the new value (with samples consistent with the
// other results) when it agrees with the saved one, since the variables used
// may have changed since; the others stay Gaussian
function resampleResults(calc) {
  if (!MC.on || !restored.size) return;
  const vars = calc.env.vars;
  const t0 = performance.now();
  vars.delete("ans");
  for (const e of state.history) {
    const q0 = e.kind === "value" && results.get(e.rid);
    if (!q0) continue;
    if (restored.has(e.rid) && performance.now() - t0 < 1000) {
      let q = null;
      try { q = evalPreview(e.input, calc); } catch {}
      if (q && sameResult(q, e.val)) {
        results.set(e.rid, q);
        vars.set(`ans_${e.rid}`, q);
      }
    }
    vars.set("ans", results.get(e.rid));
  }
  restored.clear();
}

function sameResult(q, v) {
  const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
  const sd = (c) => Math.hypot(...(c ? [...c].map(([, s]) => s) : []));
  return close(q.x.n, v.n) && close(sd(q.x.c), sd(v.c)) && dimEq(q.d, v.d) &&
    (q.zero === false ? v.zero === false : v.zero !== false && close(q.zero, v.zero));
}

// ---------------------------------------------------------------------
// Expression editor

const exprEl = $("#expr");
const previewEl = $("#preview");

function setInput(text, caret = text.length) {
  // "+/-" typed becomes "±"
  if (text.includes("+/-")) {
    const before = text.slice(0, caret).split("+/-").length - 1;
    text = text.replace(/\+\/-/g, "±");
    caret -= 2 * before;
  }
  state.text = text;
  state.caret = Math.max(0, Math.min(text.length, caret));
  onInput();
}

function setCaret(c, dir = 0) {
  c = Math.max(0, Math.min(state.text.length, c));
  for (const [s, e] of state.atoms || []) {
    if (c > s && c < e) c = dir < 0 ? s : dir > 0 ? e : (c - s < e - c ? s : e);
  }
  state.caret = c;
  renderEditor();
  updateSuggestions();
}

function insert(text, { caretBack = 0, replaceBefore = 0 } = {}) {
  const v = state.text;
  const a = Math.max(0, state.caret - replaceBefore);
  setInput(v.slice(0, a) + text + v.slice(state.caret), a + text.length - caretBack);
}

const before = () => state.text.slice(0, state.caret);
const after = () => state.text.slice(state.caret);

// Classify the text before the caret for inserting a unit:
//   "spec"  after @ (conversion target)
//   "bare"  right after a number or a bare unit chain: 12 km/  -> 12 km/h
//   "other" anywhere else: units go in brackets, 3 x[m]
// Depth of open [ before the end of b (quotes skipped)
function bracketDepth(b) {
  let d = 0, q = null;
  for (const ch of b) {
    if (q) { if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') q = ch;
    else if (ch === "[") d++;
    else if (ch === "]") d = Math.max(0, d - 1);
  }
  return d;
}

function unitContext(b) {
  if (bracketDepth(b) > 0) return "inside";
  if (lastAt(b) >= 0) return "spec";
  let toks;
  try { toks = tokenize(normalize(b)); } catch { return "other"; }
  if (!toks.length) return "other";
  const e = env();
  const t = (j) => toks[j] && toks[j].t;
  const isU = (j) => {
    const k = toks[j];
    if (!k || k.t !== "id") return false;
    const iu = e.isunit(k.v);
    return Boolean(iu && iu[1] !== "");
  };
  let i = toks.length - 1;
  let slash = false;
  if (t(i) === "/") { slash = true; i--; }
  let units = 0;
  for (;;) {
    let j = i;
    if (t(j) === "num" && t(j - 1) === "^") j -= 2;
    else if (t(j) === "num" && t(j - 1) === "-" && t(j - 2) === "^") j -= 3;
    if (!isU(j)) break;
    units++;
    i = j - 1;
    if (t(i) === "/") i--;
  }
  if (t(i) === "num" && t(i - 1) !== "^" && (units || !slash)) return "bare";
  return "other";
}

const isBareUnit = (name) => {
  const iu = env().isunit(name);
  return Boolean(iu && iu[1] !== "");
};

// Insert a unit where it will be read as one
function insertUnit(name) {
  const b = before();
  const ctx = unitContext(b);
  if (ctx === "inside") {
    insert((/[\s[/(*]$/.test(b) ? "" : " ") + name);
  } else if (ctx === "spec") {
    insert((/[\s@|/(]$/.test(b) ? "" : " ") + name);
  } else if (ctx === "bare" && state.settings.brackets && /[\d.]\s*$/.test(b)) {
    // a number: start a bracketed unit, 9.8[m]
    insert("[" + name + "]");
  } else if (ctx === "bare") {
    insert((/[\s/]$/.test(b) ? "" : " ") + name);
  } else if (/\]\s*\/$/.test(b)) {
    // 5[m]/ + s  ->  5[m/s]
    const m = /\]\s*\/$/.exec(b);
    const nb = b.slice(0, m.index) + "/" + name + "]";
    setInput(nb + after(), nb.length);
  } else if (/\]$/.test(b)) {
    // 5[m] + s  ->  5[m s]
    const nb = b.slice(0, -1) + " " + name + "]";
    setInput(nb + after(), nb.length);
  } else {
    insert("[" + name + "]");
  }
}

// Systems and formats go after @ (added when missing)
function insertTarget(name) {
  if (lastAt(before()) >= 0) return insertUnit(name);
  const v = state.text.trimEnd();
  setInput(v + " @ " + name);
}

// Wrap the name before the cursor in quotes, swap the quote kind, or
// insert an empty pair: 'c' keeps a variable in the unit, "c" removes it
function quoteName(q) {
  if (/\]$/.test(before()) && bracketDepth(before()) === 0) setCaret(state.caret - 1, -1);
  const b = before();
  let m = /(['"])([\p{L}_][\p{L}\p{N}_]*)\1$/u.exec(b);
  if (m) {
    const nb = b.slice(0, m.index) + q + m[2] + q;
    return setInput(nb + after(), nb.length);
  }
  m = /([\p{L}_][\p{L}\p{N}_]*)$/u.exec(b);
  if (m && env().vars.has(m[1])) {
    const nb = b.slice(0, m.index) + q + m[1] + q;
    return setInput(nb + after(), nb.length);
  }
  insert((/[\p{L}\p{N}_)\]]$/u.test(b) ? " " : "") + q + q, { caretBack: 1 });
}

// [ ]: open a bracket, or step out of the one the cursor is in
function bracketKey() {
  if (/\]$/.test(before()) && bracketDepth(before()) === 0) {
    // step back into the bracket just closed: 5[s] -> 5[s|]
    return setCaret(state.caret - 1, -1);
  }
  if (bracketDepth(before()) > 0) {
    const i = after().indexOf("]");
    if (i >= 0) return setCaret(state.caret + i + 1, 1);
    return insert("]");
  }
  insert("[]", { caretBack: 1 });
}

// x², x³ for units: inside brackets when the unit is bracketed
function insertPower(p) {
  const b = before();
  if (/\]$/.test(b) && unitContext(b) === "other") {
    const nb = b.slice(0, -1) + "^" + p + "]";
    setInput(nb + after(), nb.length);
  } else insert("^" + p);
}

// Insert a variable or constant (implicit multiplication by a space)
function insertName(name) {
  const b = before();
  const ctx = unitContext(b);
  const plain = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name);
  if (plain && /^'$/.test(b.slice(-1)) && after()[0] === "'") {
    // inside an empty pair of quotes
    insert(name);
    return setCaret(state.caret + 1, 1);
  }
  if (ctx === "inside" && plain) {
    // a variable in a unit bracket: 5[s 'c']
    insert((/[\s[/(*]$/.test(b) ? "" : " ") + `'${name}'`);
    return;
  }
  if (ctx === "spec" && plain && !isBareUnit(name)) {
    insert((/[\s@|/(]$/.test(b) ? "" : " ") + `'${name}'`);
    return;
  }
  let sep = "";
  if (/[\p{L}\p{N}_.)\]°µΩ!]$/u.test(b)) sep = " ";
  // after a number, a name that is also a unit (h, g) would be read as the unit
  if (ctx === "bare" && !["M_Sun", "L_Sun", "R_Sun", "M_Earth", "R_Earth", "M_Jupiter", "R_Jupiter"].includes(name) && isBareUnit(name.replace(/\[.*$/, ""))) sep = /\s$/.test(b) ? "* " : " * ";
  insert(sep + name);
}

// ", " between arguments and list items
function insertComma() {
  const sp = /\s+$/.exec(before());
  insert(", ", { replaceBefore: sp ? sp[0].length : 0 });
}

function insertFunction(f) {
  const b = before();
  insert((/[\p{L}\p{N}_.)\]°]$/u.test(b) ? " " : "") + f);
}

// Operators: spaces around + − ×, none around / and ^
function insertOp(op) {
  let b = before();
  if (!state.text.trim() && op !== "-" && lastValue()) {
    setInput("ans");
    b = "ans";
  }
  if (op === "/" || op === "^") return insert(op);
  const unary = !b.trim() || /[([^,=*/+\-±@|~]\s*$/.test(b) || /\d[eE]$/.test(b);
  if (op === "-" && unary) return insert("-");
  if (op === "+" && /\d[eE]$/.test(b)) return insert("+");
  insert(op);   // no spaces around operators
}

function backspace({ chars = state.tab === "abc" } = {}) {
  const v = state.text;
  const a = state.caret;
  if (a === 0) return;
  const b = v.slice(0, a);
  let rest = v.slice(a);
  let n = 1;
  // after a bracket: edit inside it, 5[km/h] -> 5[km]
  if (!chars && /\]$/.test(b)) {
    const open = b.lastIndexOf("[");
    if (open >= 0) {
      let inner = b.slice(open + 1, -1);
      const m = /(?:[\p{L}_°µΩÅ][\p{L}\p{N}_]*|'[^']*'|"[^"]*"|\^-?\d+(?:\/\d+)?|[\s\S])\s*$/u.exec(inner);
      inner = m ? inner.slice(0, m.index).replace(/[\s/]+$/, "") : "";
      const nb = inner ? b.slice(0, open + 1) + inner + "]" : b.slice(0, open);
      return setInput(nb + rest, nb.length);
    }
  }
  let m;
  if (/ [-+*@±|] $/.test(b)) n = 3;
  else if (/^\s*@ $/.test(b)) n = b.length;
  else if (!chars && (m = /([\p{L}_][\p{L}\p{N}_]*)\($/u.exec(b))) n = m[0].length;
  else if (!chars && (m = /(^|[\s[/*(|@-])([\p{L}_°µΩÅ][\p{L}\p{N}_]*)$/u.exec(b))) {
    // whole unit and constant names, as they were entered with one key
    const w = m[2];
    const e = env();
    if (isBareUnit(w) || e.vars.has(w) || ["pi", "tau", "ans"].includes(w)) {
      n = w.length;
      if (m[1] === " " && !/[@|] $/.test(b.slice(0, b.length - w.length))) n++;
    }
  }
  if (n === 1 && !chars) {
    const atomBefore = (state.atoms || []).find(([s, e, kind]) => e === a && kind === "name");
    if (atomBefore) n = a - atomBefore[0];
  }
  const nb = b.slice(0, a - n);
  if (/[[(]$/.test(b) && /^[\])]/.test(rest) && n === 1) rest = rest.slice(1);
  setInput(nb + rest, nb.length);
}

// Syntax colouring and typesetting: [{s, e, cls, html, atom}]. Atoms
// (typeset names, exponents) are drawn as one glyph group; the caret
// stops only at their ends.
const SEG_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d*)?|\^\(\s*-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?\s*\)|\^-?\d+(?:\.\d+)?(?:\/\d+)?|[\p{L}_°µΩÅ][\p{L}\p{N}_]*|'[^']*'?|"[^"]*"?|\s+|[\s\S]/gu;

function segments(text) {
  const segs = [];
  const at = lastAt(text);
  const e = env();
  const re = new RegExp(SEG_RE.source, "gu");
  let depth = 0, unitCtx = false, prev = "";
  let m;
  while ((m = re.exec(text))) {
    let s = m[0];
    const i = m.index;
    const inUnit = depth > 0 || (at >= 0 && i > at);
    let cls = "", html = null, atom = null;
    if (i === at) { cls = "at"; unitCtx = false; }
    else if (/^[\d.]/.test(s) && s !== ".") { cls = "n"; unitCtx = true; }
    else if (s[0] === "^" && s.length > 1) {
      let body = s.slice(1);
      if (!inUnit && body[0] !== "(" && body.includes("/")) {
        // x^1/2 is (x^1)/2 outside units
        body = body.slice(0, body.indexOf("/"));
        s = "^" + body;
        re.lastIndex = i + s.length;
      }
      const inner = body.replace(/^\(|\)$/g, "").replace(/\s+/g, "").replace("-", "−");
      cls = prev === "u" || prev === "v" ? prev : "n";
      html = `<sup>${esc(inner)}</sup>`;
      atom = "exp";
    } else if (/^[\p{L}_°µΩÅ]/u.test(s)) {
      const fn = text[i + s.length] === "(";
      const unit = isBareUnit(s);
      if (fn) cls = "f";
      else if (inUnit) cls = "u";
      else cls = unit && (unitCtx || !e.vars.has(s)) ? "u" : "v";
      unitCtx = cls === "u";
      html = prettyName(s, { fn, unit: cls === "u" });
      if (html) atom = "name";
    } else if ((s[0] === "'" || s[0] === '"') && s.length > 2 && s.at(-1) === s[0]) {
      cls = "u";
      const n = s.slice(1, -1);
      const ph = prettyName(n, { unit: false });
      if (ph) { html = esc(s[0]) + ph + esc(s[0]); atom = "name"; }
    } else if (s === "[") { depth++; cls = "u"; unitCtx = false; }
    else if (s === "]") { depth = Math.max(0, depth - 1); cls = "u"; unitCtx = false; }
    else if (/^\s+$/.test(s)) { /* keep context */ }
    else if (s === "/" || s === "^") cls = inUnit ? "u" : "op";
    else if (/^[-+*=±~,|]$/.test(s)) { cls = inUnit ? "u" : "op"; unitCtx = false; }
    else unitCtx = false;
    if (cls) prev = cls;
    // spaces are drawn narrow; * after @ is the prefix wildcard, not ×
    segs.push({ s: i, e: i + s.length, cls, html, atom, sp: /^\s+$/.test(s), raw: s === "*" && inUnit });
  }
  return segs;
}

const SHOW_CHAR = { "*": "×", "-": "−" };
const showText = (s) => esc(s.replace(/[*-]/g, (c) => SHOW_CHAR[c]));

function segHTML(t, sg, s = sg.s, e = sg.e) {
  const cls = (sg.cls ? "t-" + sg.cls : "") + (sg.atom ? " atom" : "") + (sg.sp ? " sp" : "") + (sg.rb ? " " + sg.rb : "") + (sg.br ? " " + sg.br : "");
  if (sg.atom) return `<span class="${cls}" data-s="${sg.s}" data-e="${sg.e}">${sg.html}</span>`;
  const text = t.slice(s, e);
  return e > s ? `<span class="${cls}" data-s="${s}">${sg.raw ? esc(text) : showText(text)}</span>` : "";
}

// Parentheses (outside atoms and strings), both optional in Settings;
// unit brackets cannot nest, so they are left alone:
// - match: the parenthesis next to the caret (before it, else after it)
//   and its partner are marked "br-match"; one without a partner is
//   marked "br-bad" (drawn as set by data-br on .expr);
// - rainbow: each pair is coloured by its depth ("rb0"…"rb3"); closing
//   parentheses without a partner are "br-bad".
function markBrackets(segs, t, c, { match, rainbow }) {
  if (!match && !rainbow) return;
  const br = segs.filter((sg) => !sg.atom && sg.e - sg.s === 1 && (t[sg.s] === "(" || t[sg.s] === ")"));
  const partners = new Map();
  const stack = [];
  for (const sg of br) {
    if (t[sg.s] === "(") {
      if (rainbow) sg.rb = "rb" + (stack.length % 4);
      stack.push(sg);
      continue;
    }
    const o = stack.pop();
    if (o) { partners.set(sg, o); partners.set(o, sg); }
    if (rainbow) {
      if (o) sg.rb = o.rb;
      else sg.br = "br-bad";
    }
  }
  if (!match) return;
  const at = br.find((sg) => sg.e === c) || br.find((sg) => sg.s === c);
  if (!at) return;
  const partner = partners.get(at);
  at.br = partner ? "br-match" : "br-bad";
  if (partner) partner.br = at.br;
}

// Typeset expression without caret (history)
function exprHTML(t) {
  if (!state.calc) return esc(t);
  try {
    return segments(t).map((sg) => segHTML(t, sg)).join("");
  } catch {
    return esc(t);
  }
}

function renderEditor() {
  const t = state.text;
  let c = state.caret;
  const caret = '<span class="caret" aria-hidden="true"></span>';
  if (!t) {
    state.atoms = [];
    exprEl.innerHTML = caret + '<span class="ph">100 km/h @ mph</span>';
    exprEl.setAttribute("aria-label", "Expression, empty");
    return;
  }
  const segs = segments(t);
  state.atoms = segs.filter((sg) => sg.atom).map((sg) => [sg.s, sg.e, sg.atom]);
  const brStyle = state.settings.bracketMatch || "fill";
  exprEl.dataset.br = brStyle;
  markBrackets(segs, t, c, { match: brStyle !== "none", rainbow: Boolean(state.settings.rainbow) });
  let html = "";
  for (const sg of segs) {
    if (sg.atom) {
      html += (c === sg.s ? caret : "") + segHTML(t, sg);
      if (c > sg.s && c < sg.e) html += caret;
    } else if (c > sg.s && c < sg.e) html += segHTML(t, sg, sg.s, c) + caret + segHTML(t, sg, c, sg.e);
    else html += (c === sg.s ? caret : "") + segHTML(t, sg);
  }
  if (c === t.length) html += caret;
  exprEl.innerHTML = html;
  exprEl.setAttribute("aria-label", "Expression: " + t);
  const ce = $(".caret", exprEl);
  if (ce) {
    const top = ce.offsetTop, h = ce.offsetHeight;
    if (top < exprEl.scrollTop) exprEl.scrollTop = top;
    else if (top + h > exprEl.scrollTop + exprEl.clientHeight) exprEl.scrollTop = top + h - exprEl.clientHeight;
  }
}

// Index of the character boundary under a point
function caretIndexAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  const atomEl = hit && hit.closest && hit.closest("#expr [data-e]");
  if (atomEl) {
    const r = atomEl.getBoundingClientRect();
    return x < r.left + r.width / 2 ? Number(atomEl.dataset.s) : Number(atomEl.dataset.e);
  }
  let node = null, offset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  }
  const host = node && node.nodeType === 3 && node.parentElement && node.parentElement.closest("[data-s]");
  if (host && host.dataset.e === undefined && exprEl.contains(host)) return Number(host.dataset.s) + offset;
  // outside the text: nearest end of the line under the point
  let best = state.text.length, bestD = Infinity;
  for (const sp of exprEl.querySelectorAll("[data-s]")) {
    for (const r of sp.getClientRects()) {
      if (y < r.top - 2 || y > r.bottom + 2) continue;
      const s = Number(sp.dataset.s);
      const end = sp.dataset.e !== undefined ? Number(sp.dataset.e) : s + sp.textContent.length;
      const dl = Math.abs(x - r.left), dr = Math.abs(x - r.right);
      if (dl < bestD) { bestD = dl; best = s; }
      if (dr < bestD) { bestD = dr; best = end; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------
// Preview and evaluation

let previewTimer = null;

// The value of src (for an assignment, of its right side) without running it
function evalPreview(src, calc = state.calc, { lists = false } = {}) {
  const { code } = splitComment(src);
  const t = code.trim();
  if (!t || t[0] === "%" || /!$/.test(t)) return null;
  const node = parse(normalize(t), calc.env);
  if (!node || node.t === "def") return null;
  const target = node.t === "assign" ? node.value : node;
  if (target.t === "call" && target.f === "plot") return null;   // drawn on ⏎ only
  const v = calc.evalNode(target);
  return v instanceof Q || (lists && Array.isArray(v) && v.length) ? v : null;
}

// "= 4 values: 0.1, 0.5, 1, …" or "= table: 2 columns × 4 rows"
function listPreview(v) {
  if (v.some(Array.isArray)) {
    const rows = Math.max(...v.map((c) => (Array.isArray(c) ? c.length : 1)));
    return `<span class="eq">=</span><span class="lp">table: ${v.length} columns × ${rows} rows</span>`;
  }
  const inline = inlineList(v);
  if (inline) return `<span class="eq">=</span>${inline}`;
  const shown = v.slice(0, 3).map((q) => (q instanceof Q ? qHTMLraw(q) : "…")).join(", ");
  return `<span class="eq">=</span><span class="lp">${v.length} value${v.length > 1 ? "s" : ""}: ${shown}${v.length > 3 ? ", …" : ""}</span>`;
}

function updateMath2d() {
  const el = $("#math2d");
  const m = state.settings.typeset ? mathML(state.text) : "";
  if (m !== el._m) {
    el._m = m;
    el.innerHTML = m;
  }
  el.hidden = !m;
}

function updatePreview() {
  updateMath2d();
  clearTimeout(previewTimer);
  previewEl.classList.remove("error");
  const src = state.text;
  if (!src.trim()) { previewEl.innerHTML = ""; return; }
  try {
    const q = evalPreview(src, state.calc, { lists: true });
    previewEl.innerHTML = !q ? "" : Array.isArray(q) ? listPreview(q) : `<span class="eq">=</span>${qHTML(q)}`;
  } catch (e) {
    previewEl.innerHTML = "";
    previewTimer = setTimeout(() => {
      previewEl.classList.add("error");
      previewEl.textContent = e.message;
    }, 900);
  }
}

function onInput() {
  renderEditor();
  updatePreview();
  updateSuggestions();
}

// Does src assign to a built-in name? -> how to describe what it replaces
function builtinTarget(src) {
  const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*(\([^)]*\))?\s*=(?!=)/u.exec(src);
  if (!m) return null;
  const e = env();
  const name = e.vars.resolve(m[1]);
  const shown = m[1];
  if (m[2] && state.calc.builtins[name] && !e.vars.has(name)) return { shown, what: `the built-in function ${name}` };
  if (!state.calc.systemNames.has(name) || !e.vars.has(name)) return null;
  const v = e.vars.get(name);
  const doc = v && v.doc ? firstLine(v.doc) : "";
  return { shown, what: doc ? `the built-in ${doc.charAt(0).toLowerCase() + doc.slice(1)}` : `the built-in ${name}` };
}

function evaluate() {
  const src = state.text.trim();
  if (!src) return;
  const shadow = builtinTarget(src);
  const r = state.calc.run(src);
  if (r.kind === "error") {
    previewEl.classList.add("error");
    previewEl.textContent = r.message;
    const ed = $(".editor");
    ed.classList.remove("shake");
    void ed.offsetWidth;
    ed.classList.add("shake");
    return;
  }
  const entry = { input: src, kind: r.kind };
  if (r.kind === "value" && Array.isArray(r.q)) {
    // a list or a table
    const t = tableOf(r.q, src), inline = inlineList(r.q);
    entry.html = inline || t.html;
    entry.table = !inline;
    entry.text = listText(r.q);
    entry.csv = t.csv;
    entry.rid = newRid();
    results.set(entry.rid, r.q);
    restored.delete(entry.rid);
    const val = packResult(r.q);
    if (val) entry.val = val;
    if (r.name) entry.name = r.name;
  } else if (r.kind === "plot") {
    entry.plot = plotOf(r.plot);
  } else if (r.kind === "value") {
    entry.html = qHTML(r.q);
    entry.text = qText(r.q);
    const dist = distSummary(r.q);
    if (dist) entry.dist = dist;
    entry.rid = newRid();
    results.set(entry.rid, r.q);
    restored.delete(entry.rid);
    const val = packResult(r.q);
    if (val) entry.val = val;
    if (r.name) entry.name = r.name;
  } else if (r.kind === "info") {
    entry.title = r.title;
    entry.text = r.text;
  } else if (r.kind === "list") {
    entry.title = r.title;
    entry.items = r.items.map(({ name, doc }) => ({ name, doc }));
  } else {
    entry.kind = "done";
    entry.text = "✓ Done";
  }
  if (r.define) {
    state.session.push(src);
    if (state.session.length > 500) state.session = state.session.slice(-500);
    store.set("session", state.session);
    categoryDims = null;
    if (shadow) {
      toast(`${shadow.shown} now replaces ${shadow.what} in this session`, 8000, ["Undo", () => {
        const i = state.session.lastIndexOf(src);
        if (i >= 0) state.session.splice(i, 1);
        store.set("session", state.session);
        build();
        refresh();
        toast(`${shadow.shown} restored`);
      }]);
    }
    renderConstGrid();
    renderFnGrid();
  }
  appendEntry(entry);
  installResults();
  state.recall = -1;
  state.draft = null;
  setInput("");
}

// ---------------------------------------------------------------------
// Names: one notation, aliases by appearance
//
// Subscripts come only from "_" (Omega_M, m_e, L_Sun). Within a namespace
// (variables and functions; units; prefixes) names that are displayed the
// same are the same object: π = pi, Ω_M = Omega_M, ε_0 = epsilon_0. Old
// names (OmegaM, Msun, me…) stay accepted as hidden legacy aliases.

const LEGACY_VARS = {
  // iMKS library
  Nav: "N_A", Gfermi: "G_F", me: "m_e", mp: "m_p", muBohr: "mu_B", mu0: "mu_0", epsilon0: "epsilon_0",
  ke: "k_e", sigma: "sigma_SB", Msun: "M_Sun", Rsun: "R_Sun", Lsun: "L_Sun", H0: "H_0",
  OmegaM: "Omega_M", OmegaL: "Omega_L", OmegaCMB: "Omega_CMB", OmegaK: "Omega_K", OmegaR: "Omega_R",
  dH: "d_H", tH: "t_H",
  // names used by earlier versions of this app
  GMsun_N: "GM_Sun_N", Rsun_N: "R_Sun_N", Lsun_N: "L_Sun_N", Teff_sun: "T_eff_Sun", Mbol_sun: "M_bol_Sun",
  S_sun: "S_Sun", J2_Earth: "J_2_Earth", Phi0: "Phi_0", G0: "G_0", zeta3: "zeta_3", gammaE: "gamma_E",
  sin2thetaW: "sin2theta_W", cp_water: "c_p_water", Lvap_water: "L_vap_water", Lfus_water: "L_fus_water",
  cp_air: "c_p_air", muN: "mu_N",
};
// symbols typed for names that are not stored variables
const SYMBOL_VARS = { "π": "pi", "τ": "tau", "∞": "inf" };

const LEGACY_FNS = {
  Ez: "E", Hubble: "H", thetaE: "theta_E", thetaSIS: "theta_E_SIS", Phiinv: "Phi_inv", erfinv: "erf_inv",
  chi2_p: "p_chi2", t_p: "p_t", gamma: "Gamma", beta: "B",
};

// units kept for old expressions but not offered anywhere
const LEGACY_UNITS = new Set(["Msun", "Lsun", "Mearth", "Rearth", "Mjup", "Rjup"]);

// prefixed legacy families from earlier versions (vesc_Mars -> v_esc_Mars)
const LEGACY_PATTERNS = [
  [/^vesc_(.+)$/, "v_esc_$1"], [/^Prot_(.+)$/, "P_rot_$1"], [/^T12_(.+)$/, "T_half_$1"],
  [/^kth_(.+)$/, "k_th_$1"], [/^rhoe_(.+)$/, "rho_e_$1"],
];

// look-alike characters and typed subscript digits
function fixChars(name) {
  return name
    .replace(/\u00b5/g, "μ").replace(/\u2126/g, "Ω").replace(/\u212b/g, "Å").replace(/\u210f/g, "ħ").replace(/\u212a/g, "K")
    .replace(/([^_₀-₉])([₀-₉]+)$/, (_, a, d) => a + "_" + [...d].map((c) => c.charCodeAt(0) - 0x2080).join(""));
}

// display key of a name: the typeset form as text
function displayKey(name, fn = false) {
  const n = fixChars(name);
  let h;
  try { h = prettyName(n, fn ? { fn: true } : { unit: false }); } catch { h = null; }
  h = h || esc(n);
  return h.replace(/<sub>/g, "_{").replace(/<\/sub>/g, "}").replace(/<sup>/g, "^{").replace(/<\/sup>/g, "}")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// Variables: a Map whose keys are resolved through legacy and display aliases
class AliasMap extends Map {
  constructor(entries) {
    super();
    this.legacy = new Map(Object.entries({ ...LEGACY_VARS, ...SYMBOL_VARS }));
    this.index = new Map();
    if (entries) for (const [k, v] of entries) this.set(k, v);
  }
  resolve(k) {
    if (typeof k !== "string" || super.has(k)) return k;
    if (this.legacy.has(k)) return this.legacy.get(k);
    for (const [re, to] of LEGACY_PATTERNS) if (re.test(k)) {
      const n = k.replace(re, to);
      if (super.has(n)) return n;
    }
    const f = fixChars(k);
    if (f !== k && (super.has(f) || this.legacy.has(f))) return super.has(f) ? f : this.legacy.get(f);
    const hit = this.index.get(displayKey(k));
    return hit && super.has(hit) ? hit : k;
  }
  get(k) { return super.get(this.resolve(k)); }
  has(k) { return super.has(this.resolve(k)); }
  delete(k) { return super.delete(this.resolve(k)); }
  set(k, v) {
    const r = this.resolve(k);
    super.set(r, v);
    const key = displayKey(r);
    if (!this.index.has(key) || !super.has(this.index.get(key))) this.index.set(key, r);
    return this;
  }
  // move a stored entry to its new name, keeping the old one as an alias
  rename(from, to) {
    if (!super.has(from) || super.has(to)) return;
    const v = super.get(from);
    super.delete(from);
    this.set(to, v);
    this.legacy.set(from, to);
  }
}

// Units: legacy names stay usable but are hidden from every listing
class HidingMap extends Map {
  *entries() { for (const e of super.entries()) if (!LEGACY_UNITS.has(e[0])) yield e; }
  *keys() { for (const [k] of this.entries()) yield k; }
  *values() { for (const [, v] of this.entries()) yield v; }
  [Symbol.iterator]() { return this.entries(); }
  forEach(f, t) { for (const [k, v] of this.entries()) f.call(t, v, k, this); }
}

function installAliases(calc) {
  const env = calc.env;
  const vars = new AliasMap();
  for (const [k, v] of Map.prototype.entries.call(env.vars)) Map.prototype.set.call(vars, k, v);
  for (const k of Map.prototype.keys.call(vars)) vars.index.set(displayKey(k), k);
  env.vars = vars;
  for (const [from, to] of Object.entries(LEGACY_VARS)) {
    if (to === "m_e" || to === "m_p") {
      Map.prototype.delete.call(vars, from);
      continue;
    }
    vars.rename(from, to);
  }
  if (calc.systemNames) {
    calc.systemNames = new Set([...calc.systemNames].map((n) => vars.resolve(n)));
  }
  const units = new HidingMap();
  for (const [k, v] of Map.prototype.entries.call(env.units)) Map.prototype.set.call(units, k, v);
  env.units = units;
  // units in the new notation, with the same values
  calc.run('%newunit M_Sun=M_Sun # "Mass of the Sun"');
  calc.run('%newunit L_Sun=L_Sun # "Luminosity of the Sun"');
  calc.run('%newunit R_Sun=R_Sun # "Radius of the Sun"');
}

// Functions: builtins looked up through legacy and display aliases
function installFunctionAliases(calc) {
  const target = calc.builtins;
  for (const [from, to] of Object.entries(LEGACY_FNS)) {
    if (target[from] && !target[to]) {
      target[to] = target[from];
      delete target[from];
    }
    if (functionDocs[from] && !functionDocs[to]) functionDocs[to] = functionDocs[from];
  }
  const index = new Map(Object.keys(target).map((k) => [displayKey(k, true), k]));
  calc.builtins = new Proxy(target, {
    get(t, p) {
      if (typeof p !== "string" || p in t) return t[p];
      if (LEGACY_FNS[p]) return t[LEGACY_FNS[p]];
      const hit = index.get(displayKey(p, true));
      return hit ? t[hit] : undefined;
    },
  });
}

// ---------------------------------------------------------------------
// Cosmology and lensing functions
//
// Distances follow Hogg (1999, astro-ph/9905116) for a ΛCDM model with
// the current values of H0, OmegaM, OmegaL and (if defined) OmegaR;
// curvature is OmegaK = 1 − OmegaM − OmegaL − OmegaR. Uncertainties of
// redshifts and parameters are propagated linearly (numerical derivatives).

const SCIENCE_DOCS = {
  E: "E(z) = H(z)/H_0, dimensionless Hubble parameter: E(z)",
  H: "Hubble parameter: H(z)",
  D_C: "Line-of-sight comoving distance: D_C(z) or D_C(z1, z2)",
  D_M: "Transverse comoving distance: D_M(z) or D_M(z1, z2)",
  D_A: "Angular diameter distance: D_A(z), or D_A(z1, z2) between two redshifts",
  D_L: "Luminosity distance: D_L(z)",
  distmod: "Distance modulus 5 log10(D_L / 10 pc): distmod(z)",
  t_L: "Lookback time: t_L(z)",
  age: "Age of the universe at redshift z: age(z); age(0) today",
  V_C: "All-sky comoving volume within redshift z: V_C(z)",
  scale: "Proper length subtended by one arcsecond at redshift z: scale(z)",
  Sigma_cr: "Critical surface density c² D_s / (4π G D_l D_ls): Sigma_cr(z_l, z_s)",
  theta_E: "Einstein radius of a point mass: theta_E(M, z_l, z_s)",
  theta_E_SIS: "Einstein radius of a singular isothermal sphere: theta_E_SIS(sigma_v, z_l, z_s)",
  M_E: "Mass within an Einstein radius θ: M_E(theta, z_l, z_s)",
  D_dt: "Time-delay distance (1 + z_l) D_l D_s / D_ls: D_dt(z_l, z_s)",
};

const SCIENCE = new Set(Object.keys(SCIENCE_DOCS));

// Composite Simpson rule
function simpson(f, a, b, n = 400) {
  if (a === b) return 0;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

// f(numbers) -> number, applied to UNum arguments with error propagation
function propagate(f, xs) {
  const n0 = xs.map((x) => x.n);
  const v = f(n0);
  if (MC.on) {
    // Monte Carlo: evaluate f on every sample
    const ss = xs.map((x) => x.samples());
    if (ss.some(Boolean)) {
      const N = ss.find(Boolean).length;
      const out = new Float64Array(N);
      const arg = new Array(xs.length);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < xs.length; j++) arg[j] = ss[j] ? ss[j][i] : n0[j];
        out[i] = f(arg);
      }
      const r = linearPart(f, xs, n0, v);
      r.s = out;
      return r;
    }
  }
  return linearPart(f, xs, n0, v);
}

function linearPart(f, xs, n0, v) {
  let c = null;
  xs.forEach((x, i) => {
    if (!x.c) return;
    const h = Math.max(Math.abs(x.n), 1) * 1e-6;
    const up = n0.slice(), dn = n0.slice();
    up[i] += h;
    dn[i] -= h;
    const d = (f(up) - f(dn)) / (2 * h);
    if (!c) c = new Map();
    for (const [k, val] of x.c) c.set(k, (c.get(k) || 0) + val * d);
  });
  return new UNum(v, c);
}

function addScience(calc) {
  const env = calc.env;
  const b = calc.builtins;
  const getQ = (name, def) => {
    let v = env.vars.get(name);
    if (v && v.lazy) v = v.lazy();
    return v instanceof Q ? v : def;
  };
  const pureArg = (q, fn, what) => {
    if (!(q instanceof Q)) throw new UnitError(`${fn}: ${what} is missing`);
    return env.checkPure(q, `${fn} (${what})`);
  };
  const show = (q, spec) => {
    try { return env.convert(q, [spec]); } catch { return q; }
  };
  // [om, ol, or] as UNum
  const params = () => [
    env.checkPure(getQ("Omega_M", new Q(0.3)), "Omega_M"),
    env.checkPure(getQ("Omega_L", new Q(0.7)), "Omega_L"),
    env.checkPure(getQ("Omega_R", new Q(0)), "Omega_R"),
  ];
  const hubbleDistance = () => env.div(getQ("c"), getQ("H_0"));
  const hubbleTime = () => env.div(new Q(1), getQ("H_0"));

  // dimensionless helpers on plain numbers
  const E = (z, om, ol, or) => {
    const a = 1 + z, ok = 1 - om - ol - or;
    return Math.sqrt(or * a ** 4 + om * a ** 3 + ok * a * a + ol);
  };
  // comoving distance in units of c/H0, with x = ln(1+z)
  const dc = (z1, z2, om, ol, or) =>
    simpson((x) => Math.exp(x) / E(Math.exp(x) - 1, om, ol, or), Math.log1p(z1), Math.log1p(z2));
  const sk = (chi, ok) => {
    if (ok > 1e-12) return Math.sinh(Math.sqrt(ok) * chi) / Math.sqrt(ok);
    if (ok < -1e-12) return Math.sin(Math.sqrt(-ok) * chi) / Math.sqrt(-ok);
    return chi;
  };
  const dm = (z1, z2, om, ol, or) => sk(dc(z1, z2, om, ol, or), 1 - om - ol - or);
  // age in units of 1/H0, integrating over s with a = s²
  const ageH = (z, om, ol, or) => {
    const ok = 1 - om - ol - or;
    const smax = Math.sqrt(1 / (1 + z));
    return simpson((s) => {
      if (s === 0) return 0;
      const a = s * s;
      return (2 * s) / Math.sqrt(or / (a * a) + om / a + ok + ol * a * a);
    }, 0, smax);
  };
  const vc = (z, om, ol, or) => {
    const ok = 1 - om - ol - or;
    const d = dm(0, z, om, ol, or);
    if (Math.abs(ok) < 1e-12) return (4 * Math.PI / 3) * d ** 3;
    const r = Math.sqrt(Math.abs(ok));
    const inv = ok > 0 ? Math.asinh(r * d) / r : Math.asin(r * d) / r;
    return (4 * Math.PI / (2 * ok)) * (d * Math.sqrt(1 + ok * d * d) - inv);
  };

  // f(z..., om, ol, or) on UNum redshifts -> pure Q
  const cosmo = (f, zs) => new Q(propagate((v) => f(...v), [...zs, ...params()]));
  const zArgs = (fn, args, n) => {
    if (args.length < n[0] || args.length > n[1]) {
      throw new UnitError(`${fn} expects ${n[0] === n[1] ? n[0] : n[0] + " or " + n[1]} argument(s)`);
    }
    return args.map((a, i) => pureArg(a, fn, args.length > 1 ? `z${i + 1}` : "z"));
  };

  const DA = (z1, z2) => {
    // angular diameter distance between z1 and z2 (z1 = 0: from us)
    const x = cosmo((a, b2, om, ol, or) => dm(a, b2, om, ol, or) / (1 + b2), [z1, z2]);
    return env.mul(hubbleDistance(), x);
  };
  const zero = new UNum(0);

  b.E = (...a) => {
    const [z] = zArgs("E", a, [1, 1]);
    return cosmo((z1, om, ol, or) => E(z1, om, ol, or), [z]);
  };
  b.H = (...a) => {
    const [z] = zArgs("H", a, [1, 1]);
    return show(env.mul(getQ("H_0"), b.E(new Q(z))), "km/s/Mpc");
  };
  b.D_C = (...a) => {
    const z = zArgs("D_C", a, [1, 2]);
    const [z1, z2] = z.length === 1 ? [zero, z[0]] : z;
    return show(env.mul(hubbleDistance(), cosmo(dc, [z1, z2])), "Mpc");
  };
  b.D_M = (...a) => {
    const z = zArgs("D_M", a, [1, 2]);
    const [z1, z2] = z.length === 1 ? [zero, z[0]] : z;
    return show(env.mul(hubbleDistance(), cosmo(dm, [z1, z2])), "Mpc");
  };
  b.D_A = (...a) => {
    const z = zArgs("D_A", a, [1, 2]);
    const [z1, z2] = z.length === 1 ? [zero, z[0]] : z;
    return show(DA(z1, z2), "Mpc");
  };
  b.D_L = (...a) => {
    const [z] = zArgs("D_L", a, [1, 1]);
    return show(env.mul(hubbleDistance(), cosmo((z1, om, ol, or) => (1 + z1) * dm(0, z1, om, ol, or), [z])), "Mpc");
  };
  b.distmod = (...a) => {
    const [z] = zArgs("distmod", a, [1, 1]);
    const r = env.div(b.D_L(new Q(z)), env.mul(new Q(10), env.unit("pc")));
    return new Q(ufuncs.log10(env.checkPure(r, "distmod")).scale(5));
  };
  b.t_L = (...a) => {
    const [z] = zArgs("t_L", a, [1, 1]);
    return show(env.mul(hubbleTime(), cosmo((z1, om, ol, or) => ageH(0, om, ol, or) - ageH(z1, om, ol, or), [z])), "Gyr");
  };
  b.age = (...a) => {
    const [z] = zArgs("age", a, [1, 1]);
    return show(env.mul(hubbleTime(), cosmo(ageH, [z])), "Gyr");
  };
  b.V_C = (...a) => {
    const [z] = zArgs("V_C", a, [1, 1]);
    const dh = hubbleDistance();
    return show(env.mul(env.mul(env.mul(dh, dh), dh), cosmo(vc, [z])), "Gpc^3");
  };
  b.scale = (...a) => {
    const [z] = zArgs("scale", a, [1, 1]);
    return show(env.mul(DA(zero, z), new Q(Math.PI / 180 / 3600)), "kpc");
  };

  // lensing: [D_l, D_s, D_ls]
  const lensD = (fn, zl, zs) => {
    const l = pureArg(zl, fn, "z_l"), s = pureArg(zs, fn, "z_s");
    if (s.n <= l.n) throw new UnitError(`${fn}: the source must be behind the lens (z_s > z_l)`);
    return [DA(zero, l), DA(zero, s), DA(l, s), l];
  };
  const G = () => getQ("G");
  const c2 = () => env.mul(getQ("c"), getQ("c"));
  const need = (q, unit, fn, what) => {
    if (!(q instanceof Q)) throw new UnitError(`${fn}: ${what} is missing`);
    env.checkCompatible(q, env.unit(unit), `${fn} (${what})`);
    return q;
  };

  b.Sigma_cr = (zl, zs) => {
    const [Dl, Ds, Dls] = lensD("Sigma_cr", zl, zs);
    const k = env.div(c2(), env.mul(new Q(4 * Math.PI), G()));
    return show(env.div(env.mul(k, Ds), env.mul(Dl, Dls)), "M_Sun/pc^2");
  };
  b.theta_E = (M, zl, zs) => {
    need(M, "kg", "theta_E", "mass");
    const [Dl, Ds, Dls] = lensD("theta_E", zl, zs);
    const r = env.div(env.mul(env.mul(new Q(4), G()), M), c2());
    return show(b.sqrt(env.div(env.mul(r, Dls), env.mul(Dl, Ds))), "arcsec");
  };
  b.theta_E_SIS = (sigma, zl, zs) => {
    need(sigma, "m/s", "theta_E_SIS", "velocity dispersion");
    const [, Ds, Dls] = lensD("theta_E_SIS", zl, zs);
    const v = env.div(sigma, getQ("c"));
    return show(env.mul(env.mul(new Q(4 * Math.PI), env.mul(v, v)), env.div(Dls, Ds)), "arcsec");
  };
  b.M_E = (theta, zl, zs) => {
    if (!(theta instanceof Q)) throw new UnitError("M_E: theta is missing");
    const t = env.checkPure(theta, "M_E (theta)");
    const [Dl, Ds, Dls] = lensD("M_E", zl, zs);
    const k = env.div(env.mul(new Q(t.mul(t)), c2()), env.mul(new Q(4), G()));
    return show(env.div(env.mul(k, env.mul(Dl, Ds)), Dls), "M_Sun");
  };
  b.D_dt = (zl, zs) => {
    const [Dl, Ds, Dls, l] = lensD("D_dt", zl, zs);
    return show(env.div(env.mul(new Q(l.add(1)), env.mul(Dl, Ds)), Dls), "Mpc");
  };

  Object.assign(functionDocs, SCIENCE_DOCS);
}

// ---------------------------------------------------------------------
// Solar-system data (NASA planetary fact sheets; mean radii, sidereal
// periods; negative rotation periods are retrograde). Density, surface
// gravity (GM/R², without rotation) and escape speed are derived.

const BODIES = [
  // name, primary, mass [kg], mean radius [km], semi-major axis [km], orbital period [day], rotation [h], eccentricity
  ["Mercury", "Sun", 3.3010e23, 2439.7, 57.909e6, 87.969, 1407.6, 0.2056],
  ["Venus", "Sun", 4.8673e24, 6051.8, 108.210e6, 224.701, -5832.6, 0.0068],
  ["Earth", "Sun", 5.9722e24, 6371.0, 149.598e6, 365.256, 23.9345, 0.0167],
  ["Moon", "Earth", 7.346e22, 1737.4, 384400, 27.3217, 655.72, 0.0549],
  ["Mars", "Sun", 6.4169e23, 3389.5, 227.956e6, 686.980, 24.6229, 0.0935],
  ["Phobos", "Mars", 1.0659e16, 11.27, 9376, 0.31891, 7.6538, 0.0151],
  ["Deimos", "Mars", 1.4762e15, 6.2, 23463.2, 1.263, 30.312, 0.00033],
  ["Ceres", "Sun", 9.3835e20, 469.7, 413.7e6, 1681.6, 9.074, 0.0758],
  ["Jupiter", "Sun", 1.89813e27, 69911, 778.479e6, 4332.589, 9.9250, 0.0487],
  ["Io", "Jupiter", 8.9319e22, 1821.6, 421800, 1.769, 42.46, 0.0041],
  ["Europa", "Jupiter", 4.7998e22, 1560.8, 671100, 3.551, 85.23, 0.0094],
  ["Ganymede", "Jupiter", 1.4819e23, 2634.1, 1070400, 7.155, 171.7, 0.0013],
  ["Callisto", "Jupiter", 1.0759e23, 2410.3, 1882700, 16.689, 400.5, 0.0074],
  ["Saturn", "Sun", 5.6832e26, 58232, 1432.041e6, 10759.22, 10.656, 0.0520],
  ["Enceladus", "Saturn", 1.08e20, 252.1, 237948, 1.370, 32.89, 0.0047],
  ["Titan", "Saturn", 1.3452e23, 2574.7, 1221870, 15.945, 382.7, 0.0288],
  ["Uranus", "Sun", 8.6811e25, 25362, 2867.043e6, 30685.4, -17.24, 0.0469],
  ["Neptune", "Sun", 1.02409e26, 24622, 4514.953e6, 60189, 16.11, 0.0097],
  ["Triton", "Neptune", 2.139e22, 1353.4, 354759, 5.877, 141.04, 0.000016],
  ["Pluto", "Sun", 1.303e22, 1188.3, 5869.656e6, 90560, -153.29, 0.2444],
  ["Charon", "Pluto", 1.586e21, 606, 19591, 6.387, 153.29, 0.0002],
];
const BODY_NAMES = new Set(BODIES.map((b) => b[0]));

// [key, symbol label, description, unit for display]
const BODY_PROPS = [
  ["M", "M", "Mass", "kg"],
  ["R", "R", "Mean radius", "km"],
  ["rho", "ρ", "Mean density", "g/cm^3"],
  ["g", "g", "Surface gravity", "m/s^2"],
  ["v_esc", "v", "Escape speed", "km/s"],
  ["a", "a", "Orbit semi-major axis", "km"],
  ["P", "P", "Orbital period", "day"],
  ["P_rot", "P", "Rotation period", "hour"],
  ["e", "e", "Orbit eccentricity", ""],
];
const PROP_SUB = { v_esc: "esc,", P_rot: "rot," };
const PROP_SYM = Object.fromEntries(BODY_PROPS.map((p) => [p[0], p[1]]));

function planetDefs() {
  const L = [];
  for (const [n, primary, M, R, a, P, rot, e] of BODIES) {
    const of = n === "Moon" ? "the Moon" : n;
    const around = primary === "Sun" ? "the Sun" : primary === "Earth" ? "the Earth" : primary;
    L.push(`%let M_${n} = ${M}[kg] # "Mass of ${of}"`);
    L.push(`%let R_${n} = ${R}[km] # "Mean radius of ${of}"`);
    L.push(`%lazy rho_${n} = M_${n} / (4 / 3 * pi * R_${n}^3) # "Mean density of ${of}"`);
    L.push(`%lazy g_${n} = nominal(G) * M_${n} / R_${n}^2 # "Surface gravity of ${of} (GM/R², no rotation)"`);
    L.push(`%lazy v_esc_${n} = sqrt(2 * nominal(G) * M_${n} / R_${n}) # "Escape speed from ${of}"`);
    L.push(`%let a_${n} = ${a}[km] # "Semi-major axis of the orbit of ${of} around ${around}"`);
    L.push(`%let P_${n} = ${P}[day] # "Sidereal orbital period of ${of} around ${around}"`);
    L.push(`%let P_rot_${n} = ${rot}[hour] # "Sidereal rotation period of ${of}${rot < 0 ? " (negative: retrograde)" : ""}"`);
    L.push(`%let e_${n} = ${e} # "Orbital eccentricity of ${of}"`);
  }
  L.push('%newunit M_Earth=M_Earth # "Earth mass"');
  L.push('%newunit R_Earth=R_Earth # "Earth mean radius"');
  L.push('%newunit M_Jupiter=M_Jupiter # "Jupiter mass"');
  L.push('%newunit R_Jupiter=R_Jupiter # "Jupiter mean radius"');
  // earlier names, hidden
  L.push('%newunit Mearth=5.9722e24[kg] # "Earth mass"');
  L.push('%newunit Rearth=6378.1[km] # "Earth radius (IAU nominal equatorial)"');
  L.push('%newunit Mjup=1.89813e27[kg] # "Jupiter mass"');
  L.push('%newunit Rjup=71492[km] # "Jupiter radius (IAU nominal equatorial)"');
  return L;
}

function addPlanets(calc) {
  const before = new Set(calc.env.vars.keys());
  for (const line of planetDefs()) {
    const r = calc.run(line);
    if (r.kind === "error") console.warn("planet defs:", line, r.message);
  }
  if (calc.systemNames) for (const k of calc.env.vars.keys()) if (!before.has(k)) calc.systemNames.add(k);
}

// ---------------------------------------------------------------------
// More constants and data: mathematics, particles, astronomy, Earth,
// chemistry (elements and molecules), engineering, materials, nuclides,
// information. Values marked ≈ are typical or conventional.

const ELEMENTS = [
  // Z, symbol, name, standard atomic weight (g/mol; [A] = most stable isotope)
  [1, "H", "Hydrogen", 1.008], [2, "He", "Helium", 4.0026], [3, "Li", "Lithium", 6.94], [4, "Be", "Beryllium", 9.0122],
  [5, "B", "Boron", 10.81], [6, "C", "Carbon", 12.011], [7, "N", "Nitrogen", 14.007], [8, "O", "Oxygen", 15.999],
  [9, "F", "Fluorine", 18.998], [10, "Ne", "Neon", 20.180], [11, "Na", "Sodium", 22.990], [12, "Mg", "Magnesium", 24.305],
  [13, "Al", "Aluminium", 26.982], [14, "Si", "Silicon", 28.085], [15, "P", "Phosphorus", 30.974], [16, "S", "Sulfur", 32.06],
  [17, "Cl", "Chlorine", 35.45], [18, "Ar", "Argon", 39.95], [19, "K", "Potassium", 39.098], [20, "Ca", "Calcium", 40.078],
  [21, "Sc", "Scandium", 44.956], [22, "Ti", "Titanium", 47.867], [23, "V", "Vanadium", 50.942], [24, "Cr", "Chromium", 51.996],
  [25, "Mn", "Manganese", 54.938], [26, "Fe", "Iron", 55.845], [27, "Co", "Cobalt", 58.933], [28, "Ni", "Nickel", 58.693],
  [29, "Cu", "Copper", 63.546], [30, "Zn", "Zinc", 65.38], [31, "Ga", "Gallium", 69.723], [32, "Ge", "Germanium", 72.630],
  [33, "As", "Arsenic", 74.922], [34, "Se", "Selenium", 78.971], [35, "Br", "Bromine", 79.904], [36, "Kr", "Krypton", 83.798],
  [37, "Rb", "Rubidium", 85.468], [38, "Sr", "Strontium", 87.62], [39, "Y", "Yttrium", 88.906], [40, "Zr", "Zirconium", 91.224],
  [41, "Nb", "Niobium", 92.906], [42, "Mo", "Molybdenum", 95.95], [43, "Tc", "Technetium", 97, true], [44, "Ru", "Ruthenium", 101.07],
  [45, "Rh", "Rhodium", 102.91], [46, "Pd", "Palladium", 106.42], [47, "Ag", "Silver", 107.87], [48, "Cd", "Cadmium", 112.41],
  [49, "In", "Indium", 114.82], [50, "Sn", "Tin", 118.71], [51, "Sb", "Antimony", 121.76], [52, "Te", "Tellurium", 127.60],
  [53, "I", "Iodine", 126.90], [54, "Xe", "Xenon", 131.29], [55, "Cs", "Caesium", 132.91], [56, "Ba", "Barium", 137.33],
  [57, "La", "Lanthanum", 138.91], [58, "Ce", "Cerium", 140.12], [59, "Pr", "Praseodymium", 140.91], [60, "Nd", "Neodymium", 144.24],
  [61, "Pm", "Promethium", 145, true], [62, "Sm", "Samarium", 150.36], [63, "Eu", "Europium", 151.96], [64, "Gd", "Gadolinium", 157.25],
  [65, "Tb", "Terbium", 158.93], [66, "Dy", "Dysprosium", 162.50], [67, "Ho", "Holmium", 164.93], [68, "Er", "Erbium", 167.26],
  [69, "Tm", "Thulium", 168.93], [70, "Yb", "Ytterbium", 173.05], [71, "Lu", "Lutetium", 174.97], [72, "Hf", "Hafnium", 178.49],
  [73, "Ta", "Tantalum", 180.95], [74, "W", "Tungsten", 183.84], [75, "Re", "Rhenium", 186.21], [76, "Os", "Osmium", 190.23],
  [77, "Ir", "Iridium", 192.22], [78, "Pt", "Platinum", 195.08], [79, "Au", "Gold", 196.97], [80, "Hg", "Mercury", 200.59],
  [81, "Tl", "Thallium", 204.38], [82, "Pb", "Lead", 207.2], [83, "Bi", "Bismuth", 208.98], [84, "Po", "Polonium", 209, true],
  [85, "At", "Astatine", 210, true], [86, "Rn", "Radon", 222, true], [87, "Fr", "Francium", 223, true], [88, "Ra", "Radium", 226, true],
  [89, "Ac", "Actinium", 227, true], [90, "Th", "Thorium", 232.04], [91, "Pa", "Protactinium", 231.04], [92, "U", "Uranium", 238.03],
  [93, "Np", "Neptunium", 237, true], [94, "Pu", "Plutonium", 244, true], [95, "Am", "Americium", 243, true],
];

const MOLECULES = [
  // formula, name, composition
  ["H2O", "Water", { H: 2, O: 1 }], ["CO2", "Carbon dioxide", { C: 1, O: 2 }], ["O2", "Oxygen", { O: 2 }],
  ["N2", "Nitrogen", { N: 2 }], ["H2", "Hydrogen", { H: 2 }], ["CH4", "Methane", { C: 1, H: 4 }],
  ["NH3", "Ammonia", { N: 1, H: 3 }], ["NaCl", "Sodium chloride", { Na: 1, Cl: 1 }], ["HCl", "Hydrogen chloride", { H: 1, Cl: 1 }],
  ["NaOH", "Sodium hydroxide", { Na: 1, O: 1, H: 1 }], ["H2SO4", "Sulfuric acid", { H: 2, S: 1, O: 4 }],
  ["CaCO3", "Calcium carbonate", { Ca: 1, C: 1, O: 3 }], ["C2H5OH", "Ethanol", { C: 2, H: 6, O: 1 }],
  ["C6H12O6", "Glucose", { C: 6, H: 12, O: 6 }],
];
const CHEM_NAMES = new Set([...ELEMENTS.map((e) => e[1]), ...MOLECULES.map((m) => m[0]), "air"]);


// First ionization energies (eV), from NIST tables
const ION_E = {
  H: 13.598, He: 24.587, Li: 5.392, Be: 9.323, B: 8.298, C: 11.260, N: 14.534, O: 13.618, F: 17.423, Ne: 21.565,
  Na: 5.139, Mg: 7.646, Al: 5.986, Si: 8.152, P: 10.487, S: 10.360, Cl: 12.968, Ar: 15.760, K: 4.341, Ca: 6.113,
  Sc: 6.561, Ti: 6.828, V: 6.746, Cr: 6.767, Mn: 7.434, Fe: 7.902, Co: 7.881, Ni: 7.640, Cu: 7.726, Zn: 9.394,
  Ga: 5.999, Ge: 7.899, As: 9.789, Se: 9.752, Br: 11.814, Kr: 14.000, Rb: 4.177, Sr: 5.695, Y: 6.217, Zr: 6.634,
  Nb: 6.759, Mo: 7.092, Tc: 7.28, Ru: 7.361, Rh: 7.459, Pd: 8.337, Ag: 7.576, Cd: 8.994, In: 5.786, Sn: 7.344,
  Sb: 8.608, Te: 9.010, I: 10.451, Xe: 12.130, Cs: 3.894, Ba: 5.212, La: 5.577, Ce: 5.539, Pr: 5.473, Nd: 5.525,
  Pm: 5.582, Sm: 5.644, Eu: 5.670, Gd: 6.150, Tb: 5.864, Dy: 5.939, Ho: 6.022, Er: 6.108, Tm: 6.184, Yb: 6.254,
  Lu: 5.426, Hf: 6.825, Ta: 7.550, W: 7.864, Re: 7.834, Os: 8.438, Ir: 8.967, Pt: 8.959, Au: 9.226, Hg: 10.438,
  Tl: 6.108, Pb: 7.417, Bi: 7.286, Po: 8.414, At: 9.318, Rn: 10.749, Fr: 4.073, Ra: 5.278, Ac: 5.17, Th: 6.307,
  Pa: 5.89, U: 6.194, Np: 6.266, Pu: 6.026, Am: 5.974,
};


// Properties of the elements (as simple substances): melting and boiling
// points [K] at 1 atm, density [g/cm^3] at standard conditions (solids and
// liquids near 20–25 °C; gases at 0 °C and 1 atm), Pauling electronegativity.
// null: not defined or not well known. Notes are added to the descriptions.
const ELEM_PROPS = {
  H: [13.99, 20.27, 0.00008988, 2.20], He: [null, 4.22, 0.0001785, null], Li: [453.65, 1603, 0.534, 0.98],
  Be: [1560, 2742, 1.85, 1.57], B: [2349, 4200, 2.34, 2.04], C: [null, 3915, 2.267, 2.55], N: [63.15, 77.36, 0.0012506, 3.04],
  O: [54.36, 90.19, 0.001429, 3.44], F: [53.48, 85.03, 0.001696, 3.98], Ne: [24.56, 27.10, 0.0008999, null],
  Na: [370.94, 1156.09, 0.968, 0.93], Mg: [923, 1363, 1.738, 1.31], Al: [933.47, 2743, 2.70, 1.61], Si: [1687, 3538, 2.329, 1.90],
  P: [317.3, 553.7, 1.823, 2.19], S: [388.36, 717.8, 2.07, 2.58], Cl: [171.6, 239.11, 0.003214, 3.16], Ar: [83.81, 87.30, 0.001784, null],
  K: [336.7, 1032, 0.862, 0.82], Ca: [1115, 1757, 1.55, 1.00], Sc: [1814, 3109, 2.985, 1.36], Ti: [1941, 3560, 4.506, 1.54],
  V: [2183, 3680, 6.0, 1.63], Cr: [2180, 2944, 7.19, 1.66], Mn: [1519, 2334, 7.21, 1.55], Fe: [1811, 3134, 7.874, 1.83],
  Co: [1768, 3200, 8.90, 1.88], Ni: [1728, 3186, 8.908, 1.91], Cu: [1357.77, 2835, 8.96, 1.90], Zn: [692.68, 1180, 7.14, 1.65],
  Ga: [302.91, 2673, 5.91, 1.81], Ge: [1211.40, 3106, 5.323, 2.01], As: [null, 887, 5.727, 2.18], Se: [494, 958, 4.81, 2.55],
  Br: [265.8, 332.0, 3.1028, 2.96], Kr: [115.78, 119.93, 0.003749, 3.00], Rb: [312.45, 961, 1.532, 0.82], Sr: [1050, 1655, 2.64, 0.95],
  Y: [1799, 3609, 4.472, 1.22], Zr: [2128, 4682, 6.52, 1.33], Nb: [2750, 5017, 8.57, 1.6], Mo: [2896, 4912, 10.28, 2.16],
  Tc: [2430, 4538, 11, 1.9], Ru: [2607, 4423, 12.45, 2.2], Rh: [2237, 3968, 12.41, 2.28], Pd: [1828.05, 3236, 12.023, 2.20],
  Ag: [1234.93, 2435, 10.49, 1.93], Cd: [594.22, 1040, 8.65, 1.69], In: [429.75, 2345, 7.31, 1.78], Sn: [505.08, 2875, 7.265, 1.96],
  Sb: [903.78, 1908, 6.697, 2.05], Te: [722.66, 1261, 6.24, 2.1], I: [386.85, 457.4, 4.933, 2.66], Xe: [161.4, 165.03, 0.005894, 2.6],
  Cs: [301.59, 944, 1.93, 0.79], Ba: [1000, 2118, 3.51, 0.89], La: [1193, 3737, 6.162, 1.10], Ce: [1068, 3716, 6.770, 1.12],
  Pr: [1208, 3403, 6.77, 1.13], Nd: [1297, 3347, 7.01, 1.14], Pm: [1315, 3273, 7.26, null], Sm: [1345, 2173, 7.52, 1.17],
  Eu: [1099, 1802, 5.264, null], Gd: [1585, 3546, 7.90, 1.20], Tb: [1629, 3396, 8.23, null], Dy: [1680, 2840, 8.540, 1.22],
  Ho: [1734, 2873, 8.79, 1.23], Er: [1802, 3141, 9.066, 1.24], Tm: [1818, 2223, 9.32, 1.25], Yb: [1097, 1469, 6.90, null],
  Lu: [1925, 3675, 9.841, 1.27], Hf: [2506, 4876, 13.31, 1.3], Ta: [3290, 5731, 16.69, 1.5], W: [3695, 6203, 19.25, 2.36],
  Re: [3459, 5869, 21.02, 1.9], Os: [3306, 5285, 22.59, 2.2], Ir: [2719, 4403, 22.56, 2.20], Pt: [2041.4, 4098, 21.45, 2.28],
  Au: [1337.33, 3243, 19.30, 2.54], Hg: [234.32, 629.88, 13.534, 2.00], Tl: [577, 1746, 11.85, 1.62], Pb: [600.61, 2022, 11.34, 2.33],
  Bi: [544.7, 1837, 9.78, 2.02], Po: [527, 1235, 9.20, 2.0], At: [575, null, null, 2.2], Rn: [202, 211.5, 0.00973, null],
  Fr: [null, null, null, null], Ra: [973, 2010, 5.5, 0.9], Ac: [1500, 3500, 10, 1.1], Th: [2023, 5061, 11.7, 1.3],
  Pa: [1841, 4300, 15.37, 1.5], U: [1405.3, 4404, 19.1, 1.38], Np: [912, 4447, 20.45, 1.36], Pu: [912.5, 3505, 19.85, 1.28],
  Am: [1449, 2880, 12, 1.13],
};
const ELEM_NOTES = {
  He: { T_b: "", T_m: "" }, C: { T_b: " (graphite, sublimation)", rho: " (graphite)" }, As: { T_b: " (sublimation)", rho: " (grey)" },
  P: { T_m: " (white)", T_b: " (white)", rho: " (white)" }, S: { rho: " (alpha, rhombic)" }, Sn: { rho: " (white, beta)" },
  At: { T_m: " (estimated)" }, Tc: { rho: " (estimated)" }, Ac: { T_b: " (estimated)", rho: " (estimated)" },
};

// Properties of molecules (at 1 atm unless noted; C_p and densities at 25 °C)
// T_m melting [K], T_b boiling [K], H_fus and H_vap [kJ/mol], C_p [J/(mol K)],
// rho [kg/m^3] (condensed phases only), T_c [K] and p_c [MPa] critical point
const MOL_PROPS = {
  H2O: { T_m: 273.15, T_b: 373.12, H_fus: 6.01, H_vap: 40.65, C_p: 75.3, rho: 997.05, T_c: 647.10, p_c: 22.064 },
  CO2: { T_m: [216.58, "at the triple point, 5.18 bar"], T_b: [194.69, "sublimation"], H_fus: 9.02, H_vap: [25.2, "sublimation"], C_p: 37.1, T_c: 304.13, p_c: 7.3773 },
  O2: { T_m: 54.36, T_b: 90.19, H_fus: 0.444, H_vap: 6.82, C_p: 29.38, T_c: 154.58, p_c: 5.043 },
  N2: { T_m: 63.15, T_b: 77.36, H_fus: 0.720, H_vap: 5.57, C_p: 29.12, T_c: 126.19, p_c: 3.3958 },
  H2: { T_m: 13.99, T_b: 20.27, H_fus: 0.117, H_vap: 0.904, C_p: 28.84, T_c: 33.15, p_c: 1.2964 },
  CH4: { T_m: 90.69, T_b: 111.65, H_fus: 0.94, H_vap: 8.19, C_p: 35.69, T_c: 190.56, p_c: 4.599 },
  NH3: { T_m: 195.42, T_b: 239.82, H_fus: 5.65, H_vap: 23.33, C_p: 35.06, T_c: 405.40, p_c: 11.333 },
  NaCl: { T_m: 1073.8, T_b: 1738, H_fus: 28.16, C_p: 50.5, rho: 2165 },
  HCl: { T_m: 158.97, T_b: 188.12, H_fus: 1.99, H_vap: 16.15, C_p: 29.12, T_c: 324.7, p_c: 8.31 },
  NaOH: { T_m: 596, T_b: 1661, C_p: 59.5, rho: 2130 },
  H2SO4: { T_m: 283.46, T_b: [610, "decomposes"], H_fus: 10.71, C_p: 138.9, rho: 1830 },
  CaCO3: { T_m: [1098, "decomposes to CaO + CO2"], C_p: 83.5, rho: 2711 },
  C2H5OH: { T_m: 159.0, T_b: 351.44, H_fus: 4.931, H_vap: 38.56, C_p: 112.3, rho: 789.3, T_c: 514.71, p_c: 6.268 },
  C6H12O6: { T_m: [419, "α-D-glucose, decomposes"], C_p: 218.6, rho: 1540 },
};
const MOL_UNITS = { T_m: "K", T_b: "K", H_fus: "kJ/mol", H_vap: "kJ/mol", C_p: "J/(mol K)", rho: "kg/m^3", T_c: "K", p_c: "MPa" };
const MOL_DOCS = {
  T_m: "Melting point", T_b: "Boiling point", H_fus: "Molar enthalpy of fusion", H_vap: "Molar enthalpy of vaporization",
  C_p: "Molar heat capacity at 25 °C", rho: "Density at 25 °C", T_c: "Critical temperature", p_c: "Critical pressure",
};

const MATERIALS = [
  // name, label, density kg/m³, Young's modulus GPa, thermal conductivity W/(m K), specific heat J/(kg K), expansion 1/K, resistivity Ω m
  ["steel", "Steel", 7850, 200, 50, 490, 12e-6, 1.7e-7],
  ["stainless", "Stainless steel", 8000, 193, 16.2, 500, 17.3e-6, 7.2e-7],
  ["aluminium", "Aluminium", 2700, 69, 237, 897, 23.1e-6, 2.65e-8],
  ["copper", "Copper", 8960, 117, 401, 385, 16.5e-6, 1.68e-8],
  ["titanium", "Titanium", 4506, 116, 21.9, 523, 8.6e-6, 4.2e-7],
  ["gold", "Gold", 19300, 79, 318, 129, 14.2e-6, 2.44e-8],
  ["silver", "Silver", 10490, 83, 429, 235, 18.9e-6, 1.59e-8],
  ["lead", "Lead", 11340, 16, 35.3, 129, 28.9e-6, 2.08e-7],
  ["silicon", "Silicon", 2329, 150, 149, 705, 2.6e-6, 2.3e3],
  ["glass", "Glass (soda-lime)", 2500, 70, 1.0, 840, 9e-6, 1e12],
  ["concrete", "Concrete", 2400, 30, 1.7, 880, 12e-6, null],
  ["ice", "Ice", 917, 9, 2.2, 2050, 51e-6, null],
  ["wood", "Wood (pine, along grain)", 500, 10, 0.12, 1700, 5e-6, null],
];
const MATERIAL_NAMES = new Set(MATERIALS.map((m) => m[0]));

const NUCLIDES = [
  // name, label, half-life [value, unit], atomic mass (u)
  ["H3", "Tritium", [12.32, "yr"], 3.01604928], ["Be7", "Beryllium-7", [53.22, "day"], 7.01692872],
  ["C14", "Carbon-14", [5700, "yr"], 14.00324199], ["F18", "Fluorine-18", [109.77, "min"], 18.0009380],
  ["Al26", "Aluminium-26", [7.17e5, "yr"], 25.98689186], ["K40", "Potassium-40", [1.248e9, "yr"], 39.96399817],
  ["Co60", "Cobalt-60", [5.2714, "yr"], 59.9338163], ["Sr90", "Strontium-90", [28.79, "yr"], 89.9077279],
  ["Rb87", "Rubidium-87", [4.97e10, "yr"], 86.9091805], ["Tc99m", "Technetium-99m", [6.0067, "hour"], 98.9062546],
  ["I131", "Iodine-131", [8.0252, "day"], 130.9061263], ["Cs137", "Caesium-137", [30.08, "yr"], 136.9070895],
  ["Rn222", "Radon-222", [3.8235, "day"], 222.0175782], ["Ra226", "Radium-226", [1600, "yr"], 226.0254103],
  ["Th232", "Thorium-232", [1.40e10, "yr"], 232.0380558], ["U235", "Uranium-235", [7.04e8, "yr"], 235.0439301],
  ["U238", "Uranium-238", [4.468e9, "yr"], 238.0507884], ["Pu239", "Plutonium-239", [24110, "yr"], 239.0521636],
  ["Am241", "Americium-241", [432.6, "yr"], 241.0568293],
];
const NUCLIDE_NAMES = new Set(NUCLIDES.map((n) => n[0]));

function extraDefs() {
  const L = [];
  const add = (s) => L.push(s);
  // mathematics and statistics
  add('%let euler = exp(1) # "Euler\'s number e = 2.71828… (the name e is the elementary charge)"');
  add('%let gamma_E = 0.57721566490153286 # "Euler–Mascheroni constant"');
  add('%let golden = (1 + sqrt(5)) / 2 # "Golden ratio φ"');
  add('%let zeta_3 = 1.2020569031595943 # "Apéry\'s constant ζ(3)"');
  add('%let fwhm = 2 * sqrt(2 * ln(2)) # "FWHM / σ of a Gaussian"');
  // atomic and particle physics
  add('%let m_alpha = const["alpha particle mass"] # "Alpha particle mass"');
  add('%let m_pi = (139.57039 ± 0.00018)[MeV] / c^2 # "Charged pion mass (PDG)"');
  add('%let m_pi0 = (134.9768 ± 0.0005)[MeV] / c^2 # "Neutral pion mass (PDG)"');
  add('%let m_W = (80.3692 ± 0.0133)[GeV] / c^2 # "W boson mass (PDG)"');
  add('%let m_Z = (91.1876 ± 0.0021)[GeV] / c^2 # "Z boson mass (PDG)"');
  add('%let m_H = (125.20 ± 0.11)[GeV] / c^2 # "Higgs boson mass (PDG)"');
  add('%let m_t = (172.57 ± 0.29)[GeV] / c^2 # "Top quark mass (PDG, direct measurements)"');
  add('%let alpha_s = 0.1180 ± 0.0009 # "Strong coupling constant α_s(m_Z) (PDG)"');
  add('%let sin2theta_W = const["weak mixing angle"] # "Weak mixing angle sin²θ_W (on-shell)"');
  add('%let lambda_C = const["Compton wavelength"] # "Electron Compton wavelength"');
  add('%let r_e = const["classical electron radius"] # "Classical electron radius"');
  add('%let a_0 = const["Bohr radius"] # "Bohr radius"');
  add('%let mu_N = const["nuclear magneton"] # "Nuclear magneton"');
  add('%let K_J = const["Josephson constant"] # "Josephson constant"');
  add('%let R_K = const["von Klitzing constant"] # "von Klitzing constant"');
  add('%let Phi_0 = const["mag. flux quantum"] # "Magnetic flux quantum"');
  add('%let G_0 = const["conductance quantum"] # "Conductance quantum"');
  add('%let sigma_T = const["Thomson cross section"] # "Thomson cross section"');
  add('%let b_Wien = const["Wien wavelength displacement law constant"] # "Wien wavelength displacement constant"');
  add('%let c_1 = const["first radiation constant"] # "First radiation constant"');
  add('%let c_2 = const["second radiation constant"] # "Second radiation constant"');
  // astronomy (IAU 2015 nominal solar values and others)
  add('%let GM_Sun_N = 1.3271244e20[m^3 s^-2] # "Nominal solar mass parameter (IAU 2015)"');
  add('%let R_Sun_N = 6.957e8[m] # "Nominal solar radius (IAU 2015)"');
  add('%let L_Sun_N = 3.828e26[W] # "Nominal solar luminosity (IAU 2015)"');
  add('%let T_eff_Sun = 5772[K] # "Nominal solar effective temperature (IAU 2015)"');
  add('%let M_bol_Sun = 4.74 # "Solar absolute bolometric magnitude (IAU 2015)"');
  add('%let F_AB = 3631[Jy] # "AB magnitude zero point"');
  add('%let M_Ch = 1.44 * M_Sun # "Chandrasekhar mass (≈)"');
  add('%let R_GC = 8.18[kpc] # "Distance of the Sun from the Galactic centre (≈)"');
  add('%let v_circ = 230[km/s] # "Galactic circular speed at the Sun (≈)"');
  add('%let tropicalyear = 365.24219[day] # "Tropical year"');
  add('%let R_Earth_eq = 6378137[m] # "Equatorial radius of the Earth (WGS 84)"');
  add('%let R_Jupiter_eq = 71492[km] # "Equatorial radius of Jupiter (IAU nominal)"');
  // Earth
  add('%newunit Gal=1[cm/s^2] # "Gal (gravity acceleration)"');
  add('%let GM_Earth = 3.986004418e14[m^3 s^-2] # "Earth gravitational parameter (WGS 84)"');
  add('%let a_WGS84 = 6378137[m] # "Earth equatorial radius (WGS 84)"');
  add('%let b_WGS84 = 6356752.314245[m] # "Earth polar radius (WGS 84)"');
  add('%let f_WGS84 = 1 / 298.257223563 # "Earth flattening (WGS 84)"');
  add('%let omega_Earth = 7.292115e-5[rad/s] # "Earth rotation rate (WGS 84)"');
  add('%let J_2_Earth = 1.08263e-3 # "Earth dynamic form factor J₂"');
  add('%let g_eq = 9.7803253359[m/s^2] # "Normal gravity at the equator (WGS 84)"');
  add('%let g_pole = 9.8321849378[m/s^2] # "Normal gravity at the poles (WGS 84)"');
  add('%let dg_fa = 0.3086[mGal/m] # "Free-air gravity gradient"');
  add('%let rho_crust = 2670[kg/m^3] # "Bouguer reduction density of the crust"');
  add('%let S_Sun = 1361[W/m^2] # "Solar constant, total solar irradiance at 1 au (≈)"');
  add('%let rho_sea = 1025[kg/m^3] # "Density of seawater at the surface (≈)"');
  add('%let T_Earth = 288[K] # "Mean surface temperature of the Earth (≈)"');
  add('%let dTdz = 25[K/km] # "Typical continental geothermal gradient (≈ 25–30 K/km)"');
  // chemistry
  add('%let V_m = const["molar volume of ideal gas (273.15 K, 101.325 kPa)"] # "Molar volume of an ideal gas at 0 °C, 1 atm"');
  add('%let n_0 = const["Loschmidt constant (273.15 K, 101.325 kPa)"] # "Loschmidt constant at 0 °C, 1 atm"');
  add('%let m_u = const["atomic mass constant"] # "Atomic mass constant"');
  add('%let T_STP = 273.15[K] # "Standard temperature, 0 °C"');
  add('%let T_SATP = 298.15[K] # "Standard ambient temperature, 25 °C"');
  add('%let p_std = const["standard-state pressure"] # "Standard-state pressure, 1 bar"');
  add('%let V_T = k * 298.15[K] / e # "Thermal voltage kT/e at 25 °C"');
  add('%let rho_water = 997.05[kg/m^3] # "Density of water at 25 °C"');
  add('%let c_p_water = 4181.3[J/(kg K)] # "Specific heat of water at 25 °C"');
  add('%let L_vap_water = 2.2564e6[J/kg] # "Latent heat of vaporisation of water at 100 °C"');
  add('%let L_fus_water = 3.3355e5[J/kg] # "Latent heat of fusion of water at 0 °C"');
  add('%let K_w = 1.0e-14[mol^2 L^-2] # "Ionic product of water at 25 °C (≈)"');
  for (const [, sym, name, w, unstable] of ELEMENTS) {
    add(`%let M_${sym} = ${w}[g/mol] # "Molar mass of ${name.toLowerCase()}${unstable ? ` (mass number of the most stable isotope)` : ""}"`);
  }
  for (const [f, name, comp] of MOLECULES) {
    const expr = Object.entries(comp).map(([el, n]) => (n === 1 ? `M_${el}` : `${n} * M_${el}`)).join(" + ");
    add(`%let M_${f} = ${expr} # "Molar mass of ${name.toLowerCase()} (${f})"`);
  }
  add('%let M_air = 28.9647[g/mol] # "Molar mass of dry air"');
  for (const [, sym, name] of ELEMENTS) {
    const n = name.toLowerCase();
    if (ION_E[sym]) add(`%let E_ion_${sym} = ${ION_E[sym]}[eV] # "First ionization energy of ${n}"`);
    const pr = ELEM_PROPS[sym];
    if (!pr) continue;
    const [tm, tb, rho, chi] = pr;
    const note = (k) => (ELEM_NOTES[sym] && ELEM_NOTES[sym][k]) || "";
    const gas = rho !== null && rho < 0.02;
    if (tm !== null) add(`%let T_m_${sym} = ${tm}[K] # "Melting point of ${n}${note("T_m")}"`);
    if (tb !== null) add(`%let T_b_${sym} = ${tb}[K] # "Boiling point of ${n}${note("T_b")}"`);
    if (rho !== null) add(`%let rho_${sym} = ${rho}[g/cm^3] # "Density of ${n}${gas ? " (gas at 0 °C, 1 atm)" : " near room temperature"}${note("rho")}"`);
    if (chi !== null) add(`%let chi_${sym} = ${chi} # "Pauling electronegativity of ${n}"`);
  }
  for (const [f, props] of Object.entries(MOL_PROPS)) {
    const mname = MOLECULES.find((m) => m[0] === f)[1].toLowerCase();
    for (const [k, v] of Object.entries(props)) {
      const [x, note] = Array.isArray(v) ? v : [v, ""];
      const u = MOL_UNITS[k].replace("J/(mol K)", "J mol^-1 K^-1");
      add(`%let ${k}_${f} = ${x}[${u}] # "${MOL_DOCS[k]} of ${mname}${note ? ` (${note})` : ""}"`);
    }
  }
  // engineering
  add('%let T_ISA = 288.15[K] # "ISA sea-level temperature"');
  add('%let p_ISA = 101325[Pa] # "ISA sea-level pressure"');
  add('%let rho_ISA = 1.225[kg/m^3] # "ISA sea-level air density"');
  add('%let a_ISA = 340.294[m/s] # "ISA sea-level speed of sound"');
  add('%let L_ISA = 6.5[K/km] # "ISA temperature lapse rate (troposphere)"');
  add('%let R_air = 287.053[J/(kg K)] # "Specific gas constant of dry air"');
  add('%let c_p_air = 1005[J/(kg K)] # "Specific heat of air at constant pressure (≈)"');
  add('%let gamma_air = 1.4 # "Heat capacity ratio of air"');
  add('%let mu_air = 1.789e-5[Pa s] # "Dynamic viscosity of air (ISA sea level)"');
  add('%let mu_water = 1.002e-3[Pa s] # "Dynamic viscosity of water at 20 °C"');
  add('%let nu_water = 1.004e-6[m^2/s] # "Kinematic viscosity of water at 20 °C"');
  for (const [m, label, rho, E, kth, c, alpha, rhoe] of MATERIALS) {
    const l = label.toLowerCase();
    add(`%let rho_${m} = ${rho}[kg/m^3] # "Density of ${l} (≈)"`);
    add(`%let E_${m} = ${E}[GPa] # "Young's modulus of ${l} (≈)"`);
    add(`%let k_th_${m} = ${kth}[W/(m K)] # "Thermal conductivity of ${l} (≈)"`);
    add(`%let c_${m} = ${c}[J/(kg K)] # "Specific heat of ${l} (≈)"`);
    add(`%let alpha_${m} = ${alpha}[K^-1] # "Linear thermal expansion of ${l} (≈)"`);
    if (rhoe !== null) add(`%let rho_e_${m} = ${rhoe}[ohm m] # "Electrical resistivity of ${l} (≈)"`);
  }
  // nuclides
  for (const [n, label, [t, u], mass] of NUCLIDES) {
    add(`%let T_half_${n} = ${t}[${u}] # "Half-life of ${label} (≈)"`);
    add(`%let tau_${n} = T_half_${n} / ln(2) # "Mean life of ${label}"`);
    add(`%let lambda_${n} = ln(2) / T_half_${n} # "Decay constant of ${label}"`);
    add(`%let m_${n} = ${mass}[u] # "Atomic mass of ${label}"`);
  }
  // information
  add('%newunit bit=1 # "Bit"');
  add('%newunit byte=B=8[bit] # "Byte"');
  add('%newprefix Ki=1024 # "Kibi (2¹⁰)"');
  add('%newprefix Mi=1024^2 # "Mebi (2²⁰)"');
  add('%newprefix Gi=1024^3 # "Gibi (2³⁰)"');
  add('%newprefix Ti=1024^4 # "Tebi (2⁴⁰)"');
  add('%newprefix Pi=1024^5 # "Pebi (2⁵⁰)"');
  add('%newprefix Ei=1024^6 # "Exbi (2⁶⁰)"');
  add('%let E_Landauer = k * 300[K] * ln(2) # "Landauer limit kT ln 2 at 300 K"');
  return L;
}

// ---------------------------------------------------------------------
// Statistics: special functions on plain numbers

const SQRT2 = Math.SQRT2, SQRTPI = Math.sqrt(Math.PI);

function erfN(x) {
  if (x < 0) return -erfN(-x);
  if (x < 2.5) {
    let p = x, s = x;
    for (let n = 1; n < 300; n++) {
      p *= -x * x / n;
      const t = p / (2 * n + 1);
      s += t;
      if (Math.abs(t) < 1e-17 * Math.abs(s)) break;
    }
    return (2 / SQRTPI) * s;
  }
  return 1 - erfcN(x);
}

function erfcN(x) {
  if (x < 0) return 2 - erfcN(-x);
  if (x < 2.5) return 1 - erfN(x);
  let f = x;
  for (let n = 80; n >= 1; n--) f = x + (n / 2) / f;
  return Math.exp(-x * x) / SQRTPI / f;
}

const PhiN = (x) => 0.5 * erfcN(-x / SQRT2);

// Inverse normal CDF: Acklam's approximation refined by Halley steps
function PhiinvN(p) {
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (!(p > 0 && p < 1)) throw new UnitError("the probability must be between 0 and 1");
  if (p > 0.5) return -PhiinvN(1 - p);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  let x;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    const q = p - 0.5, r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  for (let i = 0; i < 2; i++) {
    const e = PhiN(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    x -= u / (1 + x * u / 2);
  }
  return x;
}

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

function lgammaN(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgammaN(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const TINY = 1e-300;

// Regularized upper incomplete gamma Q(a, x)
function gammaQN(a, x) {
  if (x <= 0) return 1;
  const pre = Math.exp(-x + a * Math.log(x) - lgammaN(a));
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 1000; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - sum * pre;
  }
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return pre * h;
}

function betacf(a, b, x) {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a, b)
function betaIN(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgammaN(a + b) - lgammaN(a) - lgammaN(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

const STATS_DOCS = {
  erf: "Error function: erf(x)",
  erfc: "Complementary error function 1 − erf(x): erfc(x)",
  erf_inv: "Inverse error function: erf_inv(y)",
  Phi: "Standard normal cumulative distribution: Phi(x)",
  Phi_inv: "Inverse standard normal distribution (probit): Phi_inv(p)",
  pvalue: "One-sided Gaussian tail probability of n σ: pvalue(5) = 2.87e-7",
  nsigma: "Gaussian significance (one-sided) of a p-value: nsigma(2.87e-7) = 5",
  conf: "Probability inside ±n σ of a Gaussian: conf(1) = 0.6827",
  lgamma: "Logarithm of the Γ function: lgamma(x)",
  B: "Beta function B(a, b) = Γ(a)Γ(b)/Γ(a+b): B(a, b)",
  binom: "Binomial coefficient: binom(n, k)",
  p_chi2: "Upper-tail probability of χ² with k degrees of freedom: p_chi2(x, k)",
  p_t: "Two-sided tail probability of Student's t with ν degrees of freedom: p_t(t, nu)",
  R_s: "Schwarzschild radius 2GM/c²: R_s(M)",
  L_Edd: "Eddington luminosity 4πGM m_p c / σ_T: L_Edd(M)",
};

function addExtras(calc) {
  const env = calc.env;
  const b = calc.builtins;
  const known = new Set(env.vars.keys());
  for (const line of extraDefs()) {
    const r = calc.run(line);
    if (r.kind === "error") console.warn("extra defs:", line, r.message);
  }
  if (calc.systemNames) for (const k of env.vars.keys()) if (!known.has(k)) calc.systemNames.add(k);

  // pure-number function with error propagation
  const pureFn = (name, n, f) => {
    b[name] = (...args) => {
      if (args.length !== n) throw new UnitError(`${name} expects ${n} argument${n > 1 ? "s" : ""}`);
      const xs = args.map((a, i) => {
        if (!(a instanceof Q)) throw new UnitError(`${name}: argument ${i + 1} is missing`);
        return env.checkPure(a, name);
      });
      return new Q(propagate((v) => f(...v), xs));
    };
  };
  pureFn("erf", 1, erfN);
  pureFn("erfc", 1, erfcN);
  pureFn("erf_inv", 1, (y) => PhiinvN((y + 1) / 2) / SQRT2);
  pureFn("Phi", 1, PhiN);
  pureFn("Phi_inv", 1, PhiinvN);
  pureFn("pvalue", 1, (n) => 0.5 * erfcN(n / SQRT2));
  pureFn("nsigma", 1, (p) => -PhiinvN(p));
  pureFn("conf", 1, (n) => erfN(n / SQRT2));
  pureFn("lgamma", 1, lgammaN);
  pureFn("B", 2, (x, y) => Math.exp(lgammaN(x) + lgammaN(y) - lgammaN(x + y)));
  pureFn("binom", 2, (n, k) => {
    const v = Math.exp(lgammaN(n + 1) - lgammaN(k + 1) - lgammaN(n - k + 1));
    return Number.isInteger(n) && Number.isInteger(k) && v < 2 ** 53 ? Math.round(v) : v;
  });
  pureFn("p_chi2", 2, (x, k) => gammaQN(k / 2, x / 2));
  pureFn("p_t", 2, (t, nu) => betaIN(nu / 2, 0.5, nu / (nu + t * t)));

  const getQ = (name) => {
    let v = env.vars.get(name);
    if (v && v.lazy) v = v.lazy();
    return v;
  };
  const show = (q, spec) => {
    try { return env.convert(q, [spec]); } catch { return q; }
  };
  const mass = (M, fn) => {
    if (!(M instanceof Q)) throw new UnitError(`${fn}: the mass is missing`);
    env.checkCompatible(M, env.unit("kg"), `${fn} (mass)`);
    return M;
  };
  b.R_s = (M) => {
    const r = env.div(env.mul(env.mul(new Q(2), getQ("G")), mass(M, "R_s")), env.mul(getQ("c"), getQ("c")));
    return show(r, "km");
  };
  b.L_Edd = (M) => {
    const num = env.mul(env.mul(env.mul(new Q(4 * Math.PI), getQ("G")), mass(M, "L_Edd")), env.mul(getQ("m_p"), getQ("c")));
    return show(env.div(num, getQ("sigma_T")), "L_Sun");
  };
  for (const k of Object.keys(STATS_DOCS)) SCIENCE.add(k);
  Object.assign(functionDocs, STATS_DOCS);
}

// ---------------------------------------------------------------------
// Colour palettes: a few base colours per mode, the rest is derived

const PALETTES = {
  classic: {
    name: "Classic",
    light: { accent: "#2f6fde", tab: "#0e7f99", unit: "#8a4b00" },
    dark: { accent: "#4d8bf5", tab: "#22d3ee", tabText: "#05252d", unit: "#f0b35c" },
  },
  ocean: {
    name: "Ocean",
    light: { accent: "#0f766e", tab: "#1e3a8a", unit: "#b45309" },
    dark: { accent: "#2dd4bf", accentText: "#032b27", tab: "#93a8ff", tabText: "#0b1640", unit: "#fbbf24" },
  },
  nebula: {
    name: "Nebula",
    light: { accent: "#6d28d9", tab: "#be185d", unit: "#0f766e" },
    dark: { accent: "#a78bfa", accentText: "#1d0f3d", tab: "#f472b6", tabText: "#3b0a22", unit: "#5eead4" },
  },
  forest: {
    name: "Forest",
    light: { accent: "#2f7d32", tab: "#6b4f12", unit: "#9a3412" },
    dark: { accent: "#6fd66f", accentText: "#0b2a0c", tab: "#e0b46a", tabText: "#2b1d05", unit: "#fb923c" },
  },
  sunset: {
    name: "Sunset",
    light: { accent: "#c2410c", tab: "#7e22ce", unit: "#1d4ed8" },
    dark: { accent: "#ff8a5c", accentText: "#2d0e00", tab: "#c084fc", tabText: "#24083f", unit: "#93c5fd" },
  },
  graphite: {
    name: "Graphite",
    light: { accent: "#2b2f36", tab: "#2b2f36", unit: "#5b5f69" },
    dark: { accent: "#e8e8ea", accentText: "#111214", tab: "#e8e8ea", tabText: "#111214", unit: "#c9c9cf" },
  },
  terminal: {
    name: "Terminal",
    light: { accent: "#0e7f99", tab: "#111827", unit: "#3f7a0b" },
    dark: {
      accent: "#22d3ee", accentText: "#04212a", tab: "#22d3ee", tabText: "#04212a", unit: "#a3e635",
      bg: "#05070a", surface: "#0e1217", surface2: "#151a21", surface3: "#1d242d",
    },
  },
  paper: {
    name: "Paper",
    light: {
      accent: "#9a3412", tab: "#3f6212", unit: "#1e40af",
      bg: "#f5efe3", surface: "#fffdf8", surface2: "#ebe2d0", surface3: "#ded3bd",
    },
    dark: {
      accent: "#fb923c", accentText: "#2a1205", tab: "#bef264", tabText: "#1a2a05", unit: "#93c5fd",
      bg: "#16130e", surface: "#211d16", surface2: "#2b261d", surface3: "#363026",
    },
  },
};

function hexMix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return "#" + x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, "0")).join("");
}

function paletteVars(c, dark) {
  const surface = c.surface || (dark ? "#1c1d22" : "#ffffff");
  const v = {
    "--accent": c.accent,
    "--accent-text": c.accentText || "#ffffff",
    "--accent-soft": dark ? hexMix(c.accent, surface, 0.78) : hexMix(c.accent, "#ffffff", 0.86),
    "--accent-ink": dark ? hexMix(c.accent, "#ffffff", 0.45) : hexMix(c.accent, "#000000", 0.18),
    "--op": dark ? hexMix(c.accent, surface, 0.8) : hexMix(c.accent, "#ffffff", 0.88),
    "--op-ink": dark ? hexMix(c.accent, "#ffffff", 0.55) : hexMix(c.accent, "#000000", 0.25),
    "--tab": c.tab,
    "--tab-text": c.tabText || "#ffffff",
    "--tab-soft": dark ? hexMix(c.tab, surface, 0.8) : hexMix(c.tab, "#ffffff", 0.86),
    "--tab-soft-text": dark ? hexMix(c.tab, "#ffffff", 0.4) : hexMix(c.tab, "#000000", 0.3),
    "--unit": c.unit,
  };
  if (c.bg) Object.assign(v, { "--bg": c.bg, "--surface": c.surface, "--surface-2": c.surface2, "--surface-3": c.surface3 });
  return Object.entries(v).map(([k, x]) => `${k}: ${x};`).join(" ");
}

function applyPalette() {
  const id = PALETTES[state.settings.palette] ? state.settings.palette : "classic";
  let el = document.getElementById("palette-style");
  if (!el) {
    el = document.createElement("style");
    el.id = "palette-style";
    document.head.appendChild(el);
  }
  const p = PALETTES[id];
  el.textContent = id === "classic" ? "" :
    `:root { ${paletteVars(p.light, false)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${paletteVars(p.dark, true)} } }
:root[data-theme="dark"] { ${paletteVars(p.dark, true)} }`;
}

function paletteChipsHTML(current) {
  return Object.entries(PALETTES).map(([id, p]) => {
    const dots = (c) => [c.tab, c.accent, c.unit].map((x) => `<i style="background:${x}"></i>`).join("");
    return `<button class="pal${id === current ? " on" : ""}" data-pal="${id}" aria-pressed="${id === current}">
      <span class="dots light" style="background:${p.light.surface || "#ffffff"}">${dots(p.light)}</span>
      <span class="dots dark" style="background:${p.dark.surface || "#1c1d22"}">${dots(p.dark)}</span>
      <b>${esc(p.name)}</b></button>`;
  }).join("");
}

// ---------------------------------------------------------------------
// About

const APP_VERSION = "2026.10";
// set once the service worker is registered: checkForUpdate(report) calls
// report(message, kind) as it goes; appBuild() gives the cached version
let checkForUpdate = null, appBuild = null;

function openAbout(status = "") {
  const e = state.calc && env();
  const rates = e && e.currencyTime ? esc(e.currencyTime) : "—";
  $("#about-body").innerHTML = `
    <div class="about-icon" aria-hidden="true">[@]</div>
    <h2 id="about-title">iMKS Units</h2>
    <p class="about-ver">Version ${APP_VERSION}<span id="about-build"></span></p>
    ${checkForUpdate ? `<button class="about-update" id="about-update">Check for updates</button>
    <p class="about-status" id="about-status" role="status" aria-live="polite"></p>` : ""}
    <p>Copyright © 2026 Marco Lombardi.</p>
    <p class="small">This program is free software: you can redistribute it and/or modify it under the terms of the
      <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener">GNU General Public License</a>
      as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
      It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
      MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.</p>
    <p class="small">Source code: <a href="https://github.com/astrozot/imks-units" target="_blank" rel="noopener">github.com/astrozot/imks-units</a></p>
    <p class="small muted">Unit system after iMKS. Data: NIST CODATA constants; NASA planetary fact sheets; Particle Data Group;
      IAU 2015 nominal values; Planck 2018 and WMAP 9-year cosmological parameters (with and without BAO); WGS 84; IUPAC atomic weights; nuclide half-lives from evaluated nuclear data.
      Exchange rates of ${rates}.</p>`;
  const report = (msg, kind = "") => {
    const el = $("#about-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "about-status " + kind;
  };
  if (status) report(status, "ok");
  appBuild?.().then((b) => { if (b && $("#about-build")) $("#about-build").textContent = ` · build ${b}`; });
  $("#about-update")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = "Checking…";
    report("");
    await checkForUpdate(report);
    btn.disabled = false;
    btn.textContent = "Check again";
  });
  $("#about").hidden = false;
  $("#about-close").focus();
}

function closeAbout() {
  $("#about").hidden = true;
}

// ---------------------------------------------------------------------
// Typeset (2D) view: the parsed expression drawn as MathML, so fractions
// stack, roots get a radical and powers are raised. It is built from the
// same syntax tree the engine evaluates, so it shows exactly what is computed.

const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SUPCHARS = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "−": "⁻", "-": "⁻", m: "ᵐ", N: "ᴺ" };

// Typeset name (from prettyName) -> MathML
function nameMath(name, { unit = false, fn = false } = {}) {
  let html = null;
  try { html = prettyName(name, fn ? { fn: true } : { unit }); } catch { html = null; }
  html = html || esc(name);
  const plain = (h) => h.replace(/<sup>(.*?)<\/sup>/g, (_, x) => [...x].map((c) => SUPCHARS[c] || c).join(""))
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  let base = html, subTxt = null, supTxt = null;
  const si = html.indexOf("<sub>");
  if (si >= 0) {
    const se = html.lastIndexOf("</sub>");
    base = html.slice(0, si);
    subTxt = plain(html.slice(si + 5, se));
    const tail = html.slice(se + 6);
    const sm = /^<sup>(.*)<\/sup>$/.exec(tail);
    if (sm) supTxt = plain(sm[1]);
  } else {
    const sm = /^(.*?)<sup>([^<]*)<\/sup>$/.exec(html);
    if (sm) { base = sm[1]; supTxt = sm[2]; }
  }
  const b = plain(base);
  const upright = unit || fn || [...b].length > 1;
  let m = `<mi${upright ? ' mathvariant="normal"' : ""}>${xmlEsc(b)}</mi>`;
  if (subTxt !== null) m = `<msub>${m}<mi mathvariant="normal">${xmlEsc(subTxt)}</mi></msub>`;
  if (supTxt !== null) m = `<msup>${m}<mn>${xmlEsc(supTxt)}</mn></msup>`;
  return m;
}

function numText(n) {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "−∞" : "NaN";
  const s = Math.abs(n) >= 1e6 || (n !== 0 && Math.abs(n) < 1e-4) ? n.toExponential() : String(Number(n.toPrecision(12)));
  return s;
}

function numMath(x) {
  const one = (n) => {
    const s = numText(Math.abs(n));
    const m = /^([\d.]+)e([-+]\d+)$/.exec(s);
    const body = m
      ? `<mrow><mn>${m[1]}</mn><mo>×</mo><msup><mn>10</mn><mn>${String(Number(m[2])).replace("-", "−")}</mn></msup></mrow>`
      : `<mn>${s}</mn>`;
    return n < 0 ? `<mrow><mo>−</mo>${body}</mrow>` : body;
  };
  if (!x.c) return { m: one(x.n), p: x.n < 0 || /e/.test(numText(x.n)) ? 2 : 9 };
  let s2 = 0;
  for (const v of x.c.values()) s2 += v * v;
  return { m: `<mrow>${one(x.n)}<mo>±</mo>${one(Math.sqrt(s2))}</mrow>`, p: 1.5 };
}

// Units, inline: m/s^2 -> m·s⁻²
function unitsMath(raw) {
  const re = /\s*(?:('[^']*'|"[^"]*")|(\*?[\p{L}_°µΩÅ][\p{L}\p{N}_]*|\*)|\^\s*\(?\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*\)?|(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|(\/)|([()])|(\|))/uy;
  const items = [];
  let sign = 1, m, last = null;
  while (re.lastIndex < raw.length && (m = re.exec(raw))) {
    if (m[1]) { last = { m: `<mrow><mo>${m[1][0] === "'" ? "‘" : "“"}</mo>${nameMath(m[1].slice(1, -1), { unit: false })}<mo>${m[1][0] === "'" ? "’" : "”"}</mo></mrow>`, e: sign }; items.push(last); }
    else if (m[2]) { last = { m: m[2][0] === "*" ? `<mrow><mo>*</mo>${m[2].length > 1 ? nameMath(m[2].slice(1), { unit: true }) : ""}</mrow>` : nameMath(m[2], { unit: true }), e: sign }; items.push(last); }
    else if (m[3] && last) {
      const [p, q] = m[3].split("/").map((v) => Number(v.trim()));
      last.e = sign * (q ? p / q : p);
      last.frac = q ? [Math.abs(p), q, p < 0] : null;
    } else if (m[4]) { last = { m: `<mn>${m[4]}</mn>`, e: 1 }; items.push(last); }
    else if (m[5]) sign = -1;
    else if (m[7]) { items.push({ sep: true }); sign = 1; last = null; }
  }
  if (re.lastIndex < raw.length) return null;
  const out = [];
  let first = true;
  for (const it of items) {
    if (it.sep) { out.push('<mo lspace="0.3em" rspace="0.3em">|</mo>'); first = true; continue; }
    if (!first) out.push('<mo lspace="0" rspace="0.17em">&#x2062;</mo>');   // thin space
    first = false;
    if (it.e === 1) out.push(it.m);
    else {
      const ex = it.frac ? `${it.e < 0 ? "−" : ""}${it.frac[0]}/${it.frac[1]}` : String(it.e).replace("-", "−");
      out.push(`<msup>${it.m}<mn>${ex}</mn></msup>`);
    }
  }
  return `<mrow class="mu">${out.join("")}</mrow>`;
}

// Safari picks a much larger radical (and pins the content to its top)
// once a one-line radicand reaches about 1 em of height plus depth, as in
// "kg". Capping the measured size of single-line radicands keeps the
// normal radical; fractions and nested roots keep their real size.
function flatRadicand(m) {
  if (/<m(frac|sqrt|root|over|under)/.test(m)) return m;
  const sup = /<msup|<msubsup/.test(m);
  return `<mpadded height="${sup ? 0.85 : 0.75}em" depth="${sup ? 0.1 : 0.2}em">${m}</mpadded>`;
}

const LP = '<mo lspace="0" rspace="0">(</mo>', RP = '<mo lspace="0" rspace="0">)</mo>';
const PAREN = (m) => `<mrow>${LP}${m}${RP}</mrow>`;

// node -> { m: MathML, p: precedence }  (higher binds tighter)
function nodeMath(node) {
  const R = nodeMath;
  const wrap = (r, min) => (r.p < min ? PAREN(r.m) : r.m);
  switch (node.t) {
    case "num": return numMath(node.x);
    case "name": {
      // a name that is only a unit is drawn as one
      const unit = !env().vars.has(node.v) && !["pi", "tau", "inf", "ans"].includes(node.v) && isBareUnit(node.v);
      return { m: unit ? `<mrow class="mu">${nameMath(node.v, { unit: true })}</mrow>` : nameMath(node.v), p: 9 };
    }
    case "str": return { m: `<mrow><mo>‘</mo>${nameMath(node.v)}<mo>’</mo></mrow>`, p: 9 };
    case "unit": {
      if (node.target.t === "name" && node.target.v === "const") {
        return { m: `<mrow><mi mathvariant="normal">const</mi><mtext>[${xmlEsc(node.raw.replace(/^"|"$/g, ""))}]</mtext></mrow>`, p: 9 };
      }
      const u = unitsMath(node.raw);
      if (u === null) throw new Error("units");
      const t = R(node.target);
      const gap = /^\s*(deg|°|arcmin|arcsec)\s*$/.test(node.raw) ? "0" : "0.22em";   // 30°, but 3 kg
      return { m: `<mrow>${wrap(t, 2)}<mo lspace="${gap}" rspace="0">&#x2062;</mo>${u}</mrow>`, p: 2 };
    }
    case "un": {
      const a = R(node.a);
      if (node.op === "~") return { m: `<mrow><mo>~</mo>${wrap(a, 3)}</mrow>`, p: 3 };
      return { m: `<mrow><mo>${node.op === "-" ? "−" : "+"}</mo>${a.paren ? a.m : wrap(a, 3)}</mrow>`, p: 3 };
    }
    case "bin": {
      const a = R(node.a), b = R(node.b);
      switch (node.op) {
        case "+": return { m: `<mrow>${wrap(a, 1)}<mo>+</mo>${wrap(b, 1.01)}</mrow>`, p: 1 };
        case "-": return { m: `<mrow>${wrap(a, 1)}<mo>−</mo>${wrap(b, 1.01)}</mrow>`, p: 1 };
        case "/": return { m: `<mfrac>${a.m}${b.m}</mfrac>`, p: 2.5 };
        case "^": return { m: `<msup>${a.paren ? PAREN(a.m) : wrap(a, 9)}${b.m}</msup>`, p: 4 };
        case "*": {
          const bm = wrap(b, 2), am = a.paren || a.tailParen || wrap(a, 2);
          const numeric = node.b.t === "num" || (node.b.t === "unit" && node.b.target.t === "num") ||
            (node.b.t === "bin" && node.b.op === "^" && node.b.a.t === "num");
          const op = numeric ? "<mo>×</mo>" : '<mo lspace="0.12em" rspace="0.12em">&#x2062;</mo>';
          // y sin x is fine, but sin x · y is not: keep a way back to parentheses
          const tail = b.paren || b.tailParen;
          return { m: `<mrow>${am}${op}${bm}</mrow>`, p: 2, tailParen: tail ? `<mrow>${am}${op}${tail}</mrow>` : null };
        }
        default: throw new Error("op");
      }
    }
    case "eq": return { m: `<mrow>${R(node.a).m}<mo>=</mo>${R(node.b).m}</mrow>`, p: 0 };
    case "call": {
      const args = node.args.map(R);
      const v = node.args[1];
      const D = '<mi mathvariant="normal">d</mi>';
      if (node.f === "integrate" && args.length === 4 && v.t === "name" && !env().vars.has("integrate")) {
        return { m: `<mrow><msubsup><mo>∫</mo>${args[2].m}${args[3].m}</msubsup>${wrap(args[0], 1.01)}<mspace width="0.17em"/>${D}${args[1].m}</mrow>`, p: 1 };
      }
      if (node.f === "diff" && args.length === 3 && v.t === "name" && !env().vars.has("diff")) {
        return {
          m: `<mrow><mfrac>${D}<mrow>${D}${args[1].m}</mrow></mfrac>${wrap(args[0], 2.5)}<msub><mo stretchy="true">|</mo><mrow>${args[1].m}<mo>=</mo>${args[2].m}</mrow></msub></mrow>`,
          p: 2,
        };
      }
      if (node.f === "limit" && (args.length === 3 || args.length === 4) && v.t === "name" && !env().vars.has("limit")) {
        // the side, when written as a number: x → 0⁺, x → 0⁻
        const sd = node.args[3];
        const sv = !sd ? 0 : sd.t === "num" ? sd.x.n : sd.t === "un" && sd.a.t === "num" ? (sd.op === "-" ? -1 : 1) * sd.a.x.n : NaN;
        const sign = !sd ? "" : sv > 0 ? "+" : sv < 0 ? "−" : "?";
        const to = sign === "+" || sign === "−" ? `<msup>${wrap(args[2], 9)}<mo>${sign}</mo></msup>` : args[2].m;
        if (sign !== "?") {
          return { m: `<mrow><munder><mo movablelimits="false">lim</mo><mrow>${args[1].m}<mo>→</mo>${to}</mrow></munder>${wrap(args[0], 1.01)}</mrow>`, p: 1 };
        }
      }
      if (node.f === "sum" && args.length === 4 && v.t === "name" && !env().vars.has("sum")) {
        return { m: `<mrow><munderover><mo>∑</mo><mrow>${args[1].m}<mo>=</mo>${args[2].m}</mrow>${args[3].m}</munderover>${wrap(args[0], 1.01)}</mrow>`, p: 1 };
      }
      if (node.f === "sqrt" && args.length === 1) return { m: `<msqrt>${flatRadicand(args[0].m)}</msqrt>`, p: 9 };
      if (node.f === "cbrt" && args.length === 1) return { m: `<mroot>${flatRadicand(args[0].m)}<mn>3</mn></mroot>`, p: 9 };
      if (node.f === "abs" && args.length === 1) return { m: `<mrow><mo>|</mo>${args[0].m}<mo>|</mo></mrow>`, p: 9 };
      if (node.f === "floor" && args.length === 1) return { m: `<mrow><mo>⌊</mo>${args[0].m}<mo>⌋</mo></mrow>`, p: 9 };
      if (node.f === "ceil" && args.length === 1) return { m: `<mrow><mo>⌈</mo>${args[0].m}<mo>⌉</mo></mrow>`, p: 9 };
      if (node.f === "exp" && args.length === 1) return { m: `<msup><mi>e</mi>${args[0].m}</msup>`, p: 4 };
      if (node.f === "log" && args.length === 2) {
        // log(b, x) as log_b x
        const fname = `<msub><mi mathvariant="normal">log</mi>${args[0].m}</msub>`;
        const x = simpleArg(node.args[1]) ? args[1].m : `<mrow>${LP}${args[1].m}${RP}</mrow>`;
        return { m: `<mrow>${fname}<mo lspace="0" rspace="0.17em">&#x2061;</mo>${x}</mrow>`, p: simpleArg(node.args[1]) ? 2.2 : 9 };
      }
      const list = args.map((a) => a.m).join('<mo separator="true">,</mo>');
      if (BARE_FNS[node.f] !== undefined && args.length === 1) {
        // sin x, ln 2, sin π/2: no parentheses around a simple argument
        const fname = BARE_FNS[node.f];
        const paren = `<mrow>${fname}<mo lspace="0" rspace="0">&#x2061;</mo><mrow>${LP}${list}${RP}</mrow></mrow>`;
        if (simpleArg(node.args[0])) {
          return { m: `<mrow>${fname}<mo lspace="0" rspace="0.17em">&#x2061;</mo>${args[0].m}</mrow>`, p: 2.2, paren };
        }
        return { m: paren, p: 9 };
      }
      return { m: `<mrow>${nameMath(node.f, { fn: true })}<mo lspace="0" rspace="0">&#x2061;</mo><mrow>${LP}${list}${RP}</mrow></mrow>`, p: 9 };
    }
    case "tuple": return { m: PAREN(node.items.map((x) => R(x).m).join('<mo separator="true">,</mo>')), p: 9 };
    case "convert": {
      const u = unitsMath(node.spec.trim());
      if (u === null) throw new Error("spec");
      return { m: `<mrow>${R(node.a).m}<mo lspace="0.4em" rspace="0.4em">→</mo>${u}</mrow>`, p: 0 };
    }
    case "assign": return { m: `<mrow>${nameMath(node.name)}<mo>=</mo>${R(node.value).m}</mrow>`, p: 0 };
    case "def": return {
      m: `<mrow>${nameMath(node.name, { fn: true })}<mo lspace="0" rspace="0">&#x2061;</mo><mrow>${LP}${node.params.map((x) => nameMath(x)).join('<mo separator="true">,</mo>')}${RP}</mrow><mo>=</mo>${R(node.body).m}</mrow>`,
      p: 0,
    };
    default: throw new Error("node " + node.t);
  }
}

// functions usually written without parentheses, and how they are shown
const BARE_FNS = Object.fromEntries([
  ...["sin", "cos", "tan", "sinh", "cosh", "tanh", "ln", "log"].map((f) => [f, `<mi mathvariant="normal">${f}</mi>`]),
  ...["asin", "acos", "atan", "asinh", "acosh", "atanh"].map((f) => [f, `<mi mathvariant="normal">arc${f.slice(1)}</mi>`]),
  ["log10", '<msub><mi mathvariant="normal">log</mi><mn>10</mn></msub>'],
  ["log2", '<msub><mi mathvariant="normal">log</mi><mn>2</mn></msub>'],
]);

// an argument that reads unambiguously without parentheses
function simpleArg(n) {
  if (!n) return false;
  if (n.t === "num") return !n.x.c && n.x.n >= 0;
  if (n.t === "name" || n.t === "str") return true;
  if (n.t === "bin" && n.op === "/") return true;
  if (n.t === "unit") return n.target.t === "num" && !n.target.x.c && n.target.x.n >= 0;
  if (n.t === "call") return ["sqrt", "cbrt", "abs"].includes(n.f);
  return false;
}

// does the tree have anything a linear line shows badly?
function hasStructure(node) {
  if (!node || typeof node !== "object") return false;
  if (node.t === "bin" && (node.op === "/" || node.op === "^")) return true;
  if (node.t === "call" && ["sqrt", "cbrt", "abs", "exp", "integrate", "diff"].includes(node.f)) return true;
  if (node.t === "call" && node.f === "sum" && node.args.length === 4) return true;
  if (node.t === "call" && node.f === "limit" && (node.args.length === 3 || node.args.length === 4)) return true;
  if (node.t === "unit" && /\^|\//.test(node.raw) && node.target.t !== "num") return true;
  return ["a", "b", "value", "body", "target"].some((k) => hasStructure(node[k])) ||
    (node.args || node.items || []).some(hasStructure);
}

// MathML for an expression, or "" when there is nothing to typeset
function mathML(src, { always = false } = {}) {
  try {
    const { code } = splitComment(src);
    const t = code.trim();
    if (!t || t[0] === "%" || /!$/.test(t)) return "";
    const node = parse(normalize(t), env());
    if (!node || (!always && !hasStructure(node))) return "";
    return `<math displaystyle="true">${nodeMath(node).m}</math>`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------
// Probability distributions: N(μ, σ), U(a, b), LogN(m, s), Gamma(k, θ),
// Beta(a, b), T(ν, μ, s), Tri(a, c, b), and trunc(X, lo, hi).
//
// In Monte Carlo mode a distribution is a set of samples (Latin hypercube
// where an inverse CDF is available). Parameters may themselves be
// uncertain: each sample then uses the matching parameter sample. In linear
// mode a distribution becomes a normal with the same mean and σ.

const DIST_DOCS = {
  N: "Normal distribution: N(mu, sigma)",
  U: "Uniform distribution on [a, b]: U(a, b)",
  LogN: "Log-normal distribution with median m and logarithmic width s (pure): LogN(m, s)",
  Gamma: "Gamma distribution with shape k and scale θ: Gamma(k, theta); with one argument, Euler's Γ function",
  Beta: "Beta distribution on [0, 1]: Beta(a, b)",
  T: "Student's t distribution with ν degrees of freedom, centre μ and scale s: T(nu, mu, s)",
  Tri: "Triangular distribution with minimum a, mode c and maximum b: Tri(a, c, b)",
  trunc: "trunc(X, lo, hi) truncates the distribution X to [lo, hi] (use -inf or inf for one side); trunc(x) rounds towards zero",
};

// Marsaglia–Tsang gamma variate with shape k and scale 1
function gammaVariate(k, r) {
  if (k < 1) return gammaVariate(k + 1, r) * Math.pow(r(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      const u1 = r() || 1e-300, u2 = r();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function addDistributions(calc) {
  const env = calc.env;
  const b = calc.builtins;
  const origGamma = b.Gamma || b.gamma;
  const origTrunc = b.trunc;
  const N = () => MC.N;

  // parameter as plain numbers (base units): value of sample i
  const param = (q) => {
    const s = MC.on ? q.x.samples() : null;
    const n = q.x.n;
    return s ? (i) => s[i] : () => n;
  };
  const need = (fn, args, n) => {
    if (args.length !== n || args.some((a) => !(a instanceof Q))) throw new UnitError(`${fn} expects ${n} arguments`);
  };
  const pure = (q, fn, what) => env.checkPure(q, `${fn} (${what})`);
  const same = (a, b2, fn) => env.checkCompatible(a, b2, fn);

  // a distribution value with the dimensions of `like`
  // gen(i, r): one draw in base units for sample i; quant(i, u): inverse CDF or null
  function make({ mean, sd, gen, quant, like = null }) {
    const id = newSourceId();
    let u;
    if (MC.on) {
      const s = new Float64Array(N());
      if (quant) {
        const strata = lhsUniform(N(), (MC.seed ^ Math.imul(id, 2246822519)) >>> 0);
        for (let i = 0; i < s.length; i++) s[i] = quant(i, strata[i]);
      } else {
        const r = rng((MC.seed ^ Math.imul(id, 3266489917)) >>> 0);
        for (let i = 0; i < s.length; i++) s[i] = gen(i, r);
      }
      const c = new Map();
      if (sd > 0) c.set(id, sd);
      u = new UNum(mean, c, s);
    } else {
      u = UNum.uncertain(mean, sd);
    }
    u.gen = gen;
    return like ? new Q(u, like.d, like.zero) : new Q(u);
  }

  b.N = (...a) => {
    need("N", a, 2);
    const [mu, sigma] = a;
    same(mu, sigma, "N");
    const m = param(mu), s = param(sigma);
    const gen = (i, r) => m(i) + s(i) * normInv(r() || 1e-16);
    if (!MC.on) {
      // linear: μ keeps its own errors (and correlations), plus σ
      const q = new Q(mu.x.add(UNum.uncertain(0, Math.abs(sigma.x.n))), mu.d, mu.zero);
      q.x.gen = gen;
      return q;
    }
    return make({ mean: mu.x.n, sd: Math.abs(sigma.x.n), like: mu, gen, quant: (i, u) => m(i) + s(i) * normInv(u) });
  };

  b.U = (...a) => {
    need("U", a, 2);
    const [lo, hi] = a;
    same(lo, hi, "U");
    const l = param(lo), h = param(hi);
    return make({
      mean: (lo.x.n + hi.x.n) / 2, sd: Math.abs(hi.x.n - lo.x.n) / Math.sqrt(12), like: lo,
      gen: (i, r) => l(i) + (h(i) - l(i)) * r(),
      quant: (i, u) => l(i) + (h(i) - l(i)) * u,
    });
  };

  b.LogN = (...a) => {
    need("LogN", a, 2);
    const [med, width] = a;
    pure(width, "LogN", "s");
    const m = param(med), s = param(width);
    const s0 = width.x.n, mean = med.x.n * Math.exp(s0 * s0 / 2);
    return make({
      mean, sd: mean * Math.sqrt(Math.exp(s0 * s0) - 1), like: med,
      gen: (i, r) => m(i) * Math.exp(s(i) * normInv(r() || 1e-16)),
      quant: (i, u) => m(i) * Math.exp(s(i) * normInv(u)),
    });
  };

  b.Gamma = (...a) => {
    if (a.length === 1) return origGamma(...a);
    need("Gamma", a, 2);
    const [shape, scale] = a;
    pure(shape, "Gamma", "k");
    const k = param(shape), t = param(scale);
    return make({
      mean: shape.x.n * scale.x.n, sd: Math.sqrt(shape.x.n) * Math.abs(scale.x.n), like: scale,
      gen: (i, r) => t(i) * gammaVariate(k(i), r),
    });
  };

  b.Beta = (...a) => {
    need("Beta", a, 2);
    const [pa, pb] = a;
    pure(pa, "Beta", "a");
    pure(pb, "Beta", "b");
    const fa = param(pa), fb = param(pb);
    const x = pa.x.n, y = pb.x.n;
    return make({
      mean: x / (x + y), sd: Math.sqrt((x * y) / ((x + y) ** 2 * (x + y + 1))),
      gen: (i, r) => {
        const g1 = gammaVariate(fa(i), r), g2 = gammaVariate(fb(i), r);
        return g1 / (g1 + g2);
      },
    });
  };

  b.T = (...a) => {
    need("T", a, 3);
    const [nu, mu, scale] = a;
    pure(nu, "T", "nu");
    same(mu, scale, "T");
    const v = param(nu), m = param(mu), s = param(scale);
    const v0 = nu.x.n;
    if (!MC.on && !(v0 > 2)) throw new UnitError("T: the variance needs ν > 2 (use Monte Carlo for ν ≤ 2)");
    return make({
      mean: mu.x.n, sd: v0 > 2 ? Math.abs(scale.x.n) * Math.sqrt(v0 / (v0 - 2)) : Math.abs(scale.x.n), like: mu,
      gen: (i, r) => {
        const z = normInv(r() || 1e-16);
        const chi2 = 2 * gammaVariate(v(i) / 2, r);
        return m(i) + s(i) * z / Math.sqrt(chi2 / v(i));
      },
    });
  };

  b.Tri = (...a) => {
    need("Tri", a, 3);
    const [lo, mode, hi] = a;
    same(lo, mode, "Tri");
    same(lo, hi, "Tri");
    const l = param(lo), c = param(mode), h = param(hi);
    const A = lo.x.n, C = mode.x.n, B = hi.x.n;
    if (!(A <= C && C <= B && A < B)) throw new UnitError("Tri: needs a ≤ c ≤ b");
    const q = (i, u) => {
      const a0 = l(i), c0 = c(i), b0 = h(i), f = (c0 - a0) / (b0 - a0);
      return u < f ? a0 + Math.sqrt(u * (b0 - a0) * (c0 - a0)) : b0 - Math.sqrt((1 - u) * (b0 - a0) * (b0 - c0));
    };
    return make({
      mean: (A + B + C) / 3, sd: Math.sqrt((A * A + B * B + C * C - A * B - A * C - B * C) / 18), like: lo,
      gen: (i, r) => q(i, r()), quant: q,
    });
  };

  b.trunc = (...a) => {
    if (a.length === 1) return origTrunc(...a);
    if (a.length < 2 || a.length > 3) throw new UnitError("trunc expects 1, 2 or 3 arguments");
    const [X, lo, hi] = a;
    const gen = X.x.gen;
    if (!gen) throw new UnitError("trunc: the first argument must be a distribution such as N(…) or U(…)");
    const bound = (q) => {
      if (!q) return Infinity;
      if (!Number.isFinite(q.x.n)) return q.x.n;
      env.checkCompatible(q, X, "trunc");
      return q.x.n;
    };
    const L = bound(lo), H = hi ? bound(hi) : Infinity;
    if (!(L < H)) throw new UnitError("trunc: needs lo < hi");
    const id = newSourceId();
    const r = rng((MC.seed ^ Math.imul(id, 2654435761)) >>> 0);
    const draw = (i) => {
      for (let t = 0; t < 100000; t++) {
        const v = gen(i, r);
        if (v >= L && v <= H) return v;
      }
      throw new UnitError("trunc: almost no probability inside the bounds");
    };
    let u;
    if (MC.on) {
      const src = X.x.samples();
      const s = new Float64Array(src.length);
      for (let i = 0; i < s.length; i++) s[i] = src[i] >= L && src[i] <= H ? src[i] : draw(i);
      let m = 0;
      for (const v of s) m += v;
      m /= s.length;
      let vv = 0;
      for (const v of s) vv += (v - m) * (v - m);
      const c = new Map([[id, Math.sqrt(vv / (s.length - 1))]]);
      u = new UNum(m, c, s);
    } else {
      // moments of the truncated distribution from a private sample
      const n = 20000;
      let m = 0, m2 = 0;
      for (let i = 0; i < n; i++) {
        const v = draw(0);
        m += v;
        m2 += v * v;
      }
      m /= n;
      u = UNum.uncertain(m, Math.sqrt(Math.max(0, m2 / n - m * m)));
    }
    u.gen = (i, rr) => {
      for (let t = 0; t < 100000; t++) {
        const v = gen(i, rr);
        if (v >= L && v <= H) return v;
      }
      return NaN;
    };
    return new Q(u, X.d, X.zero);
  };

  Object.assign(functionDocs, DIST_DOCS);
  for (const k of Object.keys(DIST_DOCS)) SCIENCE.add(k);
}

// Summary of a Monte Carlo result for the history: quantiles and histogram
function distSummary(q) {
  if (!MC.on || !q || !q.x || !(q.x.s || q.x.c)) return null;
  let r;
  try { r = env().display(q); } catch { return null; }
  if (r.format || !r.num || !r.num.samples) return null;
  const s = r.num.samples();
  if (!s) return null;
  const v = Float64Array.from(s).sort();
  const n = v.length;
  const qu = (p) => {
    const x = p * (n - 1), i = Math.floor(x), f = x - i;
    return i + 1 < n ? v[i] * (1 - f) + v[i + 1] * f : v[i];
  };
  let m = 0;
  for (const x of v) m += x;
  m /= n;
  let ss = 0;
  for (const x of v) ss += (x - m) * (x - m);
  const x0 = qu(0.005), x1 = qu(0.995);
  const nb = 40, bins = new Array(nb).fill(0);
  if (x1 > x0) for (const x of v) if (x >= x0 && x <= x1) bins[Math.min(nb - 1, Math.floor(((x - x0) / (x1 - x0)) * nb))]++;
  const unit = r.tree ? treeHTML(r.tree) : "";
  return {
    unit, n, mean: m, sd: Math.sqrt(ss / (n - 1)), med: qu(0.5),
    lo: qu(0.158655), hi: qu(0.841345), l95: qu(0.02275), h95: qu(0.97725), x0, x1, bins,
  };
}

function openDistribution(entry) {
  const d = entry.dist;
  if (!d) return;
  openSheet("Distribution", (root) => {
    const f = (x) => formatNumber(x, 6);
    const max = Math.max(...d.bins, 1);
    const W = 320, H = 120, bw = W / d.bins.length;
    const xs = (x) => ((x - d.x0) / (d.x1 - d.x0)) * W;
    const bars = d.bins.map((c, i) => `<rect x="${(i * bw).toFixed(1)}" y="${(H - (c / max) * H).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${((c / max) * H).toFixed(1)}"/>`).join("");
    const line = (x, cls) => (x >= d.x0 && x <= d.x1 ? `<line class="${cls}" x1="${xs(x).toFixed(1)}" x2="${xs(x).toFixed(1)}" y1="0" y2="${H}"/>` : "");
    const u = d.unit ? ` <span class="u">${d.unit}</span>` : "";
    root.innerHTML = `
      <p class="dist-in">${exprHTML(entry.input)}</p>
      <svg class="hist" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Histogram of the samples">
        <g class="bars">${bars}</g>${line(d.lo, "q")}${line(d.hi, "q")}${line(d.med, "m")}
      </svg>
      <div class="hist-axis"><span>${f(d.x0)}</span><span>${f(d.x1)}</span></div>
      <div class="group">
        <div class="row"><div class="lbl">Median</div><div>${f(d.med)}${u}</div></div>
        <div class="row"><div class="lbl">68 % interval<small>15.9 % – 84.1 %</small></div><div>${f(d.lo)} – ${f(d.hi)}</div></div>
        <div class="row"><div class="lbl">95 % interval<small>2.3 % – 97.7 %</small></div><div>${f(d.l95)} – ${f(d.h95)}</div></div>
        <div class="row"><div class="lbl">Mean</div><div>${f(d.mean)}</div></div>
        <div class="row"><div class="lbl">Standard deviation</div><div>${f(d.sd)}</div></div>
        <div class="row"><div class="lbl">Samples</div><div>${d.n}</div></div>
      </div>`;
  });
}

// ---------------------------------------------------------------------
// Zooming plots
//
// A plot of lists only changes its view; plot(f(x), x, a, b) is computed
// again over the x range in view (by running its line with a range
// override), sampled as the x axis is drawn

// recomputes the plot of history entry e if its range or sampling no
// longer match the view (or, with home, over its first range): the time
// it took in ms, or null if it failed
function replot(e, { home = false, quiet = false, force = false } = {}) {
  const p = e.plot;
  if (!p.range) {
    if (home) delete p.view;
    return 0;
  }
  let want = p.home;
  if (!home) {
    const g = plotGeom(p), { a, b } = p.range, [v0, v1] = p.xr;
    const toU = (v) => a + ((v - v0) / (v1 - v0)) * (b - a);
    want = p.view ? { a: toU(p.view.x0), b: toU(p.view.x1) } : { a, b };
    want.log = g.logx && want.a > 0 && want.b > 0;
    const tol = 1e-9 * Math.abs(want.b - want.a);
    if (!force && Math.abs(want.a - a) <= tol && Math.abs(want.b - b) <= tol && want.log === p.range.log) return 0;
  }
  // the asymptotes, if shown: the lines only once
  if (p.showAsym) want = { ...want, asym: !home && p.asym && p.asym.lines ? "v" : "all" };
  const t0 = performance.now();
  const calc = state.calc;
  calc.plotRange = want;
  let r;
  try {
    r = calc.run(e.input);
  } finally {
    calc.plotRange = null;
  }
  if (r.kind !== "plot") {
    if (!quiet) toast(r.kind === "error" ? `Cannot recompute the plot: ${r.message}` : "Cannot recompute the plot");
    return null;
  }
  e.plot = home ? plotOf(r.plot) : plotOf(r.plot, p);
  if (home && p.showAsym) e.plot.showAsym = true;
  return performance.now() - t0;
}

function plotToggleLog(e, axis) {
  const p = e.plot, k = "log" + axis;
  p[k] = !(p[k] && p["can" + k]);
  // a view of linear values may not fit a log axis
  if (p.view && axis === "y") { delete p.view.y0; delete p.view.y1; }
  if (p.view && axis === "x" && p[k] && p.view.x0 <= 0) delete p.view;
  if (axis === "x") replot(e);
  saveHistory();
}

// draws history entry e again, as its plot changed
function refreshEntry(e) {
  const i = state.history.indexOf(e);
  const div = historyEl.querySelector(`.entry[data-i="${i}"]`);
  if (div) div.replaceWith(renderEntry(e, i));
}

let plotViewResize = null;
window.addEventListener("resize", () => { if (plotViewResize) plotViewResize(); });

// The zoom view of the plot of history entry e: drag to move, pinch or
// scroll to zoom (x only; shift: both), tap to read values, double-tap to
// fit y
function openPlot(e) {
  openSheet("Plot", (root) => {
    root.innerHTML = `<p class="plot-in">${exprHTML(e.input)}</p>
      <div class="out plot plot-full"><svg class="plot-svg" role="img" aria-label="Plot"></svg>${plotLegend(e.plot)}
      <div class="plot-bar"><div class="plot-read">Drag to move, pinch or scroll to zoom</div><span class="plot-chips"></span></div></div>`;
  });
  const root = sheetBody, svg = root.querySelector(".plot-svg");
  let W = PLOT_W, H = PLOT_H, raf = 0, fast = false;
  const draw = () => {
    svg.innerHTML = plotSVG(e.plot, W, H);
    root.querySelector(".plot-chips").innerHTML = plotChips(e.plot, true);
  };
  const size = () => {
    W = Math.max(240, Math.round(svg.parentElement.clientWidth));
    H = Math.round(Math.max(200, Math.min(W * 1.2, window.innerHeight - 260)));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    draw();
  };
  size();
  plotViewResize = () => { if (svg.isConnected && !sheet.hidden) size(); };
  // while moving, plots that are fast to compute follow at once
  const redraw = () => {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      if (fast) fast = (replot(e, { quiet: true }) ?? Infinity) < 30;
      draw();
    });
  };
  const commit = () => {
    const ms = replot(e);
    if (ms !== null) fast = ms < 30;
    saveHistory();
    draw();
    refreshEntry(e);
  };
  const fitY = () => {
    const p = e.plot;
    if (!p.view || p.view.y0 === undefined) return;
    delete p.view.y0;
    delete p.view.y1;
    commit();
  };

  // gestures: the view at their start (base), in the drawn coordinates
  // (log10 on a log axis), and the pointers then and now
  const pts = new Map();
  let base = null, moved = false, lastTap = null, wheelTimer = null;
  const local = (ev) => {
    const b = svg.getBoundingClientRect();
    return { x: ((ev.clientX - b.left) * W) / b.width, y: ((ev.clientY - b.top) * H) / b.height };
  };
  const start = () => {
    const p = e.plot, g = plotGeom(p, W, H);
    base = {
      g, X0: g.tx(g.x0), X1: g.tx(g.x1), Y0: g.ty(g.y0), Y1: g.ty(g.y1),
      yfix: Boolean(p.view && p.view.y0 !== undefined),
      pts: new Map([...pts].map(([k, v]) => [k, { ...v }])),
    };
  };
  const setView = (X0, X1, Y0, Y1, sety) => {
    const g = base.g;
    const fine = (a, b) => isFinite(a) && isFinite(b) && b - a > 1e-11 * Math.max(Math.abs(a), Math.abs(b));
    const v = { x0: g.ux(X0), x1: g.ux(X1) };
    if (!fine(X0, X1) || !fine(v.x0, v.x1)) return;
    if (sety) {
      Object.assign(v, { y0: g.uy(Y0), y1: g.uy(Y1) });
      if (!fine(Y0, Y1) || !fine(v.y0, v.y1)) return;
    }
    e.plot.view = v;
    redraw();
  };
  // one axis of a pinch: the point under the middle of the fingers stays
  // there, the range scales as their distance (c: from the axis origin)
  const pinch = (c0, d0, c1, d1, T0, T1, len) => {
    const s0 = Math.abs(c0 - d0), s1 = Math.abs(c1 - d1);
    const k = s0 > 40 && s1 > 10 ? s0 / s1 : 1;
    const m0 = (c0 + d0) / 2, m1 = (c1 + d1) / 2;
    const t = T0 + (m0 / len) * (T1 - T0), span = (T1 - T0) * k;
    return [t - (m1 / len) * span, t - (m1 / len) * span + span, k !== 1 || Math.abs(m1 - m0) > 20];
  };

  svg.addEventListener("pointerdown", (ev) => {
    svg.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, local(ev));
    if (pts.size === 1) moved = false;
    start();
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId)) {
      if (ev.pointerType === "mouse") plotRead(svg, e.plot, ev.clientX);
      return;
    }
    pts.set(ev.pointerId, local(ev));
    const g = base.g, B = H - g.B;
    const ids = [...base.pts.keys()].filter((k) => pts.has(k));
    if (ids.length === 1) {
      const a0 = base.pts.get(ids[0]), a = pts.get(ids[0]);
      const dx = a.x - a0.x, dy = a.y - a0.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      // mostly sideways, y keeps fitting the values
      const sety = base.yfix || Math.abs(dy) > 20;
      const sx = ((base.X1 - base.X0) * dx) / g.pw, sy = sety ? ((base.Y1 - base.Y0) * dy) / g.ph : 0;
      setView(base.X0 - sx, base.X1 - sx, base.Y0 + sy, base.Y1 + sy, sety);
    } else if (ids.length >= 2) {
      moved = true;
      const [a0, b0] = ids.map((k) => base.pts.get(k)), [a, b] = ids.map((k) => pts.get(k));
      const [X0, X1] = pinch(a0.x - g.L, b0.x - g.L, a.x - g.L, b.x - g.L, base.X0, base.X1, g.pw);
      const [Y0, Y1, ych] = pinch(B - a0.y, B - b0.y, B - a.y, B - b.y, base.Y0, base.Y1, g.ph);
      const sety = base.yfix || ych;
      setView(X0, X1, sety ? Y0 : base.Y0, sety ? Y1 : base.Y1, sety);
    }
  });
  const up = (ev) => {
    if (!pts.has(ev.pointerId)) return;
    const was = pts.size;
    pts.delete(ev.pointerId);
    if (pts.size) { start(); return; }
    if (!moved && was === 1 && ev.type === "pointerup") {
      // a tap reads the values; two quick ones fit y
      const now = Date.now();
      if (lastTap && now - lastTap.t < 350 && Math.abs(ev.clientX - lastTap.x) < 30) {
        lastTap = null;
        fitY();
        return;
      }
      lastTap = { t: now, x: ev.clientX };
      plotRead(svg, e.plot, ev.clientX);
      return;
    }
    if (moved) commit();
  };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    start();
    const g = base.g, c = local(ev);
    const k = Math.exp((ev.deltaMode ? ev.deltaY * 16 : ev.deltaY) * 0.0015);
    const at = (T0, T1, f) => { const t = T0 + f * (T1 - T0); return [t - f * (T1 - T0) * k, t + (1 - f) * (T1 - T0) * k]; };
    const [X0, X1] = at(base.X0, base.X1, (c.x - g.L) / g.pw);
    const [Y0, Y1] = ev.shiftKey ? at(base.Y0, base.Y1, (H - g.B - c.y) / g.ph) : [base.Y0, base.Y1];
    setView(X0, X1, Y0, Y1, base.yfix || ev.shiftKey);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(commit, 250);
  }, { passive: false });
  root.addEventListener("click", (ev) => {
    const lg = ev.target.closest("[data-plotlog]");
    if (lg) {
      plotToggleLog(e, lg.dataset.plotlog);
    } else if (ev.target.closest("[data-plotfit]")) {
      fitY();
      return;
    } else if (ev.target.closest("[data-plotasym]")) {
      const p = e.plot;
      p.showAsym = !p.showAsym;
      if (p.showAsym && !(p.asym && p.asym.v && p.asym.lines)) replot(e, { force: true });
      const a = e.plot.asym;
      if (e.plot.showAsym && a && !a.v.length && !(a.lines || []).length) toast("No asymptotes found");
      saveHistory();
    } else if (ev.target.closest("[data-plotreset]")) {
      replot(e, { home: true });
      saveHistory();
    } else return;
    draw();
    refreshEntry(e);
  });
}

// ---------------------------------------------------------------------
// Suggestions

const suggestEl = $("#suggest");
let categoryDims = null;

function catDims() {
  if (categoryDims) return categoryDims;
  categoryDims = CATEGORIES.map(([name, us]) => {
    for (const u of us) {
      try { return { name, d: env().unit(u).d }; } catch { /* try next */ }
    }
    return { name, d: null };
  });
  return categoryDims;
}

function categoryFor(q) {
  const c = catDims().find((c) => c.d && dimEq(c.d, q.d) && !(q.pure && c.name !== "Angle"));
  return c ? c.name : null;
}

// Conversion targets compatible with q, most useful first
function targetsFor(q) {
  const e = env();
  const out = [];
  const add = (u) => { if (!out.includes(u)) out.push(u); };
  const cat = categoryFor(q);
  if (cat) {
    for (const u of CATEGORIES.find((c) => c[0] === cat)[1]) {
      try { if (dimEq(e.unit(u).d, q.d)) add(u); } catch { /* unit missing */ }
    }
  }
  const isMoney = cat === "Money";
  if (!q.pure) {
    for (const [k, v] of e.units) {
      if (dimEq(v.d, q.d) && (isMoney || !v.currency)) add(k);
    }
  }
  const isTime = q.d.every((x, i) => (i === 2 ? x === 1 : x === 0)) && q.d[2] === 1;
  if (isTime) { add("hms"); add("dhms"); }
  if (q.pure) { add("dms"); add("frac"); }
  if (!q.pure) { add("SI"); add("Easy"); }
  return out;
}

// Position of the last top-level @, or -1
function lastAt(text) {
  let q = null, idx = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' && !/\d\s*$/.test(text.slice(0, i))) q = c;
    else if (c === "@") idx = i;
  }
  return idx;
}

function completions(word, inSpec, q) {
  const e = env();
  const w = word;
  const seen = new Set();
  const res = [];
  const push = (name, kind, label = name, insertText = name) => {
    if (seen.has(label)) return;
    seen.add(label);
    res.push({ name, kind, label, insertText });
  };
  const ok = (name) => name.startsWith(w);
  const compatible = (u) => {
    if (!q) return true;
    try { return dimEq(e.unit(u).d, q.d); } catch { return false; }
  };
  for (const u of POPULAR) if (ok(u) && e.isunit(u.split(/[/^]/)[0]) && compatible(u)) push(u, "unit");
  if (inSpec) {
    for (const k of e.systems.keys()) if (ok(k)) push(k, "system");
    for (const k of e.formats.keys()) if (ok(k)) push(k, "format");
  }
  for (const [k, v] of e.units) {
    if (!ok(k) || (v.currency && w.length < 2)) continue;
    if (compatible(k)) push(k, "unit");
  }
  if (!inSpec) {
    for (const [k, v] of e.vars) if (k !== "ans" && ok(k)) push(k, v.fn ? "function" : "variable", k, v.fn ? k + "(" : k);
    for (const k of Object.keys(state.calc.builtins)) if (ok(k)) push(k, "function", k, k + "(");
    for (const k of ["pi", "tau", "ans", "const"]) if (ok(k)) push(k, "variable", k, k === "const" ? 'const["' : k);
  }
  if (res.length < 12) {
    for (const [p] of e.prefixes) {
      if (!p || !(w.startsWith(p) || p.startsWith(w))) continue;
      for (const base of ["m", "g", "s", "W", "J", "Hz", "Pa", "V", "A", "Ω", "F", "eV", "L", "pc", "yr", "bar", "N", "C", "T", "mol", "Wh"]) {
        const name = p + base;
        if (ok(name) && e.isunit(name) && compatible(name)) push(name, "unit");
        if (res.length > 30) break;
      }
    }
  }
  return res.slice(0, 30);
}

const supHTML = unitLabelHTML;

function chipHTML(label, attrs, cls = "chip", small = "", html = false) {
  return `<button class="${cls}" ${attrs}><span>${html ? label : esc(label)}</span>${small ? `<small>${esc(small)}</small>` : ""}</button>`;
}

let suggestTimer = null;

function updateSuggestions() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(computeSuggestions, 30);
}

function computeSuggestions() {
  const text = state.text;
  const b = before();
  const atIdx = lastAt(b);
  const inSpec = atIdx >= 0 && bracketDepth(b) === 0;
  let leftQ = null;
  if (inSpec) {
    try { leftQ = evalPreview(text.slice(0, atIdx)); } catch { leftQ = null; }
  }
  const wm = /([\p{L}_°µΩÅ][\p{L}\p{N}_]*)$/u.exec(b);
  const word = wm ? wm[1] : "";
  const known = word && (env().isunit(word) || env().vars.has(word) || state.calc.builtins[word]);
  const completeChips = (items) => items
    .filter((it) => it.label !== word)
    .map((it) => chipHTML(it.label, `data-complete="${esc(it.insertText)}" data-len="${word.length}"`, "chip", it.kind === "unit" ? "" : it.kind[0]))
    .join("");
  const unitChip = (u) => chipHTML(supHTML(u), `data-unit="${esc(u)}"`, "chip unit", "", true);
  const ctx = unitContext(b);
  let html = "";
  if (inSpec) {
    if (word && !(known && leftQ && targetsFor(leftQ).includes(word))) html = completeChips(completions(word, true, leftQ));
    else if (leftQ && !word) html = targetsFor(leftQ).slice(0, 40).map(unitChip).join("");
  } else if (word) {
    // completing a name (after a number only units make sense); a complete
    // name first offers what can follow it
    const afterNumber = /[\d.]\s*$/.test(b.slice(0, b.length - word.length)) || ctx === "inside";
    const items = afterNumber ? completions(word, true, null).filter((it) => it.kind === "unit") : completions(word, false, null);
    html = (known ? afterValueChips(text) : "") + completeChips(items);
  } else if (/\^\s*$/.test(b)) {
    // an exponent
    const vars = contextVariables(b, text).filter((v) => v !== "inf");
    html = vars.map((v) => chipHTML(prettyName(v, { unit: false }) || esc(v), `data-const="${esc(v)}"`, "chip var", "", true)).join("") +
      [["2", "2"], ["3", "3"], ["−1", "-1"], ["½", "(1/2)"], ["−2", "-2"], ["⅓", "(1/3)"]]
        .map(([l, x]) => chipHTML(l, `data-complete="${esc(x)}" data-len="0"`)).join("");
  } else if ((ctx === "bare" && /[\d.]\s*$/.test(b)) || (ctx === "inside" && /[[\s/(*]$/.test(b))) {
    // a number (or an open unit bracket): units, angles first inside trig functions
    const angles = /\b(sin|cos|tan)\(\s*[^()]*$/.test(b) ? ["deg", "rad", "arcmin", "arcsec"] : [];
    const vars = ctx === "bare" ? contextVariables(b, text).filter((v) => v !== "inf") : [];
    html = vars.map((v) => chipHTML(prettyName(v, { unit: false }) || esc(v), `data-const="${esc(v)}"`, "chip var", "", true)).join("") +
      dedupe([...angles, ...recentNames("u", 8), ...SI_SUGGEST]).slice(0, 26).map(unitChip).join("");
  } else if (!text.trim() || /(^|[-+*/(,=|~±])\s*$/.test(b)) {
    // start of an operand: last result, your names, common constants and functions
    html = operandChips(b);
  } else {
    html = afterValueChips(text);
  }
  suggestEl.innerHTML = html;
  suggestEl.scrollLeft = 0;
  updatePredictions();
  updateAtKeys();
}

const dedupe = (xs) => [...new Set(xs)];

// Names used recently in the history: "u" units, "v" variables, "f" functions
function recentNames(cls, n) {
  const out = [];
  const e = env();
  for (let i = state.history.length - 1; i >= 0 && out.length < n; i--) {
    const t = state.history[i].input;
    let segs;
    try { segs = segments(t); } catch { continue; }
    for (let j = segs.length - 1; j >= 0; j--) {
      const sg = segs[j];
      if (sg.cls !== cls) continue;
      let name = t.slice(sg.s, sg.e);
      if (cls === "u") {
        if (!isBareUnit(name) || LEGACY_UNITS.has(name)) continue;
      } else if (cls === "v") {
        name = e.vars.resolve(name);
        if (!e.vars.has(name) || name === "ans") continue;
      } else if (cls === "f") {
        if (!state.calc.builtins[name] && !(e.vars.get(name) || {}).fn) continue;
      }
      if (!out.includes(name)) out.push(name);
      if (out.length >= n) break;
    }
  }
  return out;
}

const OPERAND_DEFAULTS = ["pi", "c", "G", "h", "hbar", "k", "e", "m_e", "m_p", "g", "N_A", "M_Sun"];

// functions with a variable of their own, and names often chosen for it
const BINDERS = { solve: ["x", "t", "z"], roots: ["x", "t", "z"], limit: ["x", "t", "z"], integrate: ["x", "t", "z"], diff: ["x", "t", "z"], plot: ["x", "t", "z"], sum: ["k", "n", "i"] };

// the arguments of a call, from just after its "(" (up to its ")")
function topArgs(s) {
  const args = [""];
  let depth = 0;
  for (const c of s) {
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (!depth) break; depth--; }
    else if (c === "," && !depth) { args.push(""); continue; }
    args[args.length - 1] += c;
  }
  return args;
}

// Names the cursor is likely to want: inside solve, integrate… their
// variable (common names while it is still to be chosen), ∞ in integration
// limits, and in the body of f(x, y) = … the parameters
function contextVariables(b, text) {
  const out = [];
  let depth = 0, arg = 0;
  for (let i = b.length - 1; i >= 0; i--) {
    const c = b[i];
    if (c === ")" || c === "]") depth++;
    else if (c === "," && !depth) arg++;
    else if (c === "(" || c === "[") {
      if (depth) { depth--; continue; }
      if (c === "[") return [];
      const m = /([\p{L}_][\p{L}\p{N}_]*)\s*$/u.exec(b.slice(0, i));
      if (m && BINDERS[m[1]]) {
        const v = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*$/u.exec(topArgs(text.slice(i + 1))[1] || "");
        if (arg === 0) out.push(...(v ? [v[1]] : BINDERS[m[1]]));
        else if (arg === 1) out.push(...BINDERS[m[1]]);
        else if (["integrate", "roots", "sum", "limit"].includes(m[1])) out.push("inf");
      }
      arg = 0;
    }
  }
  const def = /^\s*[\p{L}_][\p{L}\p{N}_]*\s*\(([^()]*)\)\s*=(?!=)/u.exec(text);
  if (def && b.length >= def[0].length) out.push(...def[1].split(",").map((p) => p.trim()).filter(Boolean));
  return dedupe(out);
}

function operandChips(b) {
  const e = env();
  const chips = contextVariables(b, state.text).map((v) =>
    chipHTML(v === "inf" ? "∞" : prettyName(v, { unit: false }) || esc(v), `data-const="${esc(v)}"`, "chip var", "", true));
  if (lastValue()) chips.push(chipHTML("ans", 'data-const="ans"'));
  const mine = [...e.vars.keys()].filter((k) => k !== "ans" && !state.calc.systemNames.has(k) && !(e.vars.get(k) || {}).fn);
  const names = dedupe([...recentNames("v", 6), ...mine.slice(-4), ...OPERAND_DEFAULTS]).slice(0, 16);
  for (const n of names) {
    const c = CONSTS.find((c) => c[1] === n);
    chips.push(chipHTML(constLabel(c ? c[0] : n, n), `data-const="${esc(n)}"`, "chip", "", true));
  }
  // functions you used, then a few common ones (not right after a function name)
  const fns = dedupe([...recentNames("f", 4), "sqrt", "ln", "sin", "cos", "exp"]).slice(0, 6);
  for (const f of fns) {
    const label = (prettyName(f, { fn: true }) || esc(f)) + "(";
    chips.push(chipHTML(label, `data-fn="${esc(f)}("`, "chip fnc", "", true));
  }
  return chips.join("");
}

// After a complete value: conversions of its units
function afterValueChips(text) {
  let q = null;
  try { q = evalPreview(text); } catch { q = null; }
  if (q && (!q.pure || (q.show && q.show.tree))) {
    return targetsFor(q).slice(0, 30).map((u) => chipHTML("→ " + supHTML(u), `data-convert="${esc(u)}"`, "chip conv", "", true)).join("");
  }
  if (q && q.pure && unitContext(before()) === "bare") {
    return dedupe([...recentNames("u", 8), ...SI_SUGGEST]).slice(0, 26)
      .map((u) => chipHTML(supHTML(u), `data-unit="${esc(u)}"`, "chip unit", "", true)).join("");
  }
  return "";
}

suggestEl.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.complete !== undefined) insert(b.dataset.complete, { replaceBefore: Number(b.dataset.len) });
  else if (b.dataset.unit) insertUnit(b.dataset.unit);
  else if (b.dataset.const) insertName(b.dataset.const);
  else if (b.dataset.convert) convertTo(b.dataset.convert);
  else if (b.dataset.fn) insertFunction(b.dataset.fn);
});

// Replace (or add) the @ part of the current input
function convertTo(unit) {
  const v = state.text;
  const i = lastAt(v);
  const base = (i >= 0 ? v.slice(0, i) : v).trimEnd();
  setInput(base + " @ " + unit);
}

// ---------------------------------------------------------------------
// Keypad

const DEL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7z"/><path d="m12 9.5 5 5m0-5-5 5"/></svg>';

const ENTER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5v6.5a3 3 0 0 1-3 3H5.5"/><path d="m9.5 10.5-4 4 4 4"/></svg>';

// [label, class, action, long, second, secondLong]; a nested pair is a
// split cell. The optional [label, action] pairs give the long press, the
// 2nd key and the long press after 2nd
const RIGHT = {
  num: [[DEL_SVG, "del", "backspace", ["AC", "clear"]], ["@", "conv", "@"],
    [["◀", "fn", "left", ["⇤", "home"]], ["▶", "fn", "right", ["⇥", "end"]]],
    ["π{/e}", "fn func", "n:pi", ["°", "u:deg"], ["{π/}e", "euler"], ["′", "u:arcmin"]], [ENTER_SVG, "eq", "enter", ["=", "assign"]]],
  units: [[DEL_SVG, "del", "backspace"], ["@", "conv", "@"], ["/", "op", "/"], [["x²", "op small", "pow2"], ["x³", "op small", "pow3"]], [ENTER_SVG, "eq", "enter"]],
  fn: [[DEL_SVG, "del", "backspace"], ["@", "conv", "@"], [["(", "op", "("], [")", "op", ")"]], [["◀", "fn", "left"], ["▶", "fn", "right"]], [ENTER_SVG, "eq", "enter"]],
  const: [[DEL_SVG, "del", "backspace"], ["@", "conv", "@"], [["×", "op", "*"], ["÷", "op", "/"]], [["(", "op", "("], [")", "op", ")"]], [["'x'", "op small", "q1"], ['"x"', "op small", "q2"]], [ENTER_SVG, "eq", "enter"]],
};

const NUM_KEYS = [
  ["sin{h}", "op func col", "f:sin(", ["⁻¹", "f:asin("], ["sinh", "f:sinh("], ["⁻¹", "f:asinh("]],
  [["(", "op", "("], [")", "op", ")"]],
  ["{³}√", "op", "f:sqrt(", ["x²", "pow2"], ["³√", "f:cbrt("], ["x³", "pow3"]],
  ["xʸ{/n!}", "op func", "^", ["logₓ", "f:log("], ["{xʸ/}n!", "f:factorial("], ["Γ", "f:Gamma("]],
  ["{⌊}x{⌋}", "op func", "f:abs(", ["sgn", "f:sgn("], ["⌊x⌋", "f:floor("], ["⌈x⌉", "f:ceil("]],
  ["cos{h}", "op func col", "f:cos(", ["⁻¹", "f:acos("], ["cosh", "f:cosh("], ["⁻¹", "f:acosh("]],
  ["7"], ["8"], ["9"], ["÷", "op", "/", ["x⁻¹", "pow-1"]],
  ["tan{h}", "op func col", "f:tan(", ["⁻¹", "f:atan("], ["tanh", "f:tanh("], ["⁻¹", "f:atanh("]],
  ["4"], ["5"], ["6"], ["×", "op", "*", ["x", "n:x"]],
  ["log{₁₀}", "op func col", "f:log(", ["eˣ", "f:exp("], ["log₁₀", "f:log10("], ["10ˣ", "10^"]],
  ["1"], ["2"], ["3"], ["−", "op", "-", ["f(x)", "deffn"]],
  ["2nd", "second", "second"], ["0"], [".", "", ".", [",", ","]], ["×10ˣ", "fn small", "EE"], ["+", "op", "+", ["±", "±"]],
];

// Bottom rows of the pages whose keys need the full width
const ACTIONS = {
  units: [["/", "op", "/"], ["x²", "op small", "pow2"], ["x³", "op small", "pow3"], ["[ ]", "op small", "brackets"], ["@", "conv", "@"], [DEL_SVG, "del", "backspace"], [ENTER_SVG, "eq", "enter"]],
  fn: [["(", "op", "("], [")", "op", ")"], [",", "op", ","], ["=", "op", "assign"], ["@", "conv", "@"], [DEL_SVG, "del", "backspace"], [ENTER_SVG, "eq", "enter"]],
};

// f(x) sections. Plain keys: [label, class, action]; described keys:
// {fn | name, label, desc}
const FN_SECTIONS = [
  ["Math", 5, 4, [
    ["x⁻¹", "fn small", "pow-1"], ["√", "fn", "f:sqrt("], ["∛", "fn", "f:cbrt("], ["eˣ", "fn small", "f:exp("], ["10ˣ", "fn small", "10^"],
    ["n!", "fn small", "f:factorial("], ["Γ", "fn", "f:Gamma("], ["log₂", "fn small", "f:log2("], ["ln", "fn small", "f:ln("], ["log₁₀", "fn small", "f:log10("],
    ["|x|", "fn small", "f:abs("], ["round", "fn small", "f:round("], ["floor", "fn small", "f:floor("], ["value", "fn small", "f:nominal("], ["error", "fn small", "f:err("],
    ["π", "fn", "n:pi"], ["ans", "fn small", "n:ans"], ["f(x) =", "fn small", "deffn"], ["◀", "fn", "left"], ["▶", "fn", "right"],
  ]],
  ["Trig", 5, 4, [
    ["sin", "fn small", "f:sin("], ["cos", "fn small", "f:cos("], ["tan", "fn small", "f:tan("], ["atan2", "fn small", "f:atan2("], ["rad", "fn small", "u:rad"],
    ["asin", "fn small", "f:asin("], ["acos", "fn small", "f:acos("], ["atan", "fn small", "f:atan("], ["hypot", "fn small", "f:hypot("], ["°", "fn", "u:deg"],
    ["sinh", "fn small", "f:sinh("], ["cosh", "fn small", "f:cosh("], ["tanh", "fn small", "f:tanh("], ["π", "fn", "n:pi"], ["′", "fn", "u:arcmin"],
    ["asinh", "fn small", "f:asinh("], ["acosh", "fn small", "f:acosh("], ["atanh", "fn small", "f:atanh("], ["τ", "fn", "n:tau"], ["″", "fn", "u:arcsec"],
  ]],
  ["Calculus", 4, 3, [
    { fn: "solve", desc: "f(x) = y for x" }, { fn: "roots", desc: "All the x" }, { fn: "polyroots", desc: "Complex too" }, { key: "assign", label: "=", desc: "Equation" },
    { fn: "limit", label: "lim", desc: "x → x₀, ±∞" }, { fn: "diff", label: "d/dx", desc: "Derivative" }, { fn: "integrate", label: "∫ dx", desc: "Integral a…b" }, { fn: "sum", label: "Σ", desc: "Series k = a…b" },
    { fn: "plot", desc: "f(x), x, a, b" }, { key: "deffn", label: "f(x) =", desc: "Define" }, { key: "n:x", label: "x", desc: "Variable" }, { key: "n:inf", label: "∞", desc: "Infinity" },
  ]],
  ["Lists", 4, 3, [
    { fn: "linspace", label: "a…b", desc: "n equal steps" }, { fn: "logspace", label: "a…b log", desc: "n equal ratios" }, { fn: "len", desc: "Count" }, { fn: "plot", desc: "xs, ys" },
    { fn: "sum", label: "Σ", desc: "Sum" }, { fn: "mean", desc: "Average" }, { fn: "min", desc: "Smallest" }, { fn: "max", desc: "Largest" },
    { fn: "dot", label: "a · b", desc: "Scalar product" }, { fn: "cross", label: "a × b", desc: "Vector product" }, { fn: "norm", label: "|v|", desc: "Length" }, { fn: "angle", label: "∠(a, b)", desc: "Angle" },
  ]],
  ["Cosmology", 4, 3, [
    { fn: "H", label: "H(z)", desc: "Hubble param." }, { fn: "E", label: "E(z)", desc: "H(z)/H₀" }, { fn: "t_L", desc: "Lookback time" }, { fn: "age", label: "age", desc: "Age at z" },
    { fn: "D_C", desc: "Comoving" }, { fn: "D_M", desc: "Transverse" }, { fn: "D_A", desc: "Angular diam." }, { fn: "D_L", desc: "Luminosity" },
    { fn: "distmod", label: "μ(z)", desc: "Dist. modulus" }, { fn: "scale", label: "kpc/″", desc: "Proper scale" }, { fn: "V_C", desc: "Comov. volume" },
  ]],
  ["Lensing", 4, 2, [
    { fn: "Sigma_cr", desc: "Critical density" }, { fn: "theta_E", desc: "Point mass" }, { fn: "theta_E_SIS", desc: "Isothermal" }, { fn: "M_E", desc: "Mass in θ_E" },
    { fn: "D_A", desc: "Angular diam." }, { fn: "D_dt", desc: "Time delay" }, { fn: "scale", label: "kpc/″", desc: "Proper scale" },
  ]],
  ["Stats", 4, 4, [
    { fn: "pvalue", desc: "p-value of nσ" }, { fn: "nsigma", desc: "nσ of a p-value" }, { fn: "conf", label: "CL(nσ)", desc: "Inside ±nσ" }, { name: "fwhm", label: "FWHM/σ", desc: "2√(2 ln 2)" },
    { fn: "Phi", desc: "Normal CDF" }, { fn: "Phi_inv", desc: "Normal quantile" }, { fn: "p_chi2", desc: "χ² tail (x, k)" }, { fn: "p_t", desc: "Student t tail" },
    { fn: "erf", label: "erf", desc: "Error function" }, { fn: "erfc", label: "erfc", desc: "1 − erf" }, { fn: "erf_inv", desc: "Inverse erf" }, { name: "sqrt(2 pi)", label: "√2π", desc: "2.5066" },
    { fn: "binom", label: "binom", desc: "n choose k" }, { fn: "lgamma", desc: "log Γ(x)" }, { fn: "B", label: "B(a,b)", desc: "Beta function" }, { name: "gamma_E", desc: "Euler–Mascheroni" },
  ]],
  ["Distributions", 4, 3, [
    { fn: "N", label: "N(μ, σ)", desc: "Normal" }, { fn: "T", label: "T(ν, μ, s)", desc: "Student t" },
    { fn: "LogN", label: "LogN(m, s)", desc: "Log-normal" }, { fn: "Gamma", label: "Γ(k, θ)", desc: "Gamma" },
    { fn: "U", label: "U(a, b)", desc: "Uniform" }, { fn: "Tri", label: "Tri(a, c, b)", desc: "Triangular" },
    { fn: "Beta", label: "Beta(a, b)", desc: "Beta" }, { fn: "trunc", label: "trunc(X, lo, hi)", desc: "Truncate" },
    { key: "±", label: "±", desc: "Normal error" }, { key: "f:nominal(", label: "value", desc: "Without error" },
    { key: "f:err(", label: "error", desc: "σ only" }, { engine: true },
  ]],
  ["Yours", 3, 0, []],
];

// Long-press explanations
const USAGE = {
  sqrt: "sqrt(x): square root; works on units too, sqrt(4 m^2) = 2 m",
  cbrt: "cbrt(x): cube root; cbrt(8 m^3) = 2 m",
  abs: "abs(x): absolute value",
  sgn: "sgn(x): the sign, −1, 0 or 1 (also sign)",
  factorial: "factorial(n): n! = 1·2·…·n",
  Gamma: "Gamma(x): Euler's Γ function, Γ(n) = (n − 1)!",
  ln: "ln(x): natural logarithm of a pure number (same as log)",
  log: "log(x): natural logarithm of a pure number; log(b, x): in base b, the inverse of b^x, as log(2, 8) = 3",
  log10: "log10(x): decimal logarithm of a pure number",
  log2: "log2(x): base-2 logarithm of a pure number",
  exp: "exp(x): eˣ; exp(1) is Euler's number (the name e is the elementary charge)",
  round: "round(x) or round(x, n): round to n decimals, in base SI units",
  floor: "floor(x): round down, in base SI units",
  ceil: "ceil(x): round up, in base SI units",
  nominal: "nominal(x): the value without its uncertainty; nominal(3 ± 0.1) = 3",
  err: "err(x): the uncertainty; err(3 ± 0.1) = 0.1",
  min: "min(a, b, …) or min(list): smallest value",
  max: "max(a, b, …) or max(list): largest value",
  solve: "solve(f(x) = y, x, guess) or solve(f(x) = y, x, a, b): the x where both sides are equal; the guess (or the range) gives its units, as in solve(D_L(z) = 1 Gpc, z, 0, 5)",
  roots: "roots(f(x) = y, x): every x where both sides are equal, as a list; roots(f(x) = y, x, a, b) within a range (a or b can be ±inf), and roots(f(x) = y, x, 1 m) sets the units and the scale. The expression is sampled from 10⁻¹⁰ to 10¹⁰ times the scale on both sides of 0, so roots closer than the sampling can be missed",
  polyroots: "polyroots((a0, a1, …, an)): the n roots of a0 + a1 x + … + an x^n, complex ones too, as a table of real (Re) and imaginary (Im) parts; polyroots((1, 0, 1)) gives ±i. Coefficients can have units (x then has the units of a0/a1) and errors; a multiple root has errors only in Monte Carlo mode",
  limit: "limit(f(x), x, x0): the limit of f for x → x0, as limit(sin(x)/x, x, 0); limit(f(x), x, x0, 1) from above, limit(f(x), x, x0, -1) from below; x0 can be ±inf, as limit((1 + 1/x)^x, x, inf). Found numerically, by extrapolating values ever closer to x0; the limit is ±inf where 1/f goes to 0 and f keeps its sign, as limit(1/x, x, 0, 1). An expression that oscillates gives an error",
  integrate: "integrate(f(x), x, a, b): ∫ f dx from a to b, with units; a or b can be ±inf, as in integrate(exp(-x^2), x, -inf, inf)",
  diff: "diff(f(x), x, x0): derivative df/dx at x0, as in diff(age(z), z, 1); diff(f(x), x, x0, h) sets the step",
  plot: "plot(f(x), x, a, b): a curve; plot((f(x), g(x)), x, a, b) several. plot(ys) or plot(xs, ys) for lists. Errors show as a band",
  linspace: "linspace(a, b, n): n values from a to b in equal steps, as in z = linspace(0, 3, 7)",
  logspace: "logspace(a, b, n): n values from a to b in equal ratios, as in logspace(1, 1000, 4)",
  sum: "sum(list): sum of the values; sum(f(k), k, a, b): f(a) + f(a + 1) + … + f(b), as sum(1/k^2, k, 1, 1000); b can be inf (and a -inf), as sum(1/k^2, k, 1, inf) or sum(sin(k)/k, k, 1, inf); terms of one sign must decrease faster than k^-1 (and not too close to it)",
  mean: "mean(list): average of the values",
  len: "len(list): number of values",
  dot: "dot(a, b): scalar product a · b of two vectors; dot((3, 4) N, (2, 0) m) = 6 J",
  cross: "cross(a, b): vector product a × b of two 3-vectors, as cross(r, p) for the angular momentum",
  norm: "norm(v): length of a vector; norm((3, 4) m) = 5 m",
  angle: "angle(a, b): angle between two vectors, in rad (convert with @ deg)",
  atan2: "atan2(y, x): angle of the point (x, y), in rad (convert with @ deg)",
  hypot: "hypot(x, y, …) or hypot(list): √(x² + y² + …)",
  sin: "sin(x): sine; x in rad or with an angle unit, sin(30 deg)",
  cos: "cos(x): cosine; x in rad or with an angle unit, cos(30 deg)",
  tan: "tan(x): tangent; x in rad or with an angle unit",
  asin: "asin(x): arc sine, in rad (convert with @ deg)",
  acos: "acos(x): arc cosine, in rad (convert with @ deg)",
  atan: "atan(x): arc tangent, in rad (convert with @ deg)",
  sinh: "sinh(x): hyperbolic sine",
  cosh: "cosh(x): hyperbolic cosine",
  tanh: "tanh(x): hyperbolic tangent",
  asinh: "asinh(x): inverse hyperbolic sine",
  acosh: "acosh(x): inverse hyperbolic cosine",
  atanh: "atanh(x): inverse hyperbolic tangent",
};

const KEY_HELP = {
  assign: "Assignment: name = value, e.g. H_0 = 67.4 km/s/Mpc; or a function, f(x, y) = x^2 + y^2",
  deffn: "Start a function definition: f(x) = …",
  "@": "Convert: value @ unit, e.g. 3 ft @ cm; several units with |, 20 m/s @ km|hour gives 72 km/hour",
  EE: "Power of ten: 6.674e-11",
  "±": "Uncertainty: 9.81 ± 0.02 m/s^2; errors are propagated through the calculation",
  "pow-1": "Reciprocal: x⁻¹ (for units, s⁻¹)",
  brackets: "Unit brackets: 9.8[m/s^2]. Inside brackets, powers apply to the units only: 2[m^2] is 2 m², while 2[m]^2 is 4 m². Right after ] it steps back inside; inside, it steps out",
  q1: "Single quotes keep a variable as a unit: 1 au @ 'c' s gives 499 'c' s (light-seconds)",
  q2: "Double quotes remove a variable from the result (natural units): 1e30 kg @ \"c\"|\"G\" gives a length",
  "10^": "Power of ten: 10^x",
  "^": "Power: x^y",
  pow2: "Square, e.g. m²",
  pow3: "Cube, e.g. m³",
  left: "Move the cursor left (you can also tap in the expression, or slide sideways on ◀ ▶ or the space bar)",
  right: "Move the cursor right (you can also tap in the expression, or slide sideways on ◀ ▶ or the space bar)",
  home: "Move the cursor to the start",
  end: "Move the cursor to the end",
  euler: "ℯ = exp(1) = 2.71828…, Euler's number (the name e is the elementary charge)",
  clear: "Clear the expression",
  enter: "Evaluate the expression",
  mctoggle: "Switch between linear error propagation and Monte Carlo (samples: Settings → Uncertainties)",
  "n:ans": "ans: the last result",
  "n:pi": "π = 3.14159…",
  "n:tau": "τ = 2π",
};

function usageOf(name) {
  if (USAGE[name]) return USAGE[name];
  const d = functionDocs[name];
  if (d) return /\(/.test(d) ? `${name}: ${d}` : `${name}(x): ${d}`;
  const v = state.calc && env().vars.get(name);
  if (v && v.fn) return `${name}(${v.fn.params.join(", ")}): your function`;
  return name;
}

function modelText() {
  const val = (n, spec) => {
    try {
      let q = state.calc.lookup(n);
      if (spec) q = env().convert(q, [spec]);
      return qShort(q).replace(/\[([^\]]*)\]/, " $1");
    } catch { return "?"; }
  };
  return `ΛCDM model: H₀ = ${val("H_0", "km/s/Mpc")}, Ω_M = ${val("Omega_M")}, Ω_b = ${val("Omega_b")}, Ω_Λ = ${val("Omega_L")}, Ω_K = ${val("Omega_K")}. ` +
    "Set the default in Settings, or change it here with e.g. Omega_M = 0.315. Long-press a function for its arguments.";
}

const ABC = {
  abc: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    [["⇧", "shift", 1.5], "z", "x", "c", "v", "b", "n", "m", ["⌫", "backspace", 1.5]],
    [["123", "layer:sym", 1.4], ["_", "_", 1], ["space", " ", 3.3], ["=", "assign", 1], ["@", "@", 1.1], ["⏎", "enter", 1.5]],
  ],
  sym: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["-", "/", "*", "^", "(", ")", "[", "]", "=", ","],
    [["αβγ", "layer:greek", 1.5], "'", '"', "!", "#", "%", "~", "|", ["⌫", "backspace", 1.5]],
    [["abc", "layer:abc", 1.4], [".", ".", 1], ["space", " ", 3.3], ["=", "assign", 1], ["@", "@", 1.1], ["⏎", "enter", 1.5]],
  ],
  greek: [
    ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "λ", "μ"],
    ["ν", "ξ", "π", "ρ", "σ", "τ", "φ", "χ", "ψ", "ω"],
    [["⇧", "shift", 1.5], "°", "µ", "Ω", "Å", "Δ", "Σ", "Φ", ["⌫", "backspace", 1.5]],
    [["abc", "layer:abc", 1.4], ["_", "_", 1], ["space", " ", 3.3], ["=", "assign", 1], ["@", "@", 1.1], ["⏎", "enter", 1.5]],
  ],
};

const pagesEl = $("#pages");
const tabsEl = $("#tabs");

const ARIA = { backspace: "Delete", enter: "Evaluate" };

function keyHTML([label, cls = "", action, long, second, secondLong]) {
  // with 2nd on, the key turns into its 2nd function
  if (state.second && second) {
    [label, action] = second;
    long = secondLong;
    cls += " as2";
  }
  if (action === "second") cls += state.second === 2 ? " lock" : state.second ? " on" : "";
  const svg = label.startsWith("<svg");
  const aria = svg && ARIA[action] ? ` aria-label="${ARIA[action]}"` : "";
  // the long press is written at the top right; in the label, what 2nd
  // adds is in {braces}, and in the 2nd label what it drops
  const alt = long ? `<small class="alt${long[0] === "⁻¹" ? " inv" : long[0] === "," ? " comma" : ""}" aria-hidden="true">${esc(long[0])}</small>` : "";
  const has = alt ? " has-alt corner" : "";
  const data = `data-key="${esc(action ?? label)}"${long ? ` data-long="${esc(long[1])}"` : ""}`;
  const text = esc(label).replace(/\{([^}]*)\}/g, '<span class="k2">$1</span>')
    .replace(/(<span class="k2">)?³(<\/span>)?√/, (m, k2) => `<span class="idx${k2 ? " k2" : ""}">3</span>√`)
    // |x| drawn as bars, whose feet (orange when 2nd adds them) make ⌊x⌋
    .replace(/(<span class="k2">)?([⌊⌋])(<\/span>)?/g, (m, k2, c) => `<span class="bar${c === "⌋" ? " r" : ""}${k2 ? " k2" : ""}"></span>`);
  return `<button class="key ${cls}${has}" ${data}${aria}>${svg ? label : `<span>${text}</span>`}${alt}</button>`;
}

const actionsHTML = (page) => `<div class="actions" style="--n:${ACTIONS[page].length}">${ACTIONS[page].map(keyHTML).join("")}</div>`;

function cellHTML(c, page) {
  if (!Array.isArray(c[0])) return keyHTML(c);
  // while converting, the quote keys replace the parentheses
  const cls = c[0][2] === "q1" ? " spec-only" : c[0][2] === "(" && page === "const" ? " no-spec" : "";
  return `<div class="split${cls}">${c.map(keyHTML).join("")}</div>`;
}

const rightHTML = (page) => `<div class="right">${RIGHT[page].map((c) => cellHTML(c, page)).join("")}</div>`;

const numPageHTML = () => `<div class="left grid num-grid">${NUM_KEYS.map((c) => cellHTML(c, "num")).join("")}</div>${rightHTML("num")}`;

function renderNum() {
  const p = pagesEl.querySelector('[data-page="num"]');
  if (!p) return;
  p.innerHTML = numPageHTML();
  updateAtKeys();
}

// 2nd: 0 off, 1 for the next key, 2 locked
function setSecond(v) {
  state.second = v;
  renderNum();
}

const releaseSecond = () => { if (state.second === 1) setSecond(0); };

const TABS = [["num", "123"], ["units", "Units"], ["fn", "f(x)"], ["const", "Const"], ["abc", "abc"]];

function buildKeypad() {
  tabsEl.innerHTML = TABS.map(([id, label]) =>
    `<button class="tab" role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}</button>`).join("");
  const unitCats = [["SI"], ["Systems"], ...KEY_CATS];
  pagesEl.innerHTML = `
    <div class="page num-page" data-page="num">${numPageHTML()}</div>
    <div class="page wide-page" data-page="units">
        <div class="cats" id="cats">${unitCats.map(([n]) => `<button class="cat" data-cat="${esc(n)}">${esc(n)}</button>`).join("")}</div>
        <div class="prefix-row"><button class="prefix any" data-prefix="*" aria-pressed="false" title="Any prefix (after @)"><b>*</b><small>any</small></button>
        <div class="prefixes" id="prefixes">${PREFIXES.map((p) => {
          const x = PREFIX_EXP[p];
          return `<button class="prefix" data-prefix="${esc(p)}" aria-pressed="false" title="10^${x}"><b>${esc(p)}</b><small>10<sup>${String(x).replace("-", "−")}</sup></small></button>`;
        }).join("")}</div></div>
        <div class="unit-grid" id="unit-grid"></div>
        ${actionsHTML("units")}
    </div>
    <div class="page wide-page" data-page="fn">
      <div class="cats" id="fn-cats">${FN_SECTIONS.map(([n]) => `<button class="cat" data-fncat="${esc(n)}">${esc(n)}</button>`).join("")}</div>
      <div class="fn-grid" id="fn-grid"></div>
      ${actionsHTML("fn")}
    </div>
    <div class="page" data-page="const"><div class="left const-left">
      <div class="cats" id="const-cats">${CONST_NAMES.map((n) => `<button class="cat" data-constcat="${esc(n)}">${esc(n)}</button>`).join("")}</div>
      <div class="bodies" id="picker" hidden></div>
      <div class="const-grid" id="const-grid"></div>
    </div>${rightHTML("const")}</div>
    <div class="page abc-page" data-page="abc" id="abc-page"></div>`;
  setUnitCat(state.unitCat);
  setFnCat(state.fnCat || "Math");
  renderConstGrid();
  renderAbc();
  selectTab(state.tab);
}

// Start the prefix strip around milli and kilo (once it is visible)
let prefixCentered = false;
function centerPrefixes() {
  const pre = $("#prefixes");
  const mk = pre && $('[data-prefix="d"]', pre);
  if (!mk || !pre.clientWidth) return;
  pre.scrollLeft = Math.max(0, mk.offsetLeft - pre.offsetLeft + mk.offsetWidth - pre.clientWidth / 2);
  prefixCentered = true;
}

function selectTab(tab) {
  if (!TABS.some(([id]) => id === tab)) tab = "num";
  state.tab = tab;
  store.set("tab", tab);
  for (const t of tabsEl.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.tab === tab));
  for (const p of pagesEl.querySelectorAll(".page")) p.classList.toggle("active", p.dataset.page === tab);
  if (tab !== "units") setPrefix("");
  else if (!prefixCentered) requestAnimationFrame(centerPrefixes);
  if (tab === "abc") updatePredictions();
}

// Whether a prefix can be put in front of a unit key, and the result
function prefixed(p, name) {
  const e = env();
  const m = /^([^\s/^]+)(.*)$/u.exec(name);
  if (!m) return null;
  const [, base, rest] = m;
  const v = e.units.get(base);
  if (!v || (v.zero !== false && v.zero !== 0) || v.currency) return null;
  if (["deg", "°", "arcmin", "arcsec", "min", "h", "hr", "hour", "day", "week", "Cy"].includes(base)) return null;
  if (p === "*") return "*" + base + rest;
  const full = p + base;
  if (e.units.has(full)) return null;     // e.g. c + d = cd (candela)
  const iu = e.isunit(full);
  if (!iu || iu[0] !== p || iu[1] !== base) return null;
  return full + rest;
}

function unitKeyHTML(u) {
  let name = u, ok = true;
  if (state.prefix) {
    const pn = prefixed(state.prefix, u);
    if (pn) name = pn;
    else ok = false;
  }
  const shown = UNIT_LABELS[name] || name;
  const len = shown.replace(/\^-?\d+/g, "x").length;
  return `<button class="key unit${len > 4 ? " long" : ""}${ok ? "" : " off"}" data-unit="${esc(name)}"${ok ? "" : " disabled"}><span>${supHTML(name)}</span></button>`;
}

function renderUnitGrid() {
  const grid = $("#unit-grid");
  if (!grid) return;
  const e = env();
  const has = (u) => {
    try { e.unit(u); return true; } catch { return false; }
  };
  const inSpec = lastAt(before()) >= 0 && bracketDepth(before()) === 0;
  const alone = state.prefix && inSpec
    ? `<button class="key unit alone" data-unit="${esc(state.prefix)}"><span>${esc(state.prefix)}</span><small>${state.prefix === "*" ? "any prefix" : "prefix only"}</small></button>`
    : "";
  if (state.unitCat === "Systems") {
    const p = state.prefix;
    const sys = (name, doc) => {
      const ok = !p || p === "*";
      const n = p === "*" ? "*" + name : name;
      return `<button class="key unit sys${n.length > 5 ? " span2" : ""}${ok ? "" : " off"}" data-sys="${esc(n)}"${ok ? "" : " disabled"} title="${esc(doc || "")}"><span>${esc(n)}</span></button>`;
    };
    const fmt = (name, doc) => `<button class="key unit sys${name.length > 5 ? " span2" : ""}${p ? " off" : ""}" data-sys="${esc(name)}"${p ? " disabled" : ""} title="${esc(doc || "")}"><span>${esc(name)}</span></button>`;
    grid.innerHTML = alone + `<div class="ghead">Unit systems</div>${[...e.systems].map(([k, v]) => sys(k, v.doc)).join("")}` +
      `<div class="ghead">Formats</div>${[...e.formats].map(([k, v]) => fmt(k, v.doc)).join("")}` +
      `<div class="ghead">Variables in units</div>` +
      `<button class="key unit sys wide" data-key="q1"><span>'c'</span><small>keep</small></button>` +
      `<button class="key unit sys wide" data-key="q2"><span>"c"</span><small>remove</small></button>`;
    return;
  }
  if (state.unitCat === "SI") {
    grid.innerHTML = alone + SI_GROUPS.map(([title, us]) =>
      `<div class="ghead">${esc(title)}</div>${us.filter(has).map(unitKeyHTML).join("")}`).join("");
  } else {
    const cat = KEY_CATS.find((c) => c[0] === state.unitCat) || KEY_CATS[0];
    grid.innerHTML = alone + cat[1].filter(has).map(unitKeyHTML).join("");
  }
}

function setUnitCat(name) {
  if (name !== "SI" && name !== "Systems" && !KEY_CATS.some((c) => c[0] === name)) name = "SI";
  const changed = name !== state.unitCat;
  state.unitCat = name;
  store.set("unitCat", name);
  renderUnitGrid();
  if (changed) $("#unit-grid").scrollTop = 0;
  for (const c of document.querySelectorAll("[data-cat]")) c.setAttribute("aria-selected", String(c.dataset.cat === name));
  const active = document.querySelector(`.cat[data-cat="${CSS.escape(name)}"]`);
  const cats = $("#cats");
  if (active && cats) {
    const l = active.offsetLeft - cats.offsetLeft, r = l + active.offsetWidth;
    if (l < cats.scrollLeft) cats.scrollLeft = l - 8;
    else if (r > cats.scrollLeft + cats.clientWidth) cats.scrollLeft = r - cats.clientWidth + 8;
  }
}

function setPrefix(p) {
  if (state.prefix === p) return;
  state.prefix = p;
  for (const b of document.querySelectorAll(".prefix")) b.setAttribute("aria-pressed", String(b.dataset.prefix === p));
  renderUnitGrid();
}

function setFnCat(name) {
  if (!FN_SECTIONS.some((s) => s[0] === name)) name = "Math";
  state.fnCat = name;
  store.set("fnCat", name);
  for (const c of document.querySelectorAll("[data-fncat]")) c.setAttribute("aria-selected", String(c.dataset.fncat === name));
  renderFnGrid();
  const g = $("#fn-grid");
  if (g) g.scrollTop = 0;
}

function renderFnGrid() {
  const grid = $("#fn-grid");
  if (!grid || !state.calc) return;
  const [name, cols, rows, keys] = FN_SECTIONS.find((s) => s[0] === state.fnCat) || FN_SECTIONS[0];
  grid.style.setProperty("--cols", cols);
  grid.style.setProperty("--rows", rows || 1);
  grid.classList.toggle("fixed", rows > 0);
  grid.classList.toggle("described", !keys.length || !Array.isArray(keys[0]));
  const e = env();
  const subs = (s) => esc(s).replace(/([A-Za-zθσ])_([A-Za-z]+)/g, "$1<sub>$2</sub>");
  const described = (k) => {
    if (k.engine) return `<button class="key const model" data-key="mctoggle"><b>${state.settings.mc ? "MC" : "Linear"}</b><small>${state.settings.mc ? `${(state.settings.mcN || 5000).toLocaleString("en")} samples` : "Tap for Monte Carlo"}</small></button>`;
    if (k.key) return `<button class="key const" data-key="${esc(k.key)}"><b>${esc(k.label)}</b><small>${esc(k.desc)}</small></button>`;
    if (k.name) return `<button class="key const" data-const="${esc(k.name)}"><b>${k.label ? esc(k.label) : prettyName(k.name, { unit: false }) || esc(k.name)}</b><small>${esc(k.desc)}</small></button>`;
    const label = k.label ? esc(k.label) : prettyName(k.fn, { fn: true }) || esc(k.fn);
    const long = k.label && k.label.length > 8 ? " long" : "";
    return `<button class="key const${long}" data-key="f:${esc(k.fn)}("><b>${label}</b><small>${subs(k.desc)}</small></button>`;
  };
  if (name === "Yours") {
    const mine = [...e.vars].filter(([k, v]) => v && v.fn && !state.calc.systemNames.has(k));
    grid.innerHTML = mine.map(([k, v]) =>
      `<button class="key const" data-key="f:${esc(k)}("><b>${prettyName(k, { fn: true }) || esc(k)}</b><small>(${esc(v.fn.params.join(", "))})</small></button>`).join("") +
      `<button class="key const more" data-key="deffn"><b>f(x) =</b><small>Define a function</small></button>` +
      (mine.length ? "" : `<p class="fn-note">Define functions as <code>kinetic(m, v) = m v^2 / 2</code>; they appear here.</p>`);
    return;
  }
  grid.innerHTML = keys.map((k) => (Array.isArray(k) ? keyHTML(k) : described(k))).join("");
}

// ---------------------------------------------------------------------
// Const page: sections of keys, pickers (a row of items and a grid of
// their properties) and the element table

const K = (expr, desc, label) => ({ expr, desc, label });
const U = (unit, desc) => ({ unit, desc });

const CONST_SECTIONS = [
  ["Math", [
    K("pi", "Pi"), K("euler", "Euler's number"), K("gamma_E", "Euler–Mascheroni"), K("golden", "Golden ratio"),
    K("sqrt(2)", "Square root of 2", "√2"), K("ln(2)", "Natural log of 2", "ln 2"), K("sqrt(2 pi)", "Gaussian normalization", "√2π"),
    K("zeta_3", "Apéry's constant"), K("fwhm", "Gaussian FWHM / σ", "FWHM/σ"),
    K("conf(1)", "Inside ±1σ: 68.27 %", "CL 1σ"), K("conf(2)", "Inside ±2σ: 95.45 %", "CL 2σ"), K("conf(3)", "Inside ±3σ: 99.73 %", "CL 3σ"),
    K("pvalue(3)", "3σ one-sided p-value", "p 3σ"), K("pvalue(5)", "5σ one-sided p-value", "p 5σ"),
  ]],
  ["Physics", null],
  ["Particles", [
    K("m_e", "Electron mass"), K("m_p", "Proton mass"), K("m_n", "Neutron mass"), K("m_d", "Deuteron mass"),
    K("m_alpha", "Alpha particle mass"), K("m_mu", "Muon mass"), K("m_tau", "Tau mass"), K("m_pi", "Charged pion (PDG)"),
    K("m_pi0", "Neutral pion (PDG)"), K("m_W", "W boson (PDG)"), K("m_Z", "Z boson (PDG)"), K("m_H", "Higgs boson (PDG)"),
    K("m_t", "Top quark (PDG)"), K("alpha_s", "Strong coupling at m_Z"), K("G_F", "Fermi coupling constant"),
    K("sin2theta_W", "Weak mixing angle"), K("a_0", "Bohr radius"), K("lambda_C", "Compton wavelength"),
    K("r_e", "Classical electron radius"), K("mu_B", "Bohr magneton"), K("mu_N", "Nuclear magneton"),
    U("E_h", "Hartree energy"), K('const["Rydberg constant"]', "Rydberg constant", "R<sub>∞</sub>"),
    K("K_J", "Josephson constant"), K("R_K", "von Klitzing constant"), K("Phi_0", "Flux quantum"),
    K("G_0", "Conductance quantum"), K("sigma_T", "Thomson cross section"), K("b_Wien", "Wien constant"),
    K("c_1", "First radiation constant"), K("c_2", "Second radiation constant"),
  ]],
  ["Cosmology", "cosmo"],
  ["Astro", [
    K("M_Sun", "Solar mass"), K("R_Sun", "Solar radius"), K("L_Sun", "Solar luminosity"),
    K("GM_Sun_N", "IAU nominal GM☉"), K("R_Sun_N", "IAU nominal radius"), K("L_Sun_N", "IAU nominal luminosity"),
    K("T_eff_Sun", "Solar T_eff (IAU)"), K("M_bol_Sun", "Solar M_bol (IAU)"), K("F_AB", "AB zero point"),
    K("R_s(", "Schwarzschild radius"), K("L_Edd(", "Eddington luminosity"), K("M_Ch", "Chandrasekhar mass ≈"),
    K("H_0", "Hubble constant"), K("T_CMB", "CMB temperature"), K("rho_c", "Critical density"), K("d_H", "Hubble distance"),
    K("R_GC", "Sun–Galactic centre ≈"), K("v_circ", "Galactic rotation ≈"),
    K("siderealday", "Sidereal day", "sid. day"), K("siderealyear", "Sidereal year", "sid. yr"), K("tropicalyear", "Tropical year", "trop. yr"),
    U("M_Earth", "Earth mass (unit)"), U("R_Earth", "Earth radius (unit)"), U("M_Jupiter", "Jupiter mass (unit)"),
    U("R_Jupiter", "Jupiter radius (unit)"), K("R_Earth_eq", "Earth equatorial radius"), K("R_Jupiter_eq", "Jupiter equatorial radius"), U("au", "Astronomical unit"), U("pc", "Parsec"), U("ly", "Light year"), U("Jy", "Jansky"),
  ]],
  ["Solar system", "picker"],
  ["Earth", [
    K("GM_Earth", "GM (WGS 84)"), K("a_WGS84", "Equatorial radius"), K("b_WGS84", "Polar radius"), K("f_WGS84", "Flattening"),
    K("omega_Earth", "Rotation rate"), K("J_2_Earth", "Form factor J₂"), K("g", "Standard gravity"), K("g_eq", "Normal gravity, equator"),
    K("g_pole", "Normal gravity, poles"), K("dg_fa", "Free-air gradient"), K("rho_crust", "Bouguer density"),
    K("rho_Earth", "Mean density"), K("S_Sun", "Solar constant ≈"), K("rho_sea", "Seawater density ≈"),
    K("T_Earth", "Mean surface temp. ≈"), K("dTdz", "Geothermal gradient ≈"), U("Gal", "Gal = 1 cm/s²"), U("mGal", "Milligal"),
  ]],
  ["Chemistry", [
    K("N_A", "Avogadro constant"), K("R", "Molar gas constant"), K("faraday", "Faraday constant", "F"), K("V_m", "Molar volume, 0 °C 1 atm"),
    K("n_0", "Loschmidt constant"), K("m_u", "Atomic mass constant"), K("k", "Boltzmann constant"), K("T_STP", "0 °C"),
    K("T_SATP", "25 °C"), K("p_std", "Standard pressure, 1 bar"), K("atmosphere", "Standard atmosphere", "atm"),
    K("V_T", "kT/e at 25 °C"), K("rho_water", "Water, 25 °C"), K("c_p_water", "Water, 25 °C"), K("L_vap_water", "Vaporisation"),
    K("L_fus_water", "Fusion"), K("K_w", "Ionic product ≈"), K("M_air", "Molar mass of air"),
  ]],
  ["Elements", "elements"],
  ["Engineering", [
    K("g", "Standard gravity"), K("T_ISA", "ISA temperature"), K("p_ISA", "ISA pressure"), K("rho_ISA", "ISA air density"),
    K("a_ISA", "ISA speed of sound"), K("L_ISA", "ISA lapse rate"), K("R_air", "Gas constant of air"), K("c_p_air", "Air ≈"),
    K("gamma_air", "Air c_p/c_v"), K("mu_air", "Air viscosity"), K("mu_water", "Water, 20 °C"), K("nu_water", "Water, 20 °C"),
    K("rho_water", "Water, 25 °C"), K("c_p_water", "Water, 25 °C"), U("bar", "Bar"), U("psi", "psi"), U("hp", "Horsepower"), U("kWh", "Kilowatt-hour"),
  ]],
  ["Materials", "picker"],
  ["Nuclear", "picker"],
  ["Info", [
    U("bit", "Bit"), U("B", "Byte"), U("KiB", "2¹⁰ bytes"), U("MiB", "2²⁰ bytes"), U("GiB", "2³⁰ bytes"), U("TiB", "2⁴⁰ bytes"),
    U("kbit", "Kilobit"), U("Mbit", "Megabit"), U("Gbit", "Gigabit"), K("E_Landauer", "Landauer limit, 300 K"),
  ]],
  ["Yours", "yours"],
];
const CONST_NAMES = CONST_SECTIONS.map((s) => s[0]);
const ASTRO_CONSTS = ["M_Sun", "R_Sun", "L_Sun", "H_0", "T_CMB", "rho_c", "d_H"];

// 4 significant digits, ×10ⁿ
function fmt4(x) {
  if (!Number.isFinite(x)) return "?";
  let s = Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(3) : String(Number(x.toPrecision(4)));
  const m = /^(-?[\d.]+)e([-+]\d+)$/.exec(s);
  if (m) s = `${m[1].replace(/\.?0+$/, "")}×10<sup>${String(Number(m[2])).replace("-", "−")}</sup>`;
  return s.replace(/^-/, "−");
}

const isoHTML = (n) => {
  const m = /^([A-Z][a-z]?)(\d+)(m?)$/.exec(n);
  return m ? `<sup>${m[2]}${m[3]}</sup>${m[1]}` : esc(n);
};

const timeUnit = (s) => (Math.abs(s) < 7200 ? "min" : Math.abs(s) < 2 * 86400 ? "hour" : Math.abs(s) < 2 * 365.25 * 86400 ? "day" : "yr");

const PICKERS = {
  "Solar system": {
    key: "body", def: "Earth", cols: 3, rows: 3,
    items: () => BODIES.map((b) => [b[0], esc(b[0]), b[1] === "Sun"]),
    props: () => BODY_PROPS.map(([k, sym, , unit]) => ({ k, sym: sym + (PROP_SUB[k] ? `<sub>${PROP_SUB[k].replace(",", "")}</sub>` : ""), unit })),
    unitFor: (p, item, n0) => {
      const prim = BODIES.find((b) => b[0] === item)[1];
      if (p.k === "a" && prim === "Sun") return "au";
      if (p.k === "P" && n0 > 1000 * 86400) return "yr";
      if (p.k === "P_rot" && Math.abs(n0) > 100 * 3600) return "day";
      return p.unit;
    },
  },
  Materials: {
    key: "material", def: "steel", cols: 3, rows: 2,
    items: () => MATERIALS.map((m) => [m[0], esc(m[1].replace(/ \(.*\)/, "")), true]),
    props: () => [
      { k: "rho", sym: "ρ", unit: "kg/m^3" }, { k: "E", sym: "E", unit: "GPa" }, { k: "k_th", sym: "k<sub>th</sub>", unit: "W/m/K" },
      { k: "c", sym: "c", unit: "J/kg/K" }, { k: "alpha", sym: "α", unit: "K^-1" }, { k: "rho_e", sym: "ρ<sub>e</sub>", unit: "ohm m" },
    ],
    unitFor: (p) => p.unit,
  },
  Nuclear: {
    key: "nuclide", def: "C14", cols: 2, rows: 2,
    items: () => NUCLIDES.map((n) => [n[0], isoHTML(n[0]), true]),
    props: () => [
      { k: "T_half", sym: "T<sub>½</sub>", unit: "time" }, { k: "tau", sym: "τ", unit: "time" },
      { k: "lambda", sym: "λ", unit: "rate" }, { k: "m", sym: "m", unit: "u", digits: 9 },
    ],
    unitFor: (p, item, n0) => (p.unit === "time" ? timeUnit(n0) : p.unit === "rate" ? timeUnit(1 / n0) + "^-1" : p.unit),
  },
};

function setConstCat(name) {
  if (!CONST_NAMES.includes(name)) name = "Physics";
  state.constCat = name;
  store.set("constCat", name);
  const g = $("#const-grid");
  if (g) g.scrollTop = 0;
  renderConstGrid();
  const cats = $("#const-cats");
  const active = cats && cats.querySelector(`[data-constcat="${CSS.escape(name)}"]`);
  if (active) {
    const l = active.offsetLeft - cats.offsetLeft, r = l + active.offsetWidth;
    if (l < cats.scrollLeft) cats.scrollLeft = l - 8;
    else if (r > cats.scrollLeft + cats.clientWidth) cats.scrollLeft = r - cats.clientWidth + 8;
  }
}

function setPick(item) {
  const pk = PICKERS[state.constCat];
  if (!pk) return;
  state.picks = { ...(state.picks || {}), [pk.key]: item };
  store.set("picks", state.picks);
  renderConstGrid();
}

function valueHTML(name, unitFor, digits) {
  const e = env();
  let q;
  try { q = state.calc.lookup(name); } catch { return null; }
  if (!(q instanceof Q)) return null;
  const n0 = q.x.n;
  const unit = unitFor ? unitFor(n0) : "";
  if (!unit) return fmt4(n0);
  try {
    const v = n0 / e.unit(unit).x.n;
    return `${digits ? String(Number(v.toPrecision(digits))) : fmt4(v)} ${unitLabelHTML(unit === "hour" ? "h" : unit)}`;
  } catch { return fmt4(n0); }
}

function constKeyHTML(k) {
  const e = env();
  if (k.unit) {
    return `<button class="key const unitk" data-unit="${esc(k.unit)}"><b>${unitLabelHTML(k.unit)}</b><small>${esc(k.desc || "")}</small></button>`;
  }
  const x = k.expr;
  let label;
  if (k.label) label = k.label.includes("<") ? k.label : esc(k.label);
  else if (x.endsWith("(")) label = (prettyName(x.slice(0, -1), { fn: true }) || esc(x.slice(0, -1))) + "(…)";
  else {
    const c = CONSTS.find((c) => c[1] === x);
    label = constLabel(c ? c[0] : x, x);
  }
  let desc = k.desc;
  if (!desc) {
    const v = e.vars.get(x);
    desc = (v && v.doc && firstLine(v.doc)) || "";
  }
  return `<button class="key const" data-const="${esc(x)}"><b>${label}</b><small>${esc(desc)}</small></button>`;
}

// Cosmology section: the current model, with values and errors
const COSMO_KEYS = [
  ["H_0", "km/s/Mpc", "Hubble constant"], ["Omega_M", "", "Matter"], ["Omega_b", "", "Baryons"],
  ["Omega_L", "", "Cosmological constant"], ["Omega_K", "", "Curvature"], ["Omega_R", "", "Radiation"],
  ["age(0)", "Gyr", "Age of the universe"], ["t_H", "Gyr", "Hubble time"], ["d_H", "Mpc", "Hubble distance"],
  ["rho_c", "kg/m^3", "Critical density"], ["T_CMB", "K", "CMB temperature"], ["n_CMB", "cm^-3", "CMB photons"],
  ["Omega_CMB", "", "CMB density"], ["T_nu", "K", "Neutrino temperature"], ["n_nu", "cm^-3", "Neutrinos"],
];

function cosmoValueHTML(expr, unit) {
  let q;
  try {
    q = /\(/.test(expr) ? evalPreview(expr) : state.calc.lookup(expr);
    if (q && q.lazy) q = q.lazy();
    if (!(q instanceof Q)) return "";
    if (unit) q = env().convert(q, [unit]);
  } catch { return ""; }
  const r = env().display(q);
  if (r.format) return esc(r.text);
  const exact = (x) => {
    const s = Number(x.toPrecision(6));
    return Math.abs(s) >= 1e5 || (s !== 0 && Math.abs(s) < 1e-3) ? fmt4(s) : String(s);
  };
  const num = q.x.std > 0 && env().showErrors ? numHTML(r.num) : exact(r.num.n);
  return num + (unit ? " " + unitLabelHTML(unit) : "");
}

function renderConstGrid() {
  const grid = $("#const-grid");
  if (!grid || !state.calc) return;
  const e = env();
  const sec = CONST_NAMES.includes(state.constCat) ? state.constCat : "Physics";
  const spec = CONST_SECTIONS.find((s) => s[0] === sec)[1];
  for (const c of document.querySelectorAll("[data-constcat]")) c.setAttribute("aria-selected", String(c.dataset.constcat === sec));
  const pickEl = $("#picker");
  const pk = spec === "picker" ? PICKERS[sec] : null;
  pickEl.hidden = !pk;
  grid.classList.toggle("fixed", Boolean(pk));
  grid.classList.toggle("elements", spec === "elements");
  grid.style.setProperty("--rows", pk ? pk.rows : 1);
  grid.style.setProperty("--ccols", pk ? pk.cols : spec === "elements" ? 5 : 3);
  if (pk) {
    const picks = state.picks || {};
    const items = pk.items();
    const item = items.some((i) => i[0] === picks[pk.key]) ? picks[pk.key] : pk.def;
    if (pickEl.dataset.sec !== sec) {
      pickEl.dataset.sec = sec;
      pickEl.innerHTML = items.map(([id, html, main]) => `<button class="body${main ? " planet" : ""}" data-pick="${esc(id)}">${html}</button>`).join("");
    }
    for (const c of pickEl.querySelectorAll("[data-pick]")) c.setAttribute("aria-selected", String(c.dataset.pick === item));
    grid.innerHTML = pk.props().map((p) => {
      const name = `${p.k}_${item}`;
      const v = valueHTML(name, (n0) => pk.unitFor(p, item, n0), p.digits);
      if (v === null) return `<button class="key const body-prop off" disabled><b>${p.sym}</b><small>—</small></button>`;
      return `<button class="key const body-prop" data-const="${esc(name)}"><b>${p.sym}</b><small>${v}</small></button>`;
    }).join("");
    const active = pickEl.querySelector(`[data-pick="${CSS.escape(item)}"]`);
    if (active) {
      const l = active.offsetLeft - pickEl.offsetLeft, r = l + active.offsetWidth;
      if (l < pickEl.scrollLeft) pickEl.scrollLeft = l - 8;
      else if (r > pickEl.scrollLeft + pickEl.clientWidth) pickEl.scrollLeft = r - pickEl.clientWidth + 8;
    }
    return;
  }
  if (spec === "elements") {
    const sub = (f) => f.replace(/\d+/g, (d) => [...d].map((x) => "₀₁₂₃₄₅₆₇₈₉"[x]).join(""));
    const sel = state.chemSel;
    if (sel && (CHEM_NAMES.has(sel))) {
      // one substance: all its values
      grid.classList.remove("elements");
      const el = ELEMENTS.find((x) => x[1] === sel);
      const mol = MOLECULES.find((x) => x[0] === sel);
      const title = el ? `${el[2]} (${el[1]}, Z = ${el[0]})` : mol ? `${mol[1]} (${sub(mol[0])})` : "Air";
      const props = [["M", "g/mol"], ["E_ion", "eV"], ["chi", ""], ...Object.keys(MOL_UNITS).map((k) => [k, MOL_UNITS[k]])];
      const keys = props.map(([k, u]) => {
        const name = `${k}_${sel}`;
        if (!e.vars.has(name)) return "";
        const v = valueHTML(name, () => (u === "J/(mol K)" ? "J/mol/K" : u));
        const sym = prettyName(k, { unit: false }) || esc(k);
        return `<button class="key const" data-const="${esc(name)}"><b>${sym}</b><small>${v}</small></button>`;
      }).join("");
      grid.innerHTML = `<button class="key const back" data-chem=""><b>‹</b><small>All</small></button>` +
        `<div class="chem-title">${esc(title)}</div>` + keys;
      return;
    }
    const mk = (name, label, small, long) => `<button class="key const elem${long ? " long" : ""}" data-chem="${esc(name)}"><b>${label}</b><small>${small}</small></button>`;
    grid.innerHTML = `<div class="ghead">Molecules: tap for molar mass, melting and boiling points, heats…</div>` +
      MOLECULES.map(([f]) => mk(f, esc(sub(f)), fmt4(e.vars.get(`M_${f}`).x.n / e.unit("g/mol").x.n), f.length > 4)).join("") + mk("air", "air", "28.96") +
      `<div class="ghead">Elements: tap for molar mass, ionization energy, electronegativity, melting and boiling points, density</div>` +
      ELEMENTS.map(([z, sym, , w, unstable]) => mk(sym, `<span class="z">${z}</span>${esc(sym)}`, unstable ? `[${w}]` : String(w))).join("");
    return;
  }
  if (spec === "cosmo") {
    grid.innerHTML = COSMO_KEYS.map(([x, unit, desc]) => {
      const label = x === "age(0)" ? "age" : prettyName(x, { unit: false }) || esc(x);
      return `<button class="key const cosmo" data-const="${esc(x)}" title="${esc(desc)}"><b>${label}</b><small>${cosmoValueHTML(x, unit)}</small></button>`;
    }).join("");
    return;
  }
  if (spec === "yours") {
    const mine = [...e.vars.keys()].filter((k) => k !== "ans" && !state.calc.systemNames.has(k));
    grid.innerHTML = mine.length ? mine.map((k) => {
      const v = e.vars.get(k);
      return constKeyHTML(K(v && v.fn ? k + "(" : k, v && v.fn ? "your function" : (v && v.doc) || "variable"));
    }).join("") : `<p class="fn-note">Variables you define, like <code>zl = 0.5</code>, appear here.</p>`;
    return;
  }
  if (spec === null) {
    // typeset from the name (mu_B -> μ_B); the plain label only as fallback
    grid.innerHTML = CONSTS.filter((c) => !ASTRO_CONSTS.includes(c[1])).map(([, x, d]) => constKeyHTML(K(x, d))).join("") +
      `<button class="key const more" data-key="nist"><b>NIST</b><small>All CODATA constants</small></button>`;
    return;
  }
  grid.innerHTML = spec.map(constKeyHTML).join("");
}

// Word predictions for the abc keyboard
function predictions(word, afterNumber) {
  if (!word) return [];
  const e = env();
  const cands = new Map();
  const lw = word.toLowerCase();
  const match = (n) => (n.startsWith(word) ? 0 : n.toLowerCase().startsWith(lw) ? 3 : -1);
  const add = (name, kind, score, insertText = name) => {
    const m = match(name);
    if (m < 0) return;
    score += m + (name === word ? -0.8 : 0) + (kind === "unit" && afterNumber ? -1.5 : 0);
    const prev = cands.get(name);
    if (!prev || prev.score > score) cands.set(name, { name, kind, score, insertText });
  };
  for (const [k, v] of e.vars) {
    if (k === "ans") continue;
    add(k, v && v.fn ? "function" : "variable", state.calc.systemNames.has(k) ? 1.5 : 0, v && v.fn ? k + "(" : k);
  }
  for (const k of Object.keys(state.calc.builtins)) add(k, "function", SCIENCE.has(k) ? 1 : 1.2, k + "(");
  for (const k of ["pi", "tau", "ans"]) add(k, "variable", 0.5);
  POPULAR.forEach((u, i) => { if (!/[/^]/.test(u)) add(u, "unit", 1.3 + i * 0.002); });
  for (const [k, v] of e.units) if (!(v.currency && word.length < 2)) add(k, "unit", 2.5);
  for (const [px] of e.prefixes) {
    if (!px || !word.startsWith(px) || word === px) continue;
    for (const u of SI_GROUPS.flatMap((g) => g[1])) {
      const full = prefixed(px, u);
      if (full) add(full, "unit", 2.2);
    }
  }
  return [...cands.values()]
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, 3);
}

function predictionDoc(c) {
  const e = env();
  if (c.kind === "function") return firstLine(USAGE[c.name] || functionDocs[c.name] || "function").replace(/^[^:]*:\s*/, "");
  if (c.kind === "unit") {
    const iu = e.isunit(c.name);
    const d = iu && e.units.get(iu[1]);
    return d && d.doc ? (iu[0] ? (e.prefixes.get(iu[0])?.doc || "") + firstLine(d.doc).toLowerCase() : firstLine(d.doc)) : "unit";
  }
  const v = e.vars.get(c.name);
  return (v && v.doc && firstLine(v.doc)) || (c.name === "ans" ? "last result" : c.name === "pi" ? "3.14159…" : c.name === "tau" ? "2π" : "variable");
}

function updatePredictions() {
  const row = $("#predict");
  if (!row || state.tab !== "abc" || !state.calc) return;
  const b = before();
  const wm = /([\p{L}_°µΩÅ][\p{L}\p{N}_]*)$/u.exec(b);
  const word = wm ? wm[1] : "";
  const afterNumber = word && /\d\s*$/.test(b.slice(0, b.length - word.length));
  const list = predictions(word, afterNumber);
  row.innerHTML = [0, 1, 2].map((i) => {
    const c = list[i];
    if (!c) return '<div class="pred empty"></div>';
    const label = c.kind === "unit" ? unitLabelHTML(c.name)
      : prettyName(c.name, { fn: c.kind === "function", unit: false }) || esc(c.name);
    return `<button class="pred" data-complete="${esc(c.insertText)}" data-len="${word.length}"><b>${label}${c.kind === "function" ? "(" : ""}</b><small>${esc(predictionDoc(c))}</small></button>`;
  }).join("");
}

function renderAbc() {
  const page = $("#abc-page");
  const upper = state.shift > 0;
  page.innerHTML = '<div class="predict" id="predict"></div>' + ABC[state.layer].map((row, r) => `<div class="abc-row${r === 1 && row.length === 9 ? " inset" : ""}">${row.map((k) => {
    if (Array.isArray(k)) {
      const [label, action, w] = k;
      let cls = "key fn";
      if (action === "enter") cls = "key eq";
      if (action === "@") cls = "key conv";
      if (action === "assign") cls = "key op";
      if (action === " ") cls = "key space";
      if (action === "shift") cls += state.shift === 2 ? " lock" : state.shift === 1 ? " on" : "";
      const html = action === "backspace" ? DEL_SVG : action === "enter" ? ENTER_SVG : esc(label);
      const attr = action.length === 1 && action !== "@" ? `data-ch="${esc(action)}"` : `data-key="${esc(action)}"`;
      return `<button class="${cls}" style="flex:${w}" ${attr}${action === "backspace" ? ' aria-label="Delete"' : ""}>${html}</button>`;
    }
    const ch = upper ? k.toUpperCase() : k;
    return `<button class="key ch" data-ch="${esc(ch)}">${esc(ch)}</button>`;
  }).join("")}</div>`).join("");
  updatePredictions();
}

function keyAction(k) {
  if (k.startsWith("f:")) return insertFunction(k.slice(2));
  if (k.startsWith("n:")) return insertName(k.slice(2));
  if (k.startsWith("u:")) return insertUnit(k.slice(2));
  if (k.startsWith("layer:")) {
    state.layer = k.slice(6);
    state.shift = 0;
    return renderAbc();
  }
  switch (k) {
    case "clear": setInput(""); state.recall = -1; break;
    case "backspace": backspace(); break;
    case "enter": evaluate(); break;
    case "left": setCaret(state.caret - 1, -1); break;
    case "right": setCaret(state.caret + 1, 1); break;
    case "home": setCaret(0, -1); break;
    case "end": setCaret(state.text.length, 1); break;
    case "second": setSecond(state.second ? 0 : 1); break;
    case "euler": insertName("exp(1)"); break;
    case "pow2": insertPower(2); break;
    case "pow3": insertPower(3); break;
    case "+": case "-": case "*": case "/": case "^": insertOp(k); break;
    case "EE": insert(/[\d.]$/.test(before()) ? "e" : "1e"); break;
    case "±": insert("±"); break;
    case ",": insertComma(); break;
    case "shift": state.shift = state.shift === 0 ? 1 : 0; renderAbc(); break;
    case "nist":
      sheetBody._tab = "Constants";
      openSheet("Reference", (root) => renderReference(root));
      break;
    case "info": {
      const t = state.text.trim();
      if (!t) { toast("Enter a name first, e.g. pc"); break; }
      if (!/!$/.test(t)) setInput(t + "!");
      evaluate();
      break;
    }
    case "pow-1": insertPower("-1"); break;
    case "mctoggle":
      state.settings.mc = !state.settings.mc;
      store.set("settings", state.settings);
      build();
      refresh();
      toast(state.settings.mc ? `Monte Carlo errors, ${(state.settings.mcN || 5000).toLocaleString("en")} samples` : "Linear error propagation");
      break;
    case "brackets": bracketKey(); break;
    case "q1": quoteName("'"); break;
    case "q2": quoteName('"'); break;
    case "deffn":
      if (!/=/.test(state.text)) setInput("f(x) = " + state.text, 7 + state.text.length);
      break;
    case "assign": {
      const b = before();
      insert(b === "" || /\s$/.test(b) ? "= " : " = ");
      break;
    }
    case "@": {
      if (atMode() === "|") {
        // after @ the same key separates units: 3700 s @ h|min|s
        const sp = /\s+$/.exec(before());
        insert("|", { replaceBefore: sp ? sp[0].length : 0 });
        break;
      }
      if (bracketDepth(before()) > 0) {
        // leave the unit bracket first: 5[s 'c'] @ km
        const j = after().indexOf("]");
        if (j >= 0) setCaret(state.caret + j + 1, 1);
      }
      if (!state.text.trim() && lastValue()) setInput("ans");
      const b = before();
      insert(b === "" || /\s$/.test(b) ? "@ " : " @ ");
      let q = null;
      try { q = evalPreview(state.text.slice(0, lastAt(state.text))); } catch { q = null; }
      if (state.tab !== "abc") {
        selectTab("units");
        const c = q && categoryFor(q);
        if (c) setUnitCat(KEY_CATS.some((x) => x[0] === c) ? c : "SI");
      }
      break;
    }
    default: insert(k);
  }
}

// Key presses act on click; long press on units and constants explains them
const keypadEl = $("#keypad");
let repeatTimer = null, holdTimer = null, held = false, holdStart = null;

// The @ key turns into | once a target unit follows the @
function atMode() {
  const b = before();
  const i = lastAt(b);
  return i >= 0 && /[^\s|@]\s*$/.test(b.slice(i + 1)) ? "|" : "@";
}

let lastSpecState = null;
function updateAtKeys() {
  const spec = lastAt(before()) >= 0 && bracketDepth(before()) === 0;
  keypadEl.classList.toggle("in-spec", spec);
  keypadEl.classList.toggle("quotes", spec || bracketDepth(before()) > 0 || /\]$/.test(before()));
  if (!spec && state.prefix === "*") setPrefix("");
  if (spec !== lastSpecState) {
    lastSpecState = spec;
    if (state.prefix) renderUnitGrid();
  }
  const mode = atMode();
  for (const k of keypadEl.querySelectorAll('[data-key="@"]')) {
    if (k.dataset.mode === mode) continue;
    k.dataset.mode = mode;
    k.innerHTML = `<span>${mode}</span>`;
    k.setAttribute("aria-label", mode === "|" ? "Unit separator" : "Convert");
  }
}

function explain(b) {
  const e = env();
  if (b.dataset && b.dataset.sys) {
    const n = b.dataset.sys.replace(/^\*/, "");
    const d = (e.systems.get(n) || e.formats.get(n) || {}).doc || "";
    const star = b.dataset.sys[0] === "*" ? ", with any prefix" : "";
    return `@ ${b.dataset.sys}: ${d}${star}`;
  }
  if (b.dataset && b.dataset.prefix === "*") return "* after @ allows any prefix: @ *m gives km, mm… as fits; @ * alone uses the default system with prefixes";
  if (b.dataset && b.dataset.key === "@" && b.dataset.mode === "|") {
    return "Unit separator: after @, list the units to express the result with, e.g. 20 m/s @ km|hour gives 72 km/hour; mph|s gives mph per second";
  }
  if (b.dataset.prefix) {
    const p = e.prefixes.get(b.dataset.prefix);
    return `${b.dataset.prefix}: ${p?.doc || "prefix"}, 10^${PREFIX_EXP[b.dataset.prefix]}`;
  }
  if (b.dataset.unit) {
    const u = b.dataset.unit;
    let val = "";
    try {
      const q = e.unit(u);
      val = qShort(new Q(q.x, q.d));
    } catch { /* none */ }
    if (/^1\[[^\]]*\]$/.test(val)) val = "";
    let doc = "";
    if (/^[^\s/^]+$/.test(u)) {
      const iu = e.isunit(u);
      if (iu && iu[1]) {
        const ud = firstLine(e.units.get(iu[1])?.doc || "");
        doc = iu[0] ? (e.prefixes.get(iu[0])?.doc || "") + ud.toLowerCase() : ud;
      }
    }
    return `${UNIT_LABELS[u] || u}${doc ? ": " + doc : ""}${val ? " = " + val : ""}`;
  }
  if (b.dataset.key) {
    const k = b.dataset.key;
    if (/^f:.*\($/.test(k)) return usageOf(k.slice(2, -1));
    if (k.startsWith("u:")) return explain({ dataset: { unit: k.slice(2) } });
    return KEY_HELP[k] || "";
  }
  if (b.dataset.const) {
    const x = b.dataset.const;
    if (x.endsWith("(")) return usageOf(x.slice(0, -1));
    try {
      const q = evalPreview(x.replace(/\($/, ""));
      const c = CONSTS.find((c) => c[1] === x);
      const v = env().vars.get(x);
      return `${c ? c[2] : (v && v.doc && firstLine(v.doc)) || x}${q ? " = " + qShort(q) : ""}`;
    } catch { return x; }
  }
  return "";
}

// a long press on the space bar (or ◀ ▶) followed by a slide sideways
// moves the caret, a character every SLIDE_STEP px, as on the iOS keyboard.
// ◀ ▶ with a long press of their own (on the 123 page) slide as soon as
// they move, and held still jump to the start or the end
const SLIDE_STEP = 9, SLIDE_HOLD = 300;
let slide = null, slideTimer = null;

function startSlide(s, x) {
  // the key does not type once sliding
  s.on = true;
  held = true;
  s.caret = state.caret;
  if (x !== undefined) s.x = x;
  s.b.classList.add("sliding");
  try { keypadEl.setPointerCapture(s.id); } catch { /* gone */ }
  navigator.vibrate?.(10);
}

keypadEl.addEventListener("pointerdown", (ev) => {
  const b = ev.target.closest("button");
  if (!b || b.disabled) return;
  held = false;
  holdStart = { x: ev.clientX, y: ev.clientY };
  clearTimeout(slideTimer);
  slide = b.dataset.ch === " " || b.dataset.key === "left" || b.dataset.key === "right"
    ? { b, id: ev.pointerId, x: ev.clientX, caret: state.caret, on: false, quick: !!b.dataset.long } : null;
  if (slide) {
    const s = slide;
    if (s.quick) {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        held = true;
        keyAction(b.dataset.long);
        navigator.vibrate?.(10);
      }, 400);
    } else slideTimer = setTimeout(() => startSlide(s), SLIDE_HOLD);
    return;
  }
  if (b.dataset.key === "backspace") {
    ev.preventDefault();
    backspace();
    releaseSecond();
    held = true;   // the click must not delete again
    clearInterval(repeatTimer);
    // held, it clears the line (123 page), or repeats
    if (b.dataset.long) {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        keyAction(b.dataset.long);
        navigator.vibrate?.(10);
      }, 450);
    } else repeatTimer = setTimeout(() => { repeatTimer = setInterval(backspace, 70); }, 420);
    return;
  }
  // keys with a second function in the corner type it on a long press,
  // and explain it
  if (b.dataset.long) {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      held = true;
      const k = b.dataset.long;
      endRecall();
      keyAction(k);
      releaseSecond();
      const msg = explain({ dataset: { key: k } });
      if (msg) toast(msg, Math.max(4000, msg.length * 55));
    }, 400);
    return;
  }
  if (b.dataset.key === "second") {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      held = true;
      setSecond(2);
      toast("2nd lock on: tap 2nd to turn it off");
    }, 450);
    return;
  }
  if (b.dataset.key === "shift") {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      held = true;
      state.shift = 2;
      renderAbc();
      toast("Caps lock on: tap ⇧ to turn it off");
    }, 450);
    return;
  }
  if (b.dataset.unit || b.dataset.const || b.dataset.prefix || b.dataset.key || b.dataset.sys) {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      const msg = explain(b);
      if (msg) { held = true; toast(msg, Math.max(4000, msg.length * 55)); }
    }, 480);
  }
});
keypadEl.addEventListener("pointermove", (ev) => {
  if (holdStart && Math.hypot(ev.clientX - holdStart.x, ev.clientY - holdStart.y) > 10) clearTimeout(holdTimer);
  if (!slide || ev.pointerId !== slide.id) return;
  if (!slide.on) {
    if (slide.quick && Math.abs(ev.clientX - holdStart.x) > 8) {
      clearTimeout(holdTimer);
      return startSlide(slide, ev.clientX);
    }
    // moving before the long press keeps the key an ordinary tap
    slide.x = ev.clientX;
    return;
  }
  const c = slide.caret + Math.trunc((ev.clientX - slide.x) / SLIDE_STEP);
  if (c !== state.caret) setCaret(c, Math.sign(c - state.caret));
});
const endSlide = () => {
  clearTimeout(slideTimer);
  if (slide) slide.b.classList.remove("sliding");
  slide = null;
};
const stopRepeat = () => { clearTimeout(repeatTimer); clearInterval(repeatTimer); clearTimeout(holdTimer); };
keypadEl.addEventListener("pointerup", () => { stopRepeat(); endSlide(); });
keypadEl.addEventListener("pointercancel", () => { stopRepeat(); endSlide(); });
keypadEl.addEventListener("pointerleave", stopRepeat);
keypadEl.addEventListener("contextmenu", (ev) => ev.preventDefault());
keypadEl.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b || b.disabled) return;
  if (held) { held = false; return; }
  if (!b.dataset.tab && !b.dataset.cat && !b.dataset.fncat && !b.dataset.constcat && !b.dataset.pick) endRecall();
  if (b.dataset.tab) return selectTab(b.dataset.tab);
  if (b.dataset.complete !== undefined) {
    insert(b.dataset.complete, { replaceBefore: Number(b.dataset.len) });
    if (state.shift === 1) { state.shift = 0; renderAbc(); }
    return;
  }
  if (b.dataset.cat) return setUnitCat(b.dataset.cat);
  if (b.dataset.fncat) return setFnCat(b.dataset.fncat);
  if (b.dataset.constcat) return setConstCat(b.dataset.constcat);
  if (b.dataset.pick) return setPick(b.dataset.pick);
  if (b.dataset.chem !== undefined) {
    const g = $("#const-grid");
    if (b.dataset.chem && g) state.chemScroll = g.scrollTop;
    state.chemSel = b.dataset.chem || null;
    renderConstGrid();
    if (g) g.scrollTop = state.chemSel ? 0 : (state.chemScroll || 0);
    return;
  }
  if (b.dataset.prefix) {
    if (b.dataset.prefix === "*" && lastAt(before()) < 0) {
      toast("* (any prefix) works after @: 1200 m @ *m gives 1.2 km");
      return;
    }
    return setPrefix(state.prefix === b.dataset.prefix ? "" : b.dataset.prefix);
  }
  if (b.dataset.sys) {
    insertTarget(b.dataset.sys);
    return setPrefix("");
  }
  if (b.dataset.unit) {
    insertUnit(b.dataset.unit);
    return setPrefix("");
  }
  if (b.dataset.const) {
    const x = b.dataset.const;
    return x.endsWith("(") ? insertFunction(x) : insertName(x);
  }
  if (b.dataset.ch !== undefined) {
    insert(b.dataset.ch);
    if (state.shift === 1) { state.shift = 0; renderAbc(); }
    return;
  }
  if (b.dataset.key) {
    if (b.dataset.key !== "pow2" && b.dataset.key !== "pow3" && b.dataset.key !== "/") setPrefix("");
    keyAction(b.dataset.key);
    if (b.dataset.key !== "second") releaseSecond();
  }
});

// ---------------------------------------------------------------------
// Editor interactions: tap to move the caret, long press for a menu

let edPress = null, edTimer = null, edLong = false;
exprEl.addEventListener("pointerdown", (ev) => {
  edLong = false;
  edPress = { x: ev.clientX, y: ev.clientY };
  clearTimeout(edTimer);
  edTimer = setTimeout(() => {
    edLong = true;
    editorMenu(edPress.x, edPress.y);
  }, 520);
});
exprEl.addEventListener("pointermove", (ev) => {
  if (edPress && Math.hypot(ev.clientX - edPress.x, ev.clientY - edPress.y) > 8) clearTimeout(edTimer);
});
exprEl.addEventListener("pointerup", () => clearTimeout(edTimer));
exprEl.addEventListener("pointercancel", () => clearTimeout(edTimer));
exprEl.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  clearTimeout(edTimer);
  if (!edLong) editorMenu(ev.clientX, ev.clientY);
});
// Horizontal swipes on the input area change the keypad page
const editorEl = $(".editor");
let swipe = null, swiped = false;
editorEl.addEventListener("pointerdown", (ev) => {
  swipe = { x: ev.clientX, y: ev.clientY, t: Date.now() };
  swiped = false;
});
editorEl.addEventListener("pointerup", (ev) => {
  if (!swipe) return;
  const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y;
  const fast = Date.now() - swipe.t < 700;
  swipe = null;
  if (!fast || Math.abs(dx) < 45 || Math.abs(dx) < 2 * Math.abs(dy)) return;
  // let a wide formula scroll instead
  const m = $("#math2d");
  if (!m.hidden && m.contains(ev.target) && m.scrollWidth > m.clientWidth + 2) return;
  const i = TABS.findIndex(([id]) => id === state.tab);
  const j = Math.max(0, Math.min(TABS.length - 1, i + (dx < 0 ? 1 : -1)));
  swiped = true;
  clearTimeout(edTimer);
  if (j !== i) selectTab(TABS[j][0]);
});
editorEl.addEventListener("pointercancel", () => { swipe = null; });

exprEl.addEventListener("click", (ev) => {
  if (swiped) { swiped = false; return; }
  if (edLong) { edLong = false; return; }
  setCaret(caretIndexAt(ev.clientX, ev.clientY));
});

async function pasteText() {
  try {
    const t = await navigator.clipboard.readText();
    if (t) insert(t.replace(/\s*\n\s*/g, " "));
  } catch {
    toast("Paste is blocked here: use Ctrl+V or ⌘V");
  }
}

function editorMenu(x, y) {
  const items = [["Paste", pasteText]];
  if (state.text) {
    items.push(["Copy expression", () => copy(state.text)]);
    items.push(["Clear", () => setInput(""), "danger"]);
  }
  showMenu(x, y, items);
}

// History recall with ↑ ↓: the recalled entry is highlighted, and going
// past the newest one brings back what was being typed
function markRecalled() {
  for (const el of historyEl.querySelectorAll(".entry.recalled")) el.classList.remove("recalled");
  if (state.recall < 0) return;
  const el = historyEl.querySelector(`.entry[data-i="${state.recall}"]`);
  if (el) {
    el.classList.add("recalled");
    el.scrollIntoView({ block: "nearest" });
  }
}

function recallStep(dir) {
  const n = state.history.length;
  if (state.recall < 0) {
    if (dir > 0) return;
    state.draft = { text: state.text, caret: state.caret };
    state.recall = n - 1;
  } else {
    state.recall += dir;
  }
  if (state.recall < 0) state.recall = 0;
  if (state.recall >= n) {
    state.recall = -1;
    const d = state.draft || { text: "", caret: 0 };
    setInput(d.text, d.caret);
  } else {
    setInput(state.history[state.recall].input);
  }
  markRecalled();
}

// any edit keeps the recalled text as the new draft
function endRecall() {
  if (state.recall < 0) return;
  state.recall = -1;
  markRecalled();
}

// Hardware keyboard: the document receives the keys, no field has focus
document.addEventListener("keydown", (ev) => {
  if (!sheet.hidden || !menuEl.hidden) return;
  if (ev.target.closest && ev.target.closest("input, textarea, select")) return;
  if (ev.ctrlKey || ev.metaKey) return;   // let copy and paste through
  const k = ev.key;
  const handled = () => ev.preventDefault();
  if (k === "Enter") { handled(); evaluate(); }
  else if (k === "Backspace") { handled(); endRecall(); backspace({ chars: true }); }
  else if (k === "Delete") {
    handled();
    if (state.caret < state.text.length) setInput(state.text.slice(0, state.caret) + state.text.slice(state.caret + 1), state.caret);
  }
  else if (k === "Escape") { handled(); endRecall(); setInput(""); }
  else if (k === "ArrowLeft") { handled(); setCaret(state.caret - 1, -1); }
  else if (k === "ArrowRight") { handled(); setCaret(state.caret + 1, 1); }
  else if (k === "Home") { handled(); setCaret(0); }
  else if (k === "End") { handled(); setCaret(state.text.length); }
  else if (k === "Tab") {
    const first = suggestEl.querySelector("button");
    if (first) { handled(); first.click(); }
  } else if (k === "ArrowUp" || k === "ArrowDown") {
    if (!state.history.length) return;
    handled();
    recallStep(k === "ArrowUp" ? -1 : 1);
  } else if (k.length === 1 || /^[\p{L}\p{S}\p{P}]$/u.test(k)) {
    handled();
    endRecall();
    insert(k);
  }
});

document.addEventListener("paste", (ev) => {
  if (ev.target.closest && ev.target.closest("input, textarea, select")) return;
  if (!sheet.hidden) return;
  const t = ev.clipboardData && ev.clipboardData.getData("text");
  if (t) { ev.preventDefault(); insert(t.replace(/\s*\n\s*/g, " ")); }
});

document.addEventListener("copy", (ev) => {
  if (ev.target.closest && ev.target.closest("input, textarea, select")) return;
  const sel = String(getSelection() || "");
  if (sel || !state.text || !ev.clipboardData) return;
  ev.clipboardData.setData("text/plain", state.text);
  ev.preventDefault();
  toast("Expression copied");
});

// ---------------------------------------------------------------------
// History interactions: tap result to insert it, tap input to edit,
// long press (or right click) for more

const menuEl = $("#menu");
let pressTimer = null, pressed = null, longPressed = false;

function entryAt(el) {
  const div = el.closest(".entry");
  return div ? { div, e: state.history[Number(div.dataset.i)], i: Number(div.dataset.i) } : null;
}

// a result is inserted as itself (ans_n), with all its samples and
// correlations, or as its text with asText
const resultRef = (e) => (e.rid && resultNames.includes(`ans_${e.rid}`) ? `ans_${e.rid}` : null);

function insertResult(e, asText = false) {
  if (!e || e.kind !== "value") return;
  const ref = resultRef(e);
  if (ref && !asText) return insertName(ref);
  insertValueText(e.text);
}

function insertValueText(t) {
  if (t[0] !== "(" && /\s/.test(t.replace(/\[[^\]]*\]/g, ""))) t = "(" + t + ")";
  const b = before();
  insert((/[\p{L}\p{N}_.)\]]$/u.test(b) ? " " : "") + t);
}

function showMenu(x, y, items) {
  menuEl.innerHTML = items.map(([label, , cls]) => `<button class="${cls || ""}">${esc(label)}</button>`).join("");
  menuEl.hidden = false;
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
  menuEl.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
  [...menuEl.children].forEach((b, i) => b.addEventListener("click", () => { hideMenu(); items[i][1](); }));
  setTimeout(() => document.addEventListener("pointerdown", outsideMenu), 0);
}

function hideMenu() {
  menuEl.hidden = true;
  document.removeEventListener("pointerdown", outsideMenu);
}

function outsideMenu(ev) {
  if (!menuEl.contains(ev.target)) hideMenu();
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Copy failed");
  }
}

function entryMenu(x, y, ent) {
  const { e, i } = ent;
  const items = [];
  if (e.kind === "value") {
    if (e.dist) items.push(["Distribution", () => openDistribution(e)]);
    const ref = resultRef(e);
    if (ref) items.push([`Insert ${ref}`, () => insertResult(e)]);
    items.push([ref ? "Insert value" : "Insert result", () => insertResult(e, true)]);
    items.push(["Copy result", () => copy(e.text)]);
    if (e.csv) items.push(["Copy as CSV", () => copy(e.csv)]);
  }
  if (e.kind === "plot") items.push(["Copy data (CSV)", () => copy(plotCSV(e.plot))]);
  items.push(["Edit expression", () => setInput(e.input)]);
  items.push(["Copy expression", () => copy(e.input)]);
  items.push(["Delete", () => {
    state.history.splice(i, 1);
    saveHistory();
    installResults();
    renderHistory();
  }, "danger"]);
  showMenu(x, y, items);
}

// plots: drag to read the values (no long press there), tap to zoom
let plotDown = null;
function readPlot(ev) {
  const svg = ev.target.closest(".plot-svg");
  const ent = svg && entryAt(svg);
  if (ent && ent.e.plot) plotRead(svg, ent.e.plot, ev.clientX);
  return Boolean(svg);
}
historyEl.addEventListener("pointermove", (ev) => {
  if (ev.buttons || ev.pointerType === "mouse") readPlot(ev);
});

historyEl.addEventListener("pointerdown", (ev) => {
  const ent = entryAt(ev.target);
  longPressed = false;
  plotDown = { x: ev.clientX, y: ev.clientY };
  if (readPlot(ev)) return;
  if (!ent) return;
  pressed = { x: ev.clientX, y: ev.clientY };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    longPressed = true;
    entryMenu(pressed.x, pressed.y, ent);
  }, 520);
});
historyEl.addEventListener("pointermove", (ev) => {
  if (pressed && Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > 8) clearTimeout(pressTimer);
});
historyEl.addEventListener("pointerup", () => clearTimeout(pressTimer));
historyEl.addEventListener("pointercancel", () => clearTimeout(pressTimer));
historyEl.addEventListener("contextmenu", (ev) => {
  const ent = entryAt(ev.target);
  if (!ent) return;
  ev.preventDefault();
  clearTimeout(pressTimer);
  if (!longPressed) entryMenu(ev.clientX, ev.clientY, ent);
});
historyEl.addEventListener("click", (ev) => {
  if (longPressed) { longPressed = false; return; }
  const t = ev.target.closest("[data-try]");
  if (t) { setInput(t.dataset.try); evaluate(); return; }
  const ins = ev.target.closest("[data-insert]");
  if (ins) { insertName(ins.dataset.insert); return; }
  const ent = entryAt(ev.target);
  if (!ent) return;
  const lg = ev.target.closest("[data-plotlog]");
  if (lg && ent.e.plot) {
    plotToggleLog(ent.e, lg.dataset.plotlog);
    ent.div.replaceWith(renderEntry(ent.e, ent.i));
    return;
  }
  if (ev.target.closest(".plot-svg") && ent.e.plot && plotDown && Math.hypot(ev.clientX - plotDown.x, ev.clientY - plotDown.y) < 8) {
    openPlot(ent.e);
    return;
  }
  if (ev.target.closest(".plot")) return;
  const cell = ev.target.closest("td[data-v]");
  if (cell && ent.e.kind === "value") {
    insertValueText(cell.dataset.v);
    flash(cell);
    return;
  }
  if (ev.target.closest(".mcb") && ent.e.dist) { openDistribution(ent.e); return; }
  if (ev.target.closest(".in")) {
    setInput(ent.e.input);
    flash(ev.target.closest(".in"));
  } else if (ev.target.closest(".out") && ent.e.kind === "value") {
    insertResult(ent.e);
    flash(ev.target.closest(".out"));
  }
});

function flash(el) {
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

// ---------------------------------------------------------------------
// Toast

let toastTimer = null;
function toast(msg, ms = 2200, action = null) {
  const t = $("#toast");
  t.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-act";
    b.textContent = action[0];
    b.addEventListener("click", () => { t.hidden = true; action[1](); });
    t.appendChild(b);
  }
  t.classList.toggle("has-act", Boolean(action));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------------------------------------------------------------------
// Sheets

const sheet = $("#sheet");
let sheetBody = $("#sheet-body");

function openSheet(title, render) {
  $("#sheet-title").textContent = title;
  // a fresh element, so that listeners added by earlier sheets go away
  const fresh = sheetBody.cloneNode(false);
  fresh._tab = sheetBody._tab;
  sheetBody.replaceWith(fresh);
  sheetBody = fresh;
  render(sheetBody);
  sheet.hidden = false;
}

function closeSheet() {
  sheet.hidden = true;
  sheetBody.innerHTML = "";
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

sheet.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-close]")) closeSheet();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !sheet.hidden) closeSheet();
});

// ---------------------------------------------------------------------
// Reference browser

const REF_TABS = ["Units", "Prefixes", "Systems", "Money", "Variables", "Constants", "Functions"];

function refItems(tab) {
  const e = env();
  const fmt = (q) => { try { return qText(q); } catch { return ""; } };
  const items = [];
  switch (tab) {
    case "Units":
      for (const [k, v] of e.units) {
        if (v.currency) continue;
        items.push({ name: k, doc: firstLine(v.doc), value: () => (e.baseunits.includes(k) ? "base unit" : "= " + fmt(new Q(v.x, v.d))), insert: k, info: k });
      }
      break;
    case "Prefixes":
      for (const [k, v] of e.prefixes) if (k) items.push({ name: k, doc: firstLine(v.doc), value: () => formatUNum(v.x, e.digits), insert: k + "*", info: k });
      break;
    case "Systems":
      for (const [k, v] of e.systems) items.push({ name: k, doc: firstLine(v.doc), value: () => "[" + v.args.join("|") + "]", insert: k, info: k });
      break;
    case "Money":
      for (const [k, v] of e.units) {
        if (!v.currency && k !== e.basecurrency) continue;
        items.push({ name: k, doc: firstLine(v.doc), value: () => (k === e.basecurrency ? "base currency" : "= " + fmt(new Q(v.x, v.d))), insert: k, info: k });
      }
      break;
    case "Variables":
      for (const [k, v] of e.vars) {
        if (v && v.fn) continue;
        items.push({
          name: k, doc: firstLine(v.doc || (v instanceof Q ? v.doc : "")),
          value: () => { const x = v.lazy ? v.lazy() : v; return x instanceof Q ? fmt(x) : ""; },
          insert: k, info: k,
        });
      }
      break;
    case "Constants":
      for (const k of state.calc.const.keys()) {
        items.push({ name: k, doc: "", value: () => fmt(state.calc.const.get(k)), insert: `const["${k}"]`, info: k, isConst: true });
      }
      break;
    case "Functions":
      for (const k of Object.keys(state.calc.builtins)) items.push({ name: k + "()", doc: functionDocs[k] || "", value: () => "", insert: k + "(", info: k });
      for (const [k, v] of e.vars) if (v && v.fn) items.push({ name: `${k}(${v.fn.params.join(", ")})`, doc: v.doc || v.src, value: () => "", insert: k + "(", info: k });
      for (const [k, v] of e.formats) items.push({ name: k, doc: v.doc, value: () => "output format, use after @", insert: k, info: k });
      break;
  }
  return items;
}

function renderReference(root, { side = false } = {}) {
  root.innerHTML = `
    <input class="search" type="search" placeholder="Search units, constants…" inputmode="search" autocapitalize="off" autocorrect="off" spellcheck="false">
    <div class="seg" role="tablist">${REF_TABS.map((t) => `<button data-reftab="${t}" aria-selected="${t === (root._tab || "Units")}">${t}</button>`).join("")}</div>
    <div class="ref-scroll"><div class="ref-count"></div><ul class="ref-list"></ul></div>`;
  root._tab = root._tab || "Units";
  const search = $(".search", root);
  const list = $(".ref-list", root);
  const count = $(".ref-count", root);
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    let items;
    if (q) {
      // search across all tabs
      items = REF_TABS.flatMap((t) => refItems(t).map((it) => ({ ...it, tab: t })))
        .filter((it) => it.name.toLowerCase().includes(q) || (it.doc || "").toLowerCase().includes(q));
      items.sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)));
    } else items = refItems(root._tab);
    const shown = items.slice(0, 250);
    count.textContent = `${items.length} item${items.length === 1 ? "" : "s"}${items.length > shown.length ? " — refine the search to see more" : ""}`;
    list.innerHTML = shown.map((it, i) => `
      <li class="ref-item" data-i="${i}">
        <div class="main-col">
          <div class="nm">${esc(it.name)}</div>
          ${it.doc ? `<div class="dc">${esc(it.doc)}</div>` : ""}
          <div class="vl"></div>
        </div>
        <button class="icon-btn more" data-more aria-label="Details">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/></svg>
        </button>
        <button class="small-btn ins" data-ins>Insert</button>
      </li>`).join("");
    // fill values lazily
    const lis = [...list.children];
    let k = 0;
    const fill = () => {
      const end = Math.min(lis.length, k + 40);
      for (; k < end; k++) {
        const v = shown[k].value();
        $(".vl", lis[k]).textContent = v;
      }
      if (k < lis.length) requestAnimationFrame(fill);
    };
    fill();
    list._items = shown;
  };
  search.addEventListener("input", draw);
  root.addEventListener("click", (ev) => {
    const tb = ev.target.closest("[data-reftab]");
    if (tb) {
      root._tab = tb.dataset.reftab;
      for (const b of root.querySelectorAll("[data-reftab]")) b.setAttribute("aria-selected", String(b === tb));
      search.value = "";
      draw();
      return;
    }
    const li = ev.target.closest(".ref-item");
    if (!li) return;
    const it = list._items[Number(li.dataset.i)];
    if (ev.target.closest("[data-more]")) {
      const old = $(".ref-detail", li);
      if (old) { old.remove(); return; }
      const r = it.isConst ? state.calc.const.get(it.info) : null;
      const info = r ? { text: r.doc + "\n\n" + qText(r) } : state.calc.info(it.info);
      const d = document.createElement("div");
      d.className = "ref-detail";
      d.textContent = info.text || info.message || "";
      $(".main-col", li).appendChild(d);
      return;
    }
    if (it.insert.endsWith("(")) insertFunction(it.insert);
    else if (it.insert.endsWith("*")) insert(it.insert);
    else if (env().units.has(it.insert) && !env().vars.has(it.insert)) insertUnit(it.insert);
    else insertName(it.insert);
    if (!side) closeSheet();
    toast(`Inserted ${it.insert}`);
  });
  draw();
}

// ---------------------------------------------------------------------
// Settings

function renderSettings(root) {
  const s = state.settings;
  const e = env();
  const systems = ["none", ...e.systems.keys()];
  const nvars = state.session.length;
  root.innerHTML = `
    <div class="group-title">Display</div>
    <div class="group">
      <div class="row"><div class="lbl">Default unit system<small>Used when no @ is given</small></div>
        <select id="set-system">${systems.map((x) => `<option ${x === s.system ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="row"><div class="lbl">Significant digits</div>
        <select id="set-digits">${[4, 6, 8, 10, 12, 15].map((x) => `<option ${x === s.digits ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="row"><div class="lbl">Show uncertainties<small>Errors of constants and ± inputs</small></div>
        <input type="checkbox" class="switch" id="set-errors" ${s.errors ? "checked" : ""}></div>
      <div class="row"><div class="lbl">Typeset formulas<small>Fractions, roots and powers drawn in 2D</small></div>
        <input type="checkbox" class="switch" id="set-typeset" ${s.typeset !== false ? "checked" : ""}></div>
      <div class="row"><div class="lbl">Units in brackets<small>Unit keys after a number give 9.8[m/s^2]</small></div>
        <input type="checkbox" class="switch" id="set-brackets" ${s.brackets !== false ? "checked" : ""}></div>
      <div class="row"><div class="lbl">Matching parentheses<small>The pair at the cursor; unmatched in red</small></div>
        <select id="set-match">${[["fill", "Filled"], ["underline", "Underline"], ["box", "Box"], ["none", "None"]].map(([v, l]) => `<option value="${v}" ${v === (s.bracketMatch || "fill") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="row"><div class="lbl">Rainbow parentheses<small>Each nesting level in its own colour</small></div>
        <input type="checkbox" class="switch" id="set-rainbow" ${s.rainbow ? "checked" : ""}></div>
      <div class="row"><div class="lbl">Appearance</div>
        <select id="set-theme">${["auto", "light", "dark"].map((x) => `<option ${x === s.theme ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="row pal-row"><div class="lbl">Colours</div>
        <div class="pals" id="set-palette">${paletteChipsHTML(s.palette || "classic")}</div></div>
    </div>

    <div class="group-title">Uncertainties</div>
    <div class="group">
      <div class="row"><div class="lbl">Error propagation<small>Linear: first order, exact for linear expressions. Monte Carlo: sampling, any distribution and nonlinearity</small></div>
        <select id="set-mc"><option value="lin" ${s.mc ? "" : "selected"}>Linear</option><option value="mc" ${s.mc ? "selected" : ""}>Monte Carlo</option></select></div>
      <div class="row"><div class="lbl">Monte Carlo samples<small>More samples: smoother results, slower</small></div>
        <select id="set-mcn">${[1000, 2000, 5000, 10000, 20000, 50000, 100000].map((n) => `<option value="${n}" ${n === (s.mcN || 5000) ? "selected" : ""}>${n.toLocaleString("en")}</option>`).join("")}</select></div>
    </div>

    <div class="group-title">Cosmology</div>
    <div class="group" id="cosmo-group">
      <div class="row"><div class="lbl">Default model<small>Used by the cosmology and lensing functions</small></div>
        <select id="set-cosmo">${Object.entries(COSMO_PRESETS).map(([k, v]) => `<option value="${k}" ${k === (s.cosmo?.preset || "concordance") ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
      <div class="row"><div class="lbl">H<sub>0</sub><small>km/s/Mpc</small></div><input type="text" inputmode="decimal" class="num" data-cp="H0"></div>
      <div class="row"><div class="lbl">Ω<sub>M</sub><small>Matter density</small></div><input type="text" inputmode="decimal" class="num" data-cp="Om"></div>
      <div class="row"><div class="lbl">Ω<sub>b</sub><small>Baryon density</small></div><input type="text" inputmode="decimal" class="num" data-cp="Ob"></div>
      <div class="row"><div class="lbl">Ω<sub>R</sub><small>Radiation density</small></div><input type="text" inputmode="decimal" class="num" data-cp="OR"></div>
      <div class="row"><div class="lbl">Flat<small>Ω<sub>Λ</sub> = 1 − Ω<sub>M</sub> − Ω<sub>R</sub></small></div><input type="checkbox" class="switch" id="set-flat"></div>
      <div class="row"><div class="lbl">Ω<sub>Λ</sub><small>Cosmological constant</small></div><input type="text" inputmode="decimal" class="num" data-cp="OL"></div>
      <div class="row"><div class="lbl">Parameter uncertainties<small>Correlated errors on H<sub>0</sub>, Ω<sub>M</sub>, Ω<sub>b</sub> (and Ω<sub>K</sub>) in all cosmology and lensing results</small></div><input type="checkbox" class="switch" id="set-cerr"></div>
      <div class="row cinfo"><div class="lbl" id="cosmo-covinfo"></div></div>
      <div class="row cerr"><div class="lbl">σ(H<sub>0</sub>)<small>km/s/Mpc</small></div><input type="text" inputmode="decimal" class="num" data-cp="sH0"></div>
      <div class="row cerr"><div class="lbl">σ(Ω<sub>M</sub>)</div><input type="text" inputmode="decimal" class="num" data-cp="sOm"></div>
      <div class="row cerr"><div class="lbl">Correlation ρ(H<sub>0</sub>, Ω<sub>M</sub>)<small>Between −1 and 1</small></div><input type="text" inputmode="decimal" class="num" data-cp="rho"></div>
    </div>

    <div class="group-title">Exchange rates</div>
    <div class="group">
      ${ARTIFACT ? `<div class="row"><div class="lbl">Rates of ${esc(e.currencyTime || "—")}<small>A fixed snapshot: live updates are not available in this view</small></div></div>
    </div>` : `
      <div class="row"><div class="lbl">Rates of ${esc(e.currencyTime || "—")}<small id="cur-status">${e.units.has("USD") ? "Currencies are units: 10 USD @ EUR" : "No rates loaded"}</small></div>
        <button class="act" id="cur-update">Update</button></div>
      <div class="row"><div class="lbl">Update automatically<small>At most once a day, when online</small></div>
        <input type="checkbox" class="switch" id="set-autocur" ${s.autoCurrency ? "checked" : ""}></div>
      <div class="row"><div class="lbl">openexchangerates.org ID<small>Optional; otherwise open.er-api.com is used</small></div>
        <input type="password" id="set-oxr" value="${esc(s.oxrId)}" autocomplete="off" placeholder="app id"></div>
    </div>`}

    <div class="group-title">Definitions</div>
    <div class="group">
      <div class="row"><div class="lbl">My definitions<small>Your own Startup.imks: units, prefixes, systems</small></div>
        <button class="act" id="open-defs">Edit</button></div>
      <div class="row"><div class="lbl">Session variables<small>${nvars} definition${nvars === 1 ? "" : "s"} made in the calculator</small></div>
        <button class="danger" id="clear-vars">Clear</button></div>
      <div class="row"><div class="lbl">History<small>${state.history.length} entries</small></div>
        <button class="danger" id="clear-hist">Clear</button></div>
    </div>

    <div class="group-title">Backup</div>
    <div class="group">
      <div class="row"><div class="lbl">Export everything<small>${ARTIFACT ? "Copies a backup to the clipboard, to paste into a .json file" : "History, variables, definitions and settings"}</small></div>
        <button class="act" id="export">Export</button></div>
      <div class="row"><div class="lbl">Import a backup</div>
        <button class="act" id="import">Import</button><input type="file" id="import-file" accept="application/json,.json" hidden></div>
    </div>
    <textarea class="defs-editor" id="export-text" readonly hidden></textarea>
    ${state.startupErrors.length ? `<div class="group-title">Startup problems</div><div class="errors">${esc(state.startupErrors.join("\n"))}</div>` : ""}
    <p class="note">Data stays on this device. iOS may clear the storage of web apps that are not used for a long time: use Export to keep a backup.</p>`;

  const save = () => { store.set("settings", state.settings); };
  $("#set-system", root).addEventListener("change", (ev) => { s.system = ev.target.value; save(); applySettings(state.calc); refresh(); });
  $("#set-digits", root).addEventListener("change", (ev) => { s.digits = Number(ev.target.value); save(); applySettings(state.calc); refresh(); });
  $("#set-errors", root).addEventListener("change", (ev) => { s.errors = ev.target.checked; save(); applySettings(state.calc); refresh(); });
  $("#set-typeset", root).addEventListener("change", (ev) => { s.typeset = ev.target.checked; save(); renderHistory(); updateMath2d(); });
  $("#set-match", root).addEventListener("change", (ev) => { s.bracketMatch = ev.target.value; save(); renderEditor(); });
  $("#set-rainbow", root).addEventListener("change", (ev) => { s.rainbow = ev.target.checked; save(); renderEditor(); });
  const mcChange = () => {
    s.mc = $("#set-mc", root).value === "mc";
    s.mcN = Number($("#set-mcn", root).value);
    save();
    build();
    refresh();
    toast(s.mc ? `Monte Carlo errors, ${s.mcN.toLocaleString("en")} samples` : "Linear error propagation");
  };
  $("#set-mc", root).addEventListener("change", mcChange);
  $("#set-mcn", root).addEventListener("change", mcChange);
  $("#set-brackets", root).addEventListener("change", (ev) => { s.brackets = ev.target.checked; save(); });
  $("#set-palette", root).addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pal]");
    if (!b) return;
    s.palette = b.dataset.pal;
    save();
    applyPalette();
    for (const x of root.querySelectorAll("[data-pal]")) {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    }
  });
  $("#set-theme", root).addEventListener("change", (ev) => { s.theme = ev.target.value; save(); applyTheme(); });
  setupCosmoSettings(root, save);
  if (!ARTIFACT) {
    $("#set-autocur", root).addEventListener("change", (ev) => { s.autoCurrency = ev.target.checked; save(); });
    $("#set-oxr", root).addEventListener("change", (ev) => { s.oxrId = ev.target.value.trim(); save(); });
    $("#cur-update", root).addEventListener("click", async () => {
      $("#cur-status", root).textContent = "Updating…";
      const ok = await updateCurrencies(true);
      renderSettings(root);
      if (!ok) $("#cur-status", root).textContent = "Update failed (offline?)";
    });
  }
  $("#open-defs", root).addEventListener("click", () => openSheet("My definitions", renderDefs));
  confirmButton($("#clear-vars", root), () => {
    state.session = [];
    store.set("session", []);
    build();
    renderSettings(root);
    toast("Variables cleared");
  });
  confirmButton($("#clear-hist", root), () => {
    state.history = [];
    saveHistory();
    store.set("rid", 0);
    installResults();
    renderHistory();
    renderSettings(root);
  });
  $("#export", root).addEventListener("click", () => exportData(root));
  $("#import", root).addEventListener("click", () => $("#import-file", root).click());
  $("#import-file", root).addEventListener("change", (ev) => importData(ev.target.files[0]));
}

// A destructive button asks for a second tap instead of a dialog
function confirmButton(btn, action) {
  let timer = null;
  const label = btn.textContent;
  btn.addEventListener("click", () => {
    if (!timer) {
      btn.textContent = "Tap to confirm";
      timer = setTimeout(() => { btn.textContent = label; timer = null; }, 3000);
      return;
    }
    clearTimeout(timer);
    timer = null;
    btn.textContent = label;
    action();
  });
}

// Cosmology fields of Settings
function setupCosmoSettings(root, save) {
  const s = state.settings;
  s.cosmo = { ...DEFAULT_SETTINGS.cosmo, ...(s.cosmo || {}) };
  const fields = [...root.querySelectorAll("[data-cp]")];
  const flat = $("#set-flat", root);
  const fill = () => {
    const c = s.cosmo;
    for (const f of fields) {
      const k = f.dataset.cp;
      const v = k === "OL" && c.flat ? 1 - Number(c.Om) - Number(c.OR) : c[k];
      f.value = String(Math.round(Number(v) * 1e6) / 1e6);
    }
    flat.checked = Boolean(c.flat);
    $('[data-cp="OL"]', root).disabled = Boolean(c.flat);
    $("#set-cerr", root).checked = Boolean(c.errors);
    // a preset with a covariance matrix shows it; otherwise σ and ρ can be edited
    for (const r of root.querySelectorAll(".row.cerr")) r.hidden = !c.errors || Boolean(c.cov);
    const info = root.querySelector(".row.cinfo");
    info.hidden = !c.errors || !c.cov;
    if (c.cov) {
      const lab = { H0: "H<sub>0</sub>", Om: "Ω<sub>M</sub>", Ob: "Ω<sub>b</sub>", Ok: "Ω<sub>K</sub>" };
      const P = c.cov.params, M = c.cov.m;
      const sd = P.map((_, i) => Math.sqrt(M[i][i]));
      const fmt = (x) => String(Number(x.toPrecision(2)));
      const sig = P.map((p, i) => `σ(${lab[p]}) = ${fmt(sd[i])}`).join(", ");
      const cor = [];
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) cor.push(`ρ(${lab[P[i]]}, ${lab[P[j]]}) = ${(M[i][j] / (sd[i] * sd[j])).toFixed(3)}`);
      $("#cosmo-covinfo", root).innerHTML = `Full covariance of the preset<small>${sig}<br>${cor.join(", ")}</small>`;
    }
    if (c.Ok && !c.flat) $('[data-cp="OL"]', root).disabled = true;
  };
  $("#set-cerr", root).addEventListener("change", (ev) => {
    s.cosmo.errors = ev.target.checked;
    fill();
    apply();
  });
  // leave a preset: keep the values, reduce a covariance to σ(H0), σ(Ω_M), ρ
  const toCustom = () => {
    const c = s.cosmo;
    if (c.cov) {
      const iH = c.cov.params.indexOf("H0"), iO = c.cov.params.indexOf("Om"), M = c.cov.m;
      c.sH0 = Math.sqrt(M[iH][iH]);
      c.sOm = Math.sqrt(M[iO][iO]);
      c.rho = M[iH][iO] / (c.sH0 * c.sOm);
      if (c.Ok) { c.OL = 1 - c.Om - c.Ok - c.OR; c.flat = false; }
      delete c.cov;
      delete c.Ok;
    }
    c.preset = "custom";
    $("#set-cosmo", root).value = "custom";
  };
  const apply = () => {
    // a redefinition in the calculator would hide the new default
    const target = (l) => { const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*=/u.exec(l); return m ? env().vars.resolve(m[1]) : null; };
    const before = state.session.length;
    state.session = state.session.filter((l) => !COSMO_NAMES.includes(target(l)));
    if (state.session.length !== before) store.set("session", state.session);
    save();
    build();
    refresh();
    const el = env().vars.get("Omega_L");
    const olv = el && el.x ? el.x.n : 1 - s.cosmo.Om - s.cosmo.OR;
    toast(modelText().replace(/ Set the default.*$/, ""), 5000);
  };
  $("#set-cosmo", root).addEventListener("change", (ev) => {
    const p = COSMO_PRESETS[ev.target.value];
    s.cosmo = p.H0 ? { ...p, preset: ev.target.value, errors: s.cosmo.errors } : { ...s.cosmo, preset: "custom" };
    delete s.cosmo.name;
    fill();
    apply();
  });
  for (const f of fields) {
    f.addEventListener("change", () => {
      const v = Number(f.value.replace(",", "."));
      const bad = !Number.isFinite(v) || (f.dataset.cp === "H0" && v <= 0) || (f.dataset.cp === "rho" && Math.abs(v) > 1) ||
        (/^s/.test(f.dataset.cp) && v < 0);
      if (bad) { fill(); toast("Not a valid number"); return; }
      toCustom();
      s.cosmo[f.dataset.cp] = v;
      $("#set-cosmo", root).value = "custom";
      fill();
      apply();
    });
  }
  flat.addEventListener("change", () => {
    toCustom();
    s.cosmo.flat = flat.checked;
    if (!flat.checked) s.cosmo.OL = 1 - s.cosmo.Om - s.cosmo.OR;
    s.cosmo.preset = "custom";
    $("#set-cosmo", root).value = "custom";
    fill();
    apply();
  });
  fill();
}

function refresh() {
  updatePreview();
  updateSuggestions();
}

function renderDefs(root) {
  root.innerHTML = `
    <p class="note">Definitions in imks syntax, loaded after the standard ones. For example:<br>
      <code>%newunit furlong=220[yd] # "Furlong"</code><br>
      <code>%newprefix Ki=1024 # "Kibi"</code><br>
      <code>%newsystem mine=[km|hour|kg]</code><br>
      <code>%let v0=50[km/hour] # "Town speed limit"</code><br>
      <code>%lazy now_age=2026[yr] - 1990[yr]</code><br>
      <code>kinetic(m, v) = m v^2 / 2</code></p>
    <textarea class="defs-editor" id="defs-text" spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>
    <div class="errors" id="defs-errors"></div>
    <div style="display:flex; gap:8px; margin-top:10px">
      <button class="small-btn" id="defs-save">Save and reload</button>
    </div>`;
  const ta = $("#defs-text", root);
  ta.value = state.defs;
  $("#defs-errors", root).textContent = state.userErrors.join("\n");
  $("#defs-save", root).addEventListener("click", () => {
    state.defs = ta.value;
    store.set("defs", state.defs);
    build();
    $("#defs-errors", root).textContent = state.userErrors.join("\n");
    toast(state.userErrors.length ? "Saved with errors" : "Definitions loaded");
    refresh();
  });
}

function exportData(root) {
  const data = {
    app: "imks-units",
    version: 1,
    exported: new Date().toISOString(),
    history: state.history,
    session: state.session,
    defs: state.defs,
    settings: { ...state.settings, oxrId: "" },
  };
  const json = JSON.stringify(data, null, 1);
  if (ARTIFACT) {
    const ta = $("#export-text", root);
    const fallback = () => {
      ta.value = json;
      ta.hidden = false;
      ta.focus();
      ta.select();
      toast("Select all and copy the backup below");
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).then(() => toast("Backup copied to the clipboard"), fallback);
    } else fallback();
    return;
  }
  const blob = new Blob([json], { type: "application/json" });
  const name = `imks-units-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: "iMKS Units backup" }).catch(() => {});
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "imks-units") throw new Error("not a backup");
    state.history = Array.isArray(data.history) ? data.history : [];
    state.session = Array.isArray(data.session) ? data.session : [];
    state.defs = typeof data.defs === "string" ? data.defs : "";
    state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}), oxrId: state.settings.oxrId };
    results = new Map();
    restoredIds = new Map();
    restored.clear();
    store.set("rid", 0);
    saveHistory();
    store.set("session", state.session);
    store.set("defs", state.defs);
    store.set("settings", state.settings);
    build();
    applyTheme();
    renderHistory();
    closeSheet();
    toast("Backup imported");
  } catch (e) {
    toast("Import failed: " + e.message);
  }
}

// ---------------------------------------------------------------------
// Help

const HELP = [
  ["Quantities", "A number followed by units, with or without brackets. Juxtaposed units multiply; one / divides by everything after it.", [
    ["9.8 m/s^2", "bare units"], ["9.8[m s^-2]", "bracketed"], ["3[m/(s K)]", "parentheses need brackets"], ["2 m^2", "is 2[m^2]"], ["2[m]^2", "is 4[m^2]"],
  ]],
  ["Converting with @", "Write @ and one or more units separated by |. With several units, the shortest combination is used.", [
    ["12 m + 3 cm @ km", ""], ["20 m/s @ km|hour", ""], ["20 m/s @ km|hour|mph", "shortest wins"], ["72 km/hour @ SI", "unit system"], ["6.63e-34[kg m^2 s^-1] @ easy", ""],
  ]],
  ["Prefixes", "After @, a prefix alone (or with *) selects the prefix; * alone means any engineering prefix.", [
    ["1200 s @ k", ""], ["0.12 cm @ m|*", ""], ["12 cm @ m*", "m* is milli"], ["1200 m @ *m", ""], ["5600 K @ *SI", ""],
  ]],
  ["Variables as units", "Single quotes keep a variable in the unit; double quotes remove it (natural units).", [
    ["5[s 'c'] @ km", ""], ["300000 km @ s 'c'", ""], ["1e30 kg @ \"c\"|\"G\"", ""], ["1 m @ planck", ""], ["6.2e34 @ m|planck", ""], ["1 @ kg|'planck'", ""],
  ]],
  ["Temperatures", "Absolute units have a zero point. ~ turns an absolute quantity into a relative one and back.", [
    ["37 °C @ °F", ""], ["300 K @ Celsius", ""], ["~300 K @ Celsius", ""], ["20 °C + ~5 K @ °C", ""], ["30 °C - 10 °C", "a difference"],
  ]],
  ["Uncertainties", "Errors propagate linearly, with correlations. Use ±, +/- or the short notation 3.0(1).", [
    ["v = (3 ± 0.1) m/s", ""], ["v^2 @ mph", ""], ["v + v", "correlated"], ["G", "NIST value"],
  ]],
  ["Formats", "Special output formats after @, and input in the same style.", [
    ["10 ks @ hms", ""], ["1 rad @ dms", ""], ["12h 34m 56s", ""], ["18d 24' 32\"", ""], ["0.375 @ frac", ""],
  ]],
  ["Variables, functions, constants", "Assign with =. Define functions as f(x) = …. NIST constants are in const[\"…\"].", [
    ["v = 50 km/hour # \"Town speed\"", "with a doc string"], ["kinetic(m, v) = m v^2 / 2", ""], ["kinetic(1200 kg, 50 km/h) @ kJ", ""], ["const[\"Rydberg constant\"]", ""], ["m_e c^2 @ MeV", ""], ["10 USD @ EUR", "currencies"],
  ]],
  ["Cosmology and lensing", "Distances, times and volumes for ΛCDM with the current H_0, Omega_M and Omega_L (Omega_b is also available) (set the default in Settings, or redefine them; Settings can also add the correlated uncertainties of H_0 and Omega_M of the chosen model, which then propagate to every result). Lensing functions take the lens and source redshifts. All are on the f(x) keys.", [
    ["D_L(1) @ Gpc", "luminosity distance"], ["scale(0.5)", "kpc per arcsec"], ["age(0)", ""], ["Omega_M = 0.315", "change the model"],
    ["theta_E(1e12 M_Sun, 0.5, 2)", "Einstein radius"], ["Sigma_cr(0.3, 1.5)", ""], ["theta_E_SIS(250 km/s, 0.5, 2)", ""], ["H(1)", ""],
  ]],
  ["Solve, integrate, differentiate", "The first argument is an expression in the variable named by the second one. solve finds where the two sides are equal, from a guess or within a range, and roots finds all such values, as a list (polyroots gives all the roots of a polynomial, complex ones too, from its coefficients a0, a1, …); integrate takes limits, which can be ±inf; diff gives the derivative at a point; limit gives the limit at a point (or at ±inf), from both sides or one. Units and errors carry through (in Monte Carlo mode, per sample). On the f(x) Calculus keys.", [
    ["solve(x^2 = 2, x)", ""], ["solve(D_L(z) = 1 Gpc, z, 0, 5)", "redshift at 1 Gpc"], ["solve(age(z) = 1 Gyr, z, 1)", ""], ["solve(cos(x) = x, x, 0, 1)", ""],
    ["roots(x^3 - 6x^2 + 11x = 6, x)", "1, 2, 3"], ["roots(sin(x) = 0.5, x, 0, 10)", ""], ["roots(cos(x) = x/10, x)", ""], ["polyroots((1, 0, 1))", "±i"], ["polyroots((-6, 11, -6, 1))", "x³ − 6x² + 11x − 6"],
    ["integrate(exp(-x^2), x, -inf, inf)", "√π"], ["integrate(9.81 m/s^2, t, 0 s, 2 s)", ""], ["diff(age(z), z, 1) @ Gyr", ""], ["diff(x^3, x, 2)", ""],
    ["limit(sin(x)/x, x, 0)", "1"], ["limit((1 + 1/x)^x, x, inf)", "e"], ["limit(x^x, x, 0, 1)", "from above"],
  ]],
  ["Lists and tables", "A list is written in parentheses, or made with linspace and logspace. Arithmetic, units, @ and functions apply to each value; sum, mean, len, min and max take the whole list. sum(f(k), k, a, b) adds f over k = a, a + 1, …, b; b can be inf, as in sum(1/k^2, k, 1, inf). A list of lists is shown as a table, one column per list. Tap a value to insert it; long-press to copy as CSV.", [
    ["z = (0.1, 0.5, 1, 2)", ""], ["D_L(z) @ Gpc", ""], ["(z, D_L(z) @ Gpc, age(z))", "a table"], ["linspace(0 m, 10 m, 6)", ""], ["logspace(1, 1000, 4)", ""], ["sum((3, 4, 5) kg)", ""], ["sum(1/k^2, k, 1, inf)", "π²/6"], ["sum((-1)^(k+1)/k, k, 1, inf)", "ln 2"], ["sum(2^k / factorial(k), k, 0, 20)", "≈ e²"],
  ]],
  ["Vectors", "A vector is a list of components with compatible units. Arithmetic is per component; dot, cross, norm and angle take whole vectors. On the f(x) Lists keys.", [
    ["F = (3, 4, 0) N", ""], ["d = (2, 0, 1) m", ""], ["dot(F, d)", "work"], ["cross(d, F)", "torque"], ["norm(F)", ""], ["angle(F, d) @ deg", ""],
  ]],
  ["Plots", "plot(f(x), x, a, b) draws a curve; a tuple of expressions draws several. plot(ys) and plot(xs, ys) plot lists. Axes take the units of the values (convert with @); errors show as a 68 % band. Wide positive ranges use log axes; toggle them below the plot. Drag on the plot to read values; a tap opens a larger view: drag to move, pinch or scroll to zoom (scroll: x only, shift-scroll: both), tap to read, double-tap to fit y again; plot(f(x), x, a, b) is computed again over the new range.", [
    ["plot(sin(x), x, 0, 2 pi)", ""], ["plot((D_L(z), D_A(z)) @ Gpc, z, 0, 5)", "two curves"], ["plot(age(z), z, 0.01, 100)", "log axes"], ["plot((1, 2, 3, 4) s, (1.2, 3.9, 9.1, 16.3) m)", "from lists"],
  ]],
  ["Solar system", "Planets, dwarf planets and major moons (NASA fact sheets): M_, R_, rho_, g_, v_esc_, a_, P_, P_rot_ and e_ followed by the body name. M_Earth, R_Earth, M_Jupiter, R_Jupiter, M_Sun, R_Sun and L_Sun are also units. On the Const keys under Solar system.", [
    ["g_Mars / g_Earth", ""], ["rho_Saturn @ g/cm^3", ""], ["M_Jupiter @ M_Earth", ""], ["a_Io", "around Jupiter"], ["P_Neptune @ yr", ""], ["sqrt(G M_Earth / a_Moon) @ km/s", "orbital speed"],
  ]],
  ["Statistics", "Gaussian and other distributions on the f(x) Stats keys; uncertainties propagate.", [
    ["pvalue(5)", "5σ, one-sided"], ["nsigma(0.05)", ""], ["conf(2)", "inside ±2σ"], ["chi2_p(12.3, 5)", "χ² tail"], ["t_p(2.1, 9)", "two-sided"], ["Phiinv(0.975)", ""], ["2.3 fwhm", "σ → FWHM"],
  ]],
  ["More data", "The Const keys have sections for mathematics, particles (PDG masses), astronomy (IAU nominal values), Earth (WGS 84), chemistry, elements and molecules (molar masses M_Fe, M_H2O; ionization energies E_ion_Fe; for elements also T_m_Fe, T_b_Fe, rho_Fe and the electronegativity chi_Fe; for molecules T_m, T_b, H_fus, H_vap, C_p, rho, T_c, p_c, as in T_b_H2O), engineering (ISA), materials (typical values), nuclides (T_half_C14, lambda_C14, m_C14) and information units (bit, B, KiB…).", [
    ["18 g / M_H2O @ mol", ""], ["E_ion_H N_A @ kJ/mol", "ionization energy"], ["H_vap_H2O / M_H2O @ MJ/kg", "latent heat"], ["T_b_C2H5OH @ °C", ""], ["T_m_W @ °C", ""], ["chi_O - chi_H", "bond polarity"], ["T_half_C14 log2(1 / 0.3)", "age when 30 % is left"], ["1 GiB / (100[Mbit/s]) @ s", ""], ["E_steel * 1e-3 @ GPa", ""], ["GM_Earth / a_WGS84^2", ""], ["m_Z c^2 @ GeV", ""], ["L_Edd(10 M_Sun)", ""],
  ]],
  ["Uncertainties", "Write errors as 3.2 ± 0.1 (or +/-) or 3.2(1). Errors propagate with correlations, including the CODATA correlations between constants. Settings → Uncertainties switches to Monte Carlo, where distributions can be used: N(μ, σ), U(a, b), LogN(m, s), Gamma(k, θ), Beta(a, b), T(ν, μ, s), Tri(a, c, b), truncated with trunc(X, lo, hi). Results then show the median and the 68 % interval, as 12.24 +0.32 −0.27 when the two sides differ; tap MC on a result for its distribution. Tapping a result inserts it as ans_n, the result itself with all its samples and correlations (after a reload, the samples are redrawn from the errors). The f(x) Distributions keys list all distributions and switch the engine.", [
    ["m_p / m_e", "correlated constants"], ["x = U(1, 3)", ""], ["exp(x)", ""], ["trunc(N(1.4 M_Sun, 0.5 M_Sun), 0 kg)", ""], ["Gamma(2, 3 s)", ""],
  ]],
  ["Typeset view", "Expressions with fractions, roots or powers are also drawn in 2D under the input line and in the history, exactly as the calculator reads them: 1/2 pi shows ½·π, not 1/(2π). Turn it off in Settings → Typeset formulas.", [
    ["1/2 pi", ""], ["1/(2 pi)", ""], ["sqrt(G M_Sun / R_Sun) @ km/s", ""], ["exp(-1.5^2/2) / sqrt(2 pi)", ""],
  ]],
  ["Names", "Subscripts are written with _: Omega_M, m_e, L_Sun, v_esc_Mars. Names that look the same are the same: π is pi, Ω_M is Omega_M, ε_0 is epsilon_0. Prefixes, units and variables are separate: after a number h is an hour, alone it is Planck's constant. √ and ∛ work as operators.", [
    ["π (2 m)^2", ""], ["Ω_M", ""], ["√2", ""], ["∛(27 m^3)", ""], ["2 h", "hours"], ["h c / (500 nm) @ eV", "Planck"],
  ]],
  ["Help and discovery", "name! shows documentation, text!! searches it, %compatible lists units of the same kind.", [
    ["pc!", ""], ["mile!!", ""], ["%compatible [J]", ""], ["%newunit furlong=220[yd] # \"Furlong\"", "define units"],
  ]],
];

function renderHelp(root) {
  root.innerHTML = `<div class="help">
    <p>An imks-style calculator: every number can carry units, results are checked for consistency, and the <b>@</b> operator converts. The bar above the keypad offers units and conversions as you type.</p>
    ${HELP.map(([title, text, ex]) => `<h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="ex">${ex.map(([x, note]) => `<button data-ex="${esc(x)}">${esc(x)}<span>${esc(note)}</span></button>`).join("")}</div>`).join("")}
    <h3>Keypad tips</h3>
    <p>Tap a result to insert it as ans_n (the n-th result; the last one is also ans), tap an expression to edit it, and long-press an entry for more options, such as inserting the value itself. Clearing the results numbers them again from ans_1. Tap inside the expression to move the cursor; long-press it to paste. Swipe left or right on it to change keypad page.</p>
    <p>On the <b>123</b> page, long-press a key for what is written in grey: its inverse (sin⁻¹ is asin, eˣ for log, x² for √, log(b, x) for xʸ), or more, such as ° on π, ± on +, x on ×, f(x) = on −, the comma on the point, AC (clear) on ⌫, sgn on |x|, and = (assignment) on ⏎; hold ◀ or ▶ to jump to the start or the end, or slide on them to move. <b>2nd</b> adds what is written in orange: sinh, log₁₀, ∛, n!, ⌊x⌋ (floor; ⌈x⌉, ceil, on a long press), e (′ on a long press, as ° for π) for one key; long-press it to keep it on.</p>
    <p>The bar above the keypad adapts to the cursor: units after a number (angles inside sin, cos, tan), your recent names and common constants after an operator or an opening parenthesis, exponents after ^, and conversions after a value with units.</p>
    <p>On the <b>Units</b> page, tap a prefix and then a unit: <b>k</b> then <b>m</b> gives km. Long-press a unit, prefix or constant to see what it is. After <b>@</b>, the units of the current quantity open automatically and compatible units appear above the keypad.</p>
    <p>Use <b>abc</b> to type names: the row above the letters guesses the name you are typing. <b>Const</b> has physical constants and your own variables, and <b>f(x)</b> has functions by topic, including cosmology and lensing. Long-press any function key for its arguments.</p>
    <p>For conversions, the Units page has a <b>Systems</b> section (SI, easy, astro, planck…, formats like hms, and quotes for variables as units), a <b>*</b> key for any prefix (after @), and a <b>[ ]</b> key for unit brackets; with a prefix selected after @, a "prefix only" key gives conversions like 1200 s @ k. On the Const page, after @, <b>'x'</b> and <b>"x"</b> keep or remove a constant as a unit.</p>
    <p>The <b>⏎</b> key evaluates; <b>=</b> assigns, as in <code>z = 0.5</code> or <code>f(m, v) = m v^2 / 2</code>. A hardware keyboard also works.</p>
  </div>`;
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ex]");
    if (!b) return;
    closeSheet();
    setInput(b.dataset.ex);
    evaluate();
  });
}

// ---------------------------------------------------------------------
// Currencies

async function updateCurrencies(force = false) {
  const s = state.settings;
  const last = store.get("currencyFetched", 0);
  if (!force && (!s.autoCurrency || Date.now() - last < 864e5 || !navigator.onLine)) return false;
  try {
    let data;
    if (s.oxrId) {
      const r = await fetch(`https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(s.oxrId)}`);
      const j = await r.json();
      if (!j.rates) throw new Error(j.description || "bad response");
      data = { rates: j.rates, timestamp: new Date(j.timestamp * 1000).toISOString().slice(0, 10) };
    } else {
      const r = await fetch("https://open.er-api.com/v6/latest/EUR");
      const j = await r.json();
      if (j.result !== "success") throw new Error("bad response");
      data = { rates: j.rates, timestamp: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) };
    }
    data.names = state.currencies?.names || {};
    state.currencies = data;
    store.set("currencies", data);
    store.set("currencyFetched", Date.now());
    loadCurrencies(env(), data);
    refresh();
    if (force) toast(`Exchange rates of ${data.timestamp}`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Theme and boot

function applyTheme() {
  const t = state.settings.theme;
  // in an artifact, "auto" follows the theme chosen in the Claude viewer
  if (t === "auto" && ARTIFACT) return;
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

// Clearing, with a way back
function clearMenu(x, y) {
  const nvars = state.session.filter((l) => /=/.test(l)).length;
  showMenu(x, y, [
    [`Clear results (${state.history.length})`, () => resetSession(false)],
    [`Start over: results and ${nvars} variable${nvars === 1 ? "" : "s"}`, () => resetSession(true), "danger"],
  ]);
}

function resetSession(vars) {
  const saved = { history: state.history, session: state.session, text: state.text, results };
  state.history = [];
  saveHistory();
  // results are numbered again from ans_1
  store.set("rid", 0);
  if (vars) {
    state.session = [];
    store.set("session", []);
    build();
  } else installResults();
  state.recall = -1;
  setInput("");
  renderHistory();
  toast(vars ? "Started over" : "Results cleared", 6000, ["Undo", () => {
    state.history = saved.history;
    results = saved.results;
    saveHistory();
    if (vars) {
      state.session = saved.session;
      store.set("session", state.session);
      build();
    } else installResults();
    renderHistory();
    setInput(saved.text);
  }]);
}

function renderSide() {
  const side = $("#side-pane");
  if (getComputedStyle(side).display !== "none" && !side._ready) {
    side._ready = true;
    renderReference(side, { side: true });
  }
}

async function boot() {
  applyTheme();
  applyPalette();
  const [constants, bundled] = window.IMKS_DATA
    ? [window.IMKS_DATA.constants, window.IMKS_DATA.currencies]
    : await Promise.all([
      fetch("data/constants.json").then((r) => r.json()).catch(() => ({})),
      fetch("data/currencies.json").then((r) => r.json()).catch(() => null),
    ]);
  state.constants = constants;
  state.corr = window.IMKS_DATA ? window.IMKS_DATA.corr : await fetch("data/codata_corr.json").then((r) => r.json()).catch(() => null);
  const saved = store.get("currencies", null);
  state.currencies = saved && bundled && saved.timestamp >= bundled.timestamp
    ? { ...saved, names: bundled.names } : bundled;
  build();
  buildKeypad();
  renderHistory();
  onInput();
  renderSide();
  addEventListener("resize", () => { renderSide(); renderEditor(); });

  $("#btn-ref").addEventListener("click", () => openSheet("Reference", (root) => renderReference(root)));
  $("#btn-settings").addEventListener("click", () => openSheet("Settings", renderSettings));
  $("#btn-help").addEventListener("click", () => openSheet("Help", renderHelp));
  $("#btn-about").addEventListener("click", () => openAbout());
  $("#about").addEventListener("click", (ev) => { if (ev.target.closest("[data-about-close]")) closeAbout(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#about").hidden) closeAbout(); });
  $("#btn-clear").addEventListener("click", (ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    clearMenu(r.left, r.bottom + 4);
  });
  // lets :active styles work on iOS
  document.addEventListener("touchstart", () => {}, { passive: true });

  if (ARTIFACT) return;
  updateCurrencies();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    // Installed apps are often resumed rather than reloaded, so look for a
    // new version at most once an hour, when the app is opened or brought to
    // the foreground, or when asked from About. A new version is fetched in
    // full before it replaces the cached one, so offline use is unaffected.
    // Once it is active, reload, but not while an expression is typed. This
    // does not rely on controllerchange, which iOS home-screen apps may miss.
    const sws = navigator.serviceWorker;
    const hadController = Boolean(sws.controller);
    let pending = false, asked = false;
    const reloadIfIdle = () => {
      if (pending && (asked || document.hidden || !state.text.trim())) location.reload();
    };
    const ready = () => {
      if (!hadController || pending) return; // first install, nothing to update
      store.set("updated", asked ? "asked" : "auto");
      pending = true;
      reloadIfIdle();
    };
    // the cache version of a worker ("imks-v33"; null from versions before 33)
    const swVersion = (sw) => new Promise((res) => {
      if (!sw) return res(null);
      const ch = new MessageChannel();
      ch.port1.onmessage = (ev) => res(ev.data);
      sw.postMessage("version", [ch.port2]);
      setTimeout(() => res(null), 1500);
    });
    const buildOf = (v) => (/^imks-v(\d+)$/.exec(v || "") || [])[1] || null;
    appBuild = () => sws.ready.then((reg) => swVersion(sws.controller || reg.active)).then(buildOf);
    // resolves once the worker is active, rejects if it fails or stalls
    const activated = (sw, ms = 60e3) => new Promise((res, rej) => {
      const check = () => {
        if (sw.state === "activated") res();
        else if (sw.state === "redundant") rej(new Error("install failed"));
      };
      sw.addEventListener("statechange", check);
      setTimeout(() => rej(new Error("timeout")), ms);
      check();
    });
    sws.addEventListener("controllerchange", ready);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    sws.register("sw.js", { updateViaCache: "none" }).then((reg) => {
      const watch = () => { if (reg.installing) activated(reg.installing).then(ready, () => {}); };
      reg.addEventListener("updatefound", watch);
      watch();
      const hourly = () => {
        if (Date.now() - store.get("updateCheck", 0) < 3600e3) return;
        reg.update().then(() => store.set("updateCheck", Date.now())).catch(() => {});
      };
      checkForUpdate = async (report) => {
        const current = await swVersion(sws.controller);
        let latest = null;
        try {
          // the published version, straight from the server
          const res = await fetch("sw.js", { cache: "no-store" });
          if (res.ok) latest = (/const CACHE = "([^"]+)"/.exec(await res.text()) || [])[1] || null;
          await reg.update();
        } catch {
          return report("Cannot check for updates: are you offline?", "err");
        }
        store.set("updateCheck", Date.now());
        await wait(300); // WebKit may report the new worker late
        const sw = reg.installing || reg.waiting;
        const stale = latest && current && latest !== current;
        if (!sw && !stale) return report(`Up to date (build ${buildOf(current || latest) || "?"})`, "ok");
        asked = true;
        report(`Downloading build ${buildOf(latest) || "?"}…`);
        try {
          if (sw) await activated(sw);
          else if ((await swVersion(reg.active)) === current) throw new Error("not installed");
          report("Updated: restarting…", "ok");
          store.set("updated", "asked");
          await wait(800);
          location.reload();
        } catch {
          // the service worker did not take the new version: drop it and
          // reload from the network, which installs the new one afresh
          report("Reinstalling…");
          store.set("updated", "asked");
          await reg.unregister().catch(() => {});
          await wait(800);
          location.reload();
        }
      };
      hourly();
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) reloadIfIdle();
        else hourly();
      });
      setInterval(hourly, 3600e3);
      // after an update, say so
      const updated = store.get("updated", null);
      if (updated) {
        store.set("updated", null);
        appBuild().then((b) => {
          const msg = `Updated to build ${b || "?"}`;
          if (updated === "asked") openAbout(msg);
          else toast(`iMKS Units: ${msg.toLowerCase()}`);
        });
      }
    }).catch(() => {});
    for (const t of ["keyup", "click"]) document.addEventListener(t, reloadIfIdle);
  }
}

boot();

// for debugging from the console
window.imks = state;
