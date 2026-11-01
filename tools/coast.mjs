// Writes js/coast.js, the coastlines of Natural Earth (public domain) at
// 1:110 million, for the maps of the eclipses:
//
//   node tools/coast.mjs <ne_110m_coastline.geojson>
//
// (from github.com/nvkelso/natural-earth-vector, geojson/). Each line is a
// list of longitude, latitude in tenths of a degree, after the first point
// as differences from the one before.

import fs from "node:fs";

const src = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const lines = [];
for (const f of src.features) {
  const g = f.geometry, parts = g.type === "MultiLineString" ? g.coordinates : [g.coordinates];
  for (const part of parts) {
    let px = 0, py = 0;
    const out = [];
    part.forEach(([lon, lat], i) => {
      const x = Math.round(lon * 10), y = Math.round(lat * 10);
      if (i && x === px && y === py) return;
      out.push(i ? x - px : x, i ? y - py : y);
      px = x;
      py = y;
    });
    if (out.length >= 4) lines.push(`[${out.join(",")}]`);
  }
}
fs.writeFileSync(new URL("../js/coast.js", import.meta.url), `// The coastlines of Natural Earth (public domain), 1:110 million, written
// by tools/coast.mjs: for each line, longitude and latitude in tenths of a
// degree, after the first point as differences from the one before.

export const COAST = [
${lines.join(",\n")},
];
`);
console.log(lines.length, "lines");
