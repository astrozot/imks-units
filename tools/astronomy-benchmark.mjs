// node tools/astronomy-benchmark.mjs [baseline-directory]
// An optional baseline directory contains the previous js/astro.js and its
// imports. Measurements concern CPU calculations, not rendering or network.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import * as current from '../js/astro.js';

const baseline = process.argv[2] ? await import(pathToFileURL(path.resolve(process.argv[2], 'js/astro.js'))) : null;
const time = Date.UTC(2026, 10, 1) / 1000;
const cases = {
  '1000 Jupiter system frames': (a) => { for (let i = 0; i < 1000; i++) a.moons('jupiter', time + i * 10); },
  '1000 Saturn system frames': (a) => { for (let i = 0; i < 1000; i++) a.moons('saturn', time + i * 10); },
  '1000 lunar positions': (a) => { for (let i = 0; i < 1000; i++) a.equatorial('moon', time + i * 1000); },
  'One day of all Jupiter moon events': (a) => { for (const n of ['Io', 'Europa', 'Ganymede', 'Callisto']) a.moonEvents(n, time, 1); },
  'Thirty days of Io events': (a) => a.moonEvents('Io', time, 30),
};
const report = { runtime: process.version, unit: 'milliseconds', method: 'Median of 5 warmed runs; baseline and current interleaved; excludes rendering and network', results: {} };
for (const [name, run] of Object.entries(cases)) {
  const measures = { current: [], baseline: [] };
  run(current); if (baseline) run(baseline);
  for (let i = 0; i < 5; i++) for (const [label, a] of [['baseline', baseline], ['current', current]]) {
    if (!a) continue;
    const start = performance.now(); run(a); measures[label].push(performance.now() - start);
  }
  const median = (xs) => xs.length ? Math.round(xs.sort((a, b) => a - b)[2] * 10) / 10 : null;
  report.results[name] = { before: median(measures.baseline), after: median(measures.current) };
  console.log(name, report.results[name]);
}
fs.writeFileSync(new URL('../data/astronomy-performance.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
