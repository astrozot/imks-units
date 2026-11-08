// Browser regression checks for online search in the Places modal.
// Uses the same PLAYWRIGHT and CHROME options as browser.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, "index.mjs"), "playwright-core", "playwright"].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* next */ }
}
if (!chromium) {
  console.log("Skipped: Playwright is not installed (npm install playwright-core, and CHROME=/path/to/chrome)");
  process.exit(0);
}

// a static server for the app
const root = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://localhost:${server.address().port}/`;


import assert from "node:assert/strict";
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const context = await browser.newContext({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });
// no satellites from CelesTrak while testing (satellites.js)
await context.route("https://celestrak.org/**", (route) => route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let requests = 0, elevations = 0, releasePisa;
const pisaResponse = new Promise((resolve) => { releasePisa = resolve; });
await page.route("https://nominatim.openstreetmap.org/search?**", async (route) => {
  requests++;
  const query = new URL(route.request().url()).searchParams.get("q");
  if (query === "Pisa") await pisaResponse;
  const result = query === "Pisa" ? { display_name: "Pisa, Toscana, Italia", lat: "43.7159", lon: "10.4019" }
    : query === "Leaning Tower of Pisa" ? { display_name: "Torre pendente, Pisa, Italia", lat: "43.723", lon: "10.3966" } : null;
  await route.fulfill({ json: result ? [result] : [] });
});
await page.route("https://api.open-meteo.com/v1/elevation?**", (route) => {
  elevations++;
  return route.fulfill({ json: { elevation: [4] } });
});
const openPlaces = async () => {
  await page.keyboard.press("Escape");
  await page.click('[data-tab="fn"]');
  await page.click('[data-fncat="Sky"]');
  await page.click('#fn-grid [data-key="f:sunrise("]');
  await page.click('#fn-grid [data-arg="today"]');
  await page.click('#fn-grid [data-key="pick:city"]');
};
const search = page.getByRole("searchbox", { name: "Search places" });
const status = page.locator(".pick-status");
const waitStatus = (text) => page.waitForFunction((text) => document.querySelector(".pick-status")?.textContent.includes(text), text);
try {
  await page.goto(url);
  await openPlaces();
  await search.fill("Pisa");
  assert.equal(await page.locator("[data-pick-insert]").count(), 0, "Pisa is outside the built-in list");
  await search.press("Enter");
  assert.equal(await status.textContent(), "Looking it up…");
  await search.press("Enter");
  releasePisa();
  await waitStatus("Tap a place");
  assert.equal(requests, 1, "repeated Enter sends one request");
  assert.equal(elevations, 1);
  const pisa = page.locator('[data-pick-insert=\'"pisa"\']');
  assert.match(await pisa.textContent(), /Pisa, Toscana, Italia.*4 m/);
  assert.equal(await page.locator(".pick-place-search").evaluate((el) => el.scrollWidth <= el.clientWidth), true, "search fits a phone");
  await pisa.click();
  assert.equal(await page.locator("#expr").textContent(), 'sunrise(today, "pisa")');
  await page.keyboard.press("Enter");
  await page.waitForSelector(".entry .out");
  assert.equal(requests, 1, "selected result evaluates from the saved query");

  // A new app session must retain the place, including without network access.
  await page.reload();
  await openPlaces();
  await context.setOffline(true);
  await search.fill("Rome");
  await search.press("Enter");
  await waitStatus("Tap a place");
  assert.equal(await page.locator('[data-pick-insert=\'"Rome"\']').count(), 1, "built-in cities resolve without the network");
  await search.fill("Pisa");
  await search.press("Enter");
  await waitStatus("Tap a place");
  assert.equal(requests, 1, "cached places resolve offline after reload");
  await context.setOffline(false);
  await search.fill("Unknown test city");
  await page.locator('.pick-place-search button').click();
  await waitStatus("not known to OpenStreetMap");
  assert.equal(await search.inputValue(), "Unknown test city", "failed search keeps the query");
  await search.fill("Leaning Tower of Pisa");
  await page.locator('.pick-place-search button').click();
  await waitStatus("Tap a place");
  const tower = page.locator('[data-pick-insert=\'"leaning tower of pisa"\']');
  assert.match(await tower.textContent(), /Torre pendente/, "translated results remain visible for the original query");
  await tower.click();
  assert.equal(await page.locator("#expr").textContent(), 'sunrise(today, "leaning tower of pisa")');
  await page.keyboard.press("Enter");
  await page.waitForSelector(".entry .out");
  assert.equal(requests, 3, "addresses reuse their exact saved lookup key");
  assert.deepEqual(errors, []);
  console.log("Places modal checks passed");
} finally {
  await browser.close();
  server.close();
}
