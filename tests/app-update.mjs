// Exercise update decisions without downloading the whole offline shell.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../js/coelumui.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const workerVersion ='), source.indexOf('// Kept separate')).replace('export async function', 'async function');
for (const scope of ['/', '/coelum/']) {
  for (const scenario of ['same', 'new', 'offline', 'failed', 'unknown']) {
    const prefix = scope === '/' ? 'imks-v' : 'coelum-v';
    const worker = (version) => ({ state: 'activated', scriptURL: 'http://localhost/sw.js', postMessage: (_, ports) => ports[0].postMessage(version) });
    let updates = 0, reloads = 0;
    const reg = { scope: `http://localhost${scope}`, active: worker(prefix + '103'), async update() { updates++; if (scenario !== 'failed') this.active = worker(prefix + '104'); } };
    const reports = [], storage = new Map();
    const context = vm.createContext({
      MessageChannel, URL, setTimeout: (fn, ms) => setTimeout(fn, ms === 1500 ? 10 : ms), clearTimeout,
      navigator: { serviceWorker: { controller: reg.active, getRegistration: async () => reg } },
      sessionStorage: { setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
      fetch: async () => { if (scenario === 'offline') throw new Error('offline'); return { ok: true, text: async () => scenario === 'unknown' ? 'invalid' : 'const CACHE = `${APP}-v' + (scenario === 'same' ? '103' : '104') + '`;' }; },
    });
    vm.runInContext(code + '\nthis.update = forceAppUpdate;', context);
    const run = () => context.update(() => reloads++, (message) => reports.push(message));
    if (['offline', 'failed', 'unknown'].includes(scenario)) {
      await assert.rejects(run());
      assert.equal(reloads, 0);
      assert.equal(storage.size, 0);
    } else {
      await run();
      assert.equal(reloads, scenario === 'new' ? 1 : 0);
      assert.equal(updates, scenario === 'new' ? 1 : 0);
      assert.match(reports[0], new RegExp(`Current version: ${prefix}103`));
      assert.match(reports.at(-1), scenario === 'new' ? /New version: .*104/ : /no update required/);
      if (scenario === 'new') assert.match(reports[1], /Update required/);
    }
  }
}
console.log('App update: current/new builds, offline, failed install and unknown version passed for both apps');
