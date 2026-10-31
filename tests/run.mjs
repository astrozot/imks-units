// Checks of the calculator, run with: node tests/run.mjs
//
// Dates and time zones, calendars (against the calendars of Intl, which
// browsers and Node share, where it has them), holidays, and the Sun and
// the Moon (against times computed with PyEphem, stored below). Prints
// the failures and exits with 1 if there are any.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const window = {};
new Function("window", fs.readFileSync(new URL("js/data.js", root), "utf8"))(window);
const { createCalculator } = await import(new URL("js/defs.js", root));
const { CALENDARS, UNIX_RD } = await import(new URL("js/calendars.js", root));
const A = await import(new URL("js/astro.js", root));

const { calc, errors } = createCalculator({ constants: window.IMKS_DATA.constants });
let failures = 0;
const fail = (msg) => { failures++; console.log("FAIL", msg); };
if (errors.length) fail(`startup: ${errors.join("; ")}`);

// the instant of a date expression, in seconds
const instant = (src) => {
  const r = calc.run(src);
  if (r.kind !== "value") throw new Error(`${src}: ${r.message || r.kind}`);
  return r.q.relative().x.n;
};

// ---------------------------------------------------------------------
// Time zones: the text of a date, typed back, is the same instant (in a
// child process for each zone, as TZ is read once)

if (process.argv[2] === "--zone") {
  calc.env.utc = process.argv[3] === "utc";
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    const t = Math.round((Math.random() * 2 - 1) * (i < 1000 ? 2e9 : 6e10)) + (i % 2 ? 0.25 : 0);
    const r = calc.run(`~${t}[s]`);
    const back = calc.run(calc.env.format(r.q));
    if (back.kind !== "value" || Math.abs(back.q.relative().x.n - t) > 1e-3) bad++;
  }
  console.log(bad);
  process.exit(0);
}

const script = fileURLToPath(import.meta.url);
for (const [zone, mode] of [["Europe/Rome"], ["America/New_York"], ["Asia/Kolkata"], ["Australia/Lord_Howe"], ["Pacific/Chatham"], ["America/New_York", "utc"]]) {
  const out = execFileSync(process.execPath, [script, "--zone", mode || ""], { env: { ...process.env, TZ: zone } }).toString().trim();
  if (out !== "0") fail(`time zone ${zone}${mode ? " (UTC mode)" : ""}: ${out} dates do not read back`);
}

// the rest in UTC, so that the dates below mean the same everywhere
calc.env.utc = true;

// ---------------------------------------------------------------------
// Known dates: expression and the date it is

const SAME = [
  ["hebrew(5787, 1, 15)", "2027.04.22"],
  ["easter(2038)", "2038.04.25"],
  ["easter(2285)", "2285.03.22"],
  ["easter_orthodox(2027)", "2027.05.02"],
  ["julian(1582, 10, 4) + 1[day]", "1582.10.15"],
  ["french(1, 1, 1)", "1792.09.22"],
  ["french(8, 2, 18)", "1799.11.09"],
  ["french(14, 4, 11)", "1806.01.01"],
  ["chinese(2025, 6, 1, 1)", "2025.07.25"],
  ["chinese(2026, 1, 1)", "2026.02.17"],
  ['japanese("Heisei", 1, 1, 8)', "1989.01.08"],
  ["mayan(13, 0, 0, 0, 0)", "2012.12.21"],
  ["persian(1405, 1, 1)", "2026.03.21"],
  ["saka(1948, 1, 1)", "2026.03.22"],
  ["islamic(1448, 9, 1)", "2027.02.08"],
  ['holiday("Rosh Hashanah", 2027)', "2027.10.02"],
  ['holiday("Purim", 2027)', "2027.03.23"],
  ['holiday("Eid al-Fitr", 2026)', "2026.03.20"],
  ['holiday("Chinese New Year", 2026)', "2026.02.17"],
  ['holiday("Orthodox Christmas", 2027)', "2027.01.07"],
  ['holiday("Ramadan", 2030)', "2030.01.05"],
  ["umalqura(1447, 9, 1)", "2026.02.18"],
  ["hindu(1948, 1, 1)", "2026.03.19"],
  ["hindu(1945, 5, 1, 1)", "2023.07.18"],
  ["hindu(1945, 5, 1)", "2023.08.17"],
  ['holiday("Makar Sankranti", 2026)', "2026.01.14"],
  ["persian(1503, 1, 1)", "2124.03.20"],
  ["2451545[JD]", "2000.01.01 12:00"],
  ["2026-10-30T18:42Z", "2026.10.30 18:42"],
  ["2026.10.30 18:42 +05:30", "2026.10.30 13:12"],
  ["date(2026, 10, 30.75)", "2026.10.30 18:00"],
];
for (const [a, b] of SAME) {
  try {
    if (instant(a) !== instant(b)) fail(`${a} is not ${b}`);
  } catch (e) { fail(e.message); }
}

