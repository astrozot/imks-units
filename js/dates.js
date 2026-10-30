// Dates: a date is an absolute time (a time with a zero point, as a
// temperature in °C), counted in seconds from 1970-01-01 00:00 UTC without
// leap seconds, as JavaScript's Date. So date − date is a duration,
// date + duration a date, and ~date the Unix time. The calendar is the
// proleptic Gregorian one, with year 0 = 1 BC. Wall-clock times are local,
// or UTC when env.utc is set, unless a zone is given.

import { Q, UnitError, dimEq } from "./units.js";
import { hebrewLeap, CALENDARS, UNIX_RD, calendarText, fixedFrom } from "./calendars.js";

const DAY = 86400;
const mod = (x, y) => x - y * Math.floor(x / y);
const MAX = 8.64e12;   // the range of Date, ±273 790 years

function timeDims(env) {
  const d = env.baseunits.map(() => 0);
  d[env.baseunits.indexOf("s")] = 1;
  return d;
}

function isDate(env, q) {
  return q instanceof Q && q.zero !== false && dimEq(q.d, timeDims(env));
}

function dateQ(env, t) {
  return new Q(t, timeDims(env), 0);
}

// The instant of a wall-clock time; zone is the offset from UTC in seconds,
// or null for local time. The parts may overflow (day 32, hour 25…) and the
// day may have a fraction.
function fromCivil(y, mo, d, h = 0, mi = 0, s = 0, zone = null) {
  if (!Number.isInteger(y) || !Number.isInteger(mo)) throw new UnitError("date: the year and the month must be integers");
  const day = Math.floor(d);
  const sec = (d - day) * DAY + h * 3600 + mi * 60 + s;
  const ms = Math.floor(sec * 1000);
  const t = new Date(0);
  if (zone === null) {
    t.setFullYear(y, mo - 1, day);
    t.setHours(0, 0, 0, ms);
  } else {
    t.setUTCFullYear(y, mo - 1, day);
    t.setUTCHours(0, 0, 0, ms);
  }
  const r = t.getTime() / 1000 + (sec - ms / 1000) - (zone || 0);
  if (!Number.isFinite(r)) throw new UnitError("Date out of range");
  return r;
}

// Offset of the wall clock from UTC at the instant t, in seconds (to the
// second: local mean times before time zones are not whole minutes)
function offsetAt(t, zone) {
  if (zone !== null) return zone;
  const x = new Date(Math.floor(t * 1000));
  const w = new Date(0);
  w.setUTCFullYear(x.getFullYear(), x.getMonth(), x.getDate());
  w.setUTCHours(x.getHours(), x.getMinutes(), x.getSeconds(), x.getMilliseconds());
  return (w.getTime() - x.getTime()) / 1000;
}

// Year, month, day… of the wall clock at the instant t, rounded to step
// seconds (at least a millisecond)
function civil(t, zone, step = 0) {
  if (!(Math.abs(t) <= MAX)) throw new UnitError("Date out of range");
  const k = Math.max(1, Math.round(step * 1000));
  const w = Math.round((t + offsetAt(t, zone)) * 1000 / k) * k;
  const x = new Date(w);
  return {
    y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(),
    mi: x.getUTCMinutes(), s: x.getUTCSeconds(), ms: x.getUTCMilliseconds(), dow: x.getUTCDay(), w,
  };
}

const pad = (n, k = 2) => String(n).padStart(k, "0");

// 2026.10.30 18:42:07.5; res is the resolution in seconds, 0 for exact
// values, which drop zero seconds and a zero time of day
function wallText(c, res, time = false) {
  const day = `${c.y < 0 ? "-" : ""}${pad(Math.abs(c.y), 4)}.${pad(c.mo)}.${pad(c.d)}`;
  let hm = `${pad(c.h)}:${pad(c.mi)}`;
  if (res >= DAY || (!res && !c.h && !c.mi && !c.s && !c.ms)) return time ? day + " " + hm : day;
  if (res >= 60 || (!res && !c.s && !c.ms)) return day + " " + hm;
  hm += ":" + pad(c.s);
  if (res >= 1 || (!res && !c.ms)) return day + " " + hm;
  const dec = res ? Math.min(3, Math.round(-Math.log10(res))) : 3;
  let f = pad(c.ms, 3).slice(0, dec);
  if (!res) f = f.replace(/0+$/, "");
  return day + " " + hm + "." + f;
}

