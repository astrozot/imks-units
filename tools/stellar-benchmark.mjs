// node tools/stellar-benchmark.mjs /path/to/before-checkout
// PLAYWRIGHT and CHROME follow the browser tests. Prints JSON; no app data
// are changed. Desktop CPU throttling approximates a slower device only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* next */ }
}
if (!chromium) throw new Error('Playwright required');
if (!process.argv[2]) throw new Error('Supply a baseline checkout containing js/');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url))), before = path.resolve(process.argv[2]);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  if (url === '/') { res.end('<html></html>'); return; }
  const base = url.startsWith('/before/') ? before : root;
  const filename = path.join(base, url.replace(/^\/(before|after)\//, '/'));
  if (!filename.startsWith(base + path.sep)) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(filename));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const result = await page.evaluate(async () => {
    const versions = {}, bytes = await (await fetch('/data/stars-12.bin')).arrayBuffer();
    for (const label of ['before', 'after']) {
      const a = await import(`/${label}/js/coelum.js`), { skyScene } = await import(`/${label}/js/coelumsky.js`);
      a.setFaintStars(bytes);
      const frame = a.skyFrame(Date.parse('2026-11-11T00:00Z') / 1000, [45, 9, 0]);
      const canvas = document.createElement('canvas'); canvas.width = 390; canvas.height = 844;
      versions[label] = { a, skyScene, frame, ctx: canvas.getContext('2d') };
    }
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const results = [];
    // Interleave baseline/current, reversing order each round, after warmup.
    const sun = versions.after.frame.bodies.find((o) => o.body === 'sun');
    for (const [ra, dec] of [[270, -29], [180, 60], [sun.ra, sun.dec]]) for (const scale of [1, 32, 256]) {
      const measures = { before: [], after: [] };
      for (let i = 0; i < 11; i++) for (const label of i % 2 ? ['after', 'before'] : ['before', 'after']) {
        const { a, skyScene, frame, ctx } = versions[label], o = frame.catalog(ra, dec);
        const view = { scale, rotation: a.lookAt(o.az, o.alt) }, start = performance.now();
        skyScene(frame, 390, 844, { ground: false, atmosphere: false, milkyway: false, deep: false, labels: false, constellations: false, magnitude: 12 }, view, ctx);
        if (i > 1) measures[label].push(performance.now() - start);
      }
      results.push({ ra, dec, scale, ...Object.fromEntries(Object.entries(measures).map(([k, v]) => [k, median(v)])) });
    }
    const playbackResults = {};
    for (const [mode, layers] of Object.entries({ stars: { deep: false, constellations: false }, default: { deep: false, constellations: true, ecliptic: true } })) {
      const measures = { before: [], after: [] };
      for (const v of Object.values(versions)) v.advance = v.a.createSkyAnimator(v.frame.t, v.frame.place, layers);
      for (let i = 0; i < 40; i++) for (const label of i % 2 ? ['after', 'before'] : ['before', 'after']) {
        const v = versions[label], start = performance.now();
        v.advance(v.frame.t + i);
        if (i > 4) measures[label].push(performance.now() - start);
      }
      playbackResults[mode] = Object.fromEntries(Object.entries(measures).map(([k, v]) => [k, median(v)]));
    }
    return {
      cpuSlowdown: 4, viewport: '390x844', stars: versions.after.a.faintCount(),
      method: 'Interleaved before/after medians after warmup; desktop Chromium, no network or catalog loading in measured sections',
      skyCanvasMedianMs: results, playbackUpdateMedianMs: playbackResults,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); server.close(); }
