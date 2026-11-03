[![Web App](https://img.shields.io/badge/Web_App-[@]-blue)](https://astrozot.github.io/imks-units/)

# iMKS Units

A unit calculator for phones, tablets and computers: numbers carry units,
`@` converts, uncertainties propagate, and it includes CODATA constants,
solar-system data, cosmology and lensing functions, equation solving,
integrals and derivatives, lists and tables, and plots.

Open `index.html` from any web server. Served over HTTPS (for example
GitHub Pages) it can be installed with **Add to Home Screen** and then
works offline. Exchange rates are refreshed daily when online.

The scripts are ES modules, so the page does not work when opened as a
local file. To try it locally, run `python3 -m http.server 8000` in this
folder and open `http://localhost:8000/` (use Shift-reload after editing,
as the service worker serves the cached copy first).

## Checks

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