// the resolution that suits an uncertainty sigma
function resolution(sigma) {
  if (sigma >= DAY / 2) return DAY;
  if (sigma >= 30) return 60;
  if (sigma >= 0.5) return 1;
  return Math.max(0.001, Math.pow(10, Math.floor(Math.log10(sigma))));
}

const DURATIONS = [["yr", 365.25 * DAY], ["day", DAY], ["h", 3600], ["min", 60], ["s", 1]];

function durationText(x, plain) {
  const [u, f] = DURATIONS.find(([, f]) => x >= f) || DURATIONS.at(-1);
  const v = Number((x / f).toPrecision(2));
  return plain ? `${v}[${u}]` : `${v} ${u}`;
}

function zoneText(off) {
  if (!off) return "Z";
  const a = Math.abs(off) / 60;
  return `${off < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// The text of a date. On screen the wall clock is shown alone (with UTC in
// UTC mode); plain text, which is typed back in, also has its offset, so it
// means the same instant anywhere.
function dateText(env, q, plain = false) {
  const x = q.relative().x;
  const sigma = env.showErrors ? x.std : 0;
  const res = sigma > 0 ? resolution(sigma) : 0;
  let zone = env.utc ? 0 : null;
  let text;
  if (plain) {
    zone = offsetAt(x.n, zone);
    if (zone % 60) zone = 0;   // a local mean time: given in UTC
    text = wallText(civil(x.n, zone, res), res, true) + " " + zoneText(zone);
  } else {
    text = wallText(civil(x.n, zone, res), res) + (zone === 0 ? " UTC" : "");
  }
  return sigma > 0 ? `${text} ± ${durationText(sigma, plain)}` : text;
}

// ---------------------------------------------------------------------
// Literals: 2026.10.30, 2026.10.30 18:42, 2026.10.30 18:42:07.5 Z (or UTC
// or +05:30) and ISO 2026-10-30 18:42 or 2026-10-30T18:42, where the time
// is needed (2026-10-30 is a subtraction). A minus is the sign of the year
// only at the start or after ( , =. They become _date(y, m, d, h, min, s,
// offset in hours).

const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d*)?))?(?:\s*(Z|UTC|[+-]\d{1,2}:\d{2})(?!\w))?`;
const DOTTED = new RegExp(String.raw`(?<![\w.])((?<=(?:^|[(,=])\s*)-)?(\d+)\.(\d{1,2})\.(\d{1,2})(?![\w.])(?:\s+${TIME})?`, "g");
const ISO = new RegExp(String.raw`(?<![\w.])(\d{4})-(\d{2})-(\d{2})(?:T|\s+)${TIME}`, "g");

const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthDays = (y, mo) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];

function literal(src, y, mo, d, h, mi, s, zone) {
  [y, mo, d, h, mi, s] = [y, mo, d, h || 0, mi || 0, s || 0].map(Number);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= monthDays(y, mo) && h <= 23 && mi <= 59 && s < 60)) {
    throw new UnitError(`Not a date: ${src.trim()}`);
  }
  let z = "";
  if (zone === "Z" || zone === "UTC") z = ", 0";
  else if (zone) {
    const [hh, mm] = zone.slice(1).split(":").map(Number);
    z = `, ${zone[0]}${hh + mm / 60}`;
  }
  return `_date(${y}, ${mo}, ${d}, ${h}, ${mi}, ${s}${z})`;
}

// The literal back from the arguments of _date, for typesetting
function literalText(y, mo, d, h, mi, s, zone) {
  let t = wallText({ y, mo, d, h, mi, s: Math.floor(s), ms: Math.round((s % 1) * 1000) }, 0);
  if (zone !== undefined) t += zone ? " " + zoneText(zone * 3600) : " UTC";
  return t;
}

function dateLiterals(s) {
  return s
    .replace(ISO, (m, y, mo, d, h, mi, sec, zone) => literal(m, y, mo, d, h, mi, sec, zone))
    .replace(DOTTED, (m, sgn, y, mo, d, h, mi, sec, zone) => literal(m, (sgn || "") + y, mo, d, h, mi, sec, zone));
}

// ---------------------------------------------------------------------
// Formats and functions

// Calendars computed by the browser (Intl): read back by searching the
// day with the same parts
const INTL_CALENDARS = {
  chinese: "Chinese calendar (lunisolar)",
  japanese: "Japanese calendar: Gregorian, with the years of the eras",
};

