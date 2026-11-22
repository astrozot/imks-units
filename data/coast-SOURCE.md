# Shared globe coastlines

`js/coast.js` is generated from the **Natural Earth 1:10 million coastline**
vector dataset in the `v5.1.2` natural-earth-vector repository snapshot:

https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_coastline.geojson

Source SHA-256:
`6f75ae0e0de157b14946e2255eb1f5486d9a13819032e26d4610852d296788f6`

Natural Earth data is public domain:
https://www.naturalearthdata.com/about/terms-of-use/

Made with Natural Earth. The coastline source includes the Caspian Sea and
major islands. It replaces the former 1:110 million coastline, whose coordinates
were rounded to tenths of a degree.

Mapshaper 0.8.7 prepares spherical Douglas–Peucker generalizations at 250 m,
2 km, and 20 km. All globe renderers share these data. The renderer chooses a
level whose generalization is smaller than a screen pixel; zoomed views use the
250 m data. Coordinates are encoded as integer deltas at 100,000 units/degree,
retaining the source's finer geometry instead of rounding it to a coarse grid.
These thresholds describe simplification, not guaranteed positional accuracy.

Rebuild from the downloaded source:

```sh
mapshaper coast-10m.geojson -simplify dp interval=250m keep-shapes -o fine.geojson
mapshaper coast-10m.geojson -simplify dp interval=2000m -o medium.geojson
mapshaper coast-10m.geojson -simplify dp interval=20000m -o overview.geojson
node tools/coast.mjs fine.geojson medium.geojson overview.geojson
```

Timezone polygons come from a separate OpenStreetMap-derived dataset. Their
marine boundaries can lie offshore, so they do not necessarily coincide with
physical coastline geometry.
