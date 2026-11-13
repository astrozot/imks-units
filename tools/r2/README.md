# Astrolabium: direct R2 data pilot

R2 is now an optional alternative. The preferred free-hosting path is
[`workers/ephemeris-static`](../../workers/ephemeris-static/README.md).
Its preparation process can reuse the verified originals described here
without creating any R2 bucket.

This alternative uses static R2 object storage. No extraction Worker
is deployed or called. The browser downloads exact 16 KiB byte ranges,
caches at most 8 MiB of payload, and delegates SPK parsing/extraction and
all astronomical calculations to its existing background worker. Only
four raw chunks (64 KiB) are resident in the range reader at a time.

Start with one verified full DE440 original (~120 MB) plus a single IERS
text snapshot (~4 MB). No satellite kernel or DE441 upload is part of this
first pilot. There are no pre-generated yearly production extracts.

## Prepare locally

Download the original files once on the development machine, not on a phone:

```sh
curl --fail --location --output /tmp/de440.bsp \
  https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp
curl --fail --location --output /tmp/finals2000A.all \
  https://maia.usno.navy.mil/ser7/finals2000A.all
node tools/prepare-r2-data.mjs /tmp/de440.bsp /tmp/finals2000A.all /tmp/astrolabium-data
```

Preparation checks DE440 against JPL's published file size and MD5, then
records a full SHA-256 for each immutable object. Range-test sparse files
must never be uploaded: matching file length alone is insufficient.

## Create the test bucket and upload

An R2-enabled Cloudflare account and current Wrangler login are required.
Enabling R2 may require billing setup by the account owner. This code does
not activate subscriptions, enter payment details or deploy a Worker.

```sh
npx wrangler login
npx wrangler r2 bucket create astrolabium-data
npx wrangler r2 bucket cors set astrolabium-data --file tools/r2/cors.json
node tools/upload-r2-data.mjs astrolabium-data /tmp/astrolabium-data
npx wrangler r2 bucket dev-url enable astrolabium-data
```

Review `cors.json` first: it permits the current GitHub Pages origin and
localhost:8000, exposes the range/revision headers, and allows the
conditional `If-Range` header. The upload helper verifies all files before
uploading anything and publishes `manifest.json` last.

The managed `r2.dev` URL is temporary, rate-limited and not suitable for a
public production release. Connect a custom domain before production.
Set `R2_DATA_URL` in `js/precisionconfig.js` to the returned bucket URL
(including any prefix, ending in `/`). Leave `EPHEMERIS_SERVICE` empty.
Reload/update the app shell. An unset R2 URL retains the verified old data
path; do not use a guessed URL or remove the old packs before validation.

## Validate before switching the public app

1. Fetch `manifest.json`, then a 1 KiB range of its DE440 object with an
   `Origin: https://astrozot.github.io` header. Confirm HTTP 206, exact
   Content-Range/Length, readable ETag and matching CORS permissions.
   `node tools/verify-r2-data.mjs https://pub-EXAMPLE.r2.dev/` checks CORS,
   bounded ranges and a reference eclipse using the real public objects.
2. Run the actual app against the bucket. Verify solar/lunar eclipse and
   occultation results against the existing independent fixtures.
3. Repeat a downloaded date offline; verify zero new network requests.
4. Cancel downloads and close the event sheet: requests must abort and the
   calculation worker must be released.
5. Check animation and memory on a real iPhone 12 before public release.
6. Review the R2 usage dashboard before installing satellite kernels.

Tests can emulate the same public-bucket contract locally without any
Cloudflare account or charges. They do not replace the actual R2 or device
checks above. Browser-throttled results are not measurements of iPhone RAM.

## Data updates and costs

Object names contain the full-file SHA-256. Never overwrite those objects;
publish a new hash-named object and update the small manifest. The phone
pins its downloaded manifest until data is cleared; this makes offline
reuse independent of a metadata network request. Clearing event data picks
up a newer hosted IERS snapshot. Do not delete older advertised objects
while clients may still have manifests referring to them.

R2 Standard currently includes 10 GB-month of storage and 10 million read
operations per month, with free egress; reads above that allowance are
metered. Budget alerts are notifications, not spending caps. The temporary
URL has separate rate limits. No claim of unlimited or guaranteed-free
hosting is made. See https://developers.cloudflare.com/r2/pricing/ and
https://developers.cloudflare.com/r2/buckets/public-buckets/ .
