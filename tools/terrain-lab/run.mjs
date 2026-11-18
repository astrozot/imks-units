// Local research server / automated browser runner. No production app imports.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { providers, difference } from './model.mjs';
import { snapshot } from './snapshot.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const cache = path.resolve(option('--cache', path.join(os.tmpdir(), 'imks-terrain-cache')));
const output = path.resolve(option('--output', path.join(os.tmpdir(), 'imks-terrain-results')));
await fs.mkdir(cache, { recursive: true }); await fs.mkdir(output, { recursive: true });
const pending = new Map();
async function tile(source, z, x, y) {
  const key = `${source}-${z}-${x}-${y}`, filename = path.join(cache, key);
  try { return await fs.readFile(filename); } catch { /* first download */ }
  if (!pending.has(key)) pending.set(key, (async () => {
    const temp = `${filename}.part`, headers = `${filename}.headers`;
    await new Promise((resolve, reject) => {
      const child = spawn('curl', ['-L', '--fail', '--max-time', '30', '--retry', '2', '--silent', '--show-error', '-D', headers, '-o', temp, providers[source].url(z, x, y)]);
      let error = ''; child.stderr.on('data', (s) => { error += s; }); child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) { resolve(); return; }
        const failure = new Error(`curl ${code}: ${error.slice(-300)}`);
        failure.statusCode = Number(/returned error: (\d{3})/.exec(error)?.[1]) || 502;
        reject(failure);
      });
    });
    await fs.rename(temp, filename); return fs.readFile(filename);
  })().finally(() => pending.delete(key)));
  return pending.get(key);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), match = /^\/tile\/(mapzen|mapterhorn)\/(\d{1,2})\/(-?\d+)\/(\d+)$/.exec(url.pathname);
    if (match) {
      const [, source, zz, xx, yy] = match, z = Number(zz), x = Number(xx), y = Number(yy);
      if (z > 15 || y >= 2 ** z) { res.writeHead(400); res.end('Invalid tile'); return; }
      const bytes = await tile(source, z, ((x % 2 ** z) + 2 ** z) % 2 ** z, y);
      res.writeHead(200, { 'content-type': source === 'mapzen' ? 'image/png' : 'image/webp', 'cache-control': 'public, max-age=86400' }); res.end(bytes); return;
    }
    if (/^data\/water\/(?:index|\d+_\d+)\.json$/.test(url.pathname.slice(1))) {
      const data = await fs.readFile(path.join(dir, '../..', url.pathname.slice(1))); res.writeHead(200, { 'content-type': 'application/json' }); res.end(data); return;
    }
    if (url.pathname.startsWith('/results/')) {
      const name = path.basename(url.pathname);
      if (!/^[a-z]+(?:-150)?\.(json|png)$/.test(name)) throw new Error('Invalid result name');
      const data = await fs.readFile(path.join(output, name)); res.writeHead(200, { 'content-type': name.endsWith('.json') ? 'application/json' : 'image/png' }); res.end(data); return;
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (/^js\/[a-z0-9-]+\.js$/.test(name)) {
      const data = await fs.readFile(path.join(dir, '../..', name)); res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(data); return;
    }
    if (!['index.html', 'lab.mjs', 'model.mjs', 'panorama.html', 'panorama.mjs', 'panorama-gl.mjs', 'panorama-model.mjs', 'panorama-worker.mjs', 'surface-io.mjs'].includes(name)) { res.writeHead(404); res.end(); return; }
    const data = await fs.readFile(path.join(dir, name)); res.writeHead(200, { 'content-type': name.endsWith('.html') ? 'text/html' : name.endsWith('.json') ? 'application/json' : 'text/javascript' }); res.end(data);
  } catch (e) { res.writeHead(e.statusCode ?? 502, { 'content-type': 'text/plain' }); res.end(e.message); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(option('--port', '0')), '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}/?proxy=1`;
console.log(`Terrain lab: ${url}\nCache: ${cache}\nResults: ${output}`);
if (args.includes('--serve')) process.on('SIGINT', () => server.close(() => process.exit()));
else {
  let browser;
  try {
    let chromium;
    for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
      try { ({ chromium } = await import(name)); break; } catch { /* next */ }
    }
    if (!chromium) throw new Error('Set PLAYWRIGHT to the playwright-core directory, or use --serve with your own browser');
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
    page.on('console', (message) => { if (message.text().startsWith('Terrain:')) console.log(message.text()); });
    await page.goto(url); await page.waitForFunction(() => window.terrainLab);
    const names = option('--sites', 'riva,chamonix,innsbruck,granada,queenstown').split(',');
    const radius = Number(option('--radius', '60000'));
    for (const name of names) {
      console.log(`Starting ${name}, ${radius / 1000} km`);
      let data = await page.evaluate(async ({ name, radius, detailedMapzen, convergence }) => {
        const site = window.terrainLab.sites[name]; if (!site) throw new Error(`Unknown site ${name}`);
        return window.terrainLab.compare({ ...site, radius, detailedMapzen, convergence });
      }, { name, radius, detailedMapzen: !args.includes('--quick'), convergence: args.includes('--convergence') });
      if (args.includes('--sonny')) {
        const hgtDir = path.resolve(option('--sonny')), files = (await fs.readdir(hgtDir)).filter((n) => /\.hgt$/i.test(n)).map((n) => path.join(hgtDir, n));
        await page.locator('details').first().locator('summary').click();
        await page.locator('#hgt').setInputFiles(files);
        await page.locator('#sonny').click();
        await page.waitForFunction((n) => window.terrainLab.getResult().methods.length > n || document.getElementById('status').textContent.startsWith('Failed:'), data.methods.length, { timeout: 180000 });
        const error = await page.locator('#status').textContent(); if (error.startsWith('Failed:')) throw new Error(error);
        data = await page.evaluate(() => window.terrainLab.getResult());
        try { data.sonnyProvenance = JSON.parse(await fs.readFile(path.join(hgtDir, 'provenance.json'), 'utf8')); }
        catch { data.sonnyProvenance = { dataset: 'User-provided HGT files; version unverified' }; }
        await page.locator('details').first().locator('summary').click();
      }
      const stem = name + (radius === 150000 ? '-150' : '');
      await snapshot(data, path.join(output, stem));
      await page.screenshot({ path: path.join(output, `${stem}.png`), fullPage: true });
      const summary = data.methods.map((m) => ({ name: m.name, eye: m.eye, ground: m.pointGround, bytes: m.bytes, tiles: m.tiles, loadMs: m.loadMs, computeMs: m.computeMs, failed: m.errors?.length ?? 0, missingRays: m.missing.filter((n) => n > 0).length, comparedWithLastReference: difference(m, data.methods.at(-1)) }));
      console.log(JSON.stringify({ name, config: data.config, summary }));
    }
  } finally { if (browser) await browser.close(); server.close(); }
}
