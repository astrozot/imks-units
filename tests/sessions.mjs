// Browser checks for named sessions, migration and backup compatibility.
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
  if (!sessionStorage.getItem("seeded-sessions")) {
    localStorage.setItem("imks.history", JSON.stringify([{kind:"done",input:"mass=2 kg",text:"Done"}]));
    localStorage.setItem("imks.session", JSON.stringify(["mass=2 kg"]));
    localStorage.setItem("imks.rid", "0");
    sessionStorage.setItem("seeded-sessions", "true");
  }
  navigator.canShare = () => true;
  navigator.share = async ({ files }) => { window.testBackup = JSON.parse(await files[0].text()); };
});
const close = () => page.locator(".sheet-head [data-close]").click();
const history = async () => {
  if (await page.locator("#sheet").isVisible()) await close();
  await page.click("#btn-history");
};
const manager = async () => { await history(); await page.getByRole("button", {name:"Choose session",exact:true}).click(); };
const choose = async (name) => {
  await manager();
  await page.locator(".session-choice").filter({has:page.getByText(name,{exact:true})}).click();
  await close();
};
const nameSession = async (action, name) => {
  await manager();
  await page.getByRole("button", {name:action,exact:true}).click();
  await page.getByRole("textbox", {name:"Session name",exact:true}).fill(name);
  await page.getByRole("button", {name:action === "Rename session" ? "Save name" : "Create session",exact:true}).click();
  await close();
};
const run = async (input) => { await page.keyboard.press("Escape"); await page.keyboard.type(input); await page.keyboard.press("Enter"); };
const name = () => page.evaluate(() => window.imks.workspaces.find((w)=>w.id===window.imks.activeSessionId).name);
const value = (src) => page.evaluate((src) => window.imks.calc.evalExpr(src).x.n, src);
const restore = async (data) => {
  if (await page.locator("#sheet").isVisible()) await close();
  await page.click("#btn-settings");
  await page.locator("#import-file").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(data))});
  await page.waitForFunction(() => document.querySelector("#sheet").hidden);
};
try {
  await page.goto(url);
  await page.waitForFunction(() => window.imks?.calc);
  assert.equal(await name(), "Main session");
  assert.equal(await value("mass @ kg"), 2000, "legacy variables migrate");
  assert.equal(await page.locator("#history .entry").count(), 1, "legacy history migrates");
  await run("session_fn(x)=mass*x");
  await run("mass");
  assert.equal(await page.evaluate(() => window.imks.history.at(-1).rid), 1);
  await page.keyboard.type("mass+1kg");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const mainDraft = await page.evaluate(() => ({text:window.imks.text,caret:window.imks.caret}));
  await nameSession("New session", "Lab measurements");
  assert.equal(await name(), "Lab measurements");
  assert.equal(await page.locator("#history .entry").count(), 0);
  assert.equal(await page.evaluate(() => window.imks.calc.run("mass").kind), "error", "variables do not leak");
  assert.equal(await page.evaluate(() => window.imks.calc.run("session_fn(2)").kind), "error", "functions do not leak");
  await run("mass=5 kg");
  assert.equal(await page.evaluate(() => window.imks.history.at(-1).rid), 1, "each session starts at ans_1");
  assert.equal(await value("ans_1"), 5000);
  await page.keyboard.type("mass*3");
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.imks.text), "mass*");
  await page.keyboard.press("Control+Shift+z");
  await choose("Main session");
  assert.deepEqual(await page.evaluate(() => ({text:window.imks.text,caret:window.imks.caret})), mainDraft, "switch restores draft and cursor");
  assert.equal(await value("ans_1"), 2000, "numbered results stay isolated");
  assert.equal(await value("session_fn(2)"), 4000);
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.imks.text), "mass+1k", "undo uses the active session's edit history");
  await page.keyboard.press("Control+Shift+z");
  await run("v=(3 +/- 0.1)m");
  const rid = await page.evaluate(() => window.imks.history.at(-1).rid);
  assert.equal(await value(`err(ans_${rid}-v)`), 0);
  await choose("Lab measurements");
  assert.equal(await page.evaluate(() => window.imks.text), "mass*3");
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.imks.text), "mass*", "undo restored for second session");
  await page.keyboard.press("Control+Shift+z");
  await choose("Main session");
  assert.equal(await value(`err(ans_${rid}-v)`), 0, "switch preserves live uncertainty correlations");
  await choose("Lab measurements");
  await page.click("#btn-settings");
  await page.click("#open-defs");
  await page.locator("#defs-text").fill("shared_constant=11");
  await page.click("#defs-save");
  await close();
  await nameSession("Rename session", "Experiments");
  assert.equal(await name(), "Experiments");
  await nameSession("Duplicate session", "Experiment copy");
  assert.equal(await name(), "Experiment copy");
  assert.equal(await value("mass"), 5000);
  assert.equal(await value("ans_1"), 5000);
  assert.equal(await page.evaluate(() => window.imks.text), "mass*3");
  await run("mass=9 kg");
  await choose("Experiments");
  assert.equal(await value("mass"), 5000, "duplicate edits do not change original variables");
  assert.equal(await page.evaluate(() => window.imks.history.length), 1, "duplicate history is independent");
  await history();
  await page.getByRole("button", {name:"Pin calculation",exact:true}).first().click();
  await close();
  await choose("Main session");
  assert.equal(await value("shared_constant"), 11, "My definitions are shared with other sessions");
  await history();
  await page.getByRole("tab", {name:"Pinned",exact:true}).click();
  assert.equal(await page.locator(".history-match").count(), 1, "pins are shared");
  await close();
  await choose("Experiments");
  await page.reload();
  await page.waitForFunction(() => window.imks?.calc);
  assert.equal(await name(), "Experiments", "active session persists");
  assert.equal(await page.evaluate(() => window.imks.text), "mass*3", "draft persists across reload");
  assert.equal(await value("mass"), 5000);
  await choose("Main session");
  assert.equal(await value("session_fn(2)"), 4000, "functions restore from storage");
  await choose("Experiments");
  await page.click("#btn-settings");
  await page.click("#export");
  await page.waitForFunction(() => window.testBackup);
  const backup = await page.evaluate(() => window.testBackup);
  assert.equal(backup.version, 2);
  assert.equal(backup.sessions.length, 3);
  assert.equal(backup.sessions.find((w)=>w.id===backup.activeSessionId).name, "Experiments");
  assert.equal(backup.pins.length, 1);
  await close();
  await nameSession("New session", "Disposable");
  await restore(backup);
  assert.equal(await page.evaluate(() => window.imks.workspaces.length), 3);
  assert.equal(await name(), "Experiments");
  assert.equal(await page.evaluate(() => window.imks.text), "mass*3");
  await choose("Experiment copy");
  assert.equal(await value("mass"), 9000, "backup preserves other sessions' variables");
  await history();
  await page.locator("[data-history-clear]").click();
  await page.locator("#menu button").filter({hasText:"Start over"}).click();
  assert.equal(await page.evaluate(() => window.imks.calc.run("mass").kind), "error", "start over clears active variables");
  await choose("Experiments");
  assert.equal(await value("mass"), 5000, "clearing another session leaves this one intact");
  // A measurement started in one session must not type into another.
  await page.evaluate(async () => {
    const { SENSORS } = await import("./js/sensors.js");
    const original = SENSORS.here.read;
    SENSORS.here.read = () => new Promise((resolve) => {
      window.releaseSessionSensor = () => { SENSORS.here.read = original; resolve({list:[[45,0.01],[9,0.01]],unit:"deg"}); };
    });
  });
  await page.click('[data-tab="fn"]');
  await page.click('[data-fncat="Sensors"]');
  await page.click('[data-key="sensor:here"]');
  await choose("Main session");
  const unchangedDraft = await page.evaluate(() => window.imks.text);
  await page.evaluate(() => window.releaseSessionSensor());
  assert.equal(await page.evaluate(() => window.imks.text), unchangedDraft, "late sensor result does not alter another draft");
  await manager();
  if (process.env.SESSION_SCREENSHOT) await page.screenshot({path:process.env.SESSION_SCREENSHOT});
  assert.equal(await page.locator(".session-list").evaluate((el)=>el.scrollWidth<=el.clientWidth), true, "session chooser fits a phone");
  await close();
  await nameSession("Rename session", "A very long session name that should fit the narrow history title");
  await history();
  assert.equal(await page.locator(".sheet-head").evaluate((el)=>el.scrollWidth<=el.clientWidth), true, "long names fit the header");
  await close();
  const legacy = {...backup, version:1,history:[],session:["legacy_var=7"],pins:backup.pins};
  delete legacy.sessions; delete legacy.activeSessionId;
  await restore(legacy);
  assert.equal(await name(), "Main session", "legacy backups migrate to Main session");
  assert.equal(await page.evaluate(() => window.imks.workspaces.length), 1);
  assert.equal(await value("legacy_var"), 7);
  await manager();
  await page.getByRole("button", {name:"New session",exact:true}).click();
  await page.getByRole("textbox", {name:"Session name",exact:true}).fill("Main session");
  await page.getByRole("button", {name:"Create session",exact:true}).click();
  assert.match(await page.locator("#session-name-error").textContent(), /already has that name/);
  assert.deepEqual(errors, []);
  console.log("All session checks passed");
} catch (e) {
  if (process.env.SESSION_SCREENSHOT) await page.screenshot({path:process.env.SESSION_SCREENSHOT});
  throw e;
} finally { await browser.close(); server.close(); }
