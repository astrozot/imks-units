// Coordinate search navigation; PLAYWRIGHT/CHROME as in browser.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* try next */ }
}
if (!chromium) { console.log('Skipped: Playwright is not installed'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  const checks = await page.evaluate(async () => {
    const { mountCoelum } = await import('/js/coelumui.js');
    const { skyFrame, coordinateTarget, pointVector, dot3 } = await import('/js/coelum.js');
    const model = { t: Date.parse('2026-11-25T21:00:00Z') / 1000, place: [42, 12, 20], label: 'Rome' };
    const frame = skyFrame(model.t, model.place);
    const host = document.createElement('div'); document.body.appendChild(host);
    const explorer = mountCoelum(host, model, String, { standalone: true });
    const input = host.querySelector('.coelum-search input'), svg = host.querySelector('.coelum-full');
    const checks = [];
    for (const mode of ['chart', 'sky']) {
      host.querySelector(`[data-view="${mode}"]`).click();
      // Disable atmospheric bending so both views can be compared directly.
      const atmosphere = host.querySelector('[data-layer="atmosphere"]');
      if (mode === 'sky' && atmosphere?.checked) atmosphere.click();
      for (const [i, query] of ['01:23:45.67 -23:32:13.23', 'GA 12.3453 -23.32132', 'AZ 90 +30'].entries()) {
        explorer.select('Vega');
        input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
        const rows = host.querySelectorAll('.coelum-results [role="option"]');
        if (rows.length !== 1 || !rows[0].textContent.includes(query)) throw new Error(`Missing coordinate result: ${query}`);
        if (i === 1) rows[0].click();
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 900));
        const target = coordinateTarget(frame, query);
        const center = mode === 'chart' ? svg.dataset.rotation.split(',').map(Number).slice(6, 9)
          : pointVector({ az: Number(svg.dataset.az), alt: Number(svg.dataset.alt) });
        if (dot3(center, pointVector(target)) < 1 - 1e-9) throw new Error(`${mode} did not center ${query}`);
        if (host.classList.contains('coelum-has-selection')) throw new Error('Coordinate search retained old selection');
        if (!host.querySelector('.coelum-search-dropdown').hidden) throw new Error('Dropdown stayed open');
        checks.push(`${mode}: ${query}`);
      }
    }
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let copied, failCopy = false;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text) => { if (failCopy) throw new Error('Clipboard denied'); copied = text; },
    } });
    try {
      for (const name of ['Vega', 'M31', 'Sun', 'Moon', 'Jupiter']) {
        explorer.select(name, { details: true });
        const buttons = [...host.querySelectorAll('[data-copy-coordinates]')];
        if (buttons.length < 6) throw new Error(`${name}: coordinate copy controls missing`);
        for (const button of buttons) {
          button.click();
          await Promise.resolve(); await Promise.resolve();
          if (copied !== button.dataset.copyCoordinates) throw new Error(`${name}: wrong clipboard pair`);
          if (host.querySelector('.coelum-toast').textContent !== 'Coordinates copied') throw new Error('Missing copy feedback');
        }
      }
      failCopy = true;
      host.querySelector('[data-copy-coordinates]').click();
      await Promise.resolve(); await Promise.resolve();
      if (host.querySelector('.coelum-toast').textContent !== 'Could not copy coordinates') throw new Error('Missing clipboard failure feedback');
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else delete navigator.clipboard;
    }
    host.remove();
    return checks;
  });
  assert.equal(checks.length, 6);
  console.log('Coordinate search navigation and coordinate clipboard actions passed');
} finally {
  await browser?.close(); await new Promise((r) => server.close(r));
}
