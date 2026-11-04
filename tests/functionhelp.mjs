// Check documentation coverage and the calling forms most easily confused.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { functionHelp, functionHelpNames } from '../js/functionhelp.js';
import { functionDocs } from '../js/interp.js';
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const sections = app.slice(app.indexOf('const FN_SECTIONS ='), app.indexOf('const USAGE ='));
const offered = [...sections.matchAll(/fn: "([^"]+)"|"f:([^"(]+)\("/g)].map((m) => m[1] || m[2]);
for (const name of new Set([...offered, ...Object.keys(functionDocs)])) {
  assert.ok(functionHelpNames.includes(name), `Missing documentation for ${name}`);
}
for (const name of functionHelpNames) {
  const doc = functionHelp(name, functionDocs[name] || name);
  assert.ok(doc.signatures.length && doc.returns && Object.keys(doc.args).length, `Incomplete help for ${name}`);
  assert.ok(!doc.description.startsWith(name + ':'), `Redundant name prefix for ${name}`);
  assert.notEqual(doc.description, name, `Missing opening summary for ${name}`);
  assert.ok(!/[\p{L}_][\p{L}\p{N}_]*\(/u.test(doc.description), `Calling example in the opening description for ${name}`);
  for (const note of doc.notes) {
    assert.match(note, /^[A-Z]/, `Note must begin with a capital letter: ${name}`);
    assert.match(note, /[.!?]$/, `Note must end with punctuation: ${name}`);
  }
  for (const signature of doc.signatures) {
    const stack = [];
    for (const c of signature) {
      if ('(['.includes(c)) stack.push(c);
      if (')]'.includes(c)) assert.equal(stack.pop(), c === ')' ? '(' : '[', `Unbalanced signature: ${signature}`);
    }
    assert.equal(stack.length, 0, signature);
  }
}
assert.deepEqual(functionHelp('Gamma').signatures, ['Gamma(x)', 'Gamma(k, theta)']);
assert.deepEqual(functionHelp('occultation').signatures, ['occultation(front, target, t[, place])']);
assert.match(functionHelp('occultation').args.place, /Settings/);
assert.match(functionHelp('radec').args.place, /Earth’s center/);
assert.match(functionHelp('refract').args.alt, /radians/);
assert.match(functionHelp('ymd').args.calendar, /Gregorian/);
assert.equal(functionHelp('sqrt', 'sqrt(x): square root; works on units too').description, 'Square root of x.');
assert.equal(functionHelp('sunrise', functionDocs.sunrise).description, 'The next sunrise after t.');
assert.deepEqual(functionHelp('gcd', 'Greatest common divisor; gcd(12, 18) = 6').notes, []);
assert.match(functionHelp('roots').notes.join(' '), /Roots closer together.*may be missed\./);
assert.equal(functionHelp('altaz', functionDocs.altaz).notes.length, 1, 'Do not split notes inside parentheses');
assert.deepEqual(functionHelp('sunrise', 'Description; with a third argument'), functionHelp('sunrise', functionDocs.sunrise), 'Notes must not depend on fragments in the usage text');
const own = functionHelp('speed', '', { fn: { params: ['d', 't'] }, doc: 'Mean speed', src: 'd/t' });
assert.deepEqual(own.signatures, ['speed(d, t)']);
assert.equal(own.description, 'Mean speed');
assert.deepEqual(own.notes, []);
assert.equal(own.definition, 'd/t');
console.log(`Function help checks passed (${functionHelpNames.length} functions)`);
