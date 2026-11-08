[![iMKS](https://img.shields.io/badge/Web_App-[@]-blue)](https://astrozot.github.io/imks-units/)

[![Coelum](https://img.shields.io/badge/Web_App-[@]-blue)](https://astrozot.github.io/imks-units/coelum/)

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
horizontal coordinates, magnitude, designations, spectral type, parallax
and distance, proper motion, double/variable flags). The search field finds
stars (by name, Bayer letter as "α Lyr", "alpha Lyr" or "alf Lyr",
Flamsteed number, HIP, HD and HR numbers), planets, deep-sky objects (also
by their other names, as "Andromeda Galaxy") and constellations, and flies
to the object. The layers button toggles ground, atmosphere (Sky), Milky Way,
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
only some buildings. **Fainter stars** can be downloaded from the app's
own `data/`: to magnitude 8 (40,000 more stars, 1.3 MB), 10 (349,000,
8.3 MB) or 11 (937,000, 18.4 MB), with parallaxes and proper motions and
found by their HIP, HD or TYC numbers; one set at a time is stored in Cache
Storage (the service worker keeps caches named `imks-data…` across
updates) and appears as you zoom in, in the chart up to the chosen
magnitude. The stars are kept in tiles of the sky, and only those in view
are read. The time bar steps an hour, plays forward or backward (÷2 and ×2
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
become disks with their phases (Saturn with its rings); the card of a
planet with moons opens their view as in `moons()` (shared code in
`js/skyview.js`) over the whole screen, at the chart's time, with the
planet's phase, size, magnitude and distance; Mercury and Venus have a
close-up too, for their phases. The planet there is ray-traced (its bands,
phase, Saturn's rings and the shadows of the globe, the rings and the
moons) by a WebGL shader, four rays a pixel, at every frame of a drag,
pinch or playback; without WebGL the same tracing runs in JavaScript, a
ray a pixel, after the view stops. The **Events** panel (`js/eventspanel.js`,
shared with the Coelum app below) lists the events after the chart's time;
in iMKS, an eclipse or an occultation tapped there is computed as
`solareclipse`, `lunareclipse` or `occultation`, with its map or drawing. Cards give apparent diameters (the Sun,
the Moon, the planets and their moons) and the sizes of deep-sky objects
(OpenNGC's axes). A star's card
shows its B−V colour index, an estimated temperature and spectral type,
and a black-body spectrum. On phones the orientation button makes the
view follow where the phone points. Both views zoom to the same largest
magnification. The AZ/EQ button chooses the mount: alt-az keeps the
horizon level with the zenith up; equatorial keeps RA and Dec of date fixed
on the screen with the celestial pole up, as a telescope's equatorial mount
does (the views keep their cameras in the mount's frame and turn them to
the horizon's to draw). The lock button holds the selected object where it
is on the screen as time runs, in either mount; a drag moves it (and the
sky with it) under the finger, and it keeps tracking from there; zooms
keep it in place. The bottom bar shows a ruler under the
speed, a round angle at the center of the view, and the play button points backward when
time runs backward.

The chart's stars, built in and downloadable, come from one catalog,
[AT-HYG](https://codeberg.org/astronexus/athyg) v4.0 (David Nash): Tycho-2,
Hipparcos, the Yale Bright Star and Gliese catalogs, Gaia DR3 distances and
proper motions, and the IAU star names. V, B−V and the double and variable
flags of Hipparcos stars come from the Hipparcos catalogue (ESA, 1997), and
their positions from its new reduction (van Leeuwen, 2007), as AT-HYG gives
those of the brightest stars at 1991.25. AT-HYG is licensed CC BY-SA 4.0,
and so are the files made from it: `js/stardata.js` (5,783 stars: to V 6,
and all with a name, a Bayer letter or a Flamsteed number) and
`data/stars-8.bin`, `stars-10.bin` and `stars-11.bin` (the others, in sky
tiles of 3°, each brightest first, 16 bytes a star plus the HIP and HD
numbers; the layout is described in the tool). To regenerate, download
`athyg_40.csv.gz` (AT-HYG's `data/`), `hip_main.dat` (VizieR I/239),
`hip2.dat.gz` (I/311) and `suppl_1.dat.gz` (I/259) — the last three from
https://vizier.cfa.harvard.edu/ftp/cats/ — into a directory and run
`node tools/stars.mjs <directory>`.

`js/skydata.js` bundles the 88 constellation figures, boundaries and Latin
labels, and the Milky Way isophotes, via
[d3-celestial](https://github.com/ofrohn/d3-celestial), BSD-3-Clause (the
license is retained in the generated file). To regenerate, download
`data/constellations.lines.json`, `data/constellations.json`,
`data/constellations.bounds.json`, `data/mw.json` and `LICENSE` from that
repository into a directory, then run `node tools/coelum.mjs <directory>`.
Chart positions include precession, nutation and proper motion; they omit
annual aberration and parallax. The existing `altaz` and `radec` functions
retain their full precision.

Satellites (`js/satellites.js`) come from CelesTrak's groups: the space
stations and the brightest ones by default, science, amateur radio and
weather satellites on request (Layers). Their elements are fetched once a
day and kept in Cache Storage for offline use; SGP4 follows near-Earth
orbits only, so geostationary and navigation satellites are left out. In
the sky they are exact at every frame, sunlit (filled diamonds) or in the
Earth's shadow (outlines), with a short trail; modules and craft docked to
a station go with it. Their brightness is estimated from Mike McCants'
standard magnitudes (`js/satmags.js`; regenerate with
`node tools/satmags.mjs quicksat.mag`, the file in `qsmag.zip` from
<https://www.mmccants.org/programs/>), or a default of the group. The
calculator knows them by CelesTrak's names (`passes("SL-16 R/B #22285",
today)` for one of several with a name).

### Coelum, the app

`coelum/` is the sky explorer as an app of its own, without the calculator:
it opens in full screen, now, at the place last chosen there (or the
location in iMKS's Settings), and installs separately (its own manifest and
icons). Its Events panel lists the visible passes of the satellites in the
next day (from 10° high, magnitude 4.5 or brighter; tap one to see it in
the sky at its start, at the real pace), the occultations by the Moon of
the planets and of the stars to magnitude 5 in the next month
(`js/occultations.js`: the Moon's path scanned hourly, the close ones
computed as `occultation` does; from the place, those seen there, with the
limbs and the contacts not seen), and the next solar and lunar eclipses
seen from the place, or anywhere on the Earth, after the time of the sky.
Each occultation or eclipse opens the same map or drawing as
`occultation`, `solareclipse` and `lunareclipse` in iMKS, and Show in the
sky goes to it. Both apps load the same modules from `js/`
(`js/coelumapp.js` is the app's own part; the Events panel is
`js/eventspanel.js`, the eclipse sheets `js/eventview.js`), so a change to
either shows in both. In iMKS, `occultations(t, place)` lists the same
occultations as a table. On the same site
they share their storage (the places and objects looked up, the downloaded
fainter stars, the UTC setting) and `sw.js`, registered for each folder with
a cache of its own.

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

`node tests/coelum-app.mjs` checks the Coelum app: its place at the start,
full screen, the eclipses from a place and anywhere, their sheets and the
sky then, the satellites and their passes, the occultations, and offline
use, with the same
Playwright options. CelesTrak is not reached by the tests: this one serves
`tests/fixtures/celestrak.json` (some satellites of November 2026), the
others an empty list.

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
`styles.css`, `js/`, `coelum/`) and bump the version in `CACHE` in `sw.js`
(e.g. `imks-v2`) so installed copies of both apps pick it up. Coelum is then
at `https://<user>.github.io/imks-units/coelum/`.
