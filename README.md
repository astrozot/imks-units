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
−1000 through 3000 are supported (UTC). These are signed astronomical
years in the proleptic Gregorian calendar: 0 is 1 BCE, −1 is 2 BCE, and
−1000 is 1001 BCE. The date panel uses the system calendar and time picker
for positive years. **B.C. / signed year** enables `YYYY-MM-DD HH:mm` entry
for year zero and negative years; **Use calendar** returns to native controls.
Standalone Coelum defaults to device time. The date panel offers device
time, UTC, and the selected location’s timezone. The date panel and event timestamps identify
the zone and UTC offset; date entry and events follow the same choice.
The compact bottom bar omits the timezone and stays within its original height.
Location time uses the approximate offline map from
[@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup)
11.7.0 (CC0; see `data/tzlookup-LICENSE.txt`). Boundaries are approximate.
Override a location with an IANA zone (automatic daylight-saving rules),
or a fixed offset such as `UTC+02:00`; **Automatic** restores the map result.
Overrides are saved per location. Browser timezone rules govern historical
and future dates, so fixed offsets are available for manual adjustments. The range is an application
limit, shared with the supported interval of the season formulas;
extending it needs validation of the position and event models.
Galactic longitude (l) and latitude (b) appear in object details, and an
optional galactic grid is available in both views (off by default).
The Place panel opens a large map dialog with an offline globe and online maps;
tap a point and confirm with **Use this place**. “Original place” is offered
only in iMKS. Search results mark objects hidden by their layer or magnitude
settings with a crossed-eye symbol; tap the symbol for its explanation.
The daylight/twilight and Sun altitude status always occupies a separate line.
Browser page zoom is disabled within Coelum, including cards and event sheets;
zoom gestures still control the sky and maps.

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
8.3 MB), 11 (937,000, 18.4 MB) or 12 (2,308,825, 58.9 MB), with available
parallaxes and proper motions and found by their HIP, HD or TYC numbers
(new Gaia stars also by their Gaia DR3 number); one set at a time is stored in Cache
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
ray a pixel, after the view stops. The moons' shadows on the planet are
the part of the Sun each moon covers, seen from each point: an umbra
narrowing away from the moon in a widening penumbra. The moons are
traced too, as lit spheres in their colours (`MOON_LOOK` in
`js/skyview.js`), hidden behind the planet or in front of it, dark in
its shadow. In Sky, the Moon zoomed in is traced on the GPU (`traceMoon`
in `js/coelumsky.js`) from NASA's CGI Moon Kit (`img/planets/moon.jpg`,
LRO colours, and `moon-heights.jpg`, LOLA heights at 4 pixels a degree,
0–255 for −9 to +11 km; public domain), turned by the IAU's rotation
(`moonDisk` in `js/astro.js`, the librations checked against JPL
Horizons), lit by the Lommel–Seeliger law, with its relief (twice as
steep) and soft shadows marched toward the Sun near the terminator. The
relief normals stay facing the observer, and a matching march toward the
observer hides shared terrain occlusion: crater rims must not paint false
dark shadows at the full Moon's limb. `node tests/lunar-relief-browser.mjs`
checks full and nearly full phases, both limbs and polar lighting, and
preserves deep quarter-Moon shadows (set `LUNAR_RELIEF_SCREENSHOT` to save
a preview). At deep zoom, magnified map texels use one filtered ray per
pixel; the silhouette retains four-ray smoothing. This removes three
quarters of the repeated terrain shading work in the interior.

Deep close-ups also keep a GPU lighting cache, separate from the albedo
texture and eclipse illumination. Small pans and zooms reuse a padded
rectangle. Its grid has three lighting samples per elevation texel at the
disk center, independent of display resolution, and is limited to
2048 × 2048 RGBA texels per renderer (16 MiB). Lighting is interpolated;
the colour texture remains sampled at display resolution. Near the limb,
the renderer retains direct shading and four-ray edge smoothing.
Every change of Sun direction, observer direction, libration or elevation
map rebuilds the lighting grid immediately. Animation therefore still
benefits from a smaller terrain pass, without holding outdated shadows.
Earthshine brightness, eclipse geometry and exposure remain live in the
display pass. If the optional target is unsupported, direct shading is
retained. `node tests/lunar-cache-browser.mjs` checks image differences,
cache reuse/invalidation, actual lunar motion, live eclipses, GPU recovery
and both repeated-frame and changing-light rendering costs. Set
`LUNAR_CACHE_SCREENSHOT` to save the direct/cached image comparison.

