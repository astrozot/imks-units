# Terrain evaluation — 9 November 2026

Recommendation: use Mapterhorn as the leading candidate for a shared European /
global terrain provider. At the supplied Riva viewpoint it agrees far more closely
with Sonny's LiDAR-derived European reference than our present Mapzen result.
Finer sampling alone does not explain the improvement. Production integration is
not part of this experiment, and neither app has been modified.

## Riva: source and sampling comparison

Viewpoint: **45.89615, 10.84330**, supplied by the user. Ground elevation was not
supplied: the experiment uses Mapterhorn's point terrain height, **91 m**, giving a
common eye height of **93 m**. This height and its vertical datum are unverified.
The existing observer-height heuristic instead raises the eye to **95.27 m**.

The reference consists of four original Sonny Italy DTM 1 arc-second v2b tiles
(2024-04-28): N45E010, N45E011, N46E010, N46E011. All were downloaded through the
public folder linked from Sonny's site, ZIP-checked, decoded as big-endian HGT,
and cover the complete 60 km comparison circle. The source README confirms
Trentino's input includes PAT LiDAR, resampled to 1 arc-second. It also says
national height systems are retained without vertical-datum unification.

Absolute angular differences from our horizon computed from Sonny:

| Method | Mean | 95th percentile | Maximum | Encoded tile payload |
|---|---:|---:|---:|---:|
| Existing Mapzen algorithm | 0.465° | 2.277° | 3.645° | 3.36 MB |
| Mapzen, corrected sampling and eye height | 0.439° | 2.199° | 3.586° | Same tiles |
| Mapzen, finer tiles and corrected sampling | 0.422° | 2.199° | 3.570° | 53.43 MB |
| Mapterhorn, detailed sampling | **0.039°** | **0.153°** | **0.518°** | **14.53 MB** |
| Mapterhorn, doubled angular and radial sampling | 0.041° | 0.160° | 0.521° | Same tiles |

There are no missing distance samples in any Riva ray in the final reference run.
Sonny's four ZIPs total 51.60 MB; decoded HGT files total 103.74 MB. These are
reference-dataset file sizes, not an estimate of a tiled production service.

The largest old-versus-Mapterhorn discrepancy is about **3.79° at azimuth 199.85°**;
the Mapterhorn skyline there is approximately 14.02° high, with terrain about
2.71 km away. It is a nearby source-data difference, rather than a distant peak
lost through coarse outer rings.

Halving both angular and radial intervals changes the Mapterhorn profile by
mean **0.0041°**, p95 **0.0181°**, maximum **0.1262°**. This supports the initial
settings for evaluation but does not prove complete convergence, especially at
narrow peaks. The slightly greater disagreement of the finer result with Sonny
is compatible with their different terrain resolutions; Sonny is not ground truth.

## Sampling and cost

The experimental detailed Mapterhorn rings use 512-pixel tiles:

| Range | Zoom | Pixel spacing at Riva |
|---|---:|---:|
| 20 m–2 km | 14 | 3.32 m |
| 2–10 km | 12 | 13.30 m |
| 10–60 km | 11 | 26.60 m |
| 60–150 km | 10 | 53.20 m |

Pixel spacing is not the native dataset resolution. Mapzen comparisons use one
zoom level higher for equivalent pixels in its 256-pixel images. The original
sampling-only comparison retains the application's old zoom 12/10/8 rings.

Corrected rays begin at 20 m, with radial steps of 0.75 pixels and azimuths every
0.05°. The convergence check uses 0.375 pixels and 0.025°. Earth curvature and
the existing refraction coefficient 0.13 are held constant. Both methods add 2 m
to the common ground height; the original applies its nearby-ground maximum too.

