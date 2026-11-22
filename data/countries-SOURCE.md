# Shared country boundaries

`js/countries.js` contains Natural Earth **1:10 million Admin 0 land boundary
lines**, from the `v5.1.2` natural-earth-vector repository snapshot:

https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_boundary_lines_land.geojson

Source SHA-256:
`74d9c16229c095fde65943a9919e337682f044bcebccb120764f38edf3b70f4a`

Natural Earth is public domain. Its default boundary linework represents
its documented de facto worldview. These are country land boundaries;
coastlines remain in the separately sourced shared coastline layer.

https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-boundary-lines/
https://www.naturalearthdata.com/about/terms-of-use/

Prepared with Mapshaper 0.8.7 using spherical Douglas–Peucker simplification
at 250 m, 2 km, and 20 km, then integer delta encoding at 100,000 units/degree.
Display detail adapts to zoom; the original source is geographic linework.
These thresholds describe generalization, not guaranteed positional accuracy.

```sh
mapshaper countries.geojson -simplify dp interval=250m -o countries-fine.geojson
mapshaper countries.geojson -simplify dp interval=2000m -o countries-medium.geojson
mapshaper countries.geojson -simplify dp interval=20000m -o countries-overview.geojson
node tools/coast.mjs --countries countries-fine.geojson countries-medium.geojson countries-overview.geojson
```

The boundaries appear in interactive GPU globes, SVG fallback globes, and
static eclipse/occultation previews. No political boundary is inferred from a
coordinate grid or a timezone's current UTC offset.
