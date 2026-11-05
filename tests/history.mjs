// Browser checks for history search, pins and backup compatibility.
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
const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(5000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.addInitScript(() => {
  navigator.canShare = () => true;
  navigator.share = async ({ files }) => { window.testBackup = JSON.parse(await files[0].text()); };
});
const run = async (input) => { await page.keyboard.type(input); await page.keyboard.press("Enter"); };
const open = () => page.getByRole("button", { name: "History", exact: true }).click();
const search = page.locator("#history-search");
const rows = page.locator(".history-match");
const pinned = () => page.getByRole("tab", { name: "Pinned", exact: true }).click();
const close = () => page.locator(".sheet-head [data-close]").click();
const clearResults = async () => {
  await open();
  await page.locator("[data-history-clear]").click();
  await page.locator("#menu button").filter({ hasText: "Clear results" }).click();
};
try {
  await page.goto(url);
  await page.waitForFunction(() => window.imks?.calc);
  await open();
  assert.match(await page.locator(".history-no-matches").textContent(), /will appear here/);
  await pinned();
  assert.match(await page.locator(".history-no-matches").textContent(), /No pinned/);
  await close();
  await run("2 km @ m");
  await run("7*11");
  await run("2 km @ m");
  await open();
  assert.equal(await rows.count(), 3);
  await search.fill("KM");
  assert.equal(await rows.count(), 2, "search ignores case");
  await search.fill("2000");
  assert.equal(await rows.count(), 2, "search includes result text");
  await search.fill("km @ m");
  await rows.first().getByRole("button", { name: "Pin calculation", exact: true }).click();
  assert.equal(await page.evaluate(() => window.imks.pins.length), 1, "pins deduplicate repeated expressions");
  assert.equal(await page.locator("#history .entry-pin").count(), 2, "both occurrences show pin markers");
  await search.fill("not-a-matching-calculation");
  assert.equal(await rows.count(), 0);
  assert.match(await page.locator(".history-no-matches").textContent(), /No matching/);
  await search.fill("");
  await pinned();
  assert.equal(await rows.count(), 1);
  await rows.first().getByRole("button", { name: "Reuse expression: 2 km @ m", exact: true }).click();
  assert.equal(await page.evaluate(() => window.imks.text), "2 km @ m");
  assert.equal(await page.evaluate(() => window.imks.history.length), 3, "reuse does not evaluate");
  await page.keyboard.press("Escape");

  // Pinning is also available in the original history context menu.
  await page.locator("#history .entry .in").first().click({button: "right"});
  await page.getByRole("button", { name: "Unpin calculation", exact: true }).click();
  assert.equal(await page.evaluate(() => window.imks.pins.length), 0);
  await page.locator("#history .entry .in").first().click({button: "right"});
  await page.getByRole("button", { name: "Pin calculation", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => window.imks?.calc);
  await page.keyboard.type("9+");
  await page.keyboard.press("Control+f");
  assert.equal(await page.locator("#sheet-title").textContent(), "History");
  await pinned();
  assert.equal(await rows.count(), 1, "pins survive reload");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => window.imks.text), "9+", "closing history preserves the draft");
  await page.keyboard.press("Escape");

  // Pins survive rolling history's cap, and visible rows keep their indices.
  await page.evaluate(() => {
    localStorage.setItem("imks.history", JSON.stringify(Array.from({length: 300}, (_, i) => ({kind: "value", input: `${i} m`, text: `${i} m`, html: `${i} m`}))));
  });
  await page.reload();
  await page.waitForFunction(() => window.imks?.calc);
  await run("1000 m");
  assert.equal(await page.evaluate(() => window.imks.history.length), 300);
  assert.equal(await page.locator("#history .entry").count(), 300);
  await page.locator("#history .entry .in").first().click();
  assert.equal(await page.evaluate(() => window.imks.text), "1 m", "trimmed history entry reuses the correct expression");
  await page.keyboard.press("Escape");
  await clearResults();
  assert.equal(await page.evaluate(() => window.imks.history.length), 0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => window.imks.history.length), 300, "clear history still supports undo");
  await clearResults();
  await open();
  await pinned();
  assert.equal(await rows.count(), 1, "pins survive clearing history");
  assert.equal(await page.locator("[data-history-clear]").isDisabled(), true);
  assert.equal(await page.locator(".history-browser").evaluate((el) => el.scrollWidth <= el.clientWidth), true, "browser fits a phone");
  if (process.env.HISTORY_SCREENSHOT) await page.screenshot({ path: process.env.HISTORY_SCREENSHOT });
  await close();

  // New backups preserve pins; importing a legacy backup leaves pins intact.
  await page.click("#btn-settings");
  await page.click("#export");
  await page.waitForFunction(() => window.testBackup);
  const backup = await page.evaluate(() => window.testBackup);
  assert.deepEqual(backup.pins, ["2 km @ m"]);
  await close();
  await open(); await pinned();
  await rows.first().getByRole("button", { name: "Unpin calculation", exact: true }).click();
  assert.equal(await rows.count(), 0);
  await close();
  const restore = async (data) => {
    await page.click("#btn-settings");
    await page.locator("#import-file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => document.querySelector("#sheet").hidden);
  };
  await restore(backup);
  assert.deepEqual(await page.evaluate(() => window.imks.pins), ["2 km @ m"]);
  delete backup.pins;
  await restore(backup);
  assert.deepEqual(await page.evaluate(() => window.imks.pins), ["2 km @ m"]);
  await open();
  await page.getByRole("tab", { name: "All history", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#history-pins").getAttribute("aria-selected"), "true", "tabs support keyboard navigation");
  await close();
  await run("history_var = 5");
  await clearResults();
  assert.equal(await page.evaluate(() => window.imks.calc.env.vars.has("history_var")), true, "clearing results retains variables");
  await open();
  assert.equal(await page.locator("[data-history-clear]").isDisabled(), false, "start over remains available with variables and no results");
  await page.locator("[data-history-clear]").click();
  await page.locator("#menu button").filter({ hasText: "Start over" }).click();
  assert.equal(await page.evaluate(() => window.imks.calc.env.vars.has("history_var")), false, "start over clears variables");
  assert.deepEqual(await page.evaluate(() => window.imks.pins), ["2 km @ m"], "start over preserves pins");
  await page.reload();
  await page.waitForFunction(() => window.imks?.calc);
  await context.setOffline(true);
  await open(); await pinned();
  assert.equal(await rows.count(), 1, "saved pins work offline");
  await rows.first().getByRole("button", { name: "Reuse expression: 2 km @ m", exact: true }).click();
  await page.keyboard.press("Enter");
  assert.match(await page.locator("#history .entry .out").last().textContent(), /2000/, "saved expression evaluates offline");
  assert.deepEqual(errors, []);
  console.log("All history checks passed");
} catch (e) {
  if (process.env.HISTORY_SCREENSHOT) await page.screenshot({ path: process.env.HISTORY_SCREENSHOT });
  throw e;
} finally {
  await browser.close();
  server.close();
}
