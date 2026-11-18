# Terrain comparison laboratory

This experiment is separate from iMKS and Coelum. It changes no application
imports, assets, service workers, caches or horizon preferences.

Run the local server:

```sh
node tools/terrain-lab/run.mjs --serve --port 8765
```

Open <http://127.0.0.1:8765/?proxy=1>. The proxy downloads only tiles from the
two fixed public elevation providers. Tile bodies and source HTTP headers are
cached under the system temporary directory (`imks-terrain-cache`). No accounts
or credentials are needed. Stop the server with Ctrl-C.

The browser can also open this directory through an ordinary static HTTP server;
omit `?proxy=1` to fetch directly from the providers and test browser CORS support.

Automated comparisons need Playwright (or playwright-core) and Chromium:

```sh
PLAYWRIGHT=/path/to/playwright-core CHROME=/path/to/chromium \
  node tools/terrain-lab/run.mjs --sites riva,chamonix,innsbruck,granada,queenstown
```

Options: `--radius 150000` for full application range (default 60000),
`--output /path/to/results`, `--cache /path/to/tiles`, `--port 8765`.
Use `--quick` to omit the expensive finer-Mapzen download outside the initial
source-isolation experiment. `--convergence` additionally halves azimuth and
distance spacing on Mapterhorn. `--sonny /path/to/hgt-files` imports unzipped
reference tiles after a comparison; place the source/version information in
`provenance.json` alongside them.
The runner writes JSON with complete profiles, coverage, observer elevations,
tile counts, encoded payload sizes, download/decode times and compute times,
plus a full-page PNG and a self-contained HTML viewer. Results default to
`imks-terrain-results` in system temp.
Import a saved JSON in the page to inspect results without downloading again.
With the local server, `?proxy=1&result=riva` opens `riva.json` from the output
directory. A standalone HTML snapshot opens directly without a server.

Validation:

```sh
node tools/terrain-lab/test.mjs
```

Browser checks (with the same PLAYWRIGHT/CHROME environment):

```sh
node tools/terrain-lab/browser-test.mjs /path/to/results/riva.html
```

Append `--cors` to test direct browser fetches against one public tile per provider.
`snapshot.mjs OUTPUT_DIR INPUT.json ...` packages older recorded runs into compact
JSON and standalone HTML using the latest viewer, without downloading terrain.

## Comparison design

1. Current Mapzen implementation, including its observer-height heuristic,
   300 m start distance, 2.5% distance steps, edge clamping and 0.5° azimuths.
   Uses the selected radius instead of hardcoding 150 km. Browser image decoding
   preserves RGB bytes explicitly. No production localStorage is used.
2. Same Mapzen tile levels, explicit observer height, 20 m start, distance steps
   of 0.75 tile pixels, cross-tile interpolation and 0.05° azimuths.
3. Same corrected computation, finer Mapzen tiles matching Mapterhorn tile pixel
   spacings. This isolates the effect of requesting coarse tiles.
4. Mapterhorn with the same sampling and pixel spacing as (3). Native source
   resolution can be coarser than the tile pixels; oversampling adds no detail.

Blank elevation uses Mapterhorn terrain at the exact viewpoint for the common
ground elevation. Each method adds 2 m eye height; the current method additionally
applies its existing maximum-nearby-ground heuristic. This is an experimental
height reference, not a surveyed height. Vertical datums must be checked before
interpreting source differences as accuracy. Curvature/refraction are held fixed.

The distance-shaded preview retains the nearest surface visible at each vertical
angle. It demonstrates depth layering; it does not implement terrain normals,
sun shadows, textures or vegetation. Fine ray spacing is not proof of convergence.

## Independent references

The page accepts unzipped Sonny HGT files. Obtain them from
<https://sonny.4lima.de/> (CC BY 4.0); select every 1° tile intersecting the
comparison circle. Missing tiles/voids stay explicit and are excluded from
statistics. Imported HGT byte counts are uncompressed local file sizes, not
network payload. Files stay in the browser. Source versions/provenance must be
recorded alongside any saved comparison.

