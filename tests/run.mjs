// Checks of the calculator, run with: node tests/run.mjs
//
// Dates and time zones, calendars (against the calendars of Intl, which
// browsers and Node share, where it has them), holidays, and the Sun, the
// Moon, the planets and the stars (against PyEphem, JPL Horizons and
// astropy, stored below), and names of stars and places. Prints
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
// planets, more for Uranus and Neptune (VSOP87), 2″ for the Moon.

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
const PLACE_TOL = { sun: 0.3, moon: 2, mercury: 1, venus: 1, mars: 1.5, jupiter: 1, saturn: 1.5, uranus: 4, neptune: 6.5 };
for (const [body, jd, ra, dec, au] of PLACES) {
  const t = (jd - 2440587.5) * 86400 - A.deltaT(2000 + (jd - 2451545) / 365.25);
  const p = A.equatorial(body, t), r = Math.PI / 180;
  const c = Math.sin(dec * r) * Math.sin(p.dec * r) + Math.cos(dec * r) * Math.cos(p.dec * r) * Math.cos((ra - p.ra) * r);
  const sep = Math.acos(Math.min(1, c)) / r * 3600, rel = p.dist / 149597870.7 / au - 1;
  if (!(sep <= PLACE_TOL[body])) fail(`${body} at JD ${jd}: ${sep.toFixed(2)}″ from Horizons`);
  if (!(Math.abs(rel) <= (body === "moon" ? 1.5e-4 : 1e-5))) fail(`${body} at JD ${jd}: distance ${rel.toExponential(1)} from Horizons`);
}

// the Moon's range of the observer tables of Horizons differs from the
// geometric distance by 1e-4: the distance against its vectors, at JD
// 2461345.5 TT, 369938.709 km, to 3 km
{
  const d = A.equatorial("moon", (2461345.5 - 2440587.5) * 86400 - A.deltaT(2026.8)).dist;
  if (!(Math.abs(d - 369938.709) <= 3)) fail(`Moon distance ${d.toFixed(1)} km, not 369938.7`);
}

// seen from Milan (45.46°, 9.19°) on 2026.11.01 12:00 UT, against Horizons
// (airless): [body, azimuth, altitude], to 1″, the Moon to 10″
for (const [body, az, alt] of [["sun", 194.720898976, 28.819999943], ["moon", 293.563366038, 5.463386662],
  ["mars", 280.625068257, 13.080708420], ["jupiter", 275.143756435, 14.784698911]]) {
  const h = A.horizontal(body, Date.UTC(2026, 10, 1, 12) / 1000, [45.46, 9.19]);
  const d = Math.hypot(h.alt - alt, (h.az - az) * Math.cos(alt * Math.PI / 180)) * 3600;
  if (!(d <= (body === "moon" ? 10 : 1))) fail(`${body} seen from Milan: ${d.toFixed(2)}″ from Horizons`);
}

// stars, against astropy (space motion, then its true equator and equinox
// of the date): apparent right ascension and declination of the catalog
// stars (catalog.js), to 0.4″; Barnard's Star and Proxima for the proper
// motion and parallax: [star, Unix time, ra, dec]
const { STARS } = await import(new URL("js/catalog.js", root));
for (const [name, t, ra, dec] of [
  ["Sirius", -2208988800, 100.195566, -16.57974], ["Polaris", -2208988800, 20.753661, 88.78109], ["Barnard's Star", -2208988800, 268.236809, 4.393341],
  ["Proxima Centauri", -2208988800, 215.740382, -62.250909], ["Vega", -2208988800, 278.383774, 38.690976], ["Sirius", 1793620800, 101.587533, -16.74998],
  ["Polaris", 1793620800, 47.241025, 89.376512], ["Barnard's Star", 1793620800, 269.777615, 4.744514], ["Proxima Centauri", 1793620800, 217.876449, -62.792692],
  ["Vega", 1793620800, 279.459154, 38.812306], ["Sirius", 4115491200, 102.388616, -16.864161], ["Polaris", 4115491200, 88.070463, 89.543416],
  ["Barnard's Star", 4115491200, 270.676173, 4.956451], ["Proxima Centauri", 4115491200, 219.168957, -63.102133], ["Vega", 4115491200, 280.091876, 38.881059]]) {
  const s = STARS.find((x) => x[0] === name), r = Math.PI / 180;
  const p = A.equatorial({ ra: s[1], dec: s[2], pmra: s[3], pmdec: s[4], plx: s[5], rv: s[6] }, t);
  const c = Math.sin(dec * r) * Math.sin(p.dec * r) + Math.cos(dec * r) * Math.cos(p.dec * r) * Math.cos((ra - p.ra) * r);
  const sep = Math.acos(Math.min(1, c)) / r * 3600;
  if (!(sep <= 0.4)) fail(`${name} at ${new Date(t * 1000).toISOString().slice(0, 10)}: ${sep.toFixed(2)}″ from astropy`);
}

