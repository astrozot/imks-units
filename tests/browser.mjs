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
// no satellites from CelesTrak while testing (satellites.js)
await context.route("https://celestrak.org/**", (route) => route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
const page = await context.newPage();
// the share menu: what is given to it, kept
await page.addInitScript(() => {
  navigator.canShare = () => true;
  navigator.share = async ({ files }) => { window.shared = files.map((f) => ({ name: f.name, type: f.type, size: f.size })); };
});
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

  // Expression swipes undo/redo without changing keypad pages or moving the
  // restored cursor on the synthetic click that follows a touch gesture.
  const editSwipe = async (right = false, dy = 0) => {
    const el = page.locator("#expr");
    const x = right ? 100 : 220, end = right ? 220 : 100;
    await el.dispatchEvent("pointerdown", { pointerId: 1, clientX: x, clientY: 200 });
    await el.dispatchEvent("pointermove", { pointerId: 1, clientX: end, clientY: 200 + dy });
    await el.dispatchEvent("pointerup", { pointerId: 1, clientX: end, clientY: 200 + dy });
    await el.dispatchEvent("click", { clientX: end, clientY: 200 + dy });
  };
  await page.keyboard.type("12");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("3");
  const editTab = await page.locator('[role="tab"][aria-selected="true"]').first().getAttribute("data-tab");
  await editSwipe();
  expect(await page.evaluate(() => window.imks.text), "12", "left swipe undoes insertion");
  expect(await page.evaluate(() => window.imks.caret), 1, "undo restores cursor before middle insertion");
  await editSwipe(true);
  expect(await page.evaluate(() => window.imks.text), "132", "right swipe redoes insertion");
  expect(await page.evaluate(() => window.imks.caret), 2, "redo restores cursor after middle insertion");
  expect(await page.locator('[role="tab"][aria-selected="true"]').first().getAttribute("data-tab"), editTab, "swiping leaves keypad page unchanged");
  await page.keyboard.press("Control+z");
  expect(await page.evaluate(() => window.imks.text), "12", "Ctrl+Z undoes");
  await page.keyboard.press("Control+Shift+z");
  expect(await page.evaluate(() => window.imks.text), "132", "Ctrl+Shift+Z redoes");
  await page.keyboard.press("Meta+z");
  expect(await page.evaluate(() => window.imks.text), "12", "Command+Z undoes");
  await page.keyboard.type("4");
  await editSwipe(true);
  expect(await page.evaluate(() => window.imks.text), "142", "new edit discards redo branch");
  await clear();
  await editSwipe();
  expect(await page.evaluate(() => window.imks.text), "142", "clearing expression can be undone");
  await clear();

  // Error messages stay in the preview; underline the relevant expression
  // token, and clear stale guidance as soon as the expression changes.
  await page.keyboard.type("sni(30 deg)");
  await page.keyboard.press("Enter");
  expect(await page.locator(".error-hint").textContent(), /Did you mean “sin”/, "unknown function offers spelling guidance");
  expect(await page.locator("#expr .error-token").allTextContents().then((xs) => xs.join("")), "sni", "unknown function is underlined");
  expect(await page.locator("#expr").getAttribute("aria-invalid"), "true", "invalid expression is exposed to accessibility");
  await page.keyboard.press("Backspace");
  check(await page.locator("#expr .error-token").count() === 0, "editing clears stale error underline immediately");
  check(await page.locator(".error-hint").count() === 0, "editing clears stale error hint immediately");
  await clear();
  await page.keyboard.type("1 m + 2 s");
  await page.keyboard.press("Enter");
  expect(await page.locator("#preview").textContent(), /Cannot add length and time/, "unit mismatch explains the dimensions");
  expect(await page.locator("#expr .error-token").textContent(), "+", "unit mismatch marks the failing operation");
  await clear();
  await page.keyboard.type("(1 + 2");
  await page.waitForTimeout(1100);
  expect(await page.locator(".error-hint").textContent(), /closing parenthesis/, "delayed preview offers syntax guidance");
  check(await page.locator("#expr .error-point").count() === 1, "missing closing parenthesis marks the insertion point");
  await clear();
  await page.keyboard.type("2 × (3 + )");
  await page.keyboard.press("Enter");
  expect(await page.locator("#expr .error-token").textContent(), ")", "normalized multiply preserves error location");
  await clear();

  // Long help uses a bounded modal; releasing the held key must not type it.
  const holdHelp = async (selector) => {
    await page.locator(selector).dispatchEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 400 });
    await page.waitForTimeout(550);
    await page.locator(selector).dispatchEvent("pointerup", { pointerId: 1 });
    await page.locator(selector).dispatchEvent("click");
    await page.waitForTimeout(250);
  };
  await clear();
  await page.waitForTimeout(80);
  const emptyInput = await line();
  await holdHelp('#suggest [data-const="pi"]');
  check(await page.locator(".quantity-card").count() === 1, "suggested constants open quantity help");
  expect(await line(), emptyInput, "holding a suggestion does not insert it");
  await page.keyboard.press("Escape");
  check(await page.locator('#suggest [data-const="pi"]').evaluate((el) => document.activeElement === el && getComputedStyle(el).outlineStyle === "none"), "Escape restores suggestion focus without a blue outline");
  await page.click('#suggest [data-const="pi"]');
  expect(await line(), "π", "a normal suggestion tap still inserts");
  await clear();
  await page.waitForTimeout(80);
  await holdHelp('#suggest [data-fn="sqrt("]');
  expect(await page.locator(".function-signatures > div").first().textContent(), "sqrt(x)", "suggested functions open function help");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.keyboard.type("sqr");
  await page.waitForTimeout(80);
  const completion = '#suggest [data-help-kind="function"][data-help-name="sqrt"]';
  await holdHelp(completion);
  expect(await line(), "sqr", "holding a completion preserves the partial word");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.click(completion);
  expect(await line(), "√(", "tapping a completion still replaces the partial word");
  await clear();
  await page.keyboard.type("3 m");
  await page.waitForTimeout(80);
  await holdHelp('#suggest [data-convert="ft"]');
  check((await page.locator(".unit-definition").textContent()).includes("0.3048"), "conversion suggestions open unit help");
  expect(await line(), "3 m", "holding a conversion suggestion does not convert");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await clear();
  await page.keyboard.type("today ");
  await page.waitForTimeout(80);
  await holdHelp('#suggest [data-convert="date"]');
  expect(await page.locator(".quantity-kind").textContent(), "Output format", "date suggestions open format help");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await clear();
  await page.waitForTimeout(80);
  const swipeChip = page.locator('#suggest [data-const="pi"]');
  await swipeChip.dispatchEvent("pointerdown", { pointerId: 1, clientX: 200, clientY: 100 });
  await swipeChip.dispatchEvent("pointermove", { pointerId: 1, clientX: 150, clientY: 100 });
  await page.waitForTimeout(550);
  await swipeChip.dispatchEvent("pointerup", { pointerId: 1 });
  check(await page.isHidden("#sheet"), "swiping suggestions cancels help");

  await fn("Sky");
  const occultationKey = '#fn-grid [data-key="f:occultation("]';
  const beforeHelp = await line();
  await holdHelp(occultationKey);
  expect(await line(), beforeHelp, "long-press help does not insert a function");
  check(await page.isVisible(".key-help-modal"), "long-press opens a help modal");
  check(await page.locator('.key-help-modal .sheet-head [data-close]').evaluate((el) => getComputedStyle(el).outlineStyle === "none"), "long-press focus does not show a blue outline");
  check(await page.locator('.key-help').evaluate((el) => getComputedStyle(el).userSelect === "none"), "held touch cannot select help text");
  expect(await page.locator(".function-signatures > div").first().textContent(), "occultation(front, target, t[, place])", "function help begins with a calling signature");
  check((await page.locator(".function-signatures > div").count()) === 1, "occultation has one explicit calling form");
  check(!(await page.locator(".key-help > p").first().textContent()).startsWith("occultation:"), "the description omits the redundant function label");
  expect((await page.locator(".key-help h3").allTextContents()).join(", "), "Arguments, Returns, Examples, Notes", "function help has documentation sections");
  check(await page.locator(".key-help code .syntax-string").count() > 0, "help highlights quoted arguments");
  check(await page.locator(".key-help code .syntax-function").count() > 0, "help highlights function names");
  const fitsHelp = () => page.$eval(".key-help-modal .sheet-panel", (el) => {
    const r = el.getBoundingClientRect(), body = el.querySelector(".sheet-body");
    return { top: r.top, bottom: r.bottom, height: innerHeight, width: body.clientWidth, scrollWidth: body.scrollWidth };
  });
  const helpFits = (r) => r.top >= 0 && r.bottom <= r.height && r.scrollWidth <= r.width;
  const portraitHelp = await fitsHelp();
  check(helpFits(portraitHelp), `long help fits a phone without horizontal overflow (${JSON.stringify(portraitHelp)})`);
  await page.waitForTimeout(4200);
  check(await page.isVisible(".key-help-modal"), "help stays open until explicitly dismissed");
  await page.setViewportSize({ width: 740, height: 360 });
  await page.waitForTimeout(250);
  const landscapeHelp = await fitsHelp();
  check(helpFits(landscapeHelp), `help fits landscape phones (${JSON.stringify(landscapeHelp)})`);
  check(await page.$eval(".key-help", (el) => el.scrollHeight > el.clientHeight), "long help scrolls in a short viewport");
  await page.locator(".key-help").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  check(await page.isHidden("#sheet"), "help closes after scrolling to the end");
  check(await page.locator(occultationKey).evaluate((el) => document.activeElement === el), "closing help restores focus to its key");
  await page.setViewportSize({ width: 360, height: 740 });
  await holdHelp(occultationKey);
  await page.keyboard.press("Tab");
  check(await page.locator(".key-help").evaluate((el) => document.activeElement === el), "keyboard users can focus and scroll help");
  check(await page.locator(".key-help").evaluate((el) => getComputedStyle(el).outlineStyle !== "none"), "keyboard navigation retains its focus indicator");
  await page.keyboard.press("Escape");
  check(await page.isHidden("#sheet"), "Escape closes help");
  check(await page.locator(occultationKey).evaluate((el) => document.activeElement === el && getComputedStyle(el).outlineStyle === "none"), "Escape restores keypad focus without a blue outline");
  await holdHelp(occultationKey);
  await page.locator(".sheet-backdrop").click({ position: { x: 2, y: 2 } });
  check(await page.isHidden("#sheet"), "tapping outside closes help");

  await holdHelp('#fn-grid [data-key="f:sunrise("]');
  const sunriseIntro = page.locator('.key-help > p:not(.signature-hint)').first();
  expect(await sunriseIntro.textContent(), "The next sunrise after t.", "sunrise introduction has no redundant calling example");
  expect(await sunriseIntro.locator("code").textContent(), "t", "argument references in prose use grey code styling");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  for (const [section, name, signature] of [["Math", "sqrt", "sqrt(x)"], ["Calculus", "solve", "solve(f(x) = y, x, guess)"], ["Distributions", "Gamma", "Γ(x)"], ["Cosmology", "D_A", "DA(z)"], ["Cosmology", "age", "age(z)"]]) {
    await fn(section);
    await holdHelp(`#fn-grid [data-key="f:${name}("]`);
    expect(await page.locator(".function-signatures > div").first().textContent(), signature, `${name} calling syntax`);
    check(await page.locator(".function-arguments dt").count() > 0, `${name} explains its arguments`);
    if (name === "D_A" || name === "age") {
      check(await page.locator(".key-help code").evaluateAll((els) => els.some((el) => el.textContent === "ΩM" && el.querySelector("sub")?.textContent === "M")), `${name} help formats Omega_M using the editor notation`);
      check(await page.locator(".key-help code").evaluateAll((els) => els.some((el) => el.textContent === "H0" && el.querySelector("sub")?.textContent === "0")), `${name} help formats H_0 with a subscript`);
    }
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }

  // Unit help distinguishes definitions, scale factors and zero points.
  await page.click('[data-tab="units"]');
  await page.click('[data-cat="Length"]');
  await holdHelp('#unit-grid [data-unit="ft"]');
  check((await page.locator(".unit-definition").textContent()).includes("0.3048"), "foot help shows its conversion to metres");
  check(await page.locator(".unit-definition").evaluate((el) => el.scrollWidth <= el.clientWidth), "unit definition fits a phone");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await holdHelp('#unit-grid [data-unit="m"]');
  expect(await page.locator(".quantity-kind").textContent(), "Base unit", "base unit is identified");
  check((await page.locator(".unit-definition").textContent()).includes("length"), "base unit describes its role");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.click('[data-cat="Temp."]');
  await holdHelp('#unit-grid [data-unit="°C"]');
  check((await page.locator(".unit-definition").textContent()).includes("273.15"), "Celsius help accounts for its zero point");
  check((await page.locator(".unit-definition").textContent()).includes("373.15"), "Celsius help shows a second reference temperature");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await holdHelp('[data-prefix="k"]');
  expect(await page.locator(".quantity-kind").textContent(), "Prefix", "prefix has its own help layout");
  expect(await page.locator(".quantity-card sup").textContent(), "3", "prefix multiplier comes from its definition");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await holdHelp('[data-prefix="*"]');
  check((await page.locator(".key-help").textContent()).includes("powers of 1000"), "automatic prefixes explain engineering scaling");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.click('[data-cat="Systems"]');
  await holdHelp('#unit-grid [data-sys="si"]');
  expect(await page.locator(".quantity-kind").textContent(), "Unit system", "unit system is identified");
  check((await page.locator(".unit-targets code").allTextContents()).includes("kg"), "system help lists actual conversion targets");
  expect(await page.locator(".unit-definition code").textContent(), "value @ si", "system help shows conversion syntax");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await holdHelp('#unit-grid [data-sys="planck"]');
  check((await page.locator(".key-help").textContent()).includes("natural-unit scales"), "natural systems explain quoted variables");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await holdHelp('#unit-grid [data-sys="hms"]');
  expect(await page.locator(".quantity-kind").textContent(), "Output format", "formats are distinguished from systems");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.click('[data-cat="Dates"]');
  await holdHelp('#unit-grid [data-sys="JD"]');
  check(!(await page.locator(".key-help").textContent()).includes("temperature"), "date offsets are not described as temperature offsets");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Constants and variables: values, units and uncertainty are separate.
  await page.click('[data-tab="const"]');
  await page.click('[data-constcat="Physics"]');
  await holdHelp('#const-grid [data-const="G"]');
  check((await page.locator(".quantity-description").textContent()).includes("gravit"), "constant has a full description");
  check((await page.locator(".quantity-value").textContent()).includes("6.674"), "constant has a prominent value");
  check((await page.locator(".quantity-details").textContent()).includes("Relative uncertainty"), "constant shows uncertainty separately");
  check((await page.locator(".key-help").textContent()).includes("NIST CODATA"), "constant retains its available source");
  const quantityFits = await page.locator(".quantity-value").evaluate((el) => el.scrollWidth <= el.clientWidth);
  check(quantityFits, "constant values fit a phone");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await holdHelp('#const-grid [data-const="c"]');
  check((await page.locator(".quantity-details").textContent()).includes("Exact by definition"), "defined constant distinguishes exact values from unspecified errors");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.click('[data-constcat="Cosmology"]');
  await holdHelp('#const-grid [data-const="H_0"]');
  expect(await page.locator(".quantity-kind").textContent(), "Model parameter", "cosmology values identify model parameters");
  expect(await page.locator("#sheet-title sub").textContent(), "0", "help titles format symbolic subscripts");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await holdHelp('#const-grid [data-const="rho_c"]');
  expect(await page.locator(".quantity-kind").textContent(), "Derived quantity", "derived value has its own kind");
  check(await page.locator(".function-definition").count() === 1, "derived value shows its definition");
  expect(await page.locator(".function-definition sup").textContent(), "2", "constant definition typesets powers like the input");
  check(!(await page.locator(".function-definition").textContent()).includes("^"), "constant definition hides the exponent caret");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const savedDistance = await run('help_distance = (12.5 +/- 0.2) m # "Measured distance"');
  check(savedDistance?.includes("12.5"), `test variable assignment succeeds (${savedDistance})`);
  await page.click('[data-constcat="Yours"]');
  await holdHelp('#const-grid [data-const="help_distance"]');
  expect(await page.locator(".quantity-kind").textContent(), "Variable", "user variable is identified");
  expect(await page.locator(".quantity-description").textContent(), "Measured distance", "variable retains its documentation");
  check((await page.locator(".quantity-value").textContent()).includes("12.5"), "variable shows its current value");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await run('help_list = (1, 2, 3) m');
  await page.click('[data-constcat="Yours"]');
  await holdHelp('#const-grid [data-const="help_list"]');
  check((await page.locator(".quantity-details").textContent()).includes("3 elements"), "list variable shows its size");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Canonical names work throughout the app; old spellings have no hidden aliases.
  expect(await run("H_0 / H_0 + Omega_M / Omega_M + M_Sun / M_Sun + mu_B / mu_B"), "4", "canonical constants evaluate");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "Ω_M / Omega_M + Γ(5) / Gamma(5)");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  expect(await last(), "2", "equivalent symbol input still resolves");
  for (const old of ["H0", "OmegaM", "Msun", "vesc_Mars", "gamma(5)", "chi2_p(12.3, 5)", "1[Mearth]"]) {
    await run(old);
    check(await page.locator("#preview").evaluate((el) => el.classList.contains("error")), `${old} is no longer a legacy alias`);
    await clear();
  }

  // dates, and the Dates targets after @
  expect(await run("2026.10.30 18:42 @ hebrew"), "19 Heshvan 5787, 18:42", "a date in the Hebrew calendar");
  await page.keyboard.type("today");
  await fn("Calendars");
  await page.click('.page.active [data-key="@"], [data-key="@"]:visible');
  await page.waitForTimeout(200);
  check(await page.$eval('[data-cat][aria-selected="true"]', (b) => b.textContent) === "Dates", "@ after a date opens Units → Dates");
  await clear();

  // now and today on the Calendars keys, as names
  await fn("Calendars");
  await page.click('#fn-grid [data-key="now"]');
  await page.keyboard.type(" - ");
  await page.click('#fn-grid [data-key="n:today"]');
  expect(await line(), "now − today", "the now and today keys");
  expect(await run(" @ h"), /^\d+(\.\d+)?\s*h$/, "now - today");
  await clear();

  // Date argument pages include user absolute times, with their variable
  // names inserted; durations and automatic history values stay out.
  await run('observingdate = 2026.11.01 20:00');
  await run('observingduration = 2 h');
  await run('observinglist = (today, today + 1[day])');
  await clear();
  await fn("Sky");
  await page.click('#fn-grid [data-key="f:moonphases("]');
  await page.locator('#fn-grid [data-arg="today"]').waitFor();
  check(await page.locator('#fn-grid [data-arg="observingdate"]').count() === 1, "absolute time variable suggested");
  check(await page.locator('#fn-grid [data-arg="observingduration"]').count() === 0, "duration not suggested as a date");
  check(await page.locator('#fn-grid [data-arg="observinglist"]').count() === 0, "date list not suggested as a scalar date");
  check(await page.locator('#fn-grid [data-arg="ans"], #fn-grid [data-arg^="ans_"]').count() === 0, "history dates not suggested");
  await page.click('#fn-grid [data-arg="observingdate"]');
  expect(await line(), 'moonphases(observingdate)', "date variable closes final argument");
  await clear();
  await fn("Planets");
  await page.click('#fn-grid [data-key="f:altaz("]');
  await page.click('#fn-grid [data-arg=\'"Moon"\']');
  await page.click('#fn-grid [data-arg="observingdate"]');
  expect(await line(), 'altaz("Moon", observingdate, ', "date variable advances to place argument");
  await clear();
  await run('observingdate = 2 h');
  await clear();
  await fn("Sky");
  await page.click('#fn-grid [data-key="f:moonphases("]');
  await page.locator('#fn-grid [data-arg="today"]').waitFor();
  check(await page.locator('#fn-grid [data-arg="observingdate"]').count() === 0, "date suggestions reflect reassignments");
  await clear();

  // a function from the Planets keys, then its arguments from their pages:
  // a body, a date (typed), and a place left to the settings
  await fn("Planets");
  await page.click('#fn-grid [data-key="f:mag("]');
  await page.waitForTimeout(150);
  check(Boolean(await page.$('#fn-grid [data-arg=\'"Saturn"\']')), "the page of bodies after mag(");
  expect(await page.$eval('[data-fncat][aria-selected="true"]', (b) => b.textContent), "Planets", "Planets stays selected on a page of arguments");
  await page.click('#fn-grid [data-arg=\'"Saturn"\']');
  await page.waitForTimeout(150);
  expect(await line(), 'mag("Saturn", ', "a body typed, and the next argument");
  check(Boolean(await page.$('#fn-grid [data-arg="today"]')), "the page of dates");
  await page.keyboard.type("2026.11.01)");
  expect(await run(""), /^0\.4\d+±0\.030$/, "mag of Saturn");
  await clear();
  // a moon, a date and a kind: the last closes the call
  await page.click('#fn-grid [data-key="f:moonevents("]');
  await page.waitForTimeout(150);
  await page.click('#fn-grid [data-arg=\'"Io"\']');
  await page.click('#fn-grid [data-arg="today"]');
  await page.click('#fn-grid [data-arg=\'"eclipse"\']');
  await page.waitForTimeout(150);
  expect(await line(), 'moonevents("Io", today, "eclipse")', "a moon, a date and a kind from their pages");
  check(Boolean(await page.$('#fn-grid [data-key="f:moonevents("]')), "back to Planets after the call");
  await clear();
  // Both longitude events require two bodies, then permit closing without
  // Settings or choosing a place. The geocentric choice is enabled either way.
  for (const name of ["conjunction", "opposition"]) {
    await fn("Sky");
    check(!await page.$('#fn-grid [data-key="f:sun("]'), "Sky omits sun shortcut");
    check(!await page.$('#fn-grid [data-key="f:moon("]'), "Sky omits moon shortcut");
    await page.click(`#fn-grid [data-key="f:${name}("]`);
    await page.click('#fn-grid [data-arg=\'"Mars"\']');
    await page.click('#fn-grid [data-arg=\'"Sun"\']');
    await page.click('#fn-grid [data-arg="today"]');
    expect(await line(), `${name}("Mars", "Sun", today, `, `${name}: optional place offered`);
    const done = page.locator('#fn-grid [data-argdone]');
    check(await done.isEnabled(), `${name}: geocentric enabled without saved location`);
    expect(await done.locator('b').textContent(), "Geocentric )", `${name}: clear close label`);
    await done.click();
    expect(await line(), `${name}("Mars", "Sun", today)`, `${name}: no trailing comma`);
    await clear();
    await fn("Sky");
    await page.click(`#fn-grid [data-key="f:${name}("]`);
    await page.click('#fn-grid [data-arg=\'"Moon"\']');
    await page.click('#fn-grid [data-arg=\'"Sun"\']');
    await page.click('#fn-grid [data-arg="today"]');
    await page.click('#fn-grid [data-key="pick:city"]');
    await page.fill('.pick-search', "Rome");
    await page.click('[data-pick-insert=\'"Rome"\']');
    expect(await line(), `${name}("Moon", "Sun", today, "Rome")`, `${name}: explicit local place`);
    await clear();
  }
  // Foreground first: only the Moon and planets. Background catalog
  // pickers then retain candidates near its path, including Regulus.
  await fn("Sky");
  await page.click('#fn-grid [data-key="f:occultation("]');
  await page.locator('#fn-grid [data-arg=\'"Moon"\']').waitFor();
  check(await page.$eval('#fn-grid [data-arg=\'"Sun"\']', (b) => b.disabled), "the Sun is not an occultation foreground");
  check(await page.$eval('#fn-grid [data-key="pick:star"]', (b) => b.disabled), "foreground cannot be a star");
  await page.click('#fn-grid [data-arg=\'"Moon"\']');
  await page.locator('#fn-grid [data-key="pick:star"]:enabled').waitFor();
  check(await page.$eval('#fn-grid [data-arg=\'"Moon"\']', (b) => b.disabled), "Moon cannot be its own background");
  await page.click('#fn-grid [data-key="pick:star"]');
  await page.locator(".pick-search").waitFor();
  check(await page.locator('[data-pick-insert=\'"Polaris"\']').count() === 0, "Polaris excluded for the Moon");
  check(await page.locator('[data-pick-insert=\'"Regulus"\']').count() === 1, "Regulus remains a lunar candidate");
  await page.fill('.pick-search', 'Polaris');
  check(await page.locator('[data-pick-insert=\'"Polaris"\']').count() === 0, "search preserves occultation filtering");
  await page.click("#sheet .sheet-head [data-close]");
  await page.click('#fn-grid [data-key="pick:deep"]');
  await page.locator('.pick-search').waitFor();
  check(await page.locator('[data-pick-insert=\'"M31"\']').count() === 0, "Andromeda excluded from lunar targets");
  check(await page.locator('[data-pick-insert=\'"M45"\']').count() === 1, "Pleiades remain lunar candidates");
  await page.click("#sheet .sheet-head [data-close]");
  await page.click('#fn-grid [data-key="pick:star"]');
  await page.fill('.pick-search', 'Regulus');
  await page.click('[data-pick-insert=\'"Regulus"\']');
  await page.click('#fn-grid [data-arg="today"]');
  expect(await line(), 'occultation("Moon", "Regulus", today, ', "foreground then background then date");
  const globalOccultation = page.locator('#fn-grid [data-argdone]');
  check(await globalOccultation.isEnabled(), "global occultation enabled without a saved location");
  expect(await globalOccultation.locator('b').textContent(), "Global )", "occultation offers global search");
  await globalOccultation.click();
  expect(await line(), 'occultation("Moon", "Regulus", today)', "global occultation closes without a trailing comma");
  await clear();
  // The filter is scoped to occultation: ordinary star pickers keep Polaris.
  await fn("Planets");
  await page.click('#fn-grid [data-key="f:altaz("]');
  await page.locator('#fn-grid [data-key="pick:star"]:enabled').waitFor();
  await page.click('#fn-grid [data-key="pick:star"]');
  await page.fill('.pick-search', 'Polaris');
  await page.locator('[data-pick-insert=\'"Polaris"\']').waitFor();
  await page.click('[data-pick-insert=\'"Polaris"\']');
  await clear();
  await fn("Planets");
  // the place closes passes( (its days are seldom given)
  await page.click('#fn-grid [data-key="f:passes("]');
  await page.waitForTimeout(150);
  await page.click('#fn-grid [data-arg=\'"ISS"\']');
  await page.click('#fn-grid [data-arg="today"]');
  await page.waitForTimeout(150);
  await page.click('#fn-grid [data-key="pick:city"]');
  await page.fill(".pick-search", "Rome");
  await page.waitForTimeout(150);
  await page.click('[data-pick-insert=\'"Rome"\']');
  await page.waitForTimeout(150);
  expect(await line(), 'passes("ISS", today, "Rome")', "the place closes passes");
  await clear();
  // a place typed from the (lat, lon, h) template: , and ) step over the
  // units, and the call closes
  await page.click('#fn-grid [data-key="f:altaz("]');
  await page.waitForTimeout(150);
  await page.click('#fn-grid [data-arg=\'"Mars"\']');
  await page.click('#fn-grid [data-arg="now"]');
  await page.waitForTimeout(150);
  await page.click('#fn-grid [data-argtpl="(|[deg], [deg], [m])"]');
  expect(await page.$eval('[data-tab][aria-selected="true"]', (b) => b.dataset.tab), "num", "the template shows the 123 keys");
  await page.keyboard.type("45.46,9.19,120)");
  expect(await line(), 'altaz("Mars", now, (45.46[°], 9.19[°], 120[m]))', "the (lat, lon, h) template");
  await clear();
  await fn("Planets");
  // an argument deleted brings its page back
  await page.click('#fn-grid [data-key="f:setting("]');
  await page.waitForTimeout(150);
  await page.click('#fn-grid [data-arg=\'"Jupiter"\']');
  await page.waitForTimeout(150);
  while ((await line()) !== "setting(") await page.keyboard.press("Backspace");
  await page.waitForTimeout(150);
  check(Boolean(await page.$('#fn-grid [data-arg=\'"Mars"\']')), "the page of bodies again after the body is deleted");
  await clear();
  // a row of a table by its name, from its label
  await run("moonphases(2026.11.03)");
  await (await (await page.$$(".entry")).at(-1).$$("td.lbl"))[2].click();
  await page.waitForTimeout(150);
  expect(await line(), /^ans.*\."full moon"$/, "a row label types its reference");
  expect(await run(""), /^2026\.11\.24 15:54/, "the row by its name");
  await clear();
  // a section tapped wins over the page of arguments; a number shows 123
  await page.click('#fn-grid [data-key="f:diam("]');
  await page.waitForTimeout(150);
  check(await page.$eval('#fn-grid [data-key="pick:star"]', (b) => b.disabled), "no stars for diam");
  await page.click('[data-fncat="Sky"]');
  await page.waitForTimeout(150);
  check(Boolean(await page.$('#fn-grid [data-key="f:seasons("]')), "a section over the page of arguments");
  await clear();
  await page.click('#fn-grid [data-key="f:seasons("]');
  await page.waitForTimeout(150);
  expect(await page.$eval('[data-tab][aria-selected="true"]', (b) => b.dataset.tab), "num", "a year shows the 123 keys");
  await page.keyboard.type('2027)."June solstice"');
  expect(await run(""), /^2027\.06\.21 16:1\d/, "a row by name");
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
  // (the canvas copied: it may be a WebGL one)
  check(await page.$eval(".sky-canvas", (c) => { const d = document.createElement("canvas"); d.width = c.width; d.height = c.height; const g = d.getContext("2d"); g.drawImage(c, 0, 0); return g.getImageData(0, 0, c.width, c.height).data.some((x, i) => i % 4 === 3 && x > 0); }), "moons: the planet in the zoom view");
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

  // the zoom view of the lunar eclipse: the Moon at a contact, the phase
  await (await (await lastEntry()).$(".lunar-svg")).click();
  await page.waitForTimeout(300);
  check(await page.$$eval("[data-lunar-t]", (c) => c.length) === 7, "lunar eclipse: the seven contacts");
  // The penumbral part must keep dimming as the limb crosses into/out of
  // the umbra. Sample the same maria at the disk center, still outside
  // the umbra on both sides of U1/U4, using the rendered picture.
  const penumbralLight = await page.evaluate(async () => {
    const { snapshot } = await import("./js/snapshot.js");
    const slider = document.querySelector(".lunar-time"), moon = document.querySelector(".lunar-close");
    const light = async (t) => {
      slider.value = t;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      const img = await createImageBitmap(await snapshot(moon));
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      img.close();
      const pixels = ctx.getImageData(Math.floor(canvas.width / 2) - 2, Math.floor(canvas.height / 2) - 2, 5, 5).data;
      return pixels.reduce((sum, v, i) => sum + (i % 4 < 3 ? v : 0), 0) / 75;
    };
    const out = [];
    for (const name of ["U1", "U4"]) {
      const t = Number([...document.querySelectorAll("[data-lunar-t]")].find((c) => c.textContent === name).dataset.lunarT);
      out.push([await light(t - 60), await light(t + 60)]);
    }
    return out;
  });
  check(penumbralLight.every(([before, after]) => before > 10 && after > 10 && Math.abs(after - before) < 5),
    `lunar eclipse: continuous penumbral dimming at umbral contacts (${JSON.stringify(penumbralLight)})`);
  await page.click('[data-lunar-t]:nth-child(4)');
  await page.waitForTimeout(150);
  expect(await page.$eval(".lunar-when", (x) => x.textContent), /: total, umbral magnitude 1\.1\d\d/, "lunar eclipse: the phase at the maximum");
  check(Boolean(await page.$(".lunar-full .lunar-umbra-on")), "lunar eclipse: the Moon in the umbra");
  // the switch to the diagram of the history, and back
  await page.click('[data-lunar-view="diagram"]');
  check(await page.$$eval(".lunar-diagram .lunar-moon", (x) => x.length) === 7 && await page.isVisible(".lunar-diagram") && !(await page.isVisible(".lunar-sim")), "lunar eclipse: the diagram");
  await page.click('[data-lunar-view="sim"]');
  check(await page.isVisible(".lunar-sim") && !(await page.isVisible(".lunar-diagram")), "lunar eclipse: back to the simulation");
  // the share button: a picture of the simulation to the share menu
  await page.click("#sheet-share");
  await page.waitForFunction(() => window.shared, null, { timeout: 10000 }).catch(() => {});
  const shared = await page.evaluate(() => window.shared?.[0]);
  check(shared?.name === "lunar-eclipse.png" && shared.type === "image/png" && shared.size > 20000, `lunar eclipse: the picture shared (${JSON.stringify(shared)})`);
  await page.keyboard.press("Escape");
  await clear();

  // the map of an occultation: its limits and the star's rising or setting
  await run('occultation("Moon", "Regulus", 2026.01.01, "Milan")');
  await page.waitForTimeout(2500);
  const occMap = await lastEntry();
  check(Boolean(await occMap.$(".map-svg .map-partial")), "occultation: the map with its limits");
  expect(await occMap.$eval(".map-key", (p) => p.textContent), /limits.*Regulus rising or setting/, "occultation: the key of the map");
  await clear();

  // the map of a solar eclipse, and its zoom view
  await run("solareclipse(2024.01.01, (32.7767, -96.797)[deg])");
  check(Boolean(await (await lastEntry()).$(".map-svg .map-path")), "solareclipse: the path on the map");
  check(Boolean(await (await lastEntry()).$(".map-svg .map-place")), "solareclipse: the place on the map");
  await (await (await lastEntry()).$(".map-svg")).click();
  await page.waitForTimeout(300);
  check(Boolean(await page.$(".map-full .map-coast")), "solareclipse: the zoom view of the map");
  // the globe or online maps (not loaded here)
  check(await page.$$eval(".map-select option", (o) => o.length) === 5, "solareclipse: the choice of maps");
  // the simulation: the shadow at the maximum, totality at Dallas at C2
  await page.click('[data-map-mode="sim"]');
  await page.click('[data-map-t]:text-is("max")');
  await page.waitForTimeout(100);
  check(await page.$$eval(".map-full .map-shade", (x) => x.length) === 5 && Boolean(await page.$(".map-full .map-umbra.total")), "solar eclipse: the penumbra and the umbra");
  expect(await page.$eval(".map-when", (x) => x.textContent), /^18:17 UTC .*: the umbra at 25\.\d° N, 104\.\d° W · at the place: partial/, "solar eclipse: the shadow at the maximum");
  await page.click('[data-map-t]:text-is("C2")');
  await page.waitForTimeout(100);
  expect(await page.$eval(".map-when", (x) => x.textContent), /at the place: total, magnitude 1\.0\d\d, 100% of the Sun covered/, "solar eclipse: totality at the place");
  await page.click('[data-map-mode="map"]');
  check(!(await page.$(".map-full .map-shade")) && !(await page.isVisible(".map-sim")), "solar eclipse: back to the map");
  // a place tapped on the globe (its center, the greatest eclipse): the
  // eclipse there, and its whole calculation
  const gb = await (await page.$(".map-full")).boundingBox();
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.waitForTimeout(500);
  expect(await page.$eval(".map-local p", (x) => x.textContent), /^2[45]\.\d° N, 10[34]\.\d° W: total eclipse, magnitude 1\.0\d\d, 100% of the Sun covered/, "solar eclipse: a place tapped");
  check(await page.$$eval(".map-contacts tr", (r) => r.length) === 6, "solar eclipse: the contacts at the place tapped");
  await page.click('[data-map="calc"]');
  await page.waitForTimeout(1500);
  expect(await (await lastEntry()).$eval(".in", (x) => x.textContent), /^solareclipse\W*2024\.04\.07 UTC,\W*2[45]\.\d+,\W10[34]\.\d+\)/, "solar eclipse: the calculation at the place tapped");
  expect(await (await lastEntry()).textContent(), /total solar eclipse/, "solar eclipse: total at the place tapped");
  await page.keyboard.press("Escape");
  await clear();

  // the dates of other calendars, from their page
  await fn("Calendars");
  await page.click('#fn-grid [data-key="fncat:Calendar"]');
  await page.waitForTimeout(150);
  check(!(await page.$('[data-fncat="Calendar"]')), "the Calendar page is not in the bar");
  expect(await page.$eval('[data-fncat][aria-selected="true"]', (b) => b.textContent), "Calendars", "Calendars stays selected on its page");
  await page.click('#fn-grid [data-key="f:japanese("]');
  await page.waitForTimeout(150);
  await page.click('#fn-grid [data-arg=\'"Reiwa"\']');
  await page.keyboard.type("8, 10, 30)");
  expect(await run(""), /^2026\.10\.30/, "japanese, the era from its page");
  await clear();

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
    ["2 + now", "2 +"], ["today", ""], ["x^2", "x"], ["x^-1", "x"], ["y = ", "y"], ["(1, ", "(1"], ["2 ln(2)", "2 "], ["age(0)", ""],
    ['moons("Jupiter"', "moons("], ['moons("Jupiter", "Io"', 'moons("Jupiter", '], ['x = "ab', 'x = "a']]) {
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

  // Digits inherit variable italics, including quotes; subscripts and numbers stay upright.
  for (const typed of ["m1", "m1_1", "m_1", "'m1'", '"m1"', "'m_1'", '"m_1"']) {
    await page.keyboard.type(typed);
    const subscript = typed.includes("_");
    expect(await page.locator("#expr .it").allTextContents().then((xs) => xs.join("")),
      typed.replace(/['"]/g, "").replace("_", ""), `${typed}: variable is wrapped in italics`);
    if (subscript) {
      expect(await page.locator("#expr sub").textContent(), "1", `${typed}: numeric subscript`);
      expect(await page.locator("#expr sub").evaluate((el) => getComputedStyle(el).fontStyle), "normal", `${typed}: subscript is upright`);
    }
    await clear();
  }
  await page.keyboard.type("12 + m1^2");
  expect(await page.locator("#expr .t-n").first().evaluate((el) => getComputedStyle(el).fontStyle), "normal", "standalone number is upright");
  expect(await page.locator("#expr sup").evaluate((el) => getComputedStyle(el).fontStyle), "normal", "numeric power is upright");
  await clear();
  await run("m1 = 3");
  for (const typed of ["m1^2", "'m1'^2", '"m1"^2']) {
    await page.keyboard.type(typed);
    expect(await page.locator("#math2d mi.it").textContent(), "1", `${typed}: digit is a typeset identifier`);
    expect(await page.locator("#math2d mi.it").evaluate((el) => getComputedStyle(el).fontStyle), "italic", `${typed}: typeset digit is italic`);
    await clear();
  }

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

  // Enter in Settings resolves cities outside the built-in catalog.
  let placeRequests = 0, elevationRequests = 0;
  const geocode = async (route) => {
    placeRequests++;
    const name = new URL(route.request().url()).searchParams.get("q");
    await new Promise((r) => setTimeout(r, 150));
    await route.fulfill({ json: name === "Pisa" ? [{ display_name: "Pisa, Toscana, Italia", lat: "43.7159", lon: "10.4019" }] : [] });
  };
  const elevation = (route) => { elevationRequests++; return route.fulfill({ json: { elevation: [4] } }); };
  await page.route("https://nominatim.openstreetmap.org/search?**", geocode);
  await page.route("https://api.open-meteo.com/v1/elevation?**", elevation);
  await page.click("#btn-settings");
  await page.fill("#set-place", "Pisa");
  await page.press("#set-place", "Enter");
  expect(await page.textContent("#loc-found"), "Looking it up…", "Enter starts the online place lookup");
  await page.press("#set-place", "Enter");
  await page.locator("#set-place").blur();
  await page.waitForFunction(() => document.querySelector("#loc-found").textContent === "Pisa, Toscana, Italia");
  expect(await page.inputValue("#set-lat"), "43.7159", "online city latitude");
  expect(await page.inputValue("#set-lon"), "10.4019", "online city longitude");
  expect(await page.inputValue("#set-h"), "4", "online city elevation");
  expect(await page.inputValue("#set-place"), "", "successful place lookup clears the query");
  check(placeRequests === 1 && elevationRequests === 1, "Enter and blur share one pending lookup");
  await page.fill("#set-place", "Unknown test city");
  await page.press("#set-place", "Enter");
  await page.waitForFunction(() => document.querySelector("#loc-found").textContent.includes("not known to OpenStreetMap"));
  expect(await page.inputValue("#set-lat"), "43.7159", "failed lookup preserves the saved location");
  await page.fill("#set-place", "Pisa");
  await page.press("#set-place", "Enter");
  expect(await page.textContent("#loc-found"), "Pisa, Toscana, Italia", "cached cities resolve after a failed search");
  check(placeRequests === 2, "cached city needs no further online request");
  await page.fill("#set-place", "Milan");
  await page.locator("#set-place").blur();
  expect(await page.textContent("#loc-found"), "Milan, IT", "built-in cities still resolve on blur");
  check(placeRequests === 2, "built-in cities need no online request");
  for (const id of ["#set-lat", "#set-lon", "#set-h"]) {
    await page.fill(id, "");
    await page.locator(id).dispatchEvent("change");
  }
  await page.click("#sheet .sheet-head [data-close]");
  await page.unroute("https://nominatim.openstreetmap.org/search?**", geocode);
  await page.unroute("https://api.open-meteo.com/v1/elevation?**", elevation);

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
