// Fetch streams contain decoded bytes even when Content-Length is compressed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../js/coelumui.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const appFile ='), source.indexOf('// The sky view\'s camera'))
  .replace('import.meta.url', "'https://example.test/js/coelumui.js'");
const file = fs.readFileSync(new URL('../data/stars-8.bin', import.meta.url));
for (const headerSize of [Math.floor(file.length / 3), file.length, null]) {
  const percentages = [], stored = [];
  let short = false, loaded = 0;
  const context = vm.createContext({ URL, Blob, Response,
    setFaintStars: (data) => { loaded = data.byteLength; },
    caches: { open: async () => ({ put: async (_, response) => stored.push((await response.arrayBuffer()).byteLength) }) },
    fetch: async () => {
      const quarter = file.length / 4, chunks = [file.subarray(0, quarter), file.subarray(quarter, 2 * quarter), file.subarray(2 * quarter, short ? file.length - 1 : file.length)];
      return { ok: true, headers: { get: () => headerSize }, body: { getReader: () => ({ read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true } }) } };
    },
  });
  vm.runInContext(code + '\nthis.download = downloadFaintStars;', context);
  for (const [limit, { bytes }] of Object.entries(vm.runInContext('STAR_FILES', context))) {
    assert.equal(bytes, fs.statSync(new URL(`../data/stars-${limit}.bin`, import.meta.url)).size, 'Progress totals match the actual catalog files');
  }
  await context.download('8', (fraction) => percentages.push(Math.floor(fraction * 100)));
  assert.deepEqual(percentages, [25, 50, 99, 100], 'Progress follows decoded catalog size, irrespective of transfer headers');
  assert.equal(loaded, file.length); assert.deepEqual(stored, [file.length]);
  short = true; loaded = 0; percentages.length = 0;
  await assert.rejects(context.download('8', (f) => percentages.push(f)), /unexpected size/);
  assert.equal(loaded, 0, 'An incomplete download never replaces the current catalog');
  assert.ok(percentages.every((f) => f < 1));
}
console.log('Catalog progress: compressed, uncompressed, missing length and truncated downloads passed');