// minor planets (minorplanets.js), against JPL Horizons: apparent
// geocentric right ascension and declination at Julian days of TT, to 30″
// (the elements of the nearest year), and their error estimates cover
// them; [name, JD, ra, dec]
{
  const { calc: c2 } = createCalculator({ constants: window.IMKS_DATA.constants });
  for (const [name, jd, ra, dec] of [["Ceres", 2460800.5, 359.96095626, -9.598611859], ["Ceres", 2461700.5, 189.882797911, 4.16115348],
    ["Vesta", 2460800.5, 222.574584307, -4.212995782], ["Vesta", 2462500.5, 326.566740195, -18.410506815],
    ["Eros", 2461345.5, 257.039287022, -26.266387322], ["Eros", 2461700.5, 149.90474675, 17.641103558],
    ["Apophis", 2461345.5, 250.372242657, -20.333721467], ["Apophis", 2462500.5, 59.975934544, 13.668293603]]) {
    const t = (jd - 2440587.5) * 86400 - A.deltaT(2000 + (jd - 2451545) / 365.25);
    const r = c2.run(`radec("${name}", ${t}[s] + 1970.01.01 0:00 Z)`);
    if (r.kind !== "value") { fail(`${name}: ${r.message}`); continue; }
    const [a, d] = r.q.map((q) => q.x.n * 180 / Math.PI), e = r.q[1].x.std * 180 / Math.PI * 3600, k = Math.PI / 180;
    const sep = Math.acos(Math.min(1, Math.sin(dec * k) * Math.sin(d * k) + Math.cos(dec * k) * Math.cos(d * k) * Math.cos((ra - a) * k))) / k * 3600;
    if (!(sep <= 30)) fail(`${name} at JD ${jd}: ${sep.toFixed(1)}″ from Horizons`);
    if (!(sep <= 3 * e)) fail(`${name} at JD ${jd}: ${sep.toFixed(1)}″ from Horizons, more than 3σ (${e.toFixed(1)}″)`);
  }
}

// SGP4 against python-sgp4 (2.25, WGS 72, improved mode): the ISS, TEME
// positions (km) from a day before its epoch to a week after, to 1 m
{
  const { sgp4init, sgp4 } = await import(new URL("js/sgp4.js", root));
  const rec = sgp4init({ MEAN_MOTION: 15.49150046, ECCENTRICITY: 0.0007139, INCLINATION: 51.6332, RA_OF_ASC_NODE: 335.9757, ARG_OF_PERICENTER: 339.3739, MEAN_ANOMALY: 20.6961, BSTAR: 0.00010508 });
  for (const [t, p] of [[0, [6205.046205, -2765.812653, 0.00672]], [90, [5733.85491, -3494.465309, -1036.818641]], [1440, [-5978.950933, 3244.107928, -73.629562]],
    [4320, [-5394.807241, 4139.278464, -206.54003]], [10080, [-3870.559297, 5570.806569, -518.665082]], [-1440, [-6417.534159, 2255.568922, 43.669286]]]) {
    const d = Math.hypot(...sgp4(rec, t).map((x, k) => x - p[k]));
    if (!(d <= 0.001)) fail(`SGP4 at ${t} min: ${(d * 1000).toFixed(1)} m from python-sgp4`);
  }
}

