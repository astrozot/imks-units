// Calendars, after Reingold & Dershowitz, "Calendrical Calculations":
// each converts to and from a fixed day number (R.D.: 1 is January 1 of
// year 1 in the proleptic Gregorian calendar). Years are astronomical
// (year 0 is 1 BC), so the Julian calendar has a year 0 too.

import { season, nextPhase, solarLongitude, crossing, hourAngle, riseSet, elongation } from "./astro.js";
import { UnitError } from "./units.js";

const floor = Math.floor;
const mod = (x, y) => x - y * floor(x / y);

// R.D. of 1970-01-01, the Unix epoch
const UNIX_RD = 719163;

// ---------------------------------------------------------------------
// Gregorian, with the Date of JavaScript

function gregorianFromFixed(f) {
  const x = new Date((f - UNIX_RD) * 864e5);
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()];
}

function fixedFromGregorian(y, m, d) {
  const x = new Date(0);
  x.setUTCFullYear(y, m - 1, d);
  return Math.round(x.getTime() / 864e5) + UNIX_RD;
}

const gregorianLeap = (y) => (mod(y, 4) === 0 && mod(y, 100) !== 0) || mod(y, 400) === 0;

// ---------------------------------------------------------------------
// Julian

const julianLeap = (y) => mod(y, 4) === 0;

function fixedFromJulian(y, m, d) {
  return -2 + 365 * (y - 1) + floor((y - 1) / 4) + floor((367 * m - 362) / 12) +
    (m <= 2 ? 0 : julianLeap(y) ? -1 : -2) + d;
}

function julianFromFixed(date) {
  const y = floor((4 * (date + 1) + 1464) / 1461);
  const prior = date - fixedFromJulian(y, 1, 1);
  const corr = date < fixedFromJulian(y, 3, 1) ? 0 : julianLeap(y) ? 1 : 2;
  const m = floor((12 * (prior + corr) + 373) / 367);
  return [y, m, date - fixedFromJulian(y, m, 1) + 1];
}

// ---------------------------------------------------------------------
// Hebrew: months from Nisan (1) to Adar (12) and Adar II (13) in leap
// years; the year begins with Tishri (7)

const HEBREW_EPOCH = fixedFromJulian(-3760, 10, 7);
const hebrewLeap = (y) => mod(7 * y + 1, 19) < 7;

function hebrewElapsed(y) {
  const months = floor((235 * y - 234) / 19);
  const parts = 12084 + 13753 * months;
  const days = 29 * months + floor(parts / 25920);
  return mod(3 * (days + 1), 7) < 3 ? days + 1 : days;
}

function hebrewNewYear(y) {
  const ny0 = hebrewElapsed(y - 1), ny1 = hebrewElapsed(y), ny2 = hebrewElapsed(y + 1);
  return HEBREW_EPOCH + ny1 + (ny2 - ny1 === 356 ? 2 : ny1 - ny0 === 382 ? 1 : 0);
}

function hebrewMonthDays(y, m) {
  const len = hebrewNewYear(y + 1) - hebrewNewYear(y);
  if ([2, 4, 6, 10, 13].includes(m) || (m === 12 && !hebrewLeap(y))) return 29;
  if (m === 8 && len % 10 !== 5) return 29;   // long Heshvan in years of 355 and 385 days
  if (m === 9 && len % 10 === 3) return 29;   // short Kislev in years of 353 and 383 days
  return 30;
}

function fixedFromHebrew(y, m, d) {
  const last = hebrewLeap(y) ? 13 : 12;
  let r = hebrewNewYear(y) + d - 1;
  if (m < 7) {
    for (let k = 7; k <= last; k++) r += hebrewMonthDays(y, k);
    for (let k = 1; k < m; k++) r += hebrewMonthDays(y, k);
  } else {
    for (let k = 7; k < m; k++) r += hebrewMonthDays(y, k);
  }
  return r;
}

