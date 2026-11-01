// Checks of the calculator, run with: node tests/run.mjs
//
// Dates and time zones, calendars (against the calendars of Intl, which
// browsers and Node share, where it has them), holidays, and the Sun, the
// Moon and the planets (against PyEphem and JPL Horizons, stored below). Prints
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

// The parts of a date
for (const [src, parts] of [["ymd(2026.10.30 23:59)", "2026,10,30"], ["ymd(2026.10.30, \"hebrew\")", "5787,8,19"], ["ymd(2026.10.30, \"Julian\")", "2026,10,17"],
  ["ymd(2012.12.21, \"mayan\")", "13,0,0,0,0"], ["ymd(2030.01.05, \"umalqura\")", "1451,9,1"], ["ymd(today).1 - ymd(today - 400[day]).1", "1"]]) {
  const r = calc.run(src);
  const got = r.kind !== "value" ? r.message : (Array.isArray(r.q) ? r.q : [r.q]).map((q) => q.x.n).join(",");
  if (got !== parts) fail(`${src} gives ${got}, not ${parts}`);
}
if (calc.run('ymd(today, "aztec")').kind !== "error") fail("ymd with an unknown calendar should be an error");

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
// new moon falls 40 s before midnight and the unknown ΔT decides. In 1917
// and 1922 the leap month moves, as a major term falls 3 and 5 minutes
// after midnight (checked with JPL Horizons)
const { chineseFromFixed, fixedFromChinese, MONTHS: CALENDAR_MONTHS } = await import(new URL("js/calendars.js", root));
{
  const CHINESE_ICU = new Set(["1906-04-23", "1917-03-23", "1922-06-25", "1954-02-03", "1955-02-22", "1987-07-26", "1999-01-17", "2012-08-17", "2018-11-07", "2027-02-06", "2030-02-02", "2070-03-12", "2097-08-07"]);
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

// The Sun, the Moon and the planets, against JPL Horizons (DE441): apparent
// geocentric right ascension and declination (degrees), distance (au), at
// Julian days of TT from 1600 to 2400. Within 1″ for the Sun and the inner
// planets, more for Uranus and Neptune (VSOP87), 10″ for the Moon.

const PLACES = [
  ["sun", 2305500.5, 335.632568587, -10.166911338, 0.99075734919586], ["sun", 2415020.5, 281.045942957, -23.062916418, 0.98326627292084], ["sun", 2451545, 281.277554826, -23.032489039, 0.98332763198913],
  ["sun", 2461345.5, 216.196590817, -14.360360159, 0.99268434071044], ["sun", 2597500.5, 142.551414377, 14.734359034, 1.01418029199028],
  ["mercury", 2305500.5, 311.262415923, -16.671752695, 0.78051126596326], ["mercury", 2415020.5, 258.134636762, -21.872980164, 1.14206697430704], ["mercury", 2451545, 272.073366975, -24.418845941, 1.41546603886886],
  ["mercury", 2461345.5, 223.731119189, -18.300113821, 0.68164127929341], ["mercury", 2597500.5, 154.050864669, 5.735470564, 0.61815733286639],
  ["venus", 2305500.5, 288.120898755, -19.233648372, 0.65299115347859], ["venus", 2415020.5, 309.207984101, -20.318598959, 1.46459621445749], ["venus", 2451545, 239.891836699, -18.448719557, 1.13757442548820],
  ["venus", 2461345.5, 202.521068866, -14.661851108, 0.27977161841143], ["venus", 2597500.5, 98.236523912, 21.153216692, 0.98400123178732],
  ["moon", 2305500.5, 83.564594642, 26.416341126, 0.00255360364917], ["moon", 2415020.5, 272.611978856, -22.321444131, 0.00246249985371], ["moon", 2451545, 222.443585389, -10.897906428, 0.00268997545281],
  ["moon", 2461345.5, 120.058113288, 23.110538242, 0.00247264541716], ["moon", 2597500.5, 271.624935480, -27.132816386, 0.00267108594928],
  ["mars", 2305500.5, 123.695028369, 24.122619831, 0.74445746054257], ["mars", 2415020.5, 285.166286914, -23.649530400, 2.40096342547839], ["mars", 2451545, 330.516247655, -13.182689444, 1.84968383439833],
  ["mars", 2461345.5, 141.569345442, 16.765264299, 1.43251661767150], ["mars", 2597500.5, 158.426214497, 10.198631798, 2.61652658902265],
  ["jupiter", 2305500.5, 137.488390031, 17.489794019, 4.41340291798485], ["jupiter", 2415020.5, 239.177830681, -19.600557014, 6.11306228335015], ["jupiter", 2451545, 23.867809514, 8.594247379, 4.62116371179118],
  ["jupiter", 2461345.5, 146.862438845, 14.064240454, 5.49965644531705], ["jupiter", 2597500.5, 274.148325530, -23.264254432, 4.47537686423769],
  ["saturn", 2305500.5, 207.250514585, -8.404740678, 9.16644684071581], ["saturn", 2415020.5, 267.530240289, -22.424383255, 11.0246699296101], ["saturn", 2451545, 38.765415018, 12.614765627, 8.65278568673054],
  ["saturn", 2461345.5, 9.588013988, 1.211248802, 8.54788678558703], ["saturn", 2597500.5, 255.633791723, -21.219342472, 9.55657486214399],
  ["uranus", 2305500.5, 26.368336344, 10.396062011, 20.3336349572548], ["uranus", 2415020.5, 248.518067829, -21.918567652, 19.8378149807608], ["uranus", 2451545, 317.474773557, -17.020341543, 20.7271637906951],
  ["uranus", 2461345.5, 62.746471966, 20.922730540, 18.5392290287537], ["uranus", 2597500.5, 230.630964645, -18.211463608, 18.5983513992441],
  ["neptune", 2305500.5, 148.880896953, 13.316665067, 29.1545733397688], ["neptune", 2415020.5, 84.841069687, 22.066379319, 28.9202265660462], ["neptune", 2451545, 305.432803804, -19.213246467, 31.0244926146295],
  ["neptune", 2461345.5, 2.474457764, -0.469166715, 29.0737641486530], ["neptune", 2597500.5, 106.479743514, 21.625831008, 30.7360891863144],
];
const PLACE_TOL = { sun: 0.3, moon: 10, mercury: 1, venus: 1, mars: 1.5, jupiter: 1, saturn: 1.5, uranus: 4, neptune: 6.5 };
for (const [body, jd, ra, dec, au] of PLACES) {
  const t = (jd - 2440587.5) * 86400 - A.deltaT(2000 + (jd - 2451545) / 365.25);
  const p = A.equatorial(body, t), r = Math.PI / 180;
  const c = Math.sin(dec * r) * Math.sin(p.dec * r) + Math.cos(dec * r) * Math.cos(p.dec * r) * Math.cos((ra - p.ra) * r);
  const sep = Math.acos(Math.min(1, c)) / r * 3600, rel = p.dist / 149597870.7 / au - 1;
  if (!(sep <= PLACE_TOL[body])) fail(`${body} at JD ${jd}: ${sep.toFixed(2)}″ from Horizons`);
  if (!(Math.abs(rel) <= (body === "moon" ? 1.5e-4 : 1e-5))) fail(`${body} at JD ${jd}: distance ${rel.toExponential(1)} from Horizons`);
}

// seen from Milan (45.46°, 9.19°) on 2026.11.01 12:00 UT, against Horizons
// (airless): [body, azimuth, altitude], to 1″, the Moon to 10″
for (const [body, az, alt] of [["sun", 194.720898976, 28.819999943], ["moon", 293.563366038, 5.463386662],
  ["mars", 280.625068257, 13.080708420], ["jupiter", 275.143756435, 14.784698911]]) {
  const h = A.horizontal(body, Date.UTC(2026, 10, 1, 12) / 1000, [45.46, 9.19]);
  const d = Math.hypot(h.alt - alt, (h.az - az) * Math.cos(alt * Math.PI / 180)) * 3600;
  if (!(d <= (body === "moon" ? 10 : 1))) fail(`${body} seen from Milan: ${d.toFixed(2)}″ from Horizons`);
}

// brightness and aspect, against Horizons (Mallama and Hilton, 2018):
// [body, JD of TT, magnitude, illuminated %, diameter (″), phase angle]
const ASPECTS = [
  ["sun", 2461088.5, -26.768, 100.00000, 1941.566, 0.0000], ["mercury", 2461088.5, -0.711, 61.90909, 6.630989, 76.2262],
  ["venus", 2461088.5, -3.902, 98.58654, 9.936095, 13.6616], ["moon", 2461088.5, -4.579, 0.29847, 1854.529, 173.7309],
  ["mars", 2461088.5, 1.049, 99.68329, 3.971613, 6.4467], ["jupiter", 2461088.5, -2.527, 99.59190, 44.23163, 7.3211],
  ["saturn", 2459867.5, 0.601, 99.79650, 17.75254, 5.1686], ["saturn", 2460829.5, 1.074, 99.74568, 16.87753, 5.7795],
  ["saturn", 2460940.5, 0.584, 99.99942, 19.44513, 0.2751], ["saturn", 2461088.5, 1.014, 99.92384, 16.09344, 3.1677],
  ["uranus", 2461088.5, 5.726, 99.93572, 3.619906, 2.9057], ["neptune", 2461088.5, 7.814, 99.99220, 2.223391, 1.0170],
];
for (const [body, jd, mag, lit, diam, phase] of ASPECTS) {
  const t = (jd - 2440587.5) * 86400 - A.deltaT(2000 + (jd - 2451545) / 365.25);
  const a = A.aspect(body, t), m = A.magnitude(body, t), d = A.diameter(body, t) * 3600;
  // Horizons adds to Mars the effects of its seasons and of the face it
  // shows, up to 0.15; the Moon's radius differs a little
  if (!(Math.abs(m - mag) <= (body === "mars" ? 0.15 : 0.025) && Math.abs(a.phase - phase) <= 0.01 && Math.abs(d / diam - 1) <= 2e-4)) {
    fail(`${body} at JD ${jd}: magnitude ${m.toFixed(3)}, phase ${a.phase.toFixed(3)}°, diameter ${d.toFixed(3)}″, not ${mag}, ${phase}°, ${diam}″`);
  }
  if (!(Math.abs(50 * (1 + Math.cos(a.phase * Math.PI / 180)) - lit) <= 0.01)) fail(`${body} at JD ${jd}: illuminated fraction`);
}
// Venus near inferior conjunction (the second formula), JD 2459001.5 UT
if (!(Math.abs(A.magnitude("venus", (2459001.5 - 2440587.5) * 86400) + 3.859) <= 0.002)) fail("Venus near inferior conjunction: magnitude");

// rising, transit and setting of planets seen from Milan after 2026.11.01
// 0:00 UT, against Horizons (refracted, to the minute)
for (const [body, rise, tr, set] of [["mars", 2461346.453472222, 2461345.755555556, 2461346.056944444],
  ["jupiter", 2461346.475, 2461345.770138889, 2461346.0625], ["venus", 2461345.714583333, 2461345.923611111, 2461346.133333333]]) {
  const t0 = Date.UTC(2026, 10, 1) / 1000, jd = (x) => x / 86400 + 2440587.5;
  const got = [A.riseSet(body, t0, [45.46, 9.19], true).t, A.transit(body, t0, 9.19), A.riseSet(body, t0, [45.46, 9.19], false).t];
  got.forEach((x, i) => {
    const d = (jd(x) - [rise, tr, set][i]) * 1440;
    if (!(Math.abs(d) <= 1)) fail(`${["rising", "transit", "setting"][i]} of ${body}: ${d.toFixed(2)} min from Horizons`);
  });
}

// the moons, against Horizons: apparent offsets from the planet (″, east
// and north) and the visibility code (* free, u in the umbra, O occulted,
// t in transit), at Julian days of UT
const MOON_REFS = [
  ["jupiter", 2461345.5, "Io", 84.344, -33.296, "*"], ["jupiter", 2461400.25, "Io", 112.982, -45.904, "*"],
  ["jupiter", 2461345.5, "Europa", -33.394, 11.317, "u"], ["jupiter", 2461400.25, "Europa", 125.338, -48.297, "*"],
  ["jupiter", 2461345.5, "Ganymede", 52.883, -21.451, "*"], ["jupiter", 2461400.25, "Ganymede", -264.145, 109.211, "*"],
  ["jupiter", 2461345.5, "Callisto", 166.178, -67.125, "*"], ["jupiter", 2461400.25, "Callisto", 448.771, -177.927, "*"],
  ["saturn", 2461345.5, "Titan", -19.539, -21.114, "*"], ["saturn", 2461400.25, "Titan", 90.440, 13.188, "*"],
  ["saturn", 2461345.5, "Iapetus", 405.002, 15.037, "*"], ["saturn", 2461400.25, "Iapetus", -476.282, -132.877, "*"],
  ["neptune", 2461345.5, "Triton", -7.171, -15.216, "*"], ["neptune", 2461400.25, "Triton", -3.878, 9.366, "*"],
];
for (const [planet, jd, name, east, north, code] of MOON_REFS) {
  const m = A.moons(planet, (jd - 2440587.5) * 86400), o = m.moons.find((x) => x.name === name);
  const d = Math.hypot(o.east * 3600 - east, o.north * 3600 - north), tol = name === "Iapetus" ? 1 : 0.2;
  if (!(d <= tol)) fail(`${name} at JD ${jd}: ${d.toFixed(2)}″ from Horizons`);
  const got = o.eclipsed ? "u" : o.occulted ? "O" : o.transit ? "t" : "*";
  if (got !== code) fail(`${name} at JD ${jd}: ${got}, not ${code}`);
}
// Europa behind Jupiter, Io in front of it (Horizons: O and t)
for (const [jd, i, k] of [[2461345.61, 1, "occulted"], [2461345.75694, 0, "transit"]]) {
  const o = A.moons("jupiter", (jd - 2440587.5) * 86400).moons[i];
  if (!o[k]) fail(`${o.name} at JD ${jd} is not ${k}`);
}

// the functions: right ascension in hours, bodies by name
for (const [src, text] of [["radec(\"Mars\", 2026.11.01 12:00 Z).1 @ hms", "9h 27m 17.39s ± 0.10s"], ["radec(\"MARS\", 2026.11.01 12:00 Z).1 @ hms", "9h 27m 17.39s ± 0.10s"],
  ["30 deg @ hms", "2h 0m 0s"], ["dist(\"Moon\", 2026.11.01 12:00 Z) @ km", "(371486±56)[km]"]]) {
  const r = calc.run(src);
  const got = r.kind === "value" ? calc.env.format(r.q) : r.message;
  if (got !== text) fail(`${src} gives ${got}, not ${text}`);
}
// coordinates: the north galactic pole, Meeus' example 21.b (θ Persei,
// with its proper motion), and the round trips through ecl and altaz
const text = (q) => (Array.isArray(q) ? `(${q.map(text).join(", ")})` : calc.env.format(q));
const T0 = "2026.11.01 12:00 Z", MILAN = "(45.46, 9.19)[deg]";
for (const [src, want] of [["gal2eq((0, 90)[deg]).1 @ hms", "12h 51m 26.275s"], ["gal2eq((0, 90)[deg]).2", "27.12825[deg]"], ["eq2ecl((6h, 23.4392911[deg]))", "(90[deg], 0[deg])"],
  ["precess((2h 44m 12.975s, 49d 13' 39.896\"), 2000, 2028.8670).1 @ hms", "2h 46m 11.331s"],
  ["precess((2h 44m 12.975s, 49d 13' 39.896\"), 2000, 2028.8670).2 @ dms", "49° 20' 54.534\""],
  [`hor2eq(altaz("Mars", ${T0}, ${MILAN}), ${T0}, ${MILAN}).1 @ hms`, "9h 27m 17.1s ± 1.3s"],
  ["sep((5h, 10[deg]), (5h, (10.5 ± 0.1)[deg]))", "(0.50±0.10)[deg]"], ["pa((0, 0)[deg], (1, 0)[deg])", "90[deg]"], ["1 hourangle @ deg", "15[deg]"]]) {
  const r = calc.run(src);
  const got = r.kind === "value" ? text(r.q) : r.message;
  if (got !== want) fail(`${src} gives ${got}, not ${want}`);
}
{
  const r = calc.run(`eq2ecl(radec("Mars", ${T0}), ${T0}) - ecl("Mars", ${T0})`);
  if (r.kind !== "value" || !r.q.every((q) => Math.abs(q.x.n) < 1e-10)) fail(`eq2ecl(radec("Mars", t), t) is not ecl("Mars", t)`);
}
for (const src of ["radec(\"Pluto\", now)", "radec(now)", "dist(\"Mars\", 5)", "altaz(\"Mars\", now, 5)", "sep((1, 2, 3), (1, 2))", "precess((0, 0), 2000)", "refract(0, 101 kPa, 5 m)"]) {
  if (calc.run(src).kind !== "error") fail(`${src} should be an error`);
}

// ---------------------------------------------------------------------
// Elements of lists: v.n and item(v, n); numbers start with a digit

const shown = (q) => (Array.isArray(q) ? `(${q.map(shown).join(", ")})` : calc.env.format(q));
for (const src of ["v = (1, 2, 4, 8)", "n = 3", "t = ((1, 2), (3, 4))"]) calc.run(src);
const LISTS = [
  ["v.1", "1"], ["v.-1", "8"], ["v.n", "4"], ["v.-n", "2"], ["v.(n+1)", "8"], ["v.(1, 3)", "(1, 4)"],
  ["t.2.1", "3"], ["t.2", "(3, 4)"], ["(5, 6, 7).2", "6"], ["-v.2^2", "-4"], ["2 v.3", "8"],
  ["item(v, 2)", "2"], ["item(v, (1, -1))", "(1, 8)"], ["sum(v.k, k, 1, 4)", "15"], ["0.5 + 1.5", "2"],
];
for (const [src, text] of LISTS) {
  const r = calc.run(src);
  const got = r.kind === "value" ? shown(r.q) : r.message;
  if (got !== text) fail(`${src} gives ${got}, not ${text}`);
}
for (const src of ["v.0", "v.5", "v.(1.5)", "n.1", "item(3, 1)", ".5", "1 + .5", "v."]) {
  if (calc.run(src).kind !== "error") fail(`${src} should be an error`);
}

console.log(failures ? `${failures} failures` : "All checks passed");
process.exit(failures ? 1 : 0);