At 60 km, Mapterhorn requires **125 tiles / 14.53 MB**; tracing takes about
**13–15 seconds** on this desktop Chromium run. Finer Mapzen requires **446 tiles /
53.43 MB** and about 13 seconds tracing. The current algorithm traces in about
0.04 seconds. These are deliberately simple CPU experiments, not mobile production
performance figures. A production implementation needs worker/GPU evaluation,
responsive progress, cancellation, persistent caching and memory limits.

At the full application range of **150 km**, Mapterhorn requires **269 tiles /
31.98 MB** and about **19.5 seconds** tracing. The skyline is unchanged from the
60 km result at this particular viewpoint; nearer terrain blocks the distant
landscape. This is not a justification for reducing the worldwide search radius.

Initial Mapterhorn download/decode time at Riva was approximately 27 seconds;
cached reload was about 0.5 seconds. Network timings varied substantially, so
these runs do not establish provider throughput or service availability guarantees.

## Broader coverage checks

All locations use a common ground height taken from Mapterhorn, with explicit
warnings where that puts the eye below another model's point terrain. The
following comparisons use 60 km circles and no independent real-world references:

| Test location | Mapterhorn tiles | Tile payload | Mean difference from current skyline | Missing terrain rays |
|---|---:|---:|---:|---:|
| Riva | 125 | 14.53 MB | 0.480° | 0 |
| Chamonix | 125 | 16.37 MB | 0.496° | 0 |
| Innsbruck | 128 | 16.04 MB | 0.156° | 0 |
| Granada | 106 | 11.05 MB | 0.397° | 0 |
| Queenstown, New Zealand | 109 | 11.51 MB | 0.580° | 0 |
| San Pedro de Atacama, Chile | 80/86 requested | 5.63 MB | 0.071° | 0 after fallback |

The Chile test deliberately exercises the global baseline outside Mapterhorn's
listed detailed national sources. Six requested zoom-14 tiles returned upstream
HTTP 404. The initial prototype stopped because its observer tile was unavailable.
Explicit fallback to already-downloaded zoom-12 data then completed every ray:
4,327,201 of 22,341,601 sample queries used zoom 12 instead of zoom 14. This is
coarser terrain coverage, not newly recovered fine detail. The final sampler
records fallback counts/transitions and the local proxy preserves upstream HTTP
error codes. The original failed run's generic HTTP 502 entries in the saved
Chile JSON are proxy translations of those source 404s, confirmed in cached headers.

At Chamonix the common 1037.38 m eye lies below Mapzen's 1041.17 m point terrain.
Starting rays at 20 m therefore creates local obstructions in the old data;
correcting sampling alone increases, rather than decreases, disagreement with
Mapterhorn. Observer height, surface objects and datum/source offsets must be
handled deliberately rather than silently raising the observer to nearby slopes.
The Chile point exhibits the same issue: the common eye is 2440.46 m while Mapzen's
point surface is 2442.47 m. Sampling-only disagreement there is therefore not a
useful accuracy ranking.

Direct browser fetches of one tile from each service passed initial CORS checks.
A later repeat returned generic browser fetch failures for both services, while
immediate command-line HEAD requests returned HTTP 200 and Mapterhorn explicitly
returned `Access-Control-Allow-Origin: *`. The cause of that browser failure was
not established. The local proxy and saved offline viewer are verified; direct
fetch reliability should be checked again from the eventual application origin.
The baseline reproduction also matches the production `computeHorizon` routine
on a synthetic constant-elevation dataset. Model tests cover geometry, interpolation
across tile boundaries, HGT decoding, missing samples and observer-height handling.
The standalone viewer passes browser checks for offline rendering, inspection,
JSON export/import and mobile layout.

## What the experiment establishes

- Mapterhorn is a practical tiled source with substantially better agreement
  with the PeakFinder-associated European source family at the supplied viewpoint.
- A 20–30 m LiDAR-derived reference can produce a much better skyline than the
  old source even before adopting sub-metre terrain.
- The depth preview retains overlapping ridges and distance haze. It is not yet
  slope lighting, cast shadows or a finished mountain renderer.