function hebrewFromFixed(date) {
  const approx = floor((date - HEBREW_EPOCH) / (35975351 / 98496)) + 1;
  let y = approx - 1;
  while (hebrewNewYear(y + 1) <= date) y++;
  let m = date < fixedFromHebrew(y, 1, 1) ? 7 : 1;
  while (date > fixedFromHebrew(y, m, hebrewMonthDays(y, m))) m++;
  return [y, m, date - fixedFromHebrew(y, m, 1) + 1];
}

// ---------------------------------------------------------------------
// Islamic (arithmetic, civil epoch: 16 July 622 Julian)

const ISLAMIC_EPOCH = fixedFromJulian(622, 7, 16);

function fixedFromIslamic(y, m, d) {
  return d + 29 * (m - 1) + floor((6 * m - 1) / 11) + (y - 1) * 354 + floor((3 + 11 * y) / 30) + ISLAMIC_EPOCH - 1;
}

function islamicFromFixed(date) {
  const y = floor((30 * (date - ISLAMIC_EPOCH) + 10646) / 10631);
  const m = Math.min(12, floor((11 * (date - fixedFromIslamic(y, 1, 1)) + 330) / 325));
  return [y, m, date - fixedFromIslamic(y, m, 1) + 1];
}

// ---------------------------------------------------------------------
// Persian. Since 1304 (1925), by the law of Iran, the year begins on the
// day whose true noon at Tehran follows the spring equinox; six months
// of 31 days, five of 30, and the last of 29 or 30. Before, and after the
// range of the equinoxes (3000), the arithmetic calendar with the 33-year
// cycle of leap years, which agrees with it from 1925 to 2123.

const PERSIAN_EPOCH = fixedFromJulian(622, 3, 18);
const PERSIAN_MONTH_START = [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336];

function fixedFromArithmeticPersian(y, m, d) {
  return PERSIAN_EPOCH - 1 + 365 * (y - 1) + floor((8 * y + 21) / 33) + PERSIAN_MONTH_START[m - 1] + d;
}

function arithmeticPersianFromFixed(date) {
  const days = date - PERSIAN_EPOCH;
  const y = 1 + floor((33 * days + 3) / 12053);
  const doy = days - (365 * (y - 1) + floor((8 * y + 21) / 33));
  const m = doy < 216 ? floor(doy / 31) : floor((doy - 6) / 30);
  return [y, m + 1, doy - PERSIAN_MONTH_START[m] + 1];
}

const TEHRAN_LON = 51.4215, TEHRAN_ZONE = 3.5 * 3600;

// the fixed day of Nowruz in the Gregorian year gy (astronomical), or NaN
const nowruz = (gy) => cached(`p${gy}`, () => {
  const eq = season(gy, 0);
  if (eq === null) return NaN;
  const d = floor((eq + TEHRAN_ZONE) / 86400) + UNIX_RD;
  const noon = crossing((t) => hourAngle("sun", t, TEHRAN_LON), (d - UNIX_RD) * 86400 - TEHRAN_ZONE, true);
  return eq < noon ? d : d + 1;
});
const astronomical = (gy) => gy >= 1925 && gy <= 3000;

function fixedFromPersian(y, m, d) {
  if (!astronomical(y + 621)) return fixedFromArithmeticPersian(y, m, d);
  return nowruz(y + 621) + PERSIAN_MONTH_START[m - 1] + d - 1;
}

function persianFromFixed(date) {
  const gy = gregorianFromFixed(date)[0];
  if (!astronomical(gy) || (gy === 1925 && date < nowruz(1925))) return arithmeticPersianFromFixed(date);
  const ny = date >= nowruz(gy) ? nowruz(gy) : nowruz(gy - 1);
  const y = gregorianFromFixed(ny)[0] - 621, doy = date - ny;
  if (!astronomical(y + 621)) return arithmeticPersianFromFixed(date);
  const m = doy < 186 ? floor(doy / 31) : floor((doy - 6) / 30);
  return [y, m + 1, doy - PERSIAN_MONTH_START[m] + 1];
}

