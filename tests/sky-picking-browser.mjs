import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* next */ }
}
if (!chromium) throw new Error('Install Playwright or set PLAYWRIGHT');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', path.extname(file) === '.js' ? 'text/javascript' : 'text/html');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**', route => route.abort());
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  const result = await page.evaluate(async () => {
    const { skyFrame } = await import('/js/coelum.js');
    const { skyScene, nearbySkyObjects } = await import('/js/coelumsky.js');
    const frame = skyFrame(Date.parse('2026-11-20T00:00:00Z') / 1000, [42, 12, 0]);
    frame.stars = []; frame.deep = []; frame.constellations = []; frame.barycenters = [];
    frame.bodies = frame.bodies.filter(o => o.body === 'sun' || o.body === 'moon').map(o => ({ ...o, alt: -80, az: 0 }));
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d'), layers = { atmosphere: false, ground: false, milkyway: false };
    const view = { az: 180, alt: 60, scale: 1, selected: null };
    const draw = () => skyScene(frame, 640, 480, layers, view, ctx);
    const limit = draw().light.limit;
    frame.stars = [
      { name: 'faint', alt: 60, az: 180, mag: limit - 0.5, type: 'star', named: true },
      { name: 'bright', alt: 60, az: 180.4, mag: limit - 4, type: 'star', named: true },
    ];
    view.selected = 'faint';
    const scene = draw(), faint = scene.objects.find(o => o.name === 'faint');
    const bright = scene.objects.find(o => o.name === 'bright');
    const pick = nearbySkyObjects(scene.objects, faint)[0]?.o.name;
    frame.stars = [frame.stars[0]];
    const empty = nearbySkyObjects(draw().objects, faint).length;
    // The same catalogue object becomes a deliberate target when magnified.
    view.scale = 16;
    const zoomed = draw().objects.find(o => o.name === 'faint');
    return { faint: faint.pickable, bright: bright.pickable, pick, empty,
      label: scene.hitLabels.some(l => l.name === 'faint'), zoomed: zoomed.pickable };
  });
  assert.deepEqual(result, { faint: false, bright: true, pick: 'bright', empty: 0, label: false, zoomed: true });
  assert.deepEqual(errors, []);
  console.log('Rendered sky visibility, labels, zoom and blend picking passed');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
