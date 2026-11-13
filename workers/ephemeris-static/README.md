# Astrolabium native ephemeris data: free static hosting

This is the preferred hosted-data path. Original JPL DE440 and IERS files
are repackaged once into exact 256 or 512 KiB byte chunks. The bytes and native
polynomials are unchanged; there are no yearly fitted ephemerides. Phones
fetch the chunks required by the selected date only when refinement is
requested. SPK parsing and astronomical calculations run in a background
worker, which is terminated when the calculation completes or is cancelled.

The current endpoint is
https://astrolabium-ephemeris-data.marco-lombardi.workers.dev/v3/ .
The original root endpoint is retained for older app versions. The public
app itself must still be released through its normal publication workflow.

The complete deployment contains 5,841 assets (including the retained old
dataset) and about 2.8 GB of logical payload. These are hosted files, not a
phone download or app-install bundle. The phone normally fetches only a
few MiB for a first date/body, then reuses cached chunks. Published data:

| Source | Native coverage used | Bodies |
| --- | --- | --- |
| DE440 | 1549-12-31 to 2650-01-25 | Sun, Earth/Moon and planet-system barycentres |
| DE441 parts 1/2 | App years −1000 to 3000, outside DE440 | Historical/future Sun, Moon and planet-system barycentres |
| MAR099 | 1600-01-01 to 2600-01-02 | Mars centre, Phobos, Deimos |
| JUP365 | 1600-01-10 to 2200-01-10 | Jupiter centre and four Galilean moons |
| SAT441 | 1749-12-30 to 2250-01-06 | Saturn centre and eight major moons |
| URA184 part 3 | 1600-01-04 to 2399-12-17 | Uranus centre and five major moons |
| NEP097 | 1600-01-10 to 2399-12-31 | Neptune centre and Triton |

Date limits are TDB boundaries; a calculation needs its short light-time
or contact window within native coverage. Compatible native record grids
are joined across solution epochs with SPICE's inclusive-boundary
precedence retained. Gaps or incompatible grids remain unavailable.
No polynomial is extrapolated. DE440 is preferred whenever it covers the
whole requested interval. DE441 covers astronomical years −1000–3000
(1001 BCE–3000 CE), the sky's existing supported range, including 654 BCE
(astronomical year −653). Supporting the complete DE441 historical span
also requires extending/auditing the sky's other models and date controls.

The object detail card offers on-demand precise positions for the Sun,
Moon, planets and the 20 existing natural moons. Topocentric and
geocentric apparent coordinates share one calculation. Results show the
requested time while the sky clock animates; changing the object/place
resets them. A fixed-size JPL/Approx. toggle replaces the existing detail
fields and event contact times, with no duplicate result block. The
Local/Geocentric selector works with either model. Cancelling Downloading…
discards the unfinished job’s new fragments. Old cached fragments are
evicted automatically; there is no clear-cache button. No automatic
download or recalculation runs during playback. When native planet-centre
data is unavailable, the result explicitly identifies the compact centre
correction or the system barycentre. Native satellite-event searches are
not enabled: moon-event lists and animations still use their compact models.

## Hosting and cost

This configuration has static assets and no application Worker script,
Functions, R2 bucket, KV or other metered storage. Cloudflare currently
documents static asset requests as free and unlimited, with no additional
asset-storage charge. The Free plan's file-count and per-asset limits
still apply; retain an explicit inventory before adding large kernels.
No `run_worker_first` route or server calculation is needed. The normal
100,000/day dynamic Workers request limit does not apply to asset requests.