// ---------------------------------------------------------------------
// Coptic and Ethiopic: twelve months of 30 days and a 13th of 5 or 6

const COPTIC_EPOCH = fixedFromJulian(284, 8, 29);
const ETHIOPIC_EPOCH = fixedFromJulian(8, 8, 29);

const fixedFromCoptic = (y, m, d, epoch = COPTIC_EPOCH) => epoch - 1 + 365 * (y - 1) + floor(y / 4) + 30 * (m - 1) + d;

function copticFromFixed(date, epoch = COPTIC_EPOCH) {
  const y = floor((4 * (date - epoch) + 1463) / 1461);
  const m = floor((date - fixedFromCoptic(y, 1, 1, epoch)) / 30) + 1;
  return [y, m, date + 1 - fixedFromCoptic(y, m, 1, epoch)];
}

// ---------------------------------------------------------------------
// Mayan long count: baktun, katun, tun, uinal, kin (GMT correlation,
// 13.0.0.0.0 = 2012-12-21)

const MAYAN_EPOCH = -1137142;
const MAYAN_UNITS = [144000, 7200, 360, 20, 1];

const fixedFromMayan = (...parts) => MAYAN_EPOCH + parts.reduce((s, x, i) => s + x * MAYAN_UNITS[i], 0);

function mayanFromFixed(date) {
  let n = date - MAYAN_EPOCH;
  return MAYAN_UNITS.map((u) => { const k = floor(n / u); n = mod(n, u); return k; });
}

// ---------------------------------------------------------------------
// French Republican, as decreed: the year begins on the day of the
// autumn equinox at Paris (local mean time); twelve months of 30 days and
// 5 or 6 complementary days, month 13. Year 1 began on 1792-09-22.

const PARIS = 2.337229 / 360 * 86400;   // seconds east of Greenwich

function frenchNewYear(gy) {
  const t = season(gy, 2);
  return t === null ? NaN : floor((t + PARIS) / 86400) + UNIX_RD;
}

const fixedFromFrench = (y, m, d) => frenchNewYear(y + 1791) + 30 * (m - 1) + d - 1;

function frenchFromFixed(date) {
  let y = gregorianFromFixed(date)[0];
  if (date < frenchNewYear(y)) y--;
  const k = date - frenchNewYear(y);
  return [y - 1791, floor(k / 30) + 1, mod(k, 30) + 1];
}

// ---------------------------------------------------------------------
// Chinese (Reingold and Dershowitz, with our Sun and Moon): a month
// begins on the day, in China, of a new moon; the winter solstice is in
// month 11; in a year (from solstice to solstice) of 13 months, the first
// month without a major solar term (a multiple of 30° of the Sun's
// longitude) is a leap month. Years are given by the Gregorian year in
// which they begin.

const MONTH_DAYS = 29.530588861;

// seconds east of UT: Beijing's mean time, and from 1929 UTC+8
const chinaZone = (date) => (date < fixedFromGregorian(1929, 1, 1) ? 1397.6 / 180 * 3600 : 8 * 3600);
// the Unix time of the start of a fixed day in China, and the day of a time
const chinaStart = (date) => (date - UNIX_RD) * 86400 - chinaZone(date);
const chinaDay = (t) => floor((t + chinaZone(floor(t / 86400) + UNIX_RD)) / 86400) + UNIX_RD;

const cache = new Map();
const cached = (key, f) => {
  if (!cache.has(key)) {
    if (cache.size > 5000) cache.clear();
    cache.set(key, f());
  }
  return cache.get(key);
};

// the day of the first new moon on or after the day date
const newMoonOnOrAfter = (date) => cached(`n${date}`, () => chinaDay(nextPhase(chinaStart(date), 0)));
// the day of the last new moon before the day date
const newMoonBefore = (date) => cached(`b${date}`, () => {
  let n = newMoonOnOrAfter(date - 31);
  for (let k = newMoonOnOrAfter(n + 1); k < date; k = newMoonOnOrAfter(n + 1)) n = k;
  return n;
});

