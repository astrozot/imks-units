# Astrolabium ephemeris service

This is the earlier prototype. The preferred implementation now uses
direct static R2 byte ranges: see
[`tools/r2`](../../tools/r2/README.md). This Worker is not required for R2.

This standalone Cloudflare Worker reads bounded byte ranges directly from
official JPL SPK files. It returns a small native-coefficient extract for
the requested date and bodies. There are no pre-generated yearly files,
Horizons API requests, fitted replacement polynomials, R2 bucket, database
or scheduled job. A cache miss fetches original records on demand;
Cloudflare caches fixed source chunks for later requests.

## Deployment

1. Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to the app's actual origin(s),
   comma separated. Origins contain the scheme and host, not a path.
2. From the repository root, authenticate and deploy:

   ```sh
   npx wrangler login
   npx wrangler deploy --config workers/ephemeris/wrangler.jsonc
   ```

3. Set `EPHEMERIS_SERVICE` in `js/precisionconfig.js` to the returned Worker
   origin, for example `https://astrolabium-ephemeris.ACCOUNT.workers.dev`.
   Rebuild/reload the app's offline shell after changing configuration.
4. Check `/health`, then test a refined eclipse in the app, including an
   offline repeat of the cached date. Actual iPhone testing remains needed.

Deploying requires access to the owner's Cloudflare account; no account
credentials or guessed deployment URL are stored in this repository.
Until configured, the app retains its verified 1900–2100 yearly data path.
Once configured it uses only this service, with no silent fallback to
yearly files. Delete the production yearly packs after verifying the
deployment; keep the small independent SPK test fixtures.

Full satellite requests can use more than the Workers Free plan's 50
subrequests on a cold cache (Cache API operations also count). Use an
appropriate Workers plan and profile CPU/subrequests before public use.
The code caps origin requests at 40 and uses batches of three concurrent
record reads. Configure request rate limits in Cloudflare for the public
endpoint. CORS origin restrictions are not authentication.

## Contract

```text
GET /v1/pack?day=2460408.5&model=de440
GET /v1/pack?day=2460408.5&model=de440&body=mercury
GET /v1/pack?day=2460408.5&model=de440&system=jupiter
```

`day` is the Julian day at UTC midnight, ending in `.5`. The extract spans
two days before through three days after that midnight, clipped to the
selected kernels' common coverage. Native records may extend further,
but the advertised validity window is never extrapolated. Responses use
the existing `IMKSEPH1` format, with `native: true`, the source kernels,
last-modified timestamps and byte sizes. `X-Ephemeris-SHA256` verifies
the downloaded extract. Type 2 positions and type 3 positions/velocities
are copied directly from native Chebyshev records; type 3 velocity
coefficients are converted from km/s to km/day for the app interface.

The base includes the Sun, Earth and Moon. `body` adds up to two planetary
barycentres; `system` adds the native planet centre and major satellites:

| System | Kernel | Included moons |
| --- | --- | --- |
| Mars | MAR099 | Phobos, Deimos |
| Jupiter | JUP365 | Io, Europa, Ganymede, Callisto |
| Saturn | SAT441 | Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Hyperion, Iapetus |
| Uranus | URA184 part 3 | Miranda, Ariel, Umbriel, Titania, Oberon |
| Neptune | NEP097 | Triton |

Sources are explicitly allowlisted in `kernels.js`. Each has its own date
range; a DE440/DE441 range does not extend satellite coverage. Requests
crossing unsupported source segments or exceeding buffer limits fail
explicitly. Jupiter and Saturn source ranges and all included satellite
states were tested live and against independent jplephem references.
Other catalogue entries require their own live validation before claiming
equivalent coverage/accuracy.

DE440 is the app default, with dates offered from 1550 through early 2650
where native coverage exists. The service also has explicit DE441 part
identifiers for later historical work; ancient apparent positions/events
are not enabled or validated in the app. No automatic DE441 substitution
occurs. Extending a kernel catalogue does not itself validate long-range
precession, Earth rotation or individual moon event models.

IERS UT1 and polar motion are read using fixed-width byte ranges from
`finals2000A.all`. Missing data, changed format or source failures leave
the existing ΔT fallback clearly labelled. The service does not predict
future leap seconds. Kernel changes detected between range reads fail
rather than mixing revisions. Chunk-cache expiry is one day; native pack
responses have a one-day HTTP cache lifetime. The phone's explicit bounded
cache reuses saved responses offline until cleared/evicted.

## Resource limits and validation

- 16 KiB source chunks, at most four resident chunks per source reader.
- At most 512 KiB for the final phone response, including metadata.
- 25-second service deadline, no full-kernel reads, no arbitrary URL proxy.
- The app retains its shared 8 MiB disk cache and one calculation worker.
  No precision request runs in the sky animation loop.

```sh
node tests/ephemeris-service.mjs
node tests/precision.mjs
PLAYWRIGHT=/path/to/playwright-core CHROME=/path/to/chrome \
  node tests/ephemeris-service-browser.mjs
```

The browser test activates the service using a test-only configuration,
runs the actual app with 6× CPU throttling, checks animation frame times,
verifies zero yearly-file requests, offline reuse and cancellation.

The SPK fixtures in `tests/fixtures/*-native.bsp` contain original JPL
coefficients for a short April 2024 test interval, extracted using
jplephem's `excerpt` utility. They are test data, not production ephemeris
tiles. `native-spk-states.json` holds independent jplephem positions and
velocities for 140 states. The original source names are DE440s, JUP365
and SAT441; these public sources are linked in `kernels.js`.
# Prototype status

The preferred implementation now uses direct static R2 byte ranges; see
[`../../tools/r2/README.md`](../../tools/r2/README.md). This extraction
Worker remains an experimental alternative and is not required for R2.