// Texts of formats
const TEXT = [
  ["2026.10.30 @ hebrew", "19 Heshvan 5787"],
  ["2026.10.30 @ islamic", "18 Jumada I 1448"],
  ["2026.10.30 @ persian", "8 Aban 1405"],
  ["2026.10.30 @ julian", "17 October 2026"],
  ["2026.10.30 @ saka", "8 Kartika 1948"],
  ["2026.10.31 @ hindu", "Ashvin Krishna 6, Saka 1948"],
  ["2023.07.20 @ hindu", "Adhika Shravana Shukla 3, Saka 1945"],
  ["2030.01.05 @ umalqura", "1 Ramadan 1451"],
  ["2026.10.30 @ chinese", "Month 9, day 21, bing-wu year (2026)"],
  ["2025.07.25 @ chinese", "Leap month 6, day 1, yi-si year (2025)"],
  ["2026.10.30 @ japanese", "30 October, Reiwa 8"],
  ["1806.01.01 @ french", "11 Nivôse, year XIV"],
  ["2012.12.21 @ mayan", "13.0.0.0.0"],
  ["2026.10.30 @ dow", "Friday"],
  ["2026.10.30 @ doy", "Day 303 of 2026"],
  ["2026.12.31 @ week", "Week 53 of 2026"],
  ["2027.01.01 @ week", "Week 53 of 2026"],
  ["2026.10.30 18:42", "2026.10.30 18:42 UTC"],
];
for (const [src, text] of TEXT) {
  const r = calc.run(src);
  const got = r.kind === "value" ? calc.env.display(r.q).text : r.message;
  if (got !== text) fail(`${src} gives ${got}, not ${text}`);
}

// Not dates
for (const src of ["2026.2.30", "hebrew(5786, 13, 1)", "julian(2026, 2, 29)", "chinese(2026, 6, 1, 1)", 'japanese("Showa", 64, 1, 8)', 'holiday("Thanksgiving", 2027)', 'hindu(1948, 1, 31)']) {
  if (calc.run(src).kind !== "error") fail(`${src} should be an error`);
}

// ---------------------------------------------------------------------
// Calendars: every day reads back, from 1003 to 2998

for (const [name, [from, to]] of Object.entries(CALENDARS)) {
  let bad = 0;
  for (let f = 366000; f <= 1095000; f += 7) if (to(...from(f)) !== f) bad++;
  if (bad) fail(`${name}: ${bad} days do not read back`);
}

// and agree with Intl: [calendar, Intl name, first and last fixed day]
// (Persian until 1501, from where ICU follows the astronomical calendar)
const INTL = [["hebrew", "hebrew", 1, 876000], ["islamic", "islamic-civil", 1, 876000], ["persian", "persian", 1, 767000],
  ["coptic", "coptic", 104000, 876000], ["ethiopic", "ethiopic", 3200, 876000], ["saka", "indian", 700000, 800000]];
