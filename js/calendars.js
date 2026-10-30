// Calendars, after Reingold & Dershowitz, "Calendrical Calculations":
// each converts to and from a fixed day number (R.D.: 1 is January 1 of
// year 1 in the proleptic Gregorian calendar). Years are astronomical
// (year 0 is 1 BC), so the Julian calendar has a year 0 too.

const floor = Math.floor;
const mod = (x, y) => x - y * floor(x / y);

// R.D. of 1970-01-01, the Unix epoch
const UNIX_RD = 719163;

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
// Persian (arithmetic, with the 33-year cycle of leap years; it matches
// the astronomical calendar of Iran, as in ICU, up to the year 1501 = 2123)

const PERSIAN_EPOCH = fixedFromJulian(622, 3, 18);
const PERSIAN_MONTH_START = [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336];

function fixedFromPersian(y, m, d) {
  return PERSIAN_EPOCH - 1 + 365 * (y - 1) + floor((8 * y + 21) / 33) + PERSIAN_MONTH_START[m - 1] + d;
}

function persianFromFixed(date) {
  const days = date - PERSIAN_EPOCH;
  const y = 1 + floor((33 * days + 3) / 12053);
  const doy = days - (365 * (y - 1) + floor((8 * y + 21) / 33));
  const m = doy < 216 ? floor(doy / 31) : floor((doy - 6) / 30);
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

const MONTHS = {
  julian: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  hebrew: ["Nisan", "Iyyar", "Sivan", "Tammuz", "Av", "Elul", "Tishri", "Heshvan", "Kislev", "Tevet", "Shevat", "Adar", "Adar II"],
  islamic: ["Muharram", "Safar", "Rabi‘ I", "Rabi‘ II", "Jumada I", "Jumada II", "Rajab", "Sha‘ban", "Ramadan", "Shawwal", "Dhu al-Qa‘da", "Dhu al-Hijja"],
  persian: ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"],
  coptic: ["Thout", "Paopi", "Hathor", "Koiak", "Tobi", "Meshir", "Paremhat", "Parmouti", "Pashons", "Paoni", "Epip", "Mesori", "Nasie"],
  ethiopic: ["Meskerem", "Tekemt", "Hedar", "Tahsas", "Ter", "Yekatit", "Megabit", "Miazia", "Genbot", "Sene", "Hamle", "Nehasse", "Pagume"],
};

// name: [from fixed, to fixed, number of parts, doc]
const CALENDARS = {
  julian: [julianFromFixed, fixedFromJulian, 3, "Julian calendar: julian(year, month, day); years are astronomical, 0 is 1 BC"],
  hebrew: [hebrewFromFixed, fixedFromHebrew, 3, "Hebrew calendar: hebrew(year, month, day), months from Nisan = 1 (Tishri = 7, Adar II = 13); a time after sunset shows the next day when a location is set"],
  islamic: [islamicFromFixed, fixedFromIslamic, 3, "Islamic calendar (arithmetic, civil): islamic(year, month, day); days from midnight, the observed calendar can differ by a day or two"],
  persian: [persianFromFixed, fixedFromPersian, 3, "Persian (Solar Hijri) calendar: persian(year, month, day)"],
  coptic: [copticFromFixed, fixedFromCoptic, 3, "Coptic calendar: coptic(year, month, day), month 13 is the 5 or 6 epagomenal days"],
  ethiopic: [(f) => copticFromFixed(f, ETHIOPIC_EPOCH), (y, m, d) => fixedFromCoptic(y, m, d, ETHIOPIC_EPOCH), 3, "Ethiopian calendar: ethiopic(year, month, day), month 13 is Pagume"],
  mayan: [mayanFromFixed, fixedFromMayan, 5, "Mayan long count: mayan(baktun, katun, tun, uinal, kin), 13.0.0.0.0 is 2012-12-21"],
};

function calendarText(name, date) {
  const p = CALENDARS[name][0](date);
  if (name === "mayan") return p.join(".");
  const [y, m, d] = p;
  let month = MONTHS[name][m - 1];
  if (name === "hebrew" && m === 12 && hebrewLeap(y)) month = "Adar I";
  return `${d} ${month} ${y}`;
}

// Gregorian, for the eras of the Japanese calendar
const GREGORIAN = [
  (f) => { const x = new Date((f - UNIX_RD) * 864e5); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; },
  (y, m, d) => { const x = new Date(0); x.setUTCFullYear(y, m - 1, d); return Math.round(x.getTime() / 864e5) + UNIX_RD; },
  3,
];

// The fixed day of a date in a calendar, or null if there is no such date
function fixedFrom(name, parts) {
  const [from, to, n] = name === "gregorian" ? GREGORIAN : CALENDARS[name];
  if (parts.length !== n || !parts.every(Number.isInteger)) return null;
  const f = to(...parts);
  const back = from(f);
  return back.every((x, i) => x === parts[i]) ? f : null;
}

export { CALENDARS, UNIX_RD, calendarText, fixedFrom };