// the Moon from Rome (41.892°, 12.511°, 20 m) on 2026.11.03 20:00 UT,
// against Horizons (apparent topocentric), to 1.5″; and its error from a
// place is that of its position (the Earth's rotation moves the place by
// some metres, 0.2″), not the 14″ of the rotation seen in alt and az
{
  const p = A.topocentric("moon", Date.UTC(2026, 10, 3, 20) / 1000, [41.892, 12.511, 20]), r = Math.PI / 180;
  const ra = 158.136484094, dec = 7.628099764;
  const c = Math.sin(dec * r) * Math.sin(p.dec * r) + Math.cos(dec * r) * Math.cos(p.dec * r) * Math.cos((ra - p.ra) * r);
  const sep = Math.acos(Math.min(1, c)) / r * 3600;
  if (!(sep <= 1.5)) fail(`the Moon from Rome: ${sep.toFixed(2)}″ from Horizons`);
  const q = calc.run('radec("Moon", 2026.11.03 20:00 Z, "Rome")');
  const e = q.kind === "value" ? q.q[1].x.std / r * 3600 : NaN;
  if (!(e < 2)) fail(`radec of the Moon from a place: an error of ${e.toFixed(1)}″, not under 2″`);
}

// the height of a place: the Moon from Milan at 3000 m against sea level,
// 2026.11.01 12:00 UT, 1.6611″ lower (astropy)
{
  const t = Date.UTC(2026, 10, 1, 12) / 1000;
  const d = (A.horizontal("moon", t, [45.46, 9.19, 3000]).alt - A.horizontal("moon", t, [45.46, 9.19]).alt) * 3600;
  if (!(Math.abs(d + 1.6611) <= 0.001)) fail(`the Moon from 3000 m: ${d.toFixed(4)}″, not −1.6611″`);
}

