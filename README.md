[![Web App](https://img.shields.io/badge/Web_App-[@]-blue)](https://astrozot.github.io/imks-units/)

# iMKS Units

A unit calculator for phones, tablets and computers: numbers carry units,
`@` converts, uncertainties propagate, and it includes CODATA constants,
solar-system data, and cosmology and lensing functions.

Open `index.html` from any web server. Served over HTTPS (for example
GitHub Pages) it can be installed with **Add to Home Screen** and then
works offline. Exchange rates are refreshed daily when online.

## Publishing on GitHub Pages

1. Create a new public repository (e.g. `imks-units`).
2. Upload all files of this folder to the repository root
   (Add file → Upload files; include `.nojekyll`).
3. Settings → Pages → Build and deployment → Source: *Deploy from a branch*,
   Branch: `main`, folder `/ (root)` → Save.
4. After a minute the app is at `https://<user>.github.io/imks-units/`.

To publish a new version, replace `index.html` and bump `CACHE` in `sw.js`
(e.g. `imks-v2`) so installed copies pick it up.