- Agreement between Mapterhorn and Sonny is not independent absolute validation:
  they can share original surveys. No matched PeakFinder horizon export or
  photograph from this precise viewpoint was available. The viewer supports a
  PeakFinder Stellarium-horizon import for that next comparison.
- National height references, cross-border seams, polar regions and sparse-data
  regions require additional validation before claiming uniform worldwide accuracy.

## Sources and reproduction

- [Mapterhorn coverage](https://mapterhorn.com/),
  [tile access](https://mapterhorn.com/data-access/),
  [attribution](https://mapterhorn.com/attribution/).
- [Sonny DTM collection, CC BY 4.0](https://sonny.4lima.de/).
- [PeakFinder source credits](https://www.peakfinder.com/about/resources/).
- [Mapzen source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

See [README.md](README.md) for commands, methods and artifact formats. Generated
terrain caches and comparison snapshots are outside the repository in temporary
directories. The self-contained HTML snapshots require no server or network to view.

## Surface and lighting prototype — 18 November 2026

The additional `panorama.html` experiment now renders full visible surfaces,
interior ridges, dynamic slope lighting, and Sun/Moon terrain shadows. Nothing
has been integrated into iMKS or Coelum. The original skyline comparison and its
recorded coordinates are retained unchanged.

### Matched viewpoint and data

The uploaded PeakFinder image explicitly gives **45.89617° N, 10.84333° E,
90 m** and a bearing of **204°**. The prototype uses those coordinates and
**90 m directly as the eye elevation**. A 100° horizontal camera field of view
and 15° camera altitude frame a similar landscape; they are estimates, not a
calibrated reconstruction of the screenshot camera. The screenshot provides no
date with which to validate actual solar lighting.

Mapterhorn reports **91 m** point terrain at the exact observer. The eye is not
silently raised: the UI reports this discrepancy, and the near field defaults
to excluding 100 m (adjustable 20–300 m). Unmodelled foreground gets a neutral
fill. A separate rebuild at **92 m** confirmed that the explicit eye is honoured
while point terrain remains 91 m. Whether the screenshot altitude denotes eye
or ground, and the relevant vertical datums, remain unresolved.

At the Riva viewpoint, the surface uses **176 tiles / 19,766,806 bytes**, with
no missing vertices or lower-zoom fallback queries in this run. The four nested
512-cell grids contain **1,998,848 triangles**, with spacings **3.906 / 15.625 /
62.5 / 250 m**, covering local square extents ±1 / 4 / 16 / 64 km. These are
rendered mesh spacings, not claims of native source resolution. Fine/coarse ring
boundaries are matched to avoid open cracks. The surface square differs from
the previous 60 km circular skyline comparison, so tile and payload totals are
not directly interchangeable.

The optional Garda water mask uses OSM relation **8569 v141**, timestamp
**2026-08-03T08:13:25Z**, simplified to 5 m. Its nominal `ele=65` supplies the
flattening level, with Earth curvature retained. This is not a dated lake-level
measurement. Islands are excluded from water. Source, ODbL licence, attribution,
and preparation instructions are retained alongside the mask. Mapterhorn and
Sonny source notices remain separate.

### Verification

- Existing model tests pass. Additional geometry tests cover normals on a known
  slope, missing-data gaps, explicit eye height, light-map bases including the
  zenith, nonlinear lunar brightness, water/islands, and matched mesh boundaries.
- Typed-buffer surface export/import round trips exactly, and invalid triangle
  indices are rejected. The standard saved surface is approximately **71 MB**
  of JSON/base64; generated surfaces stay outside the repository.
- Real-data browser checks pass for Sun and Moon lighting, shadow toggling,
  offline surface restoration with tile requests blocked, invalid-file handling,
  cancellation, and a **390 × 844** viewport without horizontal overflow.
- At the summer-day setting, enabling shadows darkened **65,808 RGB channels**
  by more than three display levels and brightened **zero**. Camera and lighting
  changes issued **zero additional terrain requests**.
- For the same camera, mean displayed RGB was about **211.48/255** in the summer
  day, **202.13/255** in the low afternoon, **3.91/255** under a nearly full Moon,
  and **1.11/255** on the near-new-Moon night. These are image diagnostics, not
  measured landscape luminances. The Moon examples use actual ephemeris dates
  2026-11-24 22:00 UTC and 2026-11-09 22:00 UTC.
- A separate rendering check extracted 290 skyline samples from the clear-sky
  muted-earth view and compared their camera rays with the previously saved
  detailed Mapterhorn numerical profile. Mean absolute difference was **0.049°**,
  p95 **0.156°**, maximum **0.259°**. The old profile has a viewpoint about 3 m
  away and a 93 m eye, and rendered-pixel extraction is quantised. This is a
  consistency check, not an independent accuracy test or a PeakFinder comparison.

Warm-cache tile load was about **0.40 s** and geometry construction including the
shoreline mask about **2.85 s** on this desktop Chromium run. Cold download time
was not benchmarked. Browser-reported render submission is typically a few ms or
less, but does not include completion of GPU work. A synchronous pixel-readback
and automation loop at the phone viewport averaged about **629 ms per round
trip**; it is not a frame-rate measurement. Physical-phone memory, graphics and
interaction performance remain untested. Fresh phone-sized sessions default to
the smaller Preview mesh.

### Remaining decisions

This establishes a reviewable surface/lighting prototype, not PeakFinder parity
or a production-ready terrain system. The next decisions need visual review of
this viewpoint and other terrain types, a matched numerical PeakFinder export
or photographic reference, and actual phone performance/memory measurements.
Sonny import is available, but no new Sonny panorama was rendered during this
iteration; the earlier independent-source comparisons remain the data evidence.
The fixed terrestrial-refraction and clear-sky illumination approximations,
finite shadow coverage/resolution, near-field treatment, height datum mismatch,
source seams and coarse distant mesh remain explicit limitations.


## Artifact fixes and general water — subsequent 18 November iteration

- The former Garda-only mask and nominal lake-level override are no longer used
  by the renderer, worker, app bundle or prepared default surface. Current data
  is general Natural Earth oceans 5.1.1 and lakes 5.0.0, public domain, prepared
  uniformly into 5° tiles. The cartographic source scale is 1:10 million; this
  cannot supply detailed shorelines or all small lakes. Coloring never changes
  DEM heights. Ocean coloring also requires near-sea-level DEM terrain, and steep
  shoreline facets are not painted blue. Source hashes live in the water index.
- Both brightness controls now start at 50%. Their baseline multipliers preserve
  the previously approved brightness, including visible moonlit relief. Previous
  saved settings are migrated; increasing the new night slider can brighten the
  scene further. Blue water is an independent appearance option.
- Shadow receivers use stable geometric face normals, per-filter-tap receiver
  depths, explicit high-precision depth samplers, a slope- and resolution-aware
  bound for rasterizer subpixel rounding, a normal offset capped at 100 m to
  avoid neighbouring-facet acne, and a blended near/far transition.
  Diffuse lighting follows the continuous Sun direction even when shadow maps
  reuse a quantised light direction. A known lit slope passed sixteen Sun
  positions with zero false darkened channels in Chromium and desktop WebKit;
  a separate raised ridge still cast a visible shadow. Zoomed real-terrain
  comparisons at four Sun positions lost the former dark triangular ridge marks.
  The bias and finite map resolution can suppress very small cast shadows.
- The prepared phone surface was rebuilt using the general water data. It has
  no regional mask or height override; at this test location the water polygons
  required two tile files totaling 7,473 bytes. Geometry preparation was roughly
  0.18 s in this desktop run, excluding decoding and the GPU buffer setup.
- Peak names and optional satellite/albedo coloring remain later stages, using
  general data sources rather than a special data pack for this viewpoint.
