// Error guidance and source locations: node tests/diagnostics.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCalculator } from "../js/defs.js";
import { describeError } from "../js/diagnostics.js";
import { normalize, parse } from "../js/interp.js";

const data = {};
new Function("window", fs.readFileSync(new URL("../js/data.js", import.meta.url), "utf8"))(data);
const { calc, errors } = createCalculator({ constants: data.IMKS_DATA.constants });
assert.deepEqual(errors, []);
const diagnostic = (src) => {
  const r = calc.run(src);
  assert.equal(r.kind, "error", src);
  return describeError(r, src, calc);
};
const marked = (src) => {
  const { range } = diagnostic(src);
  assert.ok(range, `No source location for ${src}`);
  return src.slice(range.start, range.end);
};

assert.match(diagnostic("sni(30 deg)").hint, /Did you mean “sin”/);
assert.equal(marked("sni(30 deg)"), "sni");
assert.equal(marked("sni(0) + sni(0)"), "sni");
calc.run("observed_value = 2 m");
assert.match(diagnostic("observed_vlaue").hint, /“observed_value”/);
assert.match(diagnostic("Undefined_xyz").hint, /define Undefined_xyz first/);
assert.equal(marked("5[Undefined_xyz]"), "Undefined_xyz");
assert.equal(marked("1 m @ Undefined_xyz"), "Undefined_xyz");
assert.match(diagnostic("1 m + 2 s").message, /Cannot add length and time/);
assert.match(diagnostic("1 m - 2 s").message, /Cannot subtract/);
assert.equal(marked("1 m + 2 s"), "+");
assert.equal(marked("  x = 1 m + 2 s # note"), "+");
assert.equal(marked("2 × (3 + )"), ")");
assert.equal(marked("2 3"), "3");
assert.match(diagnostic("2 3").hint, /operator between separate numbers/);
assert.match(diagnostic("log(2 m)").hint, /reference quantity/);
assert.match(diagnostic("sin(2 m)").hint, /30 deg/);
assert.equal(marked("1 + sin(2 m)"), "sin");
assert.equal(marked("5[m/s"), "[");
assert.match(diagnostic('"unclosed').hint, /same quote/);
assert.match(diagnostic("5 m @").hint, /target unit/);
assert.match(diagnostic("20 °C + 5 °C").hint, /~5 °C/);
assert.deepEqual(diagnostic("(1 + 2").range, { start: 6, end: 6 });
assert.match(diagnostic("(1 + 2").hint, /closing parenthesis/);
assert.deepEqual(diagnostic("2 +").range, { start: 3, end: 3 });

// Preview exceptions and submitted errors carry the same diagnostics.
const src = "1 + sin(2 m)";
let preview;
try { calc.evalNode(parse(normalize(src), calc.env)); } catch (e) { preview = describeError(e, src, calc); }
assert.deepEqual(preview, diagnostic(src));

// Don't underline the wrong character after normalization expands input.
assert.equal(diagnostic("2² + 3 s").range, null);
assert.equal(marked("2² + Undefined_xyz"), "Undefined_xyz");
assert.equal(diagnostic("2026.10.30 + 2 m").range, null);

// Definition offsets must not leak into the caller's expression.
calc.run("bad(x) = x + 1 s");
assert.equal(marked("2 + bad(1 m)"), "bad");
assert.equal(marked("bad(1 m)"), "bad");
assert.equal(describeError("Offline: cannot look up a place", "place(\"Rome\")", calc).hint, "");
assert.equal(calc.run("sin(30 deg)").kind, "value");
assert.equal(calc.run("5 km @ m").kind, "value");
console.log("All diagnostic checks passed");