// the day of the winter solstice on or before the day date
function solsticeOnOrBefore(date) {
  return cached(`s${date}`, () => {
    const y = gregorianFromFixed(date)[0];
    const t = season(y, 3);
    if (t === null) return NaN;
    const s = chinaDay(t);
    return s <= date ? s : chinaDay(season(y - 1, 3));
  });
}

// the major solar term (1 to 12) at the start of a day
const majorTerm = (date) => cached(`t${date}`, () => mod(2 + floor(solarLongitude(chinaStart(date)) / 30) - 1, 12) + 1);
const noMajorTerm = (date) => majorTerm(date) === majorTerm(newMoonOnOrAfter(date + 1));

function priorLeapMonth(start, m) {
  for (; m >= start; m = newMoonBefore(m)) if (noMajorTerm(m)) return true;
  return false;
}

function newYearInSui(date) {
  const s1 = solsticeOnOrBefore(date), s2 = solsticeOnOrBefore(s1 + 370);
  const m12 = newMoonOnOrAfter(s1 + 1), m13 = newMoonOnOrAfter(m12 + 1);
  const next11 = newMoonBefore(s2 + 1);
  const leap = Math.round((next11 - m12) / MONTH_DAYS) === 12 && (noMajorTerm(m12) || noMajorTerm(m13));
  return leap ? newMoonOnOrAfter(m13 + 1) : m13;
}

function chineseNewYearOnOrBefore(date) {
  const y = newYearInSui(date);
  return date >= y ? y : newYearInSui(date - 180);
}

// year, month, day, leap (1 in a leap month)
function chineseFromFixed(date) {
  const s1 = solsticeOnOrBefore(date), s2 = solsticeOnOrBefore(s1 + 370);
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) return [NaN, NaN, NaN, NaN];
  const m12 = newMoonOnOrAfter(s1 + 1), next11 = newMoonBefore(s2 + 1), m = newMoonBefore(date + 1);
  const leapYear = Math.round((next11 - m12) / MONTH_DAYS) === 12;
  const month = mod(Math.round((m - m12) / MONTH_DAYS) - (leapYear && priorLeapMonth(m12, m) ? 1 : 0) - 1, 12) + 1;
  const leap = leapYear && noMajorTerm(m) && !priorLeapMonth(m12, newMoonBefore(m));
  return [gregorianFromFixed(chineseNewYearOnOrBefore(date))[0], month, date - m + 1, leap ? 1 : 0];
}

function fixedFromChinese(y, m, d, leap = 0) {
  const ny = chineseNewYearOnOrBefore(fixedFromGregorian(y, 7, 1));
  const p = newMoonOnOrAfter(ny + (m - 1) * 29);
  const q = chineseFromFixed(p);
  const start = q[1] === m && q[3] === leap ? p : newMoonOnOrAfter(p + 1);
  return start + d - 1;
}

// ---------------------------------------------------------------------
// Hindu lunisolar (astronomical, as the modern almanacs): amanta months,
// from new moon to new moon, named by the sidereal sign of the Sun at the
// new moon that begins them (the Sun in Pisces: Chaitra), with the Lahiri
// ayanamsa; a month without a sign change of the Sun is a leap (adhika)
// month, named as the next. A day is named by the tithi (lunar day, 12° of
// the Moon's elongation) at sunrise in Ujjain, on Indian Standard Time; a
// tithi may be skipped, or last two days. Years of the Saka era.

const UJJAIN = [23.1765, 75.7885], IST = 5.5 * 3600;
const istStart = (date) => (date - UNIX_RD) * 86400 - IST;
const istDay = (t) => floor((t + IST) / 86400) + UNIX_RD;

// the Lahiri ayanamsa, and the Sun's sign (0 Aries … 11 Pisces) at t
const ayanamsa = (t) => 23.85306 + 1.39697 * (t / 86400 - 10957.5) / 36525;
const sign = (t) => floor(mod(solarLongitude(t) - ayanamsa(t), 360) / 30);

