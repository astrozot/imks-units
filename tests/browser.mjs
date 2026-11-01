// Checks of the app in a browser, with simulated sensors: node tests/browser.mjs
//
// It needs Playwright, which is not a dependency of the app: install it
// with `npm install playwright-core` (here or in a parent folder, or give
// its folder as PLAYWRIGHT=/path/to/playwright-core) and give a Chromium
// with CHROME=/path/to/chrome, or `npm install playwright` with
// `npx playwright install chromium`. Without it, the script says so and
// exits without failing. The page is served by a small server of its own.

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

let failures = 0;
const fail = (msg) => { failures++; console.log("FAIL", msg); };
// a check of a value: the test, as a regular expression or a string
const expect = (got, want, msg) => {
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  if (!ok) fail(`${msg}: got ${JSON.stringify(got)}`);
};
const check = (ok, msg) => { if (!ok) fail(msg); };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const context = await browser.newContext({
  viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, serviceWorkers: "block", timezoneId: "Europe/Rome",
  geolocation: { latitude: 45.4642, longitude: 9.19, accuracy: 10 }, permissions: ["geolocation", "accelerometer", "gyroscope", "magnetometer"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const line = () => page.$eval("#expr", (e) => e.textContent);
// the results, without their ans_n and names
const results = () => page.$$eval(".entry .out", (os) => os.map((o) => {
  const c = o.cloneNode(true);
  c.querySelectorAll(".rid, .name, .mcb").forEach((x) => x.remove());
  return c.textContent.trim();
}));
const last = async () => (await results()).at(-1);
const run = async (t) => { await page.keyboard.type(t); await page.keyboard.press("Enter"); await page.waitForTimeout(250); return last(); };
const clear = () => page.keyboard.press("Escape");
const fn = async (section) => { await page.click('[data-tab="fn"]'); await page.click(`[data-fncat="${section}"]`); await page.waitForTimeout(150); };

try {
  await page.goto(url);
  await page.waitForTimeout(1500);

  // dates, and the Dates targets after @
  expect(await run("2026.10.30 18:42 @ hebrew"), "19 Heshvan 5787, 18:42", "a date in the Hebrew calendar");
  await page.keyboard.type("today");
  await fn("Calendars");
  await page.click('.page.active [data-key="@"], [data-key="@"]:visible');
  await page.waitForTimeout(200);
  check(await page.$eval('[data-cat][aria-selected="true"]', (b) => b.textContent) === "Dates", "@ after a date opens Units → Dates");
  await clear();

  // now and today on the Sky keys, as names
  await fn("Sky");
  await page.click('#fn-grid [data-key="now"]');
  await page.keyboard.type(" - ");
  await page.click('#fn-grid [data-key="n:today"]');
  expect(await line(), "now − today", "the now and today keys");
  expect(await run(" @ h"), /^\d+(\.\d+)?\s*h$/, "now - today");
  await clear();

  // a body and a function from the Planets keys
  await fn("Planets");
  await page.click('#fn-grid [data-key="f:mag("]');
  await page.click('#fn-grid [data-key=\'"Saturn"\']');
  await page.keyboard.type(", 2026.11.01)");
  expect(await line(), 'mag("Saturn", 2026.11.01)', "the Planets keys");
  expect(await run(""), /^0\.4\d+±0\.030$/, "mag of Saturn");
  await clear();

  // the moons of Jupiter: a drawing with the planet, a table with names,
  // and a zoom view on a tap
  await run('moons("Jupiter", 2026.11.01 5:00 Z)');
  const lastEntry = async () => (await page.$$(".entry")).at(-1);
  const sketch = await (await lastEntry()).$(".sky-svg");
  check(sketch && (await sketch.$$("image")).length === 1, "moons: the planet is drawn");
  expect(await (await lastEntry()).$eval("td.lbl", (td) => td.textContent), "Io (shadow on Jupiter)", "moons: Io's shadow");
  await sketch.click();
  await page.waitForTimeout(300);
  // the planet on the canvas (some pixels not transparent), the moons over it
  check(await page.$eval(".sky-canvas", (c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((x, i) => i % 4 === 3 && x > 0)), "moons: the planet in the zoom view");
  check(await page.$$eval(".sky-full .sky-moon", (x) => x.length) === 4, "moons: the moons in the zoom view");
  // the time runs, sixty times faster after ▶▶ ▶▶
  const when0 = await page.$eval(".sky-when", (x) => x.textContent);
  await page.click('[data-sky="faster"]');
  await page.click('[data-sky="faster"]');
  await page.waitForTimeout(1500);
  await page.click('[data-sky="play"]');
  check(await page.$eval(".sky-when", (x) => x.textContent) !== when0, "moons: the time runs");
  expect(await page.$eval(".sky-speed", (x) => x.textContent), "×60, paused", "moons: the speed");
  await page.keyboard.press("Escape");
  await clear();
  // a moon of the table: its events
  await (await (await lastEntry()).$$("td.lbl"))[1].click();
  await page.waitForTimeout(400);
  expect(await (await lastEntry()).$eval("td.lbl", (td) => td.textContent), /^(transit|shadow|eclipse|occultation)/, "moonevents from the table");
  await clear();

  // the drawing of a lunar eclipse: the Moon at its seven contacts
  await run("lunareclipse(2026.01.01)");
  check(await (await lastEntry()).$$eval(".lunar-svg .lunar-moon", (x) => x.length) === 7, "lunareclipse: the drawing");
  await clear();

  // the map of a solar eclipse, and its zoom view
  await run("solareclipse(2024.01.01, (32.7767, -96.797)[deg])");
  check(Boolean(await (await lastEntry()).$(".map-svg .map-path")), "solareclipse: the path on the map");
  check(Boolean(await (await lastEntry()).$(".map-svg .map-place")), "solareclipse: the place on the map");
  await (await (await lastEntry()).$(".map-svg")).click();
  await page.waitForTimeout(300);
  check(Boolean(await page.$(".map-full .map-coast")), "solareclipse: the zoom view of the map");
  await page.keyboard.press("Escape");
  await clear();

  // the Eclipses page of Sky, from its key and back
  await fn("Sky");
  await page.click('#fn-grid [data-key="fncat:Eclipses"]');
  await page.waitForTimeout(150);
  check(Boolean(await page.$('#fn-grid [data-key="f:solareclipse("]')), "the Eclipses page");
  check(!(await page.$('[data-fncat="Eclipses"]')), "the Eclipses page is not in the bar");
  expect(await page.$eval('[data-fncat][aria-selected="true"]', (b) => b.textContent), "Sky", "Sky stays selected on its page");
  check(!(await page.$$eval("#fn-grid .key b", (bs) => bs.some((b) => b.offsetHeight > 30))), "labels wrap in Eclipses");
  // a moon from the list of moon…
  await page.click('#fn-grid [data-key="pick:moon"]');
  await page.waitForTimeout(200);
  await page.click('[data-pick-insert=\'"Titan"\']');
  await page.waitForTimeout(150);
  expect(await line(), '"Titan"', "the list of moons types a name");
  await clear();
  await page.click('#fn-grid [data-key="fncat:Sky"]');
  await page.waitForTimeout(150);
  check(Boolean(await page.$('#fn-grid [data-key="f:sunrise("]')), "back to Sky");

  // no key label wraps at 360 px
  for (const section of ["Calendars", "Sky", "Planets", "Coords", "Sensors", "Math"]) {
    await fn(section);
    const wrapped = await page.$$eval("#fn-grid .key b", (bs) => bs.filter((b) => b.offsetHeight > 30).map((b) => b.textContent));
    check(!wrapped.length, `labels wrap in ƒ(x) → ${section}: ${wrapped.join(", ")}`);
  }

  // e on the 123 page, and the holiday picker
  await page.click('[data-tab="num"]');
  await page.click('.page.active [data-key="second"]');
  await page.click('.page.active [data-key="euler"]');
  expect(await line(), "ℯ", "2nd π types euler");
  expect(await run(""), /^2\.718281828/, "euler is e");
  await fn("Calendars");
  await page.click('[data-key="holidays"]');
  await page.waitForTimeout(400);
  await page.click('[data-holiday="Yom Kippur"]');
  await page.keyboard.type("2027)");
  expect(await line(), 'holiday("Yom Kippur", 2027)', "the holiday picker types the name");
  expect(await run(""), "2027.10.11", "Yom Kippur 2027");

  // elements of lists, and the dot key: 0. where a number starts
  await clear();
  await run("v = (1, 2, 4)");
  expect(await run("v.-1 + v.2"), "6", "elements of a list");
  await page.click('[data-tab="num"]');
  await page.click('.page.active [data-key="."]');
  expect(await line(), "0.", "the dot key starts a number with 0.");
  await clear();
  await page.keyboard.type("v");
  await page.click('.page.active [data-key="."]');
  expect(await line(), "v.", "the dot key after a name");
  await clear();

  // the delete key removes whole names, exponents and keys' text
  const del = () => page.click('.page.active [data-key="backspace"]');
  for (const [typed, want] of [["5 @ hebrew", "5 @ "], ["5 @ dow", "5 @ "], ["5 @ hms", "5 @ "], ["5 @ km/h", "5 @ km"],
    ["2 + now", "2 +"], ["today", ""], ["x^2", "x"], ["x^-1", "x"], ["y = ", "y"], ["(1, ", "(1"], ["2 ln(2)", "2 "], ["age(0)", ""]]) {
    await clear();
    await page.keyboard.type(typed);
    await del();
    expect(await line(), want || "100 km/h @ mph", `delete after ${typed}`);
  }
  await clear();

  // no space between a number and a variable: 2π from the keys, 2 x drawn as 2x
  await page.keyboard.type("2");
  await page.click('[data-tab="const"]');
  await page.click('[data-constcat="Math"]');
  await page.click('#const-grid [data-const="pi"]');
  expect(await line(), "2π", "a constant after a number");
  await del();
  expect(await line(), "2", "delete after 2π");
  await clear();
  await page.keyboard.type("sin(2 x) + 2 m");
  check(await page.$$eval("#expr .sp0", (s) => s.length) === 1, "the space in 2 x is not drawn, the one in 2 m is");
  await clear();

  // angles next to their number, 30°, but 2 m and 25 °C apart (SI)
  await page.keyboard.type("sin(30 deg) + 2 m");
  check(await page.$$eval("#expr .sp0", (s) => s.length) === 1, "the space in 30 deg is not drawn, the one in 2 m is");
  await clear();
  await run("30.5 deg @ deg");
  check(await (await lastEntry()).$$eval(".out .u.tight", (u) => u.length) === 1, "a result in degrees has its unit next to the number");
  await run("25 °C");
  check(await (await lastEntry()).$$eval(".out .u.tight", (u) => u.length) === 0, "a result in °C keeps its space");

  // a unit system in quotes from the keys: no space, upright
  await page.keyboard.type("1 @ kg|");
  await page.click('[data-tab="units"]');
  await page.click('[data-cat="Systems"]');
  await page.click('[data-key="q1"]');
  await page.click('[data-sys="planck"]');
  expect(await line(), "1 @ kg|'planck'", "a unit system in quotes");
  check(!(await page.$$eval("#expr .it, #expr i", (s) => s.length)), "a unit system in quotes is upright");
  await clear();

  // floor and ceil in the typeset view; the degree sign on the abc keys
  await page.keyboard.type("floor(2.5)");
  check(await page.$eval("#math2d", (m) => !m.hidden), "floor is typeset");
  await clear();
  await page.click('[data-tab="abc"]');
  await page.click('#abc-page [data-key="layer:sym"]');
  await page.click('#abc-page [data-ch="°"]');
  expect(await line(), "°", "the degree key of the abc page");
  await page.click('#abc-page [data-key="layer:abc"]');
  await clear();

  // the year, month and day of a date
  expect(await run("ymd(2026.10.30)"), "(2026, 10, 30)", "ymd");

  // keep vertical: a page held sideways is turned, and keys still work
  await page.click("#btn-settings");
  await page.selectOption("#set-orient", "portrait");
  await page.click("#sheet .sheet-head [data-close]");
  await page.setViewportSize({ width: 740, height: 360 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.dataset.rot || ""), "-90", "the page turned upright");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".app")).flexDirection), "column", "the upright layout when turned");
  await page.click('[data-tab="num"]');
  for (const k of ["4", "2"]) await page.click(`.page.active [data-key="${k}"]`);
  expect(await line(), "42", "keys on the turned page");
  await clear();
  await page.click("#btn-settings");
  await page.selectOption("#set-orient", "auto");
  await page.click("#sheet .sheet-head [data-close]");
  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.dataset.rot || ""), "", "the page follows the device again");

  // sensors: position (the variables too), motion, compass, a tone
  await page.evaluate(() => {
    setInterval(() => {
      const g = 9.806, a = Math.PI / 6, n = () => (Math.random() - 0.5) * 0.02;
      dispatchEvent(new DeviceMotionEvent("devicemotion", { accelerationIncludingGravity: { x: n(), y: g * Math.sin(a) + n(), z: g * Math.cos(a) + n() }, interval: 16 }));
      dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", { alpha: (360 + (Math.random() - 0.5) * 4) % 360, beta: 0, gamma: 0, absolute: true }));
    }, 16);
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext(), dst = ac.createMediaStreamDestination();
      for (const [f, v] of [[440, 0.3], [880, 0.5]]) { const o = ac.createOscillator(), gn = ac.createGain(); o.frequency.value = f; gn.gain.value = v; o.connect(gn).connect(dst); o.start(); }
      return dst.stream;
    };
  });
  await fn("Sensors");
  // a key measures, and types in the variable: its value
  const measure = async (key, wait) => {
    await clear();
    await page.click(`[data-key="sensor:${key}"]`);
    await page.waitForTimeout(wait);
    expect(await line(), key === "g" ? "glocal" : key, `the ${key} key types the variable`);   // g_local, with a subscript
    return run("");
  };
  expect(await measure("here", 1500), /45\.4642/, "the here key");
  expect(await measure("g", 2700), /^\(?9\.80\d*(±|\()/, "the g key");
  expect(await measure("tilt", 2700), /^\(?(29\.9|30\.0)/, "the tilt key");
  expect(await measure("heading", 2000), /^\((359\.|0\.)/, "the heading key");
  expect(await measure("pitch", 3000), /^\(?440\.0/, "the pitch key");
  await clear();
  expect(await run("here"), /^\(45\.4642/, "the variable here");
  expect(await run("tilt"), /^\(?(29\.9|30\.0)/, "the variable tilt");
  await page.reload();
  await page.waitForTimeout(1500);
  expect(await run("tilt"), /^\(?(29\.9|30\.0)/, "tilt after a reload");
  expect(await run("sunrise(2026.10.30, here)"), /^2026\.10\.30 07:00 ± /, "sunrise at here");

  check(!errors.length, `errors on the page: ${errors.join("; ")}`);
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `${failures} failures` : "All browser checks passed");
process.exit(failures ? 1 : 0);
