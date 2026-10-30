// Offline support for iMKS Units: the app's own files are served from
// the cache and refreshed in the background; other requests (exchange
// rates) go to the network.
const CACHE = "imks-v36";
const FILES = ["./", "index.html", "styles.css", "js/data.js", "js/unum.js", "js/units.js", "js/interp.js", "js/defs.js", "js/app.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon.ico", "favicon-16.png", "favicon-32.png"];

self.addEventListener("install", (ev) => {
  // bypass the HTTP cache, so a new version never caches stale files
  const reqs = FILES.map((f) => new Request(f, { cache: "reload" }));
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(reqs)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