PeakFinder offers “Horizon for Stellarium” export. The importer accepts plain
azimuth/elevation pairs in degrees, north=0 east=90. Ensure export viewpoint,
eye height and azimuth convention agree. Its use of Sonny does not make a locally
computed Sonny profile identical to PeakFinder's renderer.

No photograph, surveyed skyline or PeakFinder export is bundled. Model differences
are not absolute errors. Only the Riva coordinates were supplied by the user;
the other test points are representative town locations, not calibrated viewpoints.

Mapterhorn can return empty/transparent higher-zoom tiles outside detailed regional
coverage. Its sampler explicitly tries lower downloaded zooms when this happens,
recording fallback counts and zoom transitions in `samplingCoverage`. This uses
the same provider's global baseline; it does not fill Sonny reference gaps.
The Chile/Atacama preset exercises this behavior. Sampling at fine pixel intervals
does not make the lower-resolution baseline more detailed.

## Data and attribution

- Mapzen/AWS: <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>
- Mapterhorn: <https://mapterhorn.com/data-access/> and
  <https://mapterhorn.com/attribution/> (retain underlying source notices).
- Sonny: <https://sonny.4lima.de/>, CC BY 4.0.
- PeakFinder source credits: <https://www.peakfinder.com/about/resources/>.

Large terrain downloads and generated results are kept outside the repository.
No production integration decision should be based solely on inter-model agreement.

## Shaded surface panorama (18 November 2026)

With the same server running, open
<http://127.0.0.1:8765/panorama.html?proxy=1> and choose **Build panorama**.
The screenshot viewpoint is **45.89617, 10.84333, 90 m eye elevation**. This is
an additional preset in the panorama; the earlier Riva comparison coordinates
and recorded results are unchanged. All times in the new controls are **UTC**.

The isolated prototype implements:

- Mapterhorn surfaces or imported Sonny HGT surfaces, with the same camera and
  lighting controls. Imports need every HGT tile intersecting the local square.
- Four nested grids spanning ±1/4/16/64 km in local east/north coordinates,
  Earth curvature/refraction as in the existing lab, surface normals, matched
  mesh boundaries, depth occlusion, ridge outlines, and distance haze.
- Actual Sun/Moon directions using read-only imports of the application’s
  astronomy modules. No production source file, import or cache is modified.
- Two directional depth shadow maps (2048² each), retaining off-camera casters.
  They are reused during camera movement and regenerated for light changes.
  The dominant source is Sun in daylight/twilight and Moon below −6° Sun altitude.
- Nonlinear lunar phase brightness (Krisciunas & Schaefer 1991 phase law), lunar
  inverse-square distance, approximate clear-sky extinction, and a fixed night
  exposure. This is a visual illumination approximation, not a calibrated
  prediction of landscape luminance or human night vision.
- General blue ocean/major-lake materials from Natural Earth; islands remain land and DEM heights stay unchanged.
- Worker download/build with cancellation; drag/scroll camera; PNG/metrics
  export; compact typed-buffer surface export/import for offline inspection.
  Surface files retain their source metadata; version 1 decimal-array imports
  remain supported. Standard surfaces export at roughly 71 MB, so they are
  intentionally kept outside the repository. Restore needs the local page and
  astronomy modules, but requires no terrain downloads.

The **eye height is never automatically raised**. At this viewpoint Mapterhorn
reports 91 m, one metre above the screenshot’s 90 m eye. Compare 90 m with 92 m
for the alternative “90 m ground + 2 m eye” convention. The configurable near
field defaults to excluding 100 m (20–300 m control); a neutral foreground fills
unmodelled downward views. This explicitly trades away local obstructions for a
mountain panorama. Neither it nor the depth preview is a validated close-range
visibility model. Normal detail follows the mesh spacing, not native tile pixels.

Current water coloring uses general Natural Earth ocean and major-lake data,
with no regional overrides or supplied lake levels. The source is generalised at
1:10 million cartographic scale, not 10 m accuracy. The previous Garda-only
experiment is retained only as historical research artifacts; it is no longer
loaded, packaged, or used to build the default panorama. Water changes material
only and never alters source DEM elevations. See `prepare-global-water.py` for
reproducible tiling and `data/water/index.json` for source hashes and versions.

