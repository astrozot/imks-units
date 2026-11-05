[![Web App](https://img.shields.io/badge/Web_App-[@]-blue)](https://astrozot.github.io/imks-units/)

# iMKS Units

A unit calculator for phones, tablets and computers: numbers carry units,
`@` converts, uncertainties propagate, and it includes CODATA constants,
solar-system data, cosmology and lensing functions, equation solving,
integrals and derivatives, lists and tables, and plots.

Open `index.html` from any web server. Served over HTTPS (for example
GitHub Pages) it can be installed with **Add to Home Screen** and then
works offline. Exchange rates are refreshed daily when online.

The **History** button searches past expressions and results. Long-press a
calculation (or right-click) to pin its expression; saved expressions are in
History → **Pinned** and survive clearing the results. Pins are included in
backups and reuse the current variables. **Clear…** in History clears results
or starts over in the current session; Ctrl/⌘F opens History from a hardware keyboard.

Tap the session name at the top of History to switch, create, rename or
duplicate sessions. Existing calculations become **Main session**. Each
session keeps its own history, variables, functions, numbered results and
unfinished expression (including cursor position). Settings, **My definitions**
and pins are shared. Switching saves automatically; backups include all
sessions and restore the active one. Older backups open as Main session.

Constants and functions use one spelling, such as `H_0`, `Omega_M`,
`M_Sun`, and `Gamma`. Older names such as `H0`, `OmegaM`, `Msun`, and
`gamma` are no longer aliases. Equivalent symbols such as `Ω_M` and `Γ`
remain accepted.

The scripts are ES modules, so the page does not work when opened as a
local file. To try it locally, run `python3 -m http.server 8000` in this
folder and open `http://localhost:8000/` (use Shift-reload after editing,
as the service worker serves the cached copy first).

## Checks

`node tests/functionhelp.mjs` checks function-help coverage and calling forms.

`node tests/diagnostics.mjs` checks error guidance and expression locations.

`node tests/run.mjs` checks dates and time zones, the calendars (against
the calendars of `Intl` where it has them), the holidays, and the Sun, the
Moon, the planets and the stars (against times from PyEphem and positions
from JPL Horizons and astropy). It needs no packages and takes a few seconds.

`js/vsop87.js` holds the VSOP87D series of the planets, truncated to about
1″: `node tools/vsop87.mjs <dir> 1` writes it from the files `VSOP87D.mer`
… `VSOP87D.nep` of ftp.imcce.fr/pub/ephem/planets/vsop87/ in `<dir>`.

`js/moons.js` holds series for the major moons of Mars, Jupiter, Saturn,
Uranus and Neptune: `node tools/moons.mjs <dir>` fetches their positions
from JPL Horizons into `<dir>` (once) and fits the series, in about a
quarter of an hour. `js/moonseries.js`, the Moon, comes the same way from
`node tools/moon.mjs <dir> 2` (about 10 minutes), and `js/coast.js`, the
coastlines of the maps of the eclipses, from Natural Earth with
`node tools/coast.mjs ne_110m_coastline.geojson`.

`js/catalog.js` holds the stars named by the IAU (IAU Catalog of Star
Names, with proper motions and parallaxes from the HYG database), the
Messier and other named deep-sky objects (OpenNGC, CC BY-SA 4.0) and the
capitals and cities of 500 000 people or more, with their elevation
(GeoNames, CC BY 4.0): `node tools/catalog.mjs <dir>` writes it from the
files listed at the top of the tool. Other names are looked up online when
asked for: objects in SIMBAD (CDS, through Sesame), places in OpenStreetMap
(Nominatim, ODbL) with their elevation from Open-Meteo (Copernicus DEM).

`js/minorplanets.js` holds the orbits of about 175 minor planets (the
brighter ones, the dwarf planets, some visited or famous) on the first of
January of each year from 2016 to 2040: `node tools/minorplanets.mjs <dir>`
fetches them from the JPL Small-Body Database and Horizons into `<dir>`
(once). Other minor planets and the comets come online from the Minor
Planet Center, artificial satellites from CelesTrak, followed with SGP4
(`js/sgp4.js`, near-Earth orbits only), checked against python-sgp4.

`img/moon.webp`, the near side of the Moon for the lunar eclipses, comes
from NASA's LRO colour map (Scientific Visualization Studio, CGI Moon Kit,
public domain): `python3 tools/moondisk.py lroc_color_poles_1k.jpg` writes
it (numpy and Pillow).

`node tests/browser.mjs` checks the app in Chromium at phone size, with
simulated sensors (position, motion, compass, microphone). It needs
Playwright (`npm install playwright-core`, then `CHROME=/path/to/chrome`;
`PLAYWRIGHT=/path/to/playwright-core` if it is installed elsewhere), and
skips without it.

`node tests/places.mjs` checks online search, selection and offline reuse in
the Places modal, using the same Playwright and Chromium options.

`node tests/history.mjs` checks history search, pinning, persistence and backup
compatibility, using the same Playwright and Chromium options.

`node tests/sessions.mjs` checks session migration, isolation, drafts, duplication
and backup restoration, using the same Playwright and Chromium options.

## Publishing on GitHub Pages

1. Create a new public repository (e.g. `imks-units`).
2. Upload all files of this folder to the repository root
   (Add file → Upload files; include `.nojekyll`).
3. Settings → Pages → Build and deployment → Source: *Deploy from a branch*,
   Branch: `main`, folder `/ (root)` → Save.
4. After a minute the app is at `https://<user>.github.io/imks-units/`.

To publish a new version, upload the changed files (`index.html`,
`styles.css`, `js/`) and bump `CACHE` in `sw.js`
(e.g. `imks-v2`) so installed copies pick it up.
