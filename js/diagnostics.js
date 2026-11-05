// Turn calculator errors into concise guidance. Suggestions are advisory;
// expressions are never changed automatically.
import { normalize, splitComment } from "./interp.js";

function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[a.length][b.length];
}

function similar(name, names) {
  // A short unknown variable should not produce a long list of unrelated
  // one-letter units. Case-only corrections are useful even for short names.
  return [...new Set(names)].filter((n) => n !== name && Math.abs(n.length - name.length) <= 2)
    .map((n) => ({ n, d: distance(name.toLowerCase(), n.toLowerCase()) }))
    .filter(({ n, d }) => d === 0 || (name.length >= 3 && n.length >= 3 && d <= (name.length >= 6 ? 2 : 1)))
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n)).slice(0, 3).map(({ n }) => n);
}

// Positions refer to normalized input. Only reuse them when normalization
// preserves character positions; dates, superscripts and sexagesimal literals
// may expand into whole expressions, so their offsets must not be guessed.
function originalRange(error, src) {
  const { code } = splitComment(src);
  const text = code.trim();
  const simple = text.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")
    .replace(/[′’]/g, "'").replace(/[″”“]/g, '"');
  if (!error.range || typeof error.source !== "string" || error.source.trim() !== simple || normalize(text) !== simple) return null;
  const offset = code.indexOf(text);
  const leading = error.source.length - error.source.trimStart().length;
  const start = Math.min(text.length, error.range.start - leading), end = Math.min(text.length, error.range.end - leading);
  if (start < 0 || end < start || error.range.end > error.source.length) return null;
  return { start: offset + start, end: offset + end };
}

function namedRange(src, name, within) {
  const { code } = splitComment(src);
  const hits = [...code.matchAll(/[\p{L}_°][\p{L}\p{N}_]*/gu)]
    .filter((m) => m[0] === name && (!within || m.index >= within.start && m.index + name.length <= within.end));
  return hits.length === 1 ? { start: hits[0].index, end: hits[0].index + name.length } : null;
}

function dimension(spec) {
  return ({ m: "length", s: "time", g: "mass", K: "temperature", A: "electric current", mol: "amount of substance", cd: "luminous intensity", "m^2": "area", "m^3": "volume", "m s^-1": "speed", "m s^-2": "acceleration", "1": "a number without units" })[spec] || `[${spec}]`;
}

export function describeError(error, src, calc) {
  const raw = typeof error === "string" ? { message: error } : error;
  const result = { message: raw.message, hint: raw.hint || "", range: originalRange(raw, src) };
  if (raw.message === "Unexpected 'num'") result.message = result.range ? `Unexpected number “${src.slice(result.range.start, result.range.end)}”.` : "Unexpected number.";
  // Online lookups have their own actionable messages and retry behavior.
  if (raw.lookup) return result;
  let m;
  if ((m = /^Unknown (name|function|unit|constant) ['"](.+?)['"](?: in unit)?$/.exec(raw.message))) {
    const [, kind, name] = m;
    const env = calc.env;
    const names = kind === "function" ? [...Object.keys(calc.builtins), ...[...env.vars].filter(([, v]) => v && v.fn).map(([n]) => n)]
      : kind === "unit" ? [...env.units.keys()]
      : kind === "constant" ? calc.const.keys()
      : [...env.vars.keys(), ...env.units.keys(), ...Object.keys(calc.builtins), "pi", "tau", "ans", "today", "now"];
    const matches = similar(name, names);
    result.hint = matches.length ? `Did you mean ${matches.map((n) => `“${n}”`).join(" or ")}? Names are case-sensitive.`
      : kind === "name" ? `Check the spelling, or define ${name} first with ${name} = ….`
      : kind === "function" ? "Check the spelling in ƒ(x), or define this function first."
      : "Check the spelling and capitalization in Reference.";
    // Prefer the exact name to the enclosing unit bracket. Restrict to the
    // engine's location when available to distinguish repeated names.
    result.range = namedRange(src, name, result.range) || result.range;
  } else if ((m = /^Incompatible units(?: in (.+?))?: \[(.*?)\] and \[(.*?)\]$/.exec(raw.message))) {
    const [, op, a, b] = m;
    const verb = ({ sum: "add", difference: "subtract", "±": "combine", mod: "calculate a remainder for" })[op];
    if (verb) result.message = `Cannot ${verb} ${dimension(a)} and ${dimension(b)}.`;
    result.hint = op === "±" ? "The value and its uncertainty must have matching dimensions."
      : "Both quantities must have matching dimensions; check the units on each side.";
  } else if (raw.message === "Cannot solve unit conversion") {
    result.message = "The target units cannot represent this quantity.";
    result.hint = "Choose compatible dimensions: for example, convert length to length (m → km), not to time (s).";
  } else if ((m = /^(?:(.+?): )?[Ee]xpected a pure number, got \[(.*?)\]$/.exec(raw.message))) {
    const trig = /^(sin|cos|tan)$/.test(m[1] || "");
    result.message = `${m[1] || "This operation"} needs ${trig ? "an angle or a number in radians" : "a number without units"}; received ${dimension(m[2])}.`;
    result.hint = trig ? "Use an angle, such as 30 deg or pi/6 rad."
      : "Divide by a reference quantity with the same units to make a dimensionless ratio.";
  } else if (raw.message === "Missing ]") {
    result.hint = "Close the unit bracket with ], as in 5[m/s].";
  } else if (raw.message === "Unterminated string") {
    result.hint = "Close the text with the same quote mark that opened it.";
  } else if (raw.message === "Missing unit after @") {
    result.hint = "Add a target unit, as in 5 km @ m.";
  } else if (raw.message.startsWith("Cannot add two absolute quantities")) {
    result.hint = "For a temperature increase, make the increment relative: 20 °C + ~5 °C.";
  }
  return result;
}