// sunrise and sunset at Ujjain on a day
const sunriseIn = (date) => cached(`r${date}`, () => riseSet("sun", istStart(date), UJJAIN, true)?.t ?? NaN);
const sunsetIn = (date) => cached(`u${date}`, () => riseSet("sun", istStart(date) + 6 * 3600, UJJAIN, false)?.t ?? NaN);

// the month, leap month and tithi current at the time t
function lunarAt(t) {
  let n = nextPhase(t - 31 * 86400, 0);
  for (let k = nextPhase(n + 86400, 0); k <= t; k = nextPhase(n + 86400, 0)) n = k;
  const s = sign(n), next = sign(nextPhase(n + 86400, 0));
  return { month: mod(s + 1, 12) + 1, leap: s === next ? 1 : 0, tithi: floor(elongation(t) / 12) + 1, newMoon: n };
}

// year, month, leap month, tithi, leap day (the second day of a tithi)
function hinduFromFixed(date) {
  return cached(`h${date}`, () => {
    const sr = sunriseIn(date);
    if (!Number.isFinite(sr)) return [NaN, NaN, NaN, NaN, NaN];
    const { month, leap, tithi } = lunarAt(sr);
    const before = floor(elongation(sunriseIn(date - 1)) / 12) + 1;
    const [gy, gm] = gregorianFromFixed(date);
    // the year begins with Chaitra, in March or April: months from
    // Margashirsha on, early in a Gregorian year, are of the year before
    return [gy - 78 - (month >= 9 && gm <= 6 ? 1 : 0), month, leap, tithi, before === tithi ? 1 : 0];
  });
}

// the day of a Hindu date; a skipped tithi is kept, as in the almanacs,
// on the day in which it begins (Ugadi, Chaitra 1, 2026: March 19)
function fixedFromHindu(y, m, leap, tithi, leapDay = 0) {
  const guess = fixedFromGregorian(y + 78, 3, 22) + Math.round((m - 1) * 29.53) + tithi;
  for (let f = guess - 40; f <= guess + 50; f++) {
    const [yy, mm, ll, tt, dd] = hinduFromFixed(f);
    if (yy !== y || mm !== m || ll !== leap) continue;
    if (tt === tithi && dd === leapDay) return f;
    // the first day of the month after the tithi: it was skipped
    if (tt > tithi && !leapDay) {
      const p = hinduFromFixed(f - 1);
      const sameMonth = p[0] === y && p[1] === m && p[2] === leap;
      if (!sameMonth || p[3] < tithi) return f - 1;
    }
  }
  return null;
}

// Festivals by the tithi at sunset (pradosh) at Ujjain: the first day of the
// Gregorian year y whose sunset falls in the tithi of the month, between
// the fixed days lo and hi
function tithiAtSunset(lo, hi, month, tithi) {
  for (let f = lo; f <= hi; f++) {
    const l = lunarAt(sunsetIn(f));
    if (l.month === month && !l.leap && l.tithi === tithi) return f;
  }
  return null;
}

// the time after t when the Moon's elongation reaches e degrees
const elongationAt = (t, e) => crossing((x) => mod(elongation(x) - e + 180, 360) - 180, t, true, 2 * 86400, 1800);

