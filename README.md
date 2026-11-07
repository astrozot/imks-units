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

`coelum(now, "Rome")` shows the sky above a place, offline, in two views.
Use `coelum(now, here)` for the device position, or omit the place to use the
location in Settings. The table gives the solar-system bodies' geometric
altitudes and azimuths, including those below the horizon. Dates from year
−1000 through 3000 are supported (UTC).

- **Chart** is a map-like whole-sky chart in the style of a printed atlas:
  zenith at the center, north up, east left; stars to magnitude 6 sized by
  brightness, double stars with a bar and variable stars with a ring
  (Hipparcos), the Sun, planets and the Moon's phase, galaxies, clusters and
  nebulae with the usual atlas symbols, constellation figures, boundaries,
  the ecliptic and the Milky Way. The legend button explains the symbols.
  Drag to roll the sky as seen from inside the celestial sphere; near the
  zenith it turns freely, and further away it keeps the horizon level (the
  zenith up, or down once dragged past it, so it never flips over).
- **Sky** is a realistic view toward the horizon, like a planetarium
  program: the sky's colour follows the Sun (daylight, sunset glow,
  twilight, night), the Sun has its glare, the Moon its texture, phase and
  glow, stars fade with twilight, moonlight and extinction near the horizon,
  the Milky Way appears in a dark sky, and a landscape hides what is below
  it. With the atmosphere on, positions include refraction (the standard
  atmosphere at the place's height; about 34′ at the horizon), and the
  details card gives the apparent altitude. Dragging keeps the grabbed
  point under the finger with the horizon level, also across the zenith;
  it opens toward the Sun around sunrise and sunset, otherwise toward the
  equator.

Switching between the views keeps the direction at the center and the
scale there. In both, pinch (touch or trackpad) or scroll to zoom, double-tap to reset the view, and tap an
object or its label for a details card (name, type, equatorial and
horizontal coordinates, magnitude, distance, double/variable flags). The
search field finds stars, planets, deep-sky objects (also by their other
names, as "Andromeda Galaxy"), constellations and HIP numbers, and flies to
the object. The layers button toggles ground, atmosphere (Sky), Milky Way,
constellations, boundaries, the ecliptic, grids, deep-sky objects and
labels; each view keeps its own layers, and the last view used opens next
time. Grids get finer as you zoom (30° down to 2′; RA from 2h down to
20s), labelled along the left edge and low in the view. Star sizes follow
the magnitude below the view's limit, which deepens with zoom, so a
magnified cluster keeps its bright and faint members apart. **Horizon** chooses a generic landscape, a flat horizon or the
**local terrain**: the first time for a place, about 40 elevation tiles
(AWS Terrain Tiles, a few MB) are downloaded and the horizon is computed
every half degree out to 150 km, with the Earth's curvature and
terrestrial refraction; it is kept on the device for twelve places, and
the chart draws it as a green line. Elevation models include no trees and
only some buildings. **Fainter stars** can be downloaded: to magnitude 8
(36,000 more stars, 5 MB) or the whole Hipparcos catalogue (113,000 more,
15 MB), from d3-celestial; they are stored compactly in Cache Storage (the
service worker keeps caches named `imks-data…` across updates) and appear
as you zoom in, in the chart up to the chosen magnitude. The time bar steps an hour, plays forward or backward (÷2 and ×2
change the speed, ⇄ the direction) and resets. **Full screen** fills the
display; its controls float over the sky and fade after a few seconds
without input, coming back on any movement, tap or key; Escape closes an
open panel, then full screen. Eclipse, occultation and lunar eclipse sheets
computed for a place have a **Show in the sky** button that opens the sky
there at the event, centered on the Sun, the Moon or the occulted body.
The chart's positions are geometric (no refraction); clouds and light
pollution are not modeled. Both views draw on one canvas under the SVG,
at most once per display frame while dragging or pinching; the chart's
drags and flights are drawn there and settle as SVG over its sky and
Milky Way, which stay on the canvas. The sky's colours, the Milky Way and
the ground are drawn by a WebGL2 shader at up to two samples per pixel;
without WebGL2 (or on a software renderer) the same model runs in
JavaScript at lower resolution. Tapping the date opens a date and time
panel with the day's sunrise, sunset, twilights, moonrise and moonset;
tapping the place opens a place panel (cities, coordinates, a search
online, the device's position). A Minor planets layer adds the built-in
minor planets and dwarf planets (and those looked up in the calculator),
which search also finds; zoomed in, the major moons of Mars, Jupiter,
Saturn, Uranus and Neptune appear around their planets, and the planets
become disks with their phases (Saturn with its rings). A star's card
shows its B−V colour index, an estimated temperature and spectral type,
and a black-body spectrum. On phones the orientation button makes the
view follow where the phone points. Both views zoom to the same largest
magnification.

`js/skydata.js` bundles 5,044 stars from XHIP (Anderson & Francis, 2012),
the 88 constellation figures, boundaries and Latin labels, and the Milky Way
isophotes, via [d3-celestial](https://github.com/ofrohn/d3-celestial),
BSD-3-Clause (the license is retained in the generated file), with double
and variable flags from the Hipparcos catalogue (ESA, 1997). To regenerate,
download `data/stars.6.json`, `data/constellations.lines.json`,
`data/constellations.json`, `data/constellations.bounds.json`,
`data/mw.json` and `LICENSE` from that repository into a directory, add the
Hipparcos flags as `hip_main.tsv` (the VizieR query is in
`tools/coelum.mjs`), then run `node tools/coelum.mjs <directory>`. Chart
positions include precession and nutation, and proper motion where matched
to the named-star catalog; they omit annual aberration and parallax. The
existing `altaz` and `radec` functions retain their full precision.

## Checks

`node tests/coelum.mjs` checks sky-chart geometry and catalog positions at
northern, southern and polar locations, and calculator integration.

`node tests/coelum-browser.mjs` checks the chart and realistic views,
search, layers, legend, fading full-screen controls, the eclipse link,
history and offline reuse in Chromium, using the Playwright options
described below.

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