The shadow maps have finite coverage and resolution. Terrain outside the loaded
square cannot cast shadows. Very low Sun/Moon, height-datum offsets, source seams,
refraction, cloud cover, snow, vegetation, artificial light, indirect reflected
light and eclipse illumination require further work. No PeakFinder parity claim
is made from visual similarity alone. There is no production integration yet.

Validation:

```sh
node tools/terrain-lab/test.mjs
node tools/terrain-lab/panorama-test.mjs
PLAYWRIGHT=/path/to/playwright-core CHROME=/path/to/chromium \
  node tools/terrain-lab/panorama-browser-test.mjs \
  'http://127.0.0.1:8765/panorama.html?proxy=1' /tmp/panorama-verification
```

The browser check downloads/builds the real Riva surface, compares shadow-on/off
pixel values, checks moonlit versus near-new-Moon nights, verifies zero terrain
requests during camera/lighting changes, restores a saved surface with tile
requests blocked, rejects an invalid import, exercises cancellation, and checks
390 px viewport layout. GPU submission timings are **not** GPU frame timings;
readback timings include automation and synchronisation. A desktop phone-sized
viewport does not establish physical-phone performance.

### Independent iPhone test

A separate, owner-private copy is published with Sites at:
<https://riva-terrain-iphone-lab.milano-stata-3371.chatgpt.site>

Open it in Safari on the phone, then choose **Load Riva panorama**. The hosted
copy includes an approximately 18 MB prepared Preview surface (499,712
triangles). The computer can be disconnected or switched off. Changing lighting
and moving the camera require no terrain-provider requests. **Build panorama**
is still available for fresh source computations, but it uses the external
terrain provider and is separate from the prepared test path.

The exact static bundle passed loading and light-change checks in desktop
WebKit and Chromium at 390 px, with zero external requests and zero WebGL errors.
This remains a compatibility check, not physical-iPhone performance validation.

To prepare another isolated static copy, save a Preview surface and run:

```sh
node tools/terrain-lab/prepare-phone-site.mjs /tmp/terrain-phone/dist \
  /path/to/terrain-surface.json
```

The preparer copies only the panorama's local dependencies and prepared surface,
preserves source notices, and adds the **Load Riva panorama** action. It does not
publish or modify the production application. The private Site's hosting identity
and deployment checkout are separate from this application repository.

### Appearance preferences

Following the successful physical-iPhone test, the defaults are **Muted earth**,
**terrain shadows enabled**, **ridge outlines disabled**, and both brightness sliders **centred**. The neutral daylight and night settings
retain the previously approved brightness (approximately 1.62× day, 4× night
as internal multipliers), with night exposure used below −6° Sun altitude. Choosing
a night example does not overwrite the separate daylight setting.

The **Appearance options** button opens a modal with both exposure sliders,
appearance, shadow and outline switches, and **Restore defaults**. Preferences
are stored in this browser/device's localStorage; if storage is unavailable,
they still work during the current session. Modal layout, saved settings,
restoring defaults, automatic exposure switching, and no extra requests during
lighting changes were checked in desktop WebKit and Chromium at 390 px.


### Current follow-up stages

Peak labels are a separate next stage: use a general peak catalog, test visibility
against the DEM rather than bearing alone, avoid overlapping labels, and show
labels in daylight. No single-location peak list is planned.

Optional satellite coloring is feasible using a separate imagery texture over the
same terrain. Copernicus Sentinel-2 offers free 10 m imagery and cloud-free mosaic
products: useful for broad vegetation, rock, snow and shore color, but visibly
limited at close zoom. Imagery needs cloud/shadow handling and consistent color;
captured terrain shadows should not be multiplied by animated Sun shadows.
The image is a dated surface appearance, not a prediction of snow or vegetation
for an arbitrary simulated date. Keep the existing shaded material available.
Sources: https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2
and https://documentation.dataspace.copernicus.eu/Data/Sentinel2.html .
