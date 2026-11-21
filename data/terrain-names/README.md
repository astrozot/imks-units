Terrain names
=============

Named summits (peaks, volcanoes, hills, mountains) for Coelum's terrain labels,
merged from two sources:

* **OpenStreetMap**: `natural=peak|volcano|hill` nodes with a name.
  © OpenStreetMap contributors, Open Database License 1.0:
  https://www.openstreetmap.org/copyright
* **GeoNames**: feature codes `MT`, `PK`, `HLL`, `VLC` (ranges and groups are
  excluded). Creative Commons Attribution 4.0: https://www.geonames.org/
  (source: https://download.geonames.org/export/dump/allCountries.zip,
  field definitions: https://download.geonames.org/export/dump/readme.txt).

OSM is preferred. It is denser in mountains (around Riva del Garda, 3,015
named summits within 60 km against GeoNames' 785) and its positions are
usually surveyed. A GeoNames record is kept only when no OSM summit lies
within 300 m and no OSM summit with the same name (accents and case ignored)
lies within 1.5 km. `index.json` lists the 10° cells that had OSM input in
`osmTiles`; elsewhere the names are GeoNames only.

Tiles are 10-degree latitude/longitude cells, named `latitudeIndex-longitudeIndex`
from origins -90/-180 degrees. Rows contain:

```
[id, name, latitude, longitude, elevationMetresOrNull, featureCode, source]
```

`source` is `O` (OSM node id) or `G` (geonameId). OSM `natural` values map to
`PK` (peak), `VLC` (volcano) and `HLL` (hill). OSM `ele` is parsed as metres
(feet when marked); GeoNames' coarse DEM field is never substituted for a
recorded elevation. Missing elevations remain null. Longitude is normalized
to [-180,180).

`index.json` (version 2) records each source's licence and count, the
GeoNames source date and SHA-256, feature counts, and the SHA-256 of each
uncompressed tile. The `.json.gz` assets are explicitly gzip-compressed to
keep downloads and offline storage small on static hosting; the client
decompresses them when the server does not provide Content-Encoding. Only
cells within the observer's 150 km surroundings are requested. The global
catalog is not part of the app-shell download.

Regenerate (keep raw inputs outside the repository):

```
# OSM, worldwide: a planet file (or a Geofabrik extract) and osmium-tool
osmium tags-filter planet-latest.osm.pbf n/natural=peak,volcano,hill -o /tmp/peaks.osm.pbf
osmium export /tmp/peaks.osm.pbf -f geojsonseq -o /tmp/peaks.geojsonseq
# GeoNames
curl -O https://download.geonames.org/export/dump/allCountries.zip
python3 tools/terrain-names.py --geonames allCountries.zip --osm /tmp/peaks.geojsonseq data/terrain-names
node tests/terrain-names.mjs
```

`--osm` may be repeated, and also accepts Overpass CSV for a region (see the
tool's help). Regional inputs are fine for experiments; a release should use
whole-planet OSM so every cell gets the same treatment. Output is
deterministic for given inputs, and the index is written last. Deploy the
tiles and index together. A catalog update is picked up through **Download
peak names**; cached names keep working offline across app updates. Computed
sightlines are cached separately for twelve viewpoints, keyed by hashes of
the exact mesh buffers, observer position/elevation and candidate records.

How the app uses the points: each catalogued point climbs the terrain
model's height grid to its summit (at most 250 m, never across a lower
saddle); records reaching the same summit are merged. A summit is named when
nearer terrain hides it by no more than 0.08° (the displayed mesh's own
accuracy) or 5 m, ignoring its own slope within 300 m (or 1% of the
distance) in front of it. Buildings, trees, haze and weather are not part of
these tests; no survey-grade identification is claimed.
