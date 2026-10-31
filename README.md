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
the calendars of `Intl` where it has them), the holidays, and the Sun and
the Moon (against times from PyEphem). It needs no packages and takes a
few seconds.

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
