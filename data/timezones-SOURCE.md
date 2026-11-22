# Geographic timezone boundaries

`timezones.topo.json` is a derived geographic polygon database from
[Timezone Boundary Builder, release 2026f](https://github.com/evansiroky/timezone-boundary-builder/releases/tag/2026f),
using its comprehensive `timezones-with-oceans.geojson.zip` product. It includes
separate IANA zones rather than merging areas that currently share an offset.

Source archive:
https://github.com/evansiroky/timezone-boundary-builder/releases/download/2026f/timezones-with-oceans.geojson.zip

SHA-256:
`838b3c9161e09ee944edb64cc4d9e4d2eb3ad0a3ec3d8d6a1520a5f8f6e21ac9`

Attribution: Timezone Boundary Builder; © OpenStreetMap contributors.
The source data and this derived database are licensed under
[ODbL 1.0](timezones-LICENSE.txt). Code elsewhere in this repository retains
its own license.

The published polygons use OpenStreetMap administrative and timezone boundaries.
They are generalized with Mapshaper 0.8.7, using spherical Douglas–Peucker
simplification with a 250 m threshold and shared topology, then exported as
TopoJSON with quantization 1,000,000. Adjacent polygons share the same arcs.
Interior label points are generated from the generalized polygons.
The original geographic boundaries are preserved to map-display resolution;
these are not contours reconstructed from a sampled timezone lookup grid.
The globe overlay and map selection both use these bundled polygons.

Rebuild with Python 3 and Mapshaper 0.8.7:

```sh
python3 tools/timezones.py --mapshaper /path/to/mapshaper
```

An existing source download can be supplied with `--archive /path/to/archive.zip`.
The builder checks its pinned SHA-256 before conversion. The generated TopoJSON
contains the source version, license, archive checksum, and build parameters.

These are a modern geographic snapshot, not historical national or timezone
boundaries for every date the astronomy app supports. Upstream documents some
approximate or overlapping areas, particularly offshore. Browser timezone rules
continue to determine the UTC offset for the selected date.

The France–Spain overlap near 42.48° N, 3.37° E is present in the original
release. Its `expectedZoneOverlaps.json` explicitly allows the disputed Gulf
of Lion marine area to belong to both Europe/Madrid and Europe/Paris. The
picker preserves such source overlaps and asks the user to choose a zone;
it does not silently treat the first polygon as an unambiguous selection.