See [static asset pricing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
Free service is subject to Cloudflare terms and future policy changes;
this is not a guarantee of unlimited availability forever.

The data is deliberately public and read-only. No credentials are shipped
in the app. Upload/delete permissions remain authenticated. Wildcard CORS
permits reuse of public scientific data; it does not grant write access.

## Prepare and deploy

Download and verify originals as described in
[`tools/r2`](../../tools/r2/README.md), using only its preparation step.
R2 activation and all R2 bucket/upload commands can be skipped.

```sh
node tools/prepare-r2-data.mjs /tmp/de440.bsp /tmp/finals2000A.all /tmp/verified-originals
node tools/prepare-static-data.mjs /tmp/verified-originals /tmp/astrolabium-static
npx wrangler login
npx wrangler deploy --config workers/ephemeris-static/wrangler.jsonc --assets /tmp/astrolabium-static
```

Preparation verifies full source hashes (and JPL's published DE440 MD5),
creates a binary SHA-256 list for each source and publishes the manifest
last. Each descriptor pins its checksum index. Every downloaded index and
chunk is checked before use, including already cached content. The loader
rejects oversized responses, malformed metadata and out-of-coverage dates.
It downloads whole small chunks and requires no HTTP Range support.

Set `STATIC_DATA_URL` in `js/precisionconfig.js` to the validated real URL.
Leave R2 and extraction-service URLs empty. The existing yearly files
remain a fallback configuration until the hosted data is verified; they
are not requested when static hosting is configured. App publication is
separate from deployment of this data endpoint.

Keep older hash-named directories in subsequent deployments while cached
manifests may reference them. The preparation tool preserves existing
output directories. Do not deploy from a clean folder containing only a
replacement IERS snapshot if older clients still need the previous one.
Users can clear downloaded event data to pick up a newer manifest/IERS
snapshot; no metadata network request is required for offline reuse.

## Prepare the extended catalogue

After creating the original v2 DE440/IERS static directory above:

```sh
node tools/prepare-native-chunks.mjs /tmp/astrolabium-static /tmp/astrolabium-static/v3 /tmp/native-source-cache
node tools/stage-ephemeris-release.mjs /tmp/astrolabium-static /tmp/astrolabium-static/v3/manifest.json /tmp/native-release
npx wrangler deploy --config workers/ephemeris-static/wrangler.jsonc --assets /tmp/native-release
```

Preparation adds immutable cache rules for `/v3/kernels/*` and `/v3/iers/*`,
and `max-age=3600` for `/v3/manifest.json`, to the root `_headers` file.
Keep wildcard CORS on the root `/*` rule. The release helper validates every published
chunk/index and checks the 20,000-asset Free limit before snapshotting the
files, so continued source preparation cannot mutate a running deployment.

The extended preparation uses exact HTTP ranges over HTTPS, pins each
origin's revision and validates Content-Range/length. It records JPL's
published whole-file MD5 for provenance; it does **not** claim to verify
that whole-file checksum without downloading the complete source. Every
published chunk is SHA-256 indexed and verified again before release.
Sparse index entries are explicit zero hashes and fail locally before an
unpublished chunk can be requested. Partial-source descriptors are bound
to their checksum-index hash; they do not advertise a fictitious full-file
SHA-256. All coefficient bytes are original; there is no resampling or fit.

The v3 path preserves the original root catalogue and old cache keys.
Never replace v2 with a partial-source catalogue: older loaders require
complete-source descriptors. Keep hash-named directories from the current
v3 catalogue when publishing subsequent updates.

## Phone resource limits and validation

Raw chunks share a 1 MiB budget (four 256 KiB or two 512 KiB chunks), plus
at most two checksum indexes (hard bound 1 MiB total).
These limits exclude short-lived I/O copies, extracted coefficients and
the app's other allocations. The complete kernel is never loaded on the
phone. Persistent ephemeris payloads share an 8 MiB eviction budget;
clearing event data removes them. Requests abort and the background worker
terminates on cancellation. No data download or numerical worker starts
with the sky animation alone.

```sh
node tests/precision-static.mjs
STATIC_STAGED=/tmp/astrolabium-static node tests/precision-static.mjs
node tests/precision-static-browser.mjs
node tools/verify-static-data.mjs https://astrolabium-ephemeris-data.marco-lombardi.workers.dev/
```

The full-data numerical test compares 13 events against independent
Skyfield/ERFA references. Browser tests use the actual app with cross-origin
static downloads, cancellation and cache reuse. Set `STATIC_STAGED` for
full local data, or `STATIC_URL` for a live deployed endpoint. Set
`PLAYWRIGHT` and `CHROME`/`WEBKIT` for locally installed browser runtimes.
WebKit's offline emulator prevents module workers from starting, so its
test checks cache-only reuse online; Chromium also checks offline reuse.
The reports in `data/static-ephemeris-*-performance.json` are desktop
measurements, not real iPhone memory measurements. A real iPhone 12 check
is still required before a public app release.

Extended validation:

```sh
python tools/native-chunk-reference.py /tmp/native-release/v3 /tmp/native-release/v3/manifest.json tests/fixtures/extended-native-states.json
EXTENDED_STAGED=/tmp/native-release/v3 node tests/precision-extended.mjs
node tests/precision-data-v3.mjs
node tests/precision-positions.mjs
node tests/precision-positions-browser.mjs
```

The independent reference uses jplephem, Skyfield and ERFA; only the
declared ΔT assumption is shared for unmeasured Earth rotation. Native
ICRF states and apparent positions are checked separately. For historical
apparent positions, the worker retains full IERS fundamental arguments in
the bounded 77-term nutation series and uses ERFA-derived IAU 2006 CIO/sidereal
rotation. This avoids extrapolating modern sidereal approximations over
millennia. Results are in `data/precision-extended-validation.json` and
`data/precision-positions-performance.json`. These are model/implementation
checks, not guarantees of historical event accuracy or real-phone memory.
