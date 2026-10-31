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

  // no key label wraps at 360 px
  for (const section of ["Calendars", "Sky", "Sensors", "Math"]) {
    await fn(section);
    const wrapped = await page.$$eval("#fn-grid .key b", (bs) => bs.filter((b) => b.offsetHeight > 30).map((b) => b.textContent));
    check(!wrapped.length, `labels wrap in f(x) → ${section}: ${wrapped.join(", ")}`);
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