// stars and places by name, and names to look up
for (const [src, text] of [['place("Milan")', "(45.464[deg], 9.19[deg], 122[m])"], ['mag("Vega")', "0.030±0.010"], ['radec("M31").2', "41.269060(56)[deg]"]]) {
  const r = calc.run(src);
  const show = (q) => (Array.isArray(q) ? `(${q.map(show).join(", ")})` : calc.env.format(q));
  const got = r.kind === "value" ? show(r.q) : r.message;
  if (got !== text) fail(`${src} gives ${got}, not ${text}`);
}
for (const [src, kind] of [['place("Nowhere at all")', "place"], ['radec("HD 12345")', "object"]]) {
  if (calc.run(src).lookup?.kind !== kind) fail(`${src} should ask to look up a ${kind}`);
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
// Io's events after 2026.11.01 0:00 UT, the times of its center between
// those of its first and last contacts in Horizons (to the minute, UT)
{
  const ev = A.moonEvents("Io", Date.UTC(2026, 10, 1) / 1000, 2);
  const at = (kind, i) => ev.find((e) => e[0] === kind)[i];
  for (const [kind, i, lo, hi] of [["eclipsed", 1, [2, 1, 42], [2, 1, 46]], ["occulted", 2, [2, 5, 14], [2, 5, 18]],
    ["transit", 1, [1, 5, 45], [1, 5, 49]], ["transit", 2, [1, 8, 3], [1, 8, 7]]]) {
    const t = at(kind, i), from = Date.UTC(2026, 10, ...lo) / 1000, to = Date.UTC(2026, 10, ...hi) / 1000;
    if (!(t >= from && t <= to)) fail(`Io ${kind} ${i === 1 ? "begins" : "ends"} at ${new Date(t * 1000).toISOString()}, out of Horizons' range`);
  }
}
// Europa behind Jupiter, Io in front of it (Horizons: O and t)
for (const [jd, i, k] of [[2461345.61, 1, "occulted"], [2461345.75694, 0, "transit"]]) {
  const o = A.moons("jupiter", (jd - 2440587.5) * 86400).moons[i];
  if (!o[k]) fail(`${o.name} at JD ${jd} is not ${k}`);
}

// eclipses: the kinds of the solar eclipses of 2023 to 2028 (NASA), the
// greatest eclipse of 2024.04.08 from the vectors of Horizons (18:17:13 UT,
// gamma 0.34403), totality at Dallas from the topocentric Sun and Moon of
// Horizons (18:40:40.9 to 18:44:37.0 UT), the lunar eclipse of 2026.03.03
// (NASA: umbral magnitude 1.151)
{
  const kinds = [];
  for (let t = Date.UTC(2023, 0, 1) / 1000, i = 0; i < 12; i++) { const e = A.solarEclipse(t); kinds.push(e.kind); t = e.max + 86400; }
  const want = "hybrid annular total annular partial partial annular total annular total annular total";
  if (kinds.join(" ") !== want) fail(`solar eclipses 2023 to 2028: ${kinds.join(" ")}`);
  const e = A.solarEclipse(Date.UTC(2024, 3, 1) / 1000);
  if (!(Math.abs(e.max - Date.UTC(2024, 3, 8, 18, 17, 13) / 1000) <= 10 && Math.abs(e.gamma - 0.34403) <= 0.0005)) fail(`eclipse of 2024.04.08: ${e.max}, ${e.gamma}`);
  const l = A.solarLocal(e.max, [32.7767, -96.797]);
  if (!(Math.abs(l.C2 - Date.UTC(2024, 3, 8, 18, 40, 40.9) / 1000) <= 3 && Math.abs(l.C3 - Date.UTC(2024, 3, 8, 18, 44, 37) / 1000) <= 3)) {
    fail(`totality at Dallas: ${new Date(l.C2 * 1000).toISOString()} to ${new Date(l.C3 * 1000).toISOString()}`);
  }
  const m = A.lunarEclipse(Date.UTC(2026, 0, 1) / 1000);
  if (!(m.kind === "total" && Math.abs(m.umbral - 1.151) <= 0.002 && Math.abs(m.max - Date.UTC(2026, 2, 3, 11, 33, 44) / 1000) <= 60)) fail(`lunar eclipse of 2026.03.03: ${m.kind} ${m.umbral}`);
}

// the map of the eclipse of 2026.08.12: one outline of the band of
// totality; all the lines without jumps (but across 180°)
{
  const tr = A.eclipseTrack(Date.UTC(2026, 7, 12, 17, 46) / 1000);
  if (tr.band.length !== 1 || tr.band[0].length < 50) fail(`eclipse map: the band is ${tr.band.map((b) => b.length)}`);
  const lines = [...tr.band, ...tr.center, ...tr.penN, ...tr.penS, ...tr.rise.begin, ...tr.rise.end, ...tr.rise.max,
    ...tr.begin.flatMap(([, l]) => l), ...tr.end.flatMap(([, l]) => l)];
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      const d = Math.hypot(l[i][0] - l[i - 1][0], (((l[i][1] - l[i - 1][1] + 540) % 360) - 180) * Math.cos(l[i][0] * Math.PI / 180));
      if (d > 3) { fail(`eclipse map: a jump of ${d.toFixed(1)}° at ${l[i]}`); break; }
    }
  }
}

// eclipses seen from Milan: the Sun sets during the one of 2026.08.12; the
// lunar eclipse of 2026.03.03 is in daylight there, the next is 2026.08.28
{
  const r = calc.run("solareclipse(2026.03.01, (45.46, 9.19)[deg])");
  if (r.kind !== "value" || !r.q.rows.includes("Sun sets") || !r.q.rows.includes("ends (Sun down)")) fail(`solar eclipse at Milan: ${r.q?.rows || r.message}`);
  const l = calc.run("lunareclipse(2026.01.01, (45.46, 9.19)[deg])");
  if (l.kind !== "value" || !calc.env.format(l.q[0][0]).startsWith("2026.08.28") || !l.q.rows.includes("Moon sets")) fail(`lunar eclipse at Milan: ${l.q?.rows || l.message}`);
}