// the calendars, as the keys show them
const CALENDAR_ORDER = ["chinese", "coptic", "ethiopic", "french", "hebrew", "islamic", "japanese", "julian", "mayan", "persian", "saka"];

const intlParts = (fmt, fixed) => Object.fromEntries(fmt.formatToParts(new Date((fixed - UNIX_RD) * 864e5 + 432e5)).map((p) => [p.type, p.value]));

const CHINESE = new Intl.DateTimeFormat("en-u-ca-chinese", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
const STEMS = ["jia", "yi", "bing", "ding", "wu", "ji", "geng", "xin", "ren", "gui"];
const BRANCHES = ["zi", "chou", "yin", "mao", "chen", "si", "wu", "wei", "shen", "you", "xu", "hai"];

// year (the Gregorian year in which it begins), month, day, leap month
function chineseFromFixed(fixed) {
  const o = intlParts(CHINESE, fixed);
  return [Number(o.relatedYear ?? o.year), parseInt(o.month, 10), Number(o.day), /bis/.test(o.month) ? 1 : 0];
}

function fixedFromChinese(y, m, d, leap) {
  // new year falls between January 21 and February 20, and a leap month
  // can delay the later months by one: search around the guess
  const g = new Date(0);
  g.setUTCFullYear(y, 1, 5);
  const guess = Math.round(g.getTime() / 864e5) + UNIX_RD + Math.round(29.53 * (m - 1 + leap)) + d - 1;
  for (let k = 0; k <= 60; k++) {
    for (const f of k ? [guess + k, guess - k] : [guess]) {
      const p = chineseFromFixed(f);
      if (p[0] === y && p[1] === m && p[2] === d && p[3] === leap) return f;
    }
  }
  return null;
}

function chineseText(fixed) {
  const [y, m, d, leap] = chineseFromFixed(fixed);
  return `${leap ? "Leap month" : "Month"} ${m}, day ${d}, ${STEMS[((y - 4) % 10 + 10) % 10]}-${BRANCHES[((y - 4) % 12 + 12) % 12]} year (${y})`;
}

const JAPANESE = new Intl.DateTimeFormat("en-u-ca-japanese", { timeZone: "UTC", era: "long", year: "numeric" });
const JAPANESE_ERAS = { meiji: 1868, taisho: 1912, showa: 1926, heisei: 1989, reiwa: 2019 };
const plainName = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function japaneseText(fixed) {
  const o = intlParts(JAPANESE, fixed);
  const x = new Date((fixed - UNIX_RD) * 864e5);
  return `${x.getUTCDate()} ${MONTH_NAMES[x.getUTCMonth()]}, ${o.era} ${o.year}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The formats that show a date: a value shown with them is still written
// as a date literal when it is inserted or copied
const DATE_FORMATS = new Set(["date", "UTC", "dow", "doy", "week", ...Object.keys(CALENDARS), ...Object.keys(INTL_CALENDARS)]);

// Easter Sunday of a year, as a fixed day (Meeus): Gregorian, and Orthodox
// from the Julian computus
function easterDay(y) {
  const a = mod(y, 19), c = Math.floor(y / 100), e = mod(y, 100);
  const h = mod(19 * a + c - Math.floor(c / 4) - Math.floor((c - Math.floor((c + 8) / 25) + 1) / 3) + 15, 30);
  const l = mod(32 + 2 * mod(c, 4) + 2 * Math.floor(e / 4) - h - mod(e, 4), 7);
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return fixedFrom("gregorian", [y, Math.floor(n / 31), mod(n, 31) + 1]);
}

function orthodoxEasterDay(y) {
  const d = mod(19 * mod(y, 19) + 15, 30);
  const n = d + mod(2 * mod(y, 4) + 4 * mod(y, 7) - d + 34, 7) + 114;
  return fixedFrom("julian", [y, Math.floor(n / 31), mod(n, 31) + 1]);
}

// Holidays: [group, names, the year of its calendar about a Gregorian
// year y, and its fixed day in a year of that calendar (null if none)]
const HOLIDAY_LIST = [
  ["Christian", ["Christmas"], (y) => y, (y) => fixedFrom("gregorian", [y, 12, 25])],
  ["Christian", ["Epiphany"], (y) => y, (y) => fixedFrom("gregorian", [y, 1, 6])],
  ["Christian", ["Ash Wednesday"], (y) => y, (y) => easterDay(y) - 46],
  ["Christian", ["Good Friday"], (y) => y, (y) => easterDay(y) - 2],
  ["Christian", ["Easter"], (y) => y, easterDay],
  ["Christian", ["Ascension"], (y) => y, (y) => easterDay(y) + 39],
  ["Christian", ["Pentecost", "Whitsun"], (y) => y, (y) => easterDay(y) + 49],
  ["Christian", ["Orthodox Easter"], (y) => y, orthodoxEasterDay],
  ["Christian", ["Orthodox Christmas"], (y) => y - 1, (y) => fixedFrom("julian", [y, 12, 25])],
  ["Jewish", ["Passover", "Pesach"], (y) => y + 3760, (y) => fixedFrom("hebrew", [y, 1, 15])],
  ["Jewish", ["Shavuot"], (y) => y + 3760, (y) => fixedFrom("hebrew", [y, 3, 6])],
  ["Jewish", ["Rosh Hashanah", "Rosh Hashana"], (y) => y + 3761, (y) => fixedFrom("hebrew", [y, 7, 1])],
  ["Jewish", ["Yom Kippur"], (y) => y + 3761, (y) => fixedFrom("hebrew", [y, 7, 10])],
  ["Jewish", ["Sukkot"], (y) => y + 3761, (y) => fixedFrom("hebrew", [y, 7, 15])],
  ["Jewish", ["Hanukkah", "Chanukah"], (y) => y + 3761, (y) => fixedFrom("hebrew", [y, 9, 25])],
  ["Jewish", ["Purim"], (y) => y + 3760, (y) => fixedFrom("hebrew", [y, hebrewLeap(y) ? 13 : 12, 14])],
  ["Islamic", ["Islamic New Year", "Muharram"], islamicYear, (y) => fixedFrom("islamic", [y, 1, 1])],
  ["Islamic", ["Mawlid"], islamicYear, (y) => fixedFrom("islamic", [y, 3, 12])],
  ["Islamic", ["Ramadan"], islamicYear, (y) => fixedFrom("islamic", [y, 9, 1])],
  ["Islamic", ["Eid al-Fitr", "Eid ul-Fitr"], islamicYear, (y) => fixedFrom("islamic", [y, 10, 1])],
  ["Islamic", ["Eid al-Adha", "Eid ul-Adha"], islamicYear, (y) => fixedFrom("islamic", [y, 12, 10])],
  ["Chinese", ["Chinese New Year", "Lunar New Year", "Spring Festival"], (y) => y, (y) => fixedFromChinese(y, 1, 1, 0)],
  ["Chinese", ["Lantern Festival"], (y) => y, (y) => fixedFromChinese(y, 1, 15, 0)],
  ["Chinese", ["Dragon Boat", "Dragon Boat Festival"], (y) => y, (y) => fixedFromChinese(y, 5, 5, 0)],
  ["Chinese", ["Mid-Autumn", "Mid-Autumn Festival"], (y) => y, (y) => fixedFromChinese(y, 8, 15, 0)],
  ["Persian", ["Nowruz", "Norouz"], (y) => y - 621, (y) => fixedFrom("persian", [y, 1, 1])],
  ["Ethiopian", ["Enkutatash", "Ethiopian New Year"], (y) => y - 7, (y) => fixedFrom("ethiopic", [y, 1, 1])],
];

// the Islamic year about a Gregorian year (the Islamic year is shorter)
function islamicYear(y) {
  return Math.floor((y - 622) * 365.2425 / 354.367);
}

const HOLIDAYS = new Map(HOLIDAY_LIST.flatMap((h) => h[1].map((n) => [plainName(n).replace(/[^a-z]/g, ""), h])));
// [group, [names]], the groups in alphabetical order, for the picker of
// the app and the list in the usage
const HOLIDAY_GROUPS = [...new Set(HOLIDAY_LIST.map((h) => h[0]))].sort().map((g) => [g, HOLIDAY_LIST.filter((h) => h[0] === g).map((h) => h[1][0])]);
const HOLIDAY_NAMES = HOLIDAY_GROUPS.flatMap(([, names]) => names);

// the first day of the holiday h in the Gregorian year y, or null
function holidayIn([, , guess, day], y) {
  const lo = fixedFrom("gregorian", [y, 1, 1]), hi = fixedFrom("gregorian", [y + 1, 1, 1]);
  const c = guess(y);
  const days = [c - 1, c, c + 1, c + 2].map((k) => day(k)).filter((f) => f !== null && f >= lo && f < hi);
  return days.length ? Math.min(...days) : null;
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function addDates(env) {
  const need = (q) => {
    if (!isDate(env, q)) throw new UnitError("Not a date");
    return q.relative().x.n;
  };
  const zone = () => (env.utc ? 0 : null);
  // dates show as dates; out of range, as the number of seconds
  env.dateText = (q, plain) => {
    if (!isDate(env, q) || (q.show && q.show.tree)) return null;
    if (q.show && q.show.format && !(plain && DATE_FORMATS.has(q.show.format))) return null;
    try { return dateText(env, q, plain); } catch (e) { if (e instanceof UnitError) return null; throw e; }
  };
  env.formats.set("date", { doc: "A format for dates like 2026.10.30 18:42", fn: (q) => (need(q), dateText(env, q)) });
  env.formats.set("UTC", {
    doc: "A format for dates in UTC, like 2026.10.30 17:42 UTC",
    fn: (q) => { need(q); const u = env.utc; env.utc = true; try { return dateText(env, q); } finally { env.utc = u; } },
  });
  env.formats.set("dow", { doc: "The day of the week of a date", fn: (q) => DOW[civil(need(q), zone()).dow] });
  // days since January 1 of the year y, for a wall-clock time w in ms
  const sinceJan1 = (w, y) => {
    const j = new Date(0);
    j.setUTCFullYear(y, 0, 1);
    return Math.floor((w - j.getTime()) / 864e5);
  };
  env.formats.set("doy", {
    doc: "The day of the year of a date, 1 on January 1",
    fn: (q) => {
      const c = civil(need(q), zone());
      return `Day ${sinceJan1(c.w, c.y) + 1} of ${c.y}`;
    },
  });
  env.formats.set("week", {
    doc: "The ISO week of a date: weeks start on Monday, and week 1 has the year's first Thursday",
    fn: (q) => {
      const c = civil(need(q), zone());
      // the Thursday of the same week decides the year
      const th = Math.floor(c.w / 864e5) * 864e5 + (4 - (c.dow || 7)) * 864e5;
      const y = new Date(th).getUTCFullYear();
      return `Week ${Math.floor(sinceJan1(th, y) / 7) + 1} of ${y}`;
    },
  });
  // calendars: the date, and the time of day unless it is midnight, to
  // the resolution of its error
  const res = (q) => { const s = env.showErrors ? q.relative().x.std : 0; return s > 0 ? resolution(s) : 0; };
  const time = (c, r = 0) => (r < DAY && (c.h || c.mi || c.s || c.ms) ? ", " + wallText(c, r).split(" ")[1] : "");
  for (const [name, [, , , doc]] of Object.entries(CALENDARS)) {
    env.formats.set(name, {
      doc: doc.replace(/: \w+\([^)]*\)/, ""),
      fn: (q) => {
        const t = need(q), r = res(q), c = civil(t, zone(), r);
        const fixed = Math.floor(c.w / 864e5) + UNIX_RD;
        // Hebrew days begin at sunset, when the location is known
        if (name === "hebrew" && time(c) && env.afterSunset?.(t, fromCivil(c.y, c.mo, c.d, 0, 0, 0, zone()))) {
          return calendarText(name, fixed + 1) + time(c, r) + " (after sunset)";
        }
        return calendarText(name, fixed) + time(c, r);
      },
    });
  }
  for (const [name, doc] of Object.entries(INTL_CALENDARS)) {
    const text = name === "chinese" ? chineseText : japaneseText;
    env.formats.set(name, {
      doc,
      fn: (q) => {
        const r = res(q), c = civil(need(q), zone(), r);
        return text(Math.floor(c.w / 864e5) + UNIX_RD) + time(c, r);
      },
    });
  }
}

// A year argument: an integer
function yearArg(env, name, q, usage = `${name}(year)`) {
  const y = q instanceof Q ? env.checkPure(q, name).n : NaN;
  if (!Number.isInteger(y)) throw new UnitError(`Usage: ${usage}`);
  return y;
}

// For the interpreter: date(y, m, d, h, min, s, offset), now and today
function dateBuiltins(env, b) {
  const num = (q, what, def) => (q === undefined ? def : env.checkPure(q, `date: the ${what}`).n);
  const date = (y, mo, d, h, mi, s, zone) => {
    if (y === undefined || mo === undefined) throw new UnitError("Usage: date(year, month, day, hour, minute, second, UTC offset)");
    const parts = [[y, "year"], [mo, "month"], [d, "day", 1], [h, "hour", 0], [mi, "minute", 0], [s, "second", 0]].map(([q, w, def]) => num(q, w, def));
    let z = env.utc ? 0 : null;
    if (zone !== undefined) z = zone.pure ? zone.x.n * 3600 : env.checkPure(env.div(zone, new Q(1, timeDims(env))), "date: the UTC offset").n;
    return dateQ(env, fromCivil(...parts, z));
  };
  b.date = date;
  Object.defineProperty(b, "_date", { value: date, enumerable: false });
  // the date of a fixed day, with the time of day in args from i on
  const dayAt = (name, f, args, i) => {
    const x = new Date((f - UNIX_RD) * 864e5);
    const [h, mi, s] = [0, 1, 2].map((k) => (args[i + k] === undefined ? 0 : env.checkPure(args[i + k], name).n));
    return dateQ(env, fromCivil(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), h, mi, s, env.utc ? 0 : null));
  };
  const nums = (name, xs) => xs.map((q) => (q === undefined ? undefined : env.checkPure(q, name).n));
  // julian(y, m, d), hebrew(y, m, d)…, with an optional time of day
  for (const [name, [, , n]] of Object.entries(CALENDARS)) {
    b[name] = (...args) => {
      const parts = nums(name, args.slice(0, n));
      const f = fixedFrom(name, parts);
      if (f === null) throw new UnitError(`Not a date of the ${name} calendar: ${parts.join(", ")}`);
      return dayAt(name, f, args, n);
    };
  }
  // chinese(year, month, day, leap): leap is 1 for the leap month
  b.chinese = (...args) => {
    const [y, m, d, leap = 0] = nums("chinese", args.slice(0, 4));
    if (![y, m, d].every(Number.isInteger) || (leap !== 0 && leap !== 1)) throw new UnitError("Usage: chinese(year, month, day, leap), leap 1 for a leap month");
    const f = fixedFromChinese(y, m, d, leap);
    if (f === null) throw new UnitError(`Not a date of the chinese calendar: ${y}, ${leap ? "leap " : ""}${m}, ${d}`);
    return dayAt("chinese", f, args, 4);
  };
  const year = (name, q) => yearArg(env, name, q);
  b.easter = (q) => dayAt("easter", easterDay(year("easter", q)), [], 0);
  b.easter_orthodox = (q) => dayAt("easter_orthodox", orthodoxEasterDay(year("easter_orthodox", q)), [], 0);
  // holiday("Passover", 2027): the first in the Gregorian year
  b.holiday = (name, q) => {
    const h = typeof name === "string" ? HOLIDAYS.get(plainName(name).replace(/[^a-z]/g, "")) : undefined;
    if (!h) throw new UnitError(`Usage: holiday("Passover", 2027); the holidays are ${HOLIDAY_NAMES.join(", ")}`);
    const y = yearArg(env, "holiday", q, 'holiday("Passover", 2027), with a Gregorian year');
    const f = holidayIn(h, y);
    if (f === null) throw new UnitError(`holiday: no ${name} in ${y}`);
    return dayAt("holiday", f, [], 0);
  };
  // japanese("Reiwa", year, month, day): the months and days are Gregorian
  b.japanese = (era, ...args) => {
    const start = typeof era === "string" ? JAPANESE_ERAS[plainName(era)] : undefined;
    if (!start) throw new UnitError(`Usage: japanese("Reiwa", year, month, day); the eras are ${Object.keys(JAPANESE_ERAS).map((e) => e[0].toUpperCase() + e.slice(1)).join(", ")}`);
    const [y, m, d] = nums("japanese", args.slice(0, 3));
    const f = fixedFrom("gregorian", [start + y - 1, m, d]);
    const o = f === null ? null : intlParts(JAPANESE, f);
    if (!o || plainName(o.era) !== plainName(era) || Number(o.year) !== y) throw new UnitError(`Not a date of the ${era} era: ${y}, ${m}, ${d}`);
    return dayAt("japanese", f, args, 3);
  };
}

function now(env) {
  return dateQ(env, Date.now() / 1000);
}

function today(env) {
  const z = env.utc ? 0 : null;
  const c = civil(Date.now() / 1000, z);
  return dateQ(env, fromCivil(c.y, c.mo, c.d, 0, 0, 0, z));
}

export { HOLIDAY_GROUPS, yearArg, CALENDAR_ORDER, DATE_FORMATS, isDate, dateQ, fromCivil, civil, dateText, dateLiterals, literalText, addDates, dateBuiltins, now, today };