**Layers → Moon detail → Download high resolution** adds an optional
34.2 MB offline download: an 8192 × 4096 colour map and 5760 × 2880 LOLA
elevations from [NASA's CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/).
Elevation spacing improves from about 7.6 km to 1.9 km at the equator.
The default JPEG has 8-bit heights (about 78 m per level); the optional
lossless PNG preserves NASA's 16-bit half-metre increments in its red
and green channels. These are height increments, not an accuracy claim.
NASA's floating-point version encodes the same measurements; additional
numeric precision would not add terrain detail. The finer map uses actual
slopes rather than the default map's doubled relief, and finer shadow
steps. Terrain still shades a spherical surface; this is not a displaced
mesh or a model of mountain silhouettes for grazing occultations.
Devices with smaller GPU texture limits use scaled maps. Both apps share
the download; it survives app updates and can be removed in Layers.
Phones, touch iPads and devices reporting at most 4 GB of memory use a
pre-sized 9.1 MB pack instead: 4096 × 2048 colour and 2880 × 1440
16-bit heights (about 3.8 km spacing at the equator). The pair decodes to
about 48 MiB instead of 191 MiB, before GPU copies. These are smaller
source files; decoding the desktop maps and then resizing them would still
incur the large memory peak. Existing desktop-sized phone downloads are
replaced automatically when online; offline they fall back to the standard
maps until the smaller files can be fetched. Heights are averaged before
packing their two bytes, preserving half-metre encoding.
Only the active Moon texture level is retained during zooming, temporary
resize canvases are released after upload, and phone Moon rendering is
limited to about one million pixels with a 1024 × 1024 lighting-cache
limit (4 MiB). These are memory budgets in addition to GPU size limits.
`node tests/lunar-mobile-browser.mjs` checks phone asset selection,
migration without decoding old large files, repeated zoom allocation,
Retina buffer limits, partial-decode cleanup and offline restoration.
Use `BROWSER_ENGINE=webkit` to run it in WebKit (omit `CHROME`). These
checks emulate the phone profile; they do not measure memory on an iPhone.
`tools/lunarmaps.py` reproduces the assets from NASA's
`lroc_color_poles_8k.tif` and `ldem_16_uint.tif` (Pillow and numpy required).
`node tests/lunar-detail-browser.mjs` checks height-map selection, deep-zoom
rendering against four rays, offline restoration and download failures.

The planets have
maps of their surfaces or clouds (`img/planets/`, from Solar System
Scope, CC BY 4.0, based on NASA's missions; Venus's clouds at a third of
their contrast, Uranus and Neptune reduced to their bands, Neptune in the
paler colour of Irwin et al. 2024; Saturn's, created by Björn Jónsson
from Cassini and Voyager 2 images), and so do Saturn's rings (Jónsson's
profiles from Voyager and Cassini: the light of their lit and unlit
faces and their transparency, more opaque seen more obliquely)
and the Galilean moons (Jónsson's maps from Voyager and Galileo images,
at the brightness of their albedos beside Jupiter's map, turned with
their longitude 0 toward Jupiter); `python3 tools/planetmaps.py <dir>`
writes Jónsson's (https://bjj.mmedia.is/data/planetary_maps.html), all
fetched the first time a
close-up shows them and kept in Cache Storage (`imks-data-planets`), so
they are not part of the offline download. Saturn's globe and rings cast
finite-Sun penumbras on each other. Solar-disk sampling starts above
256 rendering pixels per Saturn radius, and only where the estimated
transition spans at least 0.75 pixels; smaller shadows use the single ray.
The Sun's angular radius uses the planet's current distance, as for moon
shadows; older saved views retain the mean-distance fallback.
`facing` in `js/astro.js`
gives the longitude below the Earth: the IAU prime meridians (checked
against JPL Horizons; Venus's clouds turn in 4 days), Meeus's Systems I and II for
Jupiter, whose equatorial zone turns on System I. Jupiter's clouds drift,
so its map is turned to put the Great Red Spot where observers measure
it (`GRS` in `js/skyview.js`: 91° in System II on 2026 June 1, +1.75° a
month, from Sky & Telescope's transit tool; update it now and then). In Sky, a solar
eclipse cuts the Moon out of the Sun, its glare and (at totality) the
corona, and darkens the sky as a lower Sun would (to 8° below the horizon
at totality); the Moon in the Earth's shadow (`earthShadow` in
`js/astro.js`, as the lunar eclipses) is darkened in the penumbra and
reddened in the umbra, and lights the sky less. The **Events** panel (`js/eventspanel.js`,
shared with the Coelum app below) lists the events after the chart's time;
in iMKS, an eclipse or an occultation tapped there is computed as
`solareclipse`, `lunareclipse` or `occultation`, with its map or drawing.
Every planet's card also gives its geocentric solar elongation in degrees,
with east or west of the Sun. Cards give apparent diameters (the Sun,
the Moon, the planets and their moons) and the sizes of deep-sky objects
(OpenNGC's axes). A star's card
shows its B−V colour index, an estimated temperature and spectral type,
and a black-body spectrum. On phones the orientation button makes the
view follow where the phone points. Both views zoom to the same largest
magnification. The AZ/EQ/GA button chooses the mount: alt-az keeps the
horizon level with the zenith up; equatorial keeps RA and Dec of date fixed
with the celestial pole up; galactic keeps longitude and latitude fixed
with the galactic pole up. Clicks within one second cycle all three.
After a longer pause, clicks alternate between the endpoints of the last
fast sequence, skipping its intermediate mode. Three fast presses (or a
multiple of three) return to the starting mode and preserve the previous
pair. Holding selects the same next mode as a tap and sets ground and
atmosphere on for AZ, off for EQ or GA. The mode and pair are saved
for the next opening. The views keep
their cameras in the mount's frame and turn them to the horizon's to draw.
The lock button holds the selected object where it
is on the screen as time runs, in any mount; a drag moves it (and the
sky with it) under the finger, and it keeps tracking from there; zooms
keep it in place. The bottom bar shows a ruler under the
speed, a round angle at the center of the view, and the play button points backward when
time runs backward.

The chart's built-in stars and downloads through magnitude 11 come from
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

The magnitude-12 download retains the magnitude-11 stars and adds sources
from [ESA Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3), matched against
the retained catalog by HIP/TYC identifiers and J2000 position (within 2″,
or 10″ for Hipparcos systems whose integrated light is already represented).
Gaia's J2016.0 positions are propagated to J2000.0 before packing. New
sources have exact, searchable `Gaia DR3` identifiers; available HIP/TYC
cross-identifications are retained. The existing stars keep their original
astrometry, photometry and names.

For new sources, Johnson V and display B−V are **estimates**, derived from
observed Gaia G and BP−RP using the [DR3 photometric relationships](https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu5pho/cu5pho_sec_photSystem/cu5pho_ssec_photRelations.html)
(Tables 5.9 and 5.10). The V selection uses −0.5 ≤ BP−RP ≤ 5; B−V is obtained
by inverting the published BP−RP versus B−V polynomial inside its validity
range. No dereddening is applied. Gaia sources without usable colour or
outside the V transformation's range are excluded, so this is not a claim
of a completely exhaustive V≤12 catalog. Missing proper motions are stored
as zero, missing/nonpositive parallaxes as unknown. Cards identify estimated
photometry; colours, temperatures and inferred spectral classes remain
approximate.

To regenerate, run `tools/gaia-stars.adql` as an asynchronous query in the
[Gaia Archive](https://gea.esac.esa.int/archive/), requesting CSV and
`MAXREC=10000000`, and save the complete result as `gaia-v12.csv`. Then run
`node tools/gaia-stars.mjs /path/to/gaia-v12.csv`. The importer checks the
independent DR3 selection count (2,323,409 unique sources, deduplicating
cross-match rows) and refuses a truncated
extract. It writes `data/stars-12.bin` and `data/stars-12.json`, including
source and output checksums, counts and attribution. STAR version 2 keeps
the original arrays and appends 8 bytes per star for Gaia's 64-bit ID (zero
for retained AT-HYG entries); the reader accepts both versions. The file
stays an optional download shared by both apps, outside their offline shell.
Validate with `node tests/gaia-stars.mjs` and, with Playwright configured as
for the other browser checks, `node tests/gaia-stars-browser.mjs`.
The 2026-11-11 browser check at 390×844 with 4× CPU throttling measured
median canvas chart renders of 4–42 ms and Sky renders of 5–25 ms across
dense Sagittarius and high-latitude fields at several zoom levels. Full
SVG chart generation took 9–71 ms. These are desktop browser measurements,
not a physical-phone benchmark; the densest fields can reduce frame rates.

This work has made use of data from the European Space Agency (ESA) mission
Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC).
Funding for the DPAC has been provided by national institutions, in
particular the institutions participating in the Gaia Multilateral
Agreement. The combined downloadable catalog retains AT-HYG's CC BY-SA 4.0
license; full Gaia acknowledgement is included in `data/stars-12.json`.

`js/skydata.js` bundles the 88 constellation figures, boundaries and Latin
labels, and the Milky Way isophotes, via
[d3-celestial](https://github.com/ofrohn/d3-celestial), BSD-3-Clause (the
license is retained in the generated file). To regenerate, download
`data/constellations.lines.json`, `data/constellations.json`,
`data/constellations.bounds.json`, `data/mw.json` and `LICENSE` from that
repository into a directory, then run `node tools/coelum.mjs <directory>`.
Chart positions include precession, nutation, proper motion, annual stellar
parallax where known, solar gravitational light deflection, and annual and
diurnal aberration. Earth position and velocity are shared across a frame; downloaded stars retain tile culling,
with bounds expanded for these corrections. Playback caches catalog space
motion for at most a day while updating parallax, deflection and aberration each frame.
Coordinate grids retain their geometric rotations. Standard local `altaz`
and `radec` stellar positions include solar light deflection, and local
positions include diurnal aberration; geocentric positions exclude the latter.
Stellar detail cards report the included solar deflection. The solar monopole
model uses the ERFA angular limiter inside the opaque solar disk; magnification,
multiple images and planetary gravitational deflection are not simulated.
Full-model ERFA checks span 1900–2099, with a sampled maximum discrepancy of
0.1681″; this is not an all-date accuracy guarantee. The compact engine retains
its approximate nutation/precession and heliocentric Earth state.
Solar-deflection performance measurements are in
`data/solar-deflection-performance.json`. Artificial satellites retain their
geometric SGP4 convention. Stellarium desktop's
[Accuracy chapter](https://github.com/Stellarium/stellarium/blob/master/guide/app_accuracy.tex)
explicitly excludes solar light deflection, so near-Sun apparent stellar
positions can intentionally differ from Stellarium.

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

The calendar-and-sun button on the right rail opens the **Daily almanac**,
a separate view that starts on today in the selected sky timezone. Previous,
Next, Today and the system calendar browse civil days without changing the sky.
Opening the page focuses its close button, keeping mobile keyboards closed.
An optional signed-year field supports B.C. dates.
It summarizes sunrise, sunset, daylight duration, solar noon, three levels of
twilight, Moon rise/set, lunar age and illumination at noon. Daily highlights
cover Moon phases, seasons, eclipses, planetary conjunctions, oppositions and
greatest elongations; tap one to show its time in the sky. Meteor maxima are
calculated separately for each year (2000–2100) by solving for the Sun's
geometric longitude in the J2000 ecliptic at the IMO 2027 working-list value.
The view gives the date/time in the selected timezone, marks peaks on the
current day, and shows Moon illumination at maximum. These are nominal regular
maxima, not dust-trail/outburst forecasts; broad peaks and timing uncertainty
are identified. The parameters and source link live in `js/meteors.js`.
The same almanac is available in iMKS's sky explorer and works offline.
Rise/set assumes an unobstructed horizon; dates with no crossing say so.

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
It also lists the four Moon phases, conjunctions between planets and
between a planet and the Moon, planetary oppositions to the Sun, and
equinoxes and solstices (named by month for either hemisphere).
Greatest elongations lists Mercury and Venus at their maximum angular
distance from the Sun, with eastern/evening or western/morning labels
and the angle in degrees. These Earth-centered events are listed in
both scopes regardless of local altitude; tap one to center the planet.
Phases, conjunctions and oppositions use geocentric ecliptic longitudes;
the lists show local altitudes when a place is selected. Local conjunctions require both bodies above the
horizon and show their average height; Moon conjunctions also show the
Moon's illuminated fraction. Phases and oppositions remain listed even
below the horizon. Tap a phase, opposition or seasonal event to center its body in the
sky, or a conjunction to frame both bodies together. More extends each list.
The telescope page for a planet with moons has its own Events button:
transits, shadow transits, eclipses and occultations of that planet's
moons, computed by the same engine as `moonevents()`. It searches a day
at a time; More extends the list. Tap an event to show the system at its
midpoint, keeping the telescope page open. Events already underway are
included. Times span first to last limb contact, including the penumbra
for eclipses and shadow transits; a second line gives the full phase when
there is one. Predictions are geocentric and cover 1900–2100. The button
disappears when the telescope page closes and is
absent from Mercury and Venus close-ups.
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
`node tests/stellar-positions.mjs` compares stellar positions with independent
ERFA references, isolates diurnal aberration and solar light deflection,
and checks annual parallax,
tile culling, selection and forward/reverse playback. Regenerate those
references with `python tools/stellar-reference.py` (development dependency:
pyerfa). `node tools/stellar-benchmark.mjs /path/to/baseline-checkout` measures
before/after drawing and playback with the magnitude-12 catalog in a phone
viewport, using the browser-test Playwright settings and 4× CPU throttling.
This desktop approximation does not replace measurements on a real phone.

`node tests/coelum-browser.mjs` checks the chart and realistic views,
search, layers, legend, fading full-screen controls, the eclipse link,
history and offline reuse in Chromium, using the Playwright options
described below.

`node tests/phoneorientation.mjs` checks phone tracking response at different
sample rates, compass rejection, stationary noise, zenith continuity, screen
rotation and manual alignment. `node tests/phoneorientation-browser.mjs` checks
panning as calibration and zooming while following in both apps, using the
same Playwright options. The explorer's `orientationDiagnostics` getter reports
sample rate, sample age, filtering error and the 95th-percentile draw duration
while following. Physical-device tests are still needed to measure sensor-to-screen
latency and compass accuracy.

Phone following uses relative attitude when available, with time-based adaptive
quaternion filtering. The compass establishes magnetic north; on iOS its initial
reliable heading is held because Safari does not expose a compass timestamp.
Panning calibrates alignment without stopping following. For accurate north,
select a known object, point the phone at it and use **Layers → Phone orientation
→ Align**. This heading correction also accounts for magnetic declination without
assuming a fixed declination for every observing place. Alignment lasts until
following is turned off. The horizon-level option is remembered across sessions.

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
Uranus and Neptune, fitted to Horizons over 1900–2100. Their periodic
amplitudes have cubic secular terms, sharing the base series' trigonometric
evaluations. To regenerate them, use `node tools/moons.mjs <dir> --fetch`,
then `OPENBLAS_NUM_THREADS=1 python tools/refine-moons.py <dir>` (development
dependencies: NumPy, SciPy and FINUFFT). The original constant-amplitude
fitter remains available as `node tools/moons.mjs <dir>`.

`js/moonseries.js`, the Moon over 1600–2400, has linear secular amplitudes.
Use `node tools/moon.mjs <dir> --fetch`, then
`OPENBLAS_NUM_THREADS=1 python tools/refine-moon.py <dir>` (NumPy and SciPy).
The original lunar fitter remains `node tools/moon.mjs <dir> 2`.
The training samples begin in 1601; the independent audit explicitly
includes both 1600 and 2400. `js/coast.js`, the coastlines of the maps of
the eclipses, comes from Natural Earth with
`node tools/coast.mjs ne_110m_coastline.geojson`.

Independent audits and reproducible comparisons are in
`data/astronomy-accuracy.json`. On the same 1,002 audit dates per body,
the Moon's maximum geometric error falls from 3.47″ to 1.42″ (RMS 0.59″
to 0.37″). Every planetary moon improves by at least a factor of two;
Io's maximum is 21 km, Europa's 22 km and Triton's 4 km. Hyperion and
Iapetus remain approximate (about 2,727 km and 1,122 km). These are sampled
errors, not certified bounds or statistical confidence intervals.

Moon event calculations account for finite moon disks, planetary
flattening, the Sun's actual angular size, umbra and penumbra, visible
shadow contacts at the Earth-facing limb, and differential light travel
time. They refine local minima between coarse samples to catch short
grazes. Returned event arrays retain `[kind, begin, end]`, with `contacts`
(C1–C4, penumbral P1/P4, center crossings) and `errors` properties.
Contact uncertainties use the motion perpendicular to the boundary, so
they increase for grazing events. Atmospheric limbs, mutual moon events,
rings covering moons, and local-observer parallax are not modeled here.

The satellite apparent offsets match Horizons' convention
`(RA_moon − RA_planet) cos(Dec_planet), Dec_moon − Dec_planet`; drawing
coordinates remain tangent-plane coordinates. The reduction includes
nutation, differential annual aberration, and the moon's and parent's
motion during differential light travel time. Rendered shadows use their
own casting positions and the current solar angular radius.

For an independent comparison, `tools/stellarium-check.py <dir> <sources>
--fetch` downloads and compiles the pinned Stellarium analytic ephemerides
(C compiler and NumPy needed). The report names the revision and exact
configuration: VSOP87/ELP82B, MarsSat, L1.2, TASS 1.7 and GUST86. Stellarium
using DE440/441 is a different configuration. Differences between these
older satellite theories and current Horizons are recorded, rather than
assumed to be errors in this app. Triton has no matching routine in this
comparison. The C sources remain in the development cache and are not
shipped in the app.

Run `node tools/moons.mjs <dir> --audit` and
`node tools/moon.mjs <lunar-dir> --audit`, then
`node tools/astronomy-accuracy.mjs <dir> <lunar-dir>` to regenerate the
budget and compact offline fixtures. The audit dates are independent of
the fitting and initial validation samples. Satellite validation uses
stratified dates over the entire interval, fixing the former
sorted-then-sliced date selection. `tools/astronomy-benchmark.mjs` measures
frame calculations and event searches; an optional baseline directory
allows interleaved comparisons (`data/astronomy-performance.json`).

Solar eclipses and lunar occultations still use a smooth mean lunar limb.
The refined ephemeris improves their positional input, but does not predict
terrain-dependent contacts or Baily's beads. Earth-rotation uncertainty
still limits long-range eclipse geography. Precise stellar occultations
by Uranus and Neptune should use the native JPL refinement rather than
the approximate VSOP87 positions. Independent moon-event checks now include
246 limb, eclipse and visible-shadow contacts; the native shadow observer
uses the Earth-to-planet ray. A pinned Stellarium 26.3 satellite-orbit
comparison and the terrain-data requirements are documented in
[`workers/ephemeris-static/README.md`](workers/ephemeris-static/README.md).

Event detail sheets offer a fixed-size **JPL Ephemeris** switch. DE440 is
preferred in its coverage; DE441 supplies the supported historical dates.
It computes local solar-eclipse or occultation contacts at the selected
place, or geocentric lunar-eclipse contacts, in a dedicated worker. The
sky and calculator retain their compact ephemerides. With JPL selected,
eclipse/occultation maps and local contacts use the same native provider.
Solar-shadow playback interpolates a small worker-generated position grid
instead of evaluating native coefficients on animation frames. Refinement is explicit; opening a sheet or playing the sky
does not download a year or start a precision worker. Selecting another
place invalidates the refined contacts. Closing the sheet, cancelling,
starting another refinement or finishing the calculation releases the
worker. A stalled job times out after 60 seconds.

`data/precision/1900.bin` through `2100.bin` retain the native Float64
Chebyshev records from JPL DE440s, with three-day overlaps at the year
boundaries. The largest year is 122,440 bytes; all years together occupy
about 21.5 MiB on the host. The phone loads one year per calculation.
Downloads are streamed with a 512 KiB file limit and checked against the
index's exact size and SHA-256. The separate `imks-data-precision-v1`
CacheStorage cache, shared by both apps, is limited to 8 MiB and evicts
older downloads. Neither service worker puts these data in its app asset
cache. The clear button removes downloaded event data; a cached year can
be reused offline. These buffer/storage limits do not describe the whole
JavaScript worker heap, which also contains code and compact models.
Asynchronous streaming, integrity checks and cache access run in the page;
the validated buffer is transferred to the worker without copying. This
also avoids WebKit cache inconsistencies between restarted workers.

The optional reduction uses barycentric light time, solar light
deflection, relativistic aberration, IAU 2006 precession and IAU 2000B
nutation. IERS daily UT1 and polar motion are included where available;
elsewhere the app retains its ΔT model and reports rotation uncertainty.
The packed IERS series includes both observations and predictions, not a
live feed. Future civil-time labels outside that series are estimated UT;
unknown future leap seconds are not predicted. Planetary system
barycentres are corrected using the compact satellite models; this does
not supply precise orbits for individual satellites or make outer-planet
occultations authoritative. Stellar positions retain the catalog's own
proper-motion and parallax limitations. Lunar terrain and atmospheric
limb effects remain outside this refinement; lunar eclipses retain the
existing enlarged-Earth shadow convention. Seconds displayed are not an
accuracy guarantee for observed contacts.
The cached index pins the downloaded Earth-orientation snapshot. Published
endpoint versions provide updated snapshots; old fragments are evicted
automatically within the bounded cache.

`node tests/precision.mjs` checks all yearly checksums and boundaries,
588 native SPK states, ERFA frame matrices, 108 independent Skyfield
apparent positions and 13 event cases (including a no-event case).
Sampled position discrepancies are below 0.0017″ and contact differences
below 0.08 s, using common time/radius/shadow assumptions; these measure
implementation agreement, not DE440's physical uncertainty over two
centuries. The detailed report is `data/precision-accuracy.json`.
`tests/precision-browser.mjs` checks phone layout, CPU-throttled animation,
worker cancellation/release, checksum recovery, bounded cache eviction,
and offline reuse in both apps using Chromium. WebKit verifies online
calculation and cache-only reuse; its test browser's offline emulator
prevents even a trivial local worker from starting, so actual offline
behavior on iPhone remains to be checked. Reports record this limitation.
Desktop browser throttling does not replace testing
on an actual iPhone 12.

Regenerate the year files with `python tools/precision-data.py de440s.bsp
--eop finals2000A.all` (NumPy and jplephem). Generate independent references
with `python tools/precision-reference.py de440s.bsp --eop finals2000A.all`
(Skyfield, SciPy and ERFA), then `node tests/precision.mjs --report`.
Preparation tools contact no service at app runtime. DE440s and the full
DE440 have the same solution within the smaller kernel's interval.
The retained yearly-pack path covers 1900–2100; the native path below
provides the extended dates and bodies.

The preferred replacement is free static hosting: see
[`workers/ephemeris-static`](workers/ephemeris-static/README.md). Verified
original ephemeris and IERS files are split once into exact 256/512 KiB chunks;
phones request the chunks for the selected date on explicit refinement.
The original native coefficients are preserved, with per-chunk SHA-256
verification. There are no yearly extracts on this path. Extraction and
calculations run in a background worker, with at most 1 MiB of resident
raw chunks and an 8 MiB persistent payload cache. No R2 bucket or server
calculation is used; static asset requests use Cloudflare's free hosting.
The versioned catalogue adds DE441 outside DE440, through the sky's existing
astronomical-year range −1000–3000, plus MAR099, JUP365, SAT441, URA184 and
NEP097 for native planet centres and 20 natural moons within their coverage.
DE440 remains preferred whenever it covers the requested interval.
`STATIC_DATA_URL` in
`js/precisionconfig.js` selects this path. Existing yearly data remains
available as an alternative configuration and is not requested with a
static URL configured.

`node tests/precision-static.mjs` checks native extraction, offline reuse,
checksum verification, cancellation, cross-chunk reads and cache eviction.
Set `STATIC_STAGED` to test the full data against 13 independent event
references. `tests/precision-static-browser.mjs` exercises the actual app
against a separate CORS-enabled static server, or a live `STATIC_URL`.
Desktop animation measurements are in `data/static-ephemeris-performance.json`
and `data/static-ephemeris-webkit-performance.json`; real iPhone memory and
animation checks remain necessary before public release. The previous
R2 range transport remains optional; see [`tools/r2`](tools/r2/README.md).

Planet, Sun, Moon and natural-moon detail cards offer a precise-position
switch at the top, alongside a one-line Local/Geocentric selector that
works for both models. JPL updates the existing fields; switching to
Approx. Ephem. restores the compact model without a download or worker.
Results are timestamped snapshots while the sky clock runs. Changing the
object or place resets the result; completed snapshots
identify a system barycentre or compact planet-centre correction when
native centre data is unavailable. No download or numeric worker starts
merely by opening a card or playing the animation. The first day of Jupiter/Saturn moon events also offers JPL refinement
using native planet-centre and satellite records. Other systems, the
calculator and unrefined searches retain the compact models. Native
searches run one day at a time; Next day opens a new explicit request. Extended numerical checks and
phone-sized browser checks are documented with the static-data service.
During loading the same button reads Downloading…; clicking it cancels the
job and discards its new fragments, retaining previously cached ephemerides.
There is no manual clear-cache control; the bounded cache evicts old data.

The earlier extraction Worker prototype is retained in
[`workers/ephemeris`](workers/ephemeris/README.md), named
`astrolabium-ephemeris` for the intended Astrolabium branding. It reads
bounded native SPK byte ranges from JPL and returns only a short date-window
extract; it needs no yearly production files or full-kernel phone
downloads. It also supports separate planetary-satellite kernels.
To use that prototype instead, set `EPHEMERIS_SERVICE` in
`js/precisionconfig.js` with both static and R2 URLs empty. With a service configured,
DE440 dates are offered from 1550 through early 2650 where native coverage
exists; satellite coverage is the intersection with the selected kernel.
The active historical DE441 implementation uses the versioned static
catalogue above rather than this prototype service.

`node tests/ephemeris-service.mjs` checks 140 native states against
independent jplephem evaluations, type 2/3 records, exact native planet
centres and satellite positions, bounded range reads, origin restrictions,
checksum validation and offline cache reuse. The native service browser
test runs the actual app at 6× CPU throttling and verifies zero annual-file
requests; see `data/native-ephemeris-performance.json`. Satellite event
searches still use their existing compact models; supplying native
satellite positions does not yet switch those event searches.

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

Lunar eclipses in Sky use the visible area of the finite solar disk at each
point on the Moon, plus faint atmospheric red light that fades toward the
umbra's center. Lighting and exposure are calculated in floating-point linear
RGB before conversion to the display; totality increases the disk's exposure
smoothly, while the surrounding sky follows the Moon's actual integrated
illumination. The GPU and Canvas fallback share this model. The lunar eclipse
sheet's Simulation close-up uses the same surface renderer, with libration
and relief. Click an event time in either tab to open Sky at that instant,
centered on the Moon at a close-up zoom; worldwide events keep the current
observing location. Atmospheric colours represent a typical eclipse; clouds and volcanic aerosols can make
real eclipses brighter or darker. `node tests/lunar-eclipse.mjs` checks the
light model against numerical solar-disk integration;
`node tests/lunar-eclipse-browser.mjs` checks rendered lighting, crop/rotation
and the fallback (`ECLIPSE_SCREENSHOT=/path/to/preview.png` saves a preview).
`node tests/lunar-page-browser.mjs` checks the eclipse sheet, image export,
and event navigation in Coelum and iMKS.

At high zoom in Sky, sunlit lunar features appear in blue when Labels is on.
Tap a feature (also with Labels off) for its name, type, size and coordinates.
The selected feature is outlined by an ellipse projected onto the lunar surface;
its size follows the catalogue diameter/extent, rather than a surveyed boundary.
Lunar names also appear in Search, distinguished from stars with the same name.
Selecting one opens Sky, centers the feature and sets a useful zoom. Permanently
hidden lunar centers are excluded from Search using a conservative libration
envelope (±10° longitude, ±8° latitude); potentially observable limb features
remain searchable. Temporarily hidden or unlit features are identified in the
results. Selecting an unlit feature on the visible hemisphere keeps the entire
Moon in view and marks the searched location, even below the automatic label
zoom threshold. Features beyond the limb frame the Moon without a highlight. Other search results
also reset the zoom to suit the object's angular size or surrounding field.
The feature layer starts when the Moon is 240 CSS pixels across; smaller
features become selectable as their apparent size grows. Features beyond the
limb, on the night side or inside Earth's umbra are excluded. The detailed
Moon texture and WebGL renderer are required for surface alignment.

Mars surface features are available on the textured disk in **Sky** and in
**Moons of Mars**, opened from Mars's detail card. The offline catalogue contains 2,054 unique approved
IAU/USGS names. At a globe diameter of 240 CSS pixels, feature centers become
selectable, with labels added progressively by apparent size and prominence.
Search switches to Sky and frames a visible, sunlit feature directly; small
craters get a closer view. An unavailable feature frames Mars without a
highlight. Tap a surface feature or its label to select it and show its contour
and details.

Contours use measured crater ellipses from Robbins's 2020 release, mapped
USGS/OpenPlanetary polygon footprints, or derived ellipses for suitable compact
landforms. Eight familiar albedo markings have approximate identification
contours digitised from Martin Lewis's 2022–23 reference map; their cards show
the epoch and the fact that these markings can change. Other albedo names
retain center markers. Each card identifies its geometry source and shows
ellipse axes when available. All shapes rotate, foreshorten and clip at the
limb/terminator with the same globe as the texture. Polar caps are unchanged.
Sources, filters, caveats and rebuilding instructions are in
[data/mars-features.md](data/mars-features.md). Tests:
`node tests/marsfeatures.mjs`, `node tests/marsfeatures-browser.mjs`.

Surface features follow ordinary objects in Search; use a Moon/Mars prefix
to search them directly. Search uses status icons with a key containing only
symbols in the current results; tap or hover an icon for its meaning.

`js/lunardata.js` bundles 9,087 approved IAU/USGS lunar names, including
lettered craters, from the [Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/Page/MOON/target)
(LOLA 2011 coordinates). `python3 tools/lunar-features.py <official KMZ>`
regenerates it. `node tests/lunarfeatures.mjs` checks surface alignment,
illumination and feature selection; the high-zoom browser tests cover labels
and taps on the rendered Moon (`node tests/lunarfeatures-browser.mjs`).

`node tests/almanac.mjs` checks civil-day bounds, polar daylight, lunar
crossings, known event dates and meteor activity windows.
`node tests/almanac-browser.mjs` checks date navigation, sky-time independence,
responsive layout and opening daily highlights, with the same Playwright options.

`node tests/coelum-app.mjs` checks the Coelum app: its place at the start,
full screen, the eclipses from a place and anywhere, their sheets and the
sky then, phases and oppositions centered on their bodies, conjunctions
framed around both bodies in both views, the satellites and their passes,
the occultations, and offline
use, with the same
Playwright options. CelesTrak is not reached by the tests: this one serves
`tests/fixtures/celestrak.json` (some satellites of November 2026), the
others an empty list.

`node tests/eventspanel.mjs` checks the event searches, their longitude
conditions, local horizon filtering, average heights, Moon illumination,
seasons, chronological order, pagination and cancellation.
`node tests/mooneventspanel.mjs` checks planetary moon events, their
midpoint states, chronological order, ongoing events and cancellation.
`node tests/moon-contacts.mjs` checks finite disks and shadows, projected
ellipses, visible shadow contacts, short grazes and validation-date coverage.
`node tests/astronomy-accuracy.mjs` checks the Moon and all 20 planetary
moons against independent Horizons samples and pinned Stellarium references.
`node tests/moon-events-browser.mjs` checks the contact UI on a phone,
full-phase times, ongoing events, pagination and offline use, with the same
Playwright options as the other browser checks.

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
