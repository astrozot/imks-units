// Offline support for iMKS Units and Coelum (coelum/, registered there
// for that folder): the apps' own files are served from the cache and
// refreshed in the background; other requests (exchange rates) go to the
// network. Both apps share the files, each registration with a cache of
// its own (imks-v…, coelum-v…), so that an update of one leaves the other
// working offline. Caches named imks-data… hold downloads the user asked
// for (coelum's fainter stars) and survive updates.
const APP = new URL(self.registration.scope).pathname.endsWith("/coelum/") ? "coelum" : "imks";
const CACHE = `${APP}-v111`;
const FILES = ["./", "index.html", "styles.css", "js/data.js", "js/unum.js", "js/units.js", "js/interp.js", "js/defs.js", "js/dates.js", "js/calendars.js", "js/sensors.js", "js/vsop87.js", "js/moons.js", "js/moonseries.js", "js/astro.js", "js/skyview.js", "js/lunarfeatures.js", "js/marsfeatures.js", "js/lunardata.js", "js/coelum.js", "js/coelumsky.js", "js/coelumui.js", "js/phoneorientation.js", "js/skyraster.js", "js/skyhorizon.js", "js/skydata.js", "js/stardata.js", "js/eclipsemap.js", "js/osmmap.js", "js/snapshot.js", "js/coast.js", "js/catalog.js", "js/minorplanets.js", "js/sgp4.js", "js/lookup.js", "js/sky.js", "js/app.js", "js/functionhelp.js", "js/diagnostics.js", "js/eventview.js", "js/eventspanel.js", "js/coelumapp.js", "js/satellites.js", "js/satmags.js", "js/occultations.js", "coelum/", "coelum/index.html", "coelum/manifest.webmanifest", "coelum/icon-180.png", "coelum/icon-192.png", "coelum/icon-512.png", "coelum/icon-maskable-512.png", "img/moon.webp", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon.ico", "favicon-16.png", "favicon-32.png"];

self.addEventListener("install", (ev) => {
  // bypass the HTTP cache, so a new version never caches stale files
  const reqs = FILES.map((f) => new Request(f, { cache: "reload" }));
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(reqs)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith(`${APP}-v`)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// the app asks for the version, to show it and to check for updates
self.addEventListener("message", (ev) => {
  if (ev.data === "version" && ev.ports[0]) ev.ports[0].postMessage(CACHE);
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  // no-store requests (the app's update check) go straight to the network
  if (req.method !== "GET" || req.cache === "no-store" || new URL(req.url).origin !== location.origin) return;
  ev.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