// Diwali (Lakshmi Puja): the new moon (tithi 30) of Ashvin at sunset.
// Holi: the day after Holika Dahan, the bonfire on the evening of the full
// moon (tithi 15) of Phalguna; but if Bhadra, its first half, lasts past
// midnight, and the full moon ends less than two hours before the next
// sunset, the bonfire is on the next evening (as the almanacs give it).
// Makar Sankranti: the day the Sun enters sidereal Capricorn.
const diwali = (y) => tithiAtSunset(fixedFromGregorian(y, 10, 1), fixedFromGregorian(y, 11, 30), 7, 30);
function holi(y) {
  const f = tithiAtSunset(fixedFromGregorian(y, 2, 15), fixedFromGregorian(y, 4, 15), 12, 15);
  if (f === null) return null;
  const bhadraEnd = elongationAt(sunsetIn(f) - 86400, 174), fullEnd = elongationAt(sunsetIn(f) - 86400, 180);
  const late = bhadraEnd > istStart(f + 1) && fullEnd > sunsetIn(f + 1) - 2 * 3600;
  return f + (late ? 2 : 1);
}
function makarSankranti(y) {
  const t = crossing((x) => mod(solarLongitude(x) - ayanamsa(x) - 270 + 180, 360) - 180, istStart(fixedFromGregorian(y, 1, 10)), true, 10 * 86400, 3600);
  return t === null ? null : istDay(t);
}

const TITHI_NAMES = { 15: "Purnima", 30: "Amavasya" };
function hinduText(date) {
  const [y, m, leap, tithi, leapDay] = hinduFromFixed(date);
  if (!Number.isFinite(y)) throw new UnitError("Out of the range of the hindu calendar");
  const paksha = tithi <= 15 ? "Shukla" : "Krishna";
  const day = TITHI_NAMES[tithi] || `${paksha} ${tithi <= 15 ? tithi : tithi - 15}`;
  return `${leap ? "Adhika " : ""}${MONTHS.hindu[m - 1]} ${day}${leapDay ? " (2nd day)" : ""}, Saka ${y}`;
}

// ---------------------------------------------------------------------
// Indian national (Saka): Chaitra 1 is March 22, or March 21 in Gregorian
// leap years; the year is the Gregorian one − 78

const sakaMonthDays = (y) => [gregorianLeap(y + 78) ? 31 : 30, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 30];

function fixedFromSaka(y, m, d) {
  const start = fixedFromGregorian(y + 78, 3, gregorianLeap(y + 78) ? 21 : 22);
  return start + sakaMonthDays(y).slice(0, m - 1).reduce((a, b) => a + b, 0) + d - 1;
}

function sakaFromFixed(date) {
  let y = gregorianFromFixed(date)[0] - 78;
  if (date < fixedFromSaka(y, 1, 1)) y--;
  const len = sakaMonthDays(y);
  let k = date - fixedFromSaka(y, 1, 1), m = 1;
  while (m < 12 && k >= len[m - 1]) k -= len[m++ - 1];
  return [y, m, k + 1];
}

// ---------------------------------------------------------------------

const MONTHS = {
  julian: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  hebrew: ["Nisan", "Iyyar", "Sivan", "Tammuz", "Av", "Elul", "Tishri", "Heshvan", "Kislev", "Tevet", "Shevat", "Adar", "Adar II"],
  islamic: ["Muharram", "Safar", "Rabi‘ I", "Rabi‘ II", "Jumada I", "Jumada II", "Rajab", "Sha‘ban", "Ramadan", "Shawwal", "Dhu al-Qa‘da", "Dhu al-Hijja"],
  persian: ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"],
  coptic: ["Thout", "Paopi", "Hathor", "Koiak", "Tobi", "Meshir", "Paremhat", "Parmouti", "Pashons", "Paoni", "Epip", "Mesori", "Nasie"],
  french: ["Vendémiaire", "Brumaire", "Frimaire", "Nivôse", "Pluviôse", "Ventôse", "Germinal", "Floréal", "Prairial", "Messidor", "Thermidor", "Fructidor"],
  hindu: ["Chaitra", "Vaishakha", "Jyeshtha", "Ashadha", "Shravana", "Bhadrapada", "Ashvin", "Kartika", "Margashirsha", "Pausha", "Magha", "Phalguna"],
  saka: ["Chaitra", "Vaishakha", "Jyeshtha", "Ashadha", "Shravana", "Bhadra", "Ashvin", "Kartika", "Agrahayana", "Pausha", "Magha", "Phalguna"],
  ethiopic: ["Meskerem", "Tekemt", "Hedar", "Tahsas", "Ter", "Yekatit", "Megabit", "Miazia", "Genbot", "Sene", "Hamle", "Nehasse", "Pagume"],
};

