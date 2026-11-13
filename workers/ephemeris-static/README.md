# Astrolabium native ephemeris data: free static hosting

This is the preferred hosted-data path. Original JPL DE440 and IERS files
are repackaged once into exact 256 KiB byte chunks. The bytes and native
polynomials are unchanged; there are no yearly fitted ephemerides. Phones
fetch the chunks required by the selected date only when refinement is
requested. SPK parsing and astronomical calculations run in a background
worker, which is terminated when the calculation completes or is cancelled.

The initial endpoint is
https://astrolabium-ephemeris-data.marco-lombardi.workers.dev/ .
It is deployed and selected in the repository app configuration. The public
app itself must still be released through its normal publication workflow.

The initial upload is about 124 MB, consisting of 472 data chunks, two
binary checksum indexes and a small manifest. It includes full DE440
(1550 to early 2650) and one IERS snapshot. Satellite kernels, DE441 and
native satellite-event searches are not included in this first deployment.

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

## Phone resource limits and validation

Four raw chunks occupy at most 1 MiB, plus at most two checksum indexes
(under 15 KiB total for this pilot; hard bound 1 MiB for future kernels).
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