for (const [name, cal, lo, hi] of INTL) {
  const fm = new Intl.DateTimeFormat(`en-u-ca-${cal}-nu-latn`, { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
  let bad = 0;
  for (let f = lo; f <= hi; f += 13) {
    const o = Object.fromEntries(fm.formatToParts(new Date((f - UNIX_RD) * 864e5 + 432e5)).map((p) => [p.type, p.value]));
    const [y, m, d] = CALENDARS[name][0](f);
    // ICU names the Hebrew months instead of numbering them
    if (Number(o.year) !== y || Number(o.day) !== d || (name !== "hebrew" && Number(o.month) !== m)) bad++;
  }
  if (bad) fail(`${name}: ${bad} days differ from Intl`);
}

// The Chinese calendar: every day reads back, from 1901 to 2099, and it
// agrees with Intl except in the months below, which begin with a new moon
// a few minutes from midnight in China (or a leap month, 1987), where ICU's
// Moon is not precise enough: checked with PyEphem, except 2097, where the
// new moon falls 40 s before midnight and the unknown ΔT decides
const { chineseFromFixed, fixedFromChinese, MONTHS: CALENDAR_MONTHS } = await import(new URL("js/calendars.js", root));
{
  const CHINESE_ICU = new Set(["1906-04-23", "1954-02-03", "1955-02-22", "1987-07-26", "1999-01-17", "2012-08-17", "2018-11-07", "2027-02-06", "2030-02-02", "2070-03-12", "2097-08-07"]);
  const fm = new Intl.DateTimeFormat("en-u-ca-chinese", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
  const iso = (f) => new Date((f - UNIX_RD) * 864e5).toISOString().slice(0, 10);
  let bad = 0, unexpected = new Set(), start = null;
  for (let f = Math.round(Date.UTC(1901, 0, 1) / 864e5) + UNIX_RD; f < Math.round(Date.UTC(2100, 0, 1) / 864e5) + UNIX_RD; f++) {
    const p = chineseFromFixed(f);
    if (fixedFromChinese(...p) !== f) bad++;
    const o = Object.fromEntries(fm.formatToParts(new Date((f - UNIX_RD) * 864e5 + 432e5)).map((x) => [x.type, x.value]));
    const same = Number(o.relatedYear) === p[0] && parseInt(o.month, 10) === p[1] && Number(o.day) === p[2] && /bis/.test(o.month) === (p[3] === 1);
    if (same) start = null;
    else {
      // the first day of each stretch of differences
      if (start === null) {
        start = f;
        if (!CHINESE_ICU.has(iso(f))) unexpected.add(iso(f));
      }
    }
  }
  if (bad) fail(`chinese: ${bad} days do not read back`);
  if (unexpected.size) fail(`chinese: new differences from Intl from ${[...unexpected].join(", ")}`);
}
// Umm al-Qura reads back from 1300 to 1600 AH
{
  let bad = 0;
  for (let f = 686000; f <= 795000; f += 3) {
    const r = calc.run(`${new Date((f - UNIX_RD) * 864e5).toISOString().slice(0, 10).replaceAll("-", ".")} @ umalqura`);
    const m = /^(\d+) (.+) (\d+)$/.exec(calc.env.display(r.q).text);
    const back = calc.run(`umalqura(${m[3]}, ${CALENDAR_MONTHS.islamic.indexOf(m[2]) + 1}, ${m[1]})`);
    if (back.kind !== "value" || back.q.relative().x.n !== (f - UNIX_RD) * 86400) bad++;
  }
  if (bad) fail(`umalqura: ${bad} days do not read back`);
}

for (const [src, date] of [["chinese(2027, 1, 1)", "2027.02.06"], ["chinese(2030, 1, 1)", "2030.02.03"], ["chinese(1987, 6, 1, 1)", "1987.07.26"],
  ["chinese(2020, 4, 1, 1)", "2020.05.23"], ["chinese(2023, 2, 1, 1)", "2023.03.22"], ["chinese(2033, 11, 1, 1)", "2033.12.22"]]) {
  try {
    if (instant(src) !== instant(date)) fail(`${src} is not ${date}`);
  } catch (e) { fail(e.message); }
}

// The Hindu calendar: every day reads back from 2000 to 2029, and Diwali
// and Holi are on the published dates (Drik Panchang)
{
  const { hinduFromFixed, fixedFromHindu } = await import(new URL("js/calendars.js", root));
  let bad = 0;
  for (let f = 730120; f < 741077; f++) if (fixedFromHindu(...hinduFromFixed(f).slice(0, 3), ...hinduFromFixed(f).slice(3)) !== f) bad++;
  if (bad) fail(`hindu: ${bad} days do not read back`);
  const DIWALI = ["2018.11.07", "2019.10.27", "2020.11.14", "2021.11.04", "2022.10.24", "2023.11.12", "2024.10.31", "2025.10.20", "2026.11.08", "2027.10.29", "2028.10.17", "2029.11.05", "2030.10.26"];
  const HOLI = ["2018.03.02", "2019.03.21", "2020.03.10", "2021.03.29", "2022.03.18", "2023.03.08", "2024.03.25", "2025.03.14", "2026.03.04", "2027.03.22", "2028.03.11"];
  for (const [name, dates] of [["Diwali", DIWALI], ["Holi", HOLI]]) {
    for (const d of dates) {
      try {
        if (instant(`holiday("${name}", ${d.slice(0, 4)})`) !== instant(d)) fail(`${name} ${d.slice(0, 4)} is not ${d}`);
      } catch (e) { fail(e.message); }
    }
  }
}

// ---------------------------------------------------------------------
// The Sun and the Moon, against PyEphem (pressure 0, horizon −34′, upper
// limb): [event, day (0h UT), place, Unix time]. Rising and setting to a
// minute, phases to two (PyEphem's ΔT differs by seconds), seasons to 90 s.

const SKY = [
  ["sunrise", "2026.03.01", [45.46, 9.19], 1772344908], ["sunset", "2026.03.01", [45.46, 9.19], 1772385000],
  ["moonrise", "2026.03.01", [45.46, 9.19], 1772376921], ["moonset", "2026.03.01", [45.46, 9.19], 1772341890],
  ["sunrise", "2026.10.30", [45.46, 9.19], 1793339979], ["sunset", "2026.10.30", [45.46, 9.19], 1793376811],
  ["moonrise", "2026.10.30", [45.46, 9.19], 1793388734], ["moonset", "2026.10.30", [45.46, 9.19], 1793359097],
  ["sunrise", "2026.03.01", [-33.87, 151.21], 1772394207], ["sunset", "2026.03.01", [-33.87, 151.21], 1772353915],
  ["moonrise", "2026.03.01", [-33.87, 151.21], 1772349533], ["moonset", "2026.03.01", [-33.87, 151.21], 1772387981],
  ["sunrise", "2026.10.30", [-33.87, 151.21], 1793386569], ["sunset", "2026.10.30", [-33.87, 151.21], 1793348463],
  ["moonrise", "2026.10.30", [-33.87, 151.21], 1793365875], ["moonset", "2026.10.30", [-33.87, 151.21], 1793400935],
  ["sunrise", "2026.03.01", [0, -78.5], 1772364176], ["sunset", "2026.03.01", [0, -78.5], 1772407773],
  ["moonrise", "2026.03.01", [0, -78.5], 1772403285], ["moonset", "2026.03.01", [0, -78.5], 1772358487],
  ["sunrise", "2026.10.30", [0, -78.5], 1793357654], ["sunset", "2026.10.30", [0, -78.5], 1793401264],
  ["moonrise", "2026.10.30", [0, -78.5], 1793328159], ["moonset", "2026.10.30", [0, -78.5], 1793373184],
  ["newmoon", "2026.01.01", null, 1768765915], ["fullmoon", "2026.01.01", null, 1767434571],
  ["newmoon", "2026.10.30", null, 1794207723], ["fullmoon", "2026.10.30", null, 1795532009],
  ["newmoon", "2030.06.15", null, 1909085660], ["fullmoon", "2030.06.15", null, 1907779252],
];
for (const [event, day, place, ref] of SKY) {
  const t0 = Date.UTC(...day.split(".").map((x, i) => Number(x) - (i === 1 ? 1 : 0))) / 1000;
  const got = event.endsWith("moon") ? A.nextPhase(t0, event === "newmoon" ? 0 : 180)
    : A.riseSet(event.startsWith("sun") ? "sun" : "moon", t0, place, /rise$/.test(event))?.t;
  const tol = event.endsWith("moon") ? 120 : 60;
  if (!(Math.abs(got - ref) <= tol)) fail(`${event} of ${day} at ${place ?? "Earth"}: ${Math.round(got - ref)} s from PyEphem`);
}

// equinoxes and solstices of 2027 (PyEphem, UT)
const SEASONS = [[0, Date.UTC(2027, 2, 20, 20, 24, 32)], [1, Date.UTC(2027, 5, 21, 14, 10, 50)], [2, Date.UTC(2027, 8, 23, 6, 1, 33)], [3, Date.UTC(2027, 11, 22, 2, 41, 53)]];
// and an equinox of the year 500 (PyEphem: JD 1903760.3084 UT; ΔT differs)
SEASONS.push([0, (1903760.3084 - 2440587.5) * 864e5, 500, 300]);
for (const [k, ms, year = 2027, tol = 90] of SEASONS) {
  const d = A.season(year, k) - ms / 1000;
  if (!(Math.abs(d) <= tol)) fail(`season ${k} of ${year}: ${Math.round(d)} s from PyEphem`);
}

console.log(failures ? `${failures} failures` : "All checks passed");
process.exit(failures ? 1 : 0);