// name: [from fixed, to fixed, number of parts, doc]
const CALENDARS = {
  julian: [julianFromFixed, fixedFromJulian, 3, "Julian calendar: julian(year, month, day); years are astronomical, 0 is 1 BC"],
  hebrew: [hebrewFromFixed, fixedFromHebrew, 3, "Hebrew calendar: hebrew(year, month, day), months from Nisan = 1 (Tishri = 7, Adar II = 13); a time after sunset shows the next day when a location is set"],
  islamic: [islamicFromFixed, fixedFromIslamic, 3, "Islamic calendar (arithmetic, civil): islamic(year, month, day); days from midnight; umalqura is the calendar of Saudi Arabia, and the observed one can differ by a day or two"],
  persian: [persianFromFixed, fixedFromPersian, 3, "Persian (Solar Hijri) calendar: persian(year, month, day)"],
  coptic: [copticFromFixed, fixedFromCoptic, 3, "Coptic calendar: coptic(year, month, day), month 13 is the 5 or 6 epagomenal days"],
  ethiopic: [(f) => copticFromFixed(f, ETHIOPIC_EPOCH), (y, m, d) => fixedFromCoptic(y, m, d, ETHIOPIC_EPOCH), 3, "Ethiopian calendar: ethiopic(year, month, day), month 13 is Pagume"],
  french: [frenchFromFixed, fixedFromFrench, 3, "French Republican calendar: french(year, month, day), month 13 is the complementary days; from the autumn equinox at Paris, for the Gregorian years −1000 to 3000 (years −2790 to 1209)"],
  saka: [sakaFromFixed, fixedFromSaka, 3, "Indian national (Saka) calendar: saka(year, month, day)"],
  mayan: [mayanFromFixed, fixedFromMayan, 5, "Mayan long count: mayan(baktun, katun, tun, uinal, kin), 13.0.0.0.0 is 2012-12-21"],
};

// the complementary days of the French Republican calendar
const FRENCH_DAYS = ["Fête de la Vertu", "Fête du Génie", "Fête du Travail", "Fête de l'Opinion", "Fête des Récompenses", "Fête de la Révolution"];

function roman(n) {
  if (!(n >= 1 && n < 4000)) return String(n);
  const r = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, t] of r) while (n >= v) { s += t; n -= v; }
  return s;
}

function calendarText(name, date) {
  const p = CALENDARS[name][0](date);
  if (!p.every(Number.isFinite)) throw new UnitError(`Out of the range of the ${name} calendar`);
  if (name === "mayan") return p.join(".");
  if (name === "french") {
    const [y, m, d] = p;
    return `${m === 13 ? FRENCH_DAYS[d - 1] : `${d} ${MONTHS.french[m - 1]}`}, year ${roman(y)}`;
  }
  const [y, m, d] = p;
  let month = MONTHS[name][m - 1];
  if (name === "hebrew" && m === 12 && hebrewLeap(y)) month = "Adar I";
  return `${d} ${month} ${y}`;
}

// Gregorian, for the eras of the Japanese calendar
const GREGORIAN = [gregorianFromFixed, fixedFromGregorian, 3];

// The fixed day of a date in a calendar, or null if there is no such date
function fixedFrom(name, parts) {
  const [from, to, n] = name === "gregorian" ? GREGORIAN : CALENDARS[name];
  if (parts.length !== n || !parts.every(Number.isInteger)) return null;
  const f = to(...parts);
  const back = from(f);
  return back.every((x, i) => x === parts[i]) ? f : null;
}

export { hinduFromFixed, fixedFromHindu, hinduText, diwali, holi, makarSankranti, MONTHS, chineseFromFixed, fixedFromChinese, hebrewLeap, CALENDARS, UNIX_RD, calendarText, fixedFrom };
