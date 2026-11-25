# Hevelius constellation artwork

Deferred on 25 November 2026 at the user's request. Priority is low. Keep
constellation artwork out of the app until the user resumes this work.
The existing constellation lines and boundaries remain available.

## User requirements

Use historical figures. Incomplete sky coverage is acceptable, but figures
must be intact and free of engraved stars, the ecliptic and other chart
symbols. Users must not have to download, unpack or import ZIP files manually.
The preferred experience is to enable the layer and let the app install the
collection automatically on the device, retaining it for offline use.

## Prepared collection

Mark Crossley's Stellarium Hevelius collection v1.1 contains 74 prepared PNG
figures and three Hipparcos star anchors per figure. The PNGs are already
isolated on black backgrounds. Orion and Leo are substantially cleaner than
the raw atlas scans used by the rejected prototype. Inspect individual images
at full resolution before promising that every figure is free of remnants
or source cropping; the overview alone is insufficient for that claim.

- [Author and download page](https://www.wilmslowastro.com/software/software.htm)
- [Original archive](https://www.wilmslowastro.com/software/downloads/hevelius-v11.zip)
- [Converted archive and discussion](https://github.com/Stellarium/stellarium/discussions/4273)

The original archive was successfully downloaded and compared: all 74 PNGs
are byte-for-byte identical to those in the converted archive. The original
uses legacy Stellarium files, including `constellationsart.fab`; the converted
copy uses `index.json` and an `illustrations/` directory. All anchor Hipparcos
identifiers are present in the app's built-in `CHART_STARS` catalog.

Original ZIP size: 11,262,688 bytes. SHA-256:
`dc475b99bfff475552b654ab1f76deec2f31d6fab9b683f7d962ce41e43c01b6`.

Coverage follows historical names. Argo Navis covers modern Carina, Puppis
and Vela; Serpentarius combines Ophiuchus and Serpens. Triangulum Majus and
Triangulum Australe correspond to modern Triangulum and Triangulum Australe.
There are also obsolete figures such as Musca Borealis, Robur Caroli and
Triangulum Minus. The 14 modern constellations without artwork are Antlia,
Caelum, Circinus, Fornax, Horologium, Mensa, Microscopium, Norma, Octans,
Pictor, Pyxis, Reticulum, Sculptor and Telescopium.

## Download and reuse constraints

An initial request returned HTTP 403. A subsequent GET with a browser user
agent and the author's software page as Referer returned HTTP 200. A GET
using the app's Referer and Origin also returned 200. These responses did
not include `Access-Control-Allow-Origin`, so a direct cross-origin browser
fetch cannot expose the ZIP bytes to the app. Recheck this when resuming.
Either upstream CORS support or a backend download relay is needed for the
proposed automatic installation. No relay has been implemented or deployed.

The archive's `description.en.utf8` asks others not to host copies of the sky
culture, citing update management. It supplies no explicit open redistribution
license. [Stellarium maintainers also discuss source image restrictions](https://github.com/Stellarium/stellarium/discussions/3469).
Downloading into each user's local app storage would avoid bundling a mirror
with our static app; this is an architectural proposal, not a determination
of permission. Resolve applicable reuse terms before distributing the
collection or introducing a relay. Do not copy the archive or its processed
images into public app assets by default.

## Previous implementation and next steps

Commit `19ff3aa` preserves the rejected two-figure prototype and its tests.
It added a separate toggle, opacity control, spherical texture mesh, Chart
and Sky rendering, horizon and foreground clipping, and SVG export support.
Its hand-traced masks cut figures, and raw scans retained chart symbols.
Reuse the rendering ideas if useful; do not restore those assets or masks.

The removal restores app code to the state before that commit and advances
the service worker cache to v260. Artwork code, assets, controls, credits,
precache entries and dedicated tests are removed. Geometry, layer-control
browser checks and app-update tests passed after removal.

When resumed, resolve the download route and reuse terms first, then use
the collection's full prepared textures and supplied star anchors. Test
complete figures, orientation and alignment in both views, ground and planet
occlusion, export, automatic installation, failed downloads and offline
restoration. Bound decoded texture memory and load visible figures as needed;
decoding every full-resolution image at once would be wasteful on phones.
The prototype's geometry tests alone did not detect the visual defects.
