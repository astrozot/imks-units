// Package recorded runs as compact JSON and a self-contained, inspectable HTML.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
export function compact(data) {
  for (const method of data.methods) {
    if (!method.bands) continue;
    const width = Math.min(1800, method.bands.length), columns = [];
    for (let x = 0; x < width; x++) {
      const bands = method.bands[Math.floor(x / width * method.bands.length)]; let b = 0;
      const column = [];
      for (let y = 0; y < 300; y++) {
        const alt = -5 + y / 300 * 50;
        while (b < bands.length && bands[b][0] < alt) b++;
        column.push(b === bands.length ? 0 : Math.round(bands[b][1]));
      }
      columns.push(column);
    }
    method.depthRaster = { width, height: 300, lo: -5, hi: 45, columns }; delete method.bands;
  }
  return data;
}
export async function snapshot(data, stem) {
  compact(data);
  const model = (await fs.readFile(path.join(dir, 'model.mjs'), 'utf8')).replace(/^export /gm, '');
  const lab = (await fs.readFile(path.join(dir, 'lab.mjs'), 'utf8')).replace(/^import .*?;\n/, '').replace(/^export /gm, '');
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = (await fs.readFile(path.join(dir, 'index.html'), 'utf8')).replace('<script type="module" src="lab.mjs"></script>', () => `<script type="module">\n${model}\n${lab}\nwindow.terrainLab.setResult(${serialized});\ndocument.getElementById('status').textContent = 'Saved comparison. No downloads are needed to inspect these results.';\n</script>`);
  await fs.writeFile(`${stem}.json`, JSON.stringify(data)); await fs.writeFile(`${stem}.html`, html);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2]); await fs.mkdir(output, { recursive: true });
  for (const filename of process.argv.slice(3)) {
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));
    await snapshot(data, path.join(output, path.basename(filename, '.json')));
    console.log(`Packaged ${path.basename(filename)}`);
  }
}