// conjunctions and occultations: the great conjunction of 2020 (JPL
// Horizons: in right ascension at 13:32:13 UT, 0.10420° apart); Regulus
// behind the Moon at Milan (Horizons: the Moon's limb within 0.3″ of the
// star at the times found, in 2036); Venus in front of Jupiter in 2065
{
  const c = calc.run("conjunction(\"Jupiter\", \"Saturn\", 2020.06.01)");
  if (c.kind !== "value" || Math.abs(c.q[0][0].relative().x.n - Date.UTC(2020, 11, 21, 13, 32, 13) / 1000) > 120
    || Math.abs(c.q[0][1].x.n * 180 / Math.PI - 0.1042) > 0.0002) fail(`conjunction: ${c.message || c.q[0].map((q) => calc.env.format(q))}`);
  const o = calc.run("occultation(\"Regulus\", 2036.05.01, (45.46, 9.19, 120[m])[deg])");
  const rows = o.q?.rows || [];
  if (o.kind !== "value" || rows[0] !== "disappears (dark limb)" || rows[1] !== "reappears (bright limb)"
    || Math.abs(o.q[0][0].relative().x.n - Date.UTC(2036, 4, 31, 15, 0, 48) / 1000) > 3
    || Math.abs(o.q[0][1].relative().x.n - Date.UTC(2036, 4, 31, 16, 17, 11) / 1000) > 3) fail(`occultation of Regulus: ${o.message || rows}`);
  const v = calc.run("occultation(\"Jupiter\", \"Venus\", 2026.01.01, (30, 0)[deg])");
  if (v.kind !== "value" || Math.abs(v.q[0][0].relative().x.n - Date.UTC(2065, 10, 22, 12, 40) / 1000) > 120) fail(`Venus in front of Jupiter: ${v.message || v.q.rows}`);
}
// Saturn's rings behind the Moon at Milan (2036.12.09): their contacts
// around the globe's, and at each the Moon's limb on the edge of the A ring
// (136775 km, in the plane of Saturn's equator, its pole precessed here by
// IAU 1976), within 0.05″, against the edge in steps of 0.1°
{
  const MILAN = [45.46, 9.19, 120], R = Math.PI / 180;
  const e = A.occultation("saturn", "moon", Date.UTC(2036, 11, 1) / 1000, MILAN, 1);
  if (!e || !(e.R1 < e.C1 && e.C1 < e.C2 && e.C2 < e.R2 && e.R3 < e.C3 && e.C3 < e.C4 && e.C4 < e.R4)) fail(`Saturn's rings: contacts ${e && [e.R1, e.C1, e.C2, e.R2, e.R3, e.C3, e.C4, e.R4]}`);
  const v = ({ ra, dec, dist }) => [dist * Math.cos(dec * R) * Math.cos(ra * R), dist * Math.cos(dec * R) * Math.sin(ra * R), dist * Math.sin(dec * R)];
  const ang = (a, b) => Math.acos((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)) / R * 3600;
  const pole = (t) => {
    const T = A.centuries(t), as = R / 3600, [a0, d0] = [40.589 * R, 83.537 * R];
    const z1 = (2306.2181 * T + 0.30188 * T * T) * as, z = (2306.2181 * T + 1.09468 * T * T) * as, th = (2004.3109 * T - 0.42665 * T * T) * as;
    const a = Math.atan2(Math.cos(d0) * Math.sin(a0 + z1), Math.cos(th) * Math.cos(d0) * Math.cos(a0 + z1) - Math.sin(th) * Math.sin(d0)) + z;
    const d = Math.asin(Math.sin(th) * Math.cos(d0) * Math.cos(a0 + z1) + Math.cos(th) * Math.sin(d0));
    return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  };
  for (const [k, far] of [["R1", false], ["R2", true], ["R3", true], ["R4", false]]) {
    if (!e) break;
    const t = e[k], m = A.topocentric("moon", t, MILAN), c = v(A.topocentric("saturn", t, MILAN)), n = pole(t);
    const h = Math.hypot(n[1], n[2]), u1 = [0, n[2] / h, -n[1] / h], u2 = [n[1] * u1[2] - n[2] * u1[1], n[2] * u1[0] - n[0] * u1[2], n[0] * u1[1] - n[1] * u1[0]];
    const ds = Array.from({ length: 3600 }, (_, i) => ang(v(m), c.map((x, j) => x + 136775 * (Math.cos(i * R / 10) * u1[j] + Math.sin(i * R / 10) * u2[j]))));
    const off = (far ? Math.max(...ds) : Math.min(...ds)) - Math.asin(0.2725076 * 6378.137 / m.dist) / R * 3600;
    if (Math.abs(off) > 0.05) fail(`Saturn's rings: at ${k} the edge is ${off.toFixed(3)}″ from the Moon's limb`);
  }
}
// the track of an occultation (Regulus, 2026.03.29): seen from points of
// its limits the star grazes the Moon's limb, from its central line it
// passes behind the center (within 0.6″, the points rounded to 0.01°);
// the lines of the hours
{
  const R = Math.PI / 180, regulus = { ra: 152.0929625, dec: 11.9672083, pmra: -248.73, pmdec: 5.59, plx: 41.13 };
  const m = A.occultationTrack(regulus, "moon", Date.UTC(2026, 2, 29, 18, 50) / 1000);
  const v = ({ ra, dec, dist }) => [dist * Math.cos(dec * R) * Math.cos(ra * R), dist * Math.cos(dec * R) * Math.sin(ra * R), dist * Math.sin(dec * R)];
  const ang = (a, b) => Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))) / R * 3600;
  // the least distance of the centers seen from p (by minutes, then half seconds), less the Moon's radius
  const least = (p, limb) => {
    const d = (t) => { const a = A.topocentric("moon", t, p); return ang(v(a), v(A.topocentric(regulus, t, p))) - (limb ? Math.asin(0.2725076 * 6378.137 / a.dist) / R * 3600 : 0); };
    let best = Infinity, tb = 0;
    for (let t = m.t - 4 * 3600; t < m.t + 4 * 3600; t += 60) if (d(t) < best) { best = d(t); tb = t; }
    for (let t = tb - 60; t < tb + 60; t += 0.5) if (d(t) < best) { best = d(t); tb = t; }
    return best;
  };
  for (const [name, lines, limb] of [["northern limit", m.penN, true], ["southern limit", m.penS, true], ["central line", m.center, false]]) {
    if (!lines.length) { fail(`occultation track: no ${name}`); continue; }
    const l = lines[0];
    for (const p of [l[Math.floor(l.length / 4)], l[Math.floor(l.length / 2)]]) {
      const off = least([p[0], p[1], 0], limb);
      if (Math.abs(off) > 0.6) fail(`occultation track: on the ${name} at ${p.slice(0, 2)} the star is ${off.toFixed(2)}″ off`);
    }
  }
  if (m.band.length || m.step !== 1 || m.begin.length < 3 || m.end.length < 3) fail(`occultation track: band ${m.band.length}, step ${m.step}, hours ${m.begin.length}/${m.end.length}`);
}

// the functions: right ascension in hours, bodies by name
for (const [src, text] of [["radec(\"Mars\", 2026.11.01 12:00 Z).1 @ hms", "9h 27m 17.39s ± 0.10s"], ["radec(\"MARS\", 2026.11.01 12:00 Z).1 @ hms", "9h 27m 17.39s ± 0.10s"],
  ["30 deg @ hms", "2h 0m 0s"], ["dist(\"Moon\", 2026.11.01 12:00 Z) @ km", "371475.1(37)[km]"]]) {
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
for (const src of ["radec(\"Vulcan\", now)", "radec(now)", "dist(\"Mars\", 5)", "altaz(\"Mars\", now, 5)", "sep((1, 2, 3), (1, 2))", "precess((0, 0), 2000)", "refract(0, 101 kPa, 5 m)"]) {
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
