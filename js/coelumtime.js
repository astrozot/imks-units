// Astronomical years in the proleptic Gregorian calendar: 0 = 1 BCE.
// A zone is an IANA identifier or a fixed offset such as +02:00.
const pad = (n) => String(n).padStart(2, '0');
export const signedYear = (year) => `${year < 0 ? '−' : ''}${String(Math.abs(year)).padStart(4, '0')}`;
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const normalize = (zone) => zone === true ? 'UTC' : !zone || zone === 'device' ? deviceTimeZone() : zone;
const fixedOffset = (zone) => {
  const m = /^(?:UTC)?([+−-])(\d{2}):(\d{2})$/.exec(zone);
  return m && Number(m[2]) <= 14 && Number(m[3]) < 60 && (Number(m[2]) < 14 || Number(m[3]) === 0)
    ? (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3])) : null;
};
const formatters = new Map();
const formatter = (zone) => {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', era: 'short',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return formatters.get(zone);
};
export function validSkyZone(zone) {
  if (fixedOffset(zone) !== null) return true;
  try { formatter(zone); return true; } catch { return false; }
}
export function skyTimeParts(time, zone = false) {
  zone = normalize(zone);
  const offset = fixedOffset(zone);
  if (offset !== null) {
    const d = new Date((time + offset * 60) * 1000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
  }
  const p = Object.fromEntries(formatter(zone).formatToParts(new Date(time * 1000)).map((p) => [p.type, p.value]));
  return { year: p.era === 'BC' ? 1 - Number(p.year) : Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}
const wallTime = (p) => {
  const d = new Date(0); d.setUTCFullYear(p.year, p.month - 1, p.day); d.setUTCHours(p.hour, p.minute, p.second || 0, 0);
  return d.getTime() / 1000;
};
export function skyOffset(time, zone = false) {
  return (wallTime(skyTimeParts(time, zone)) - Math.floor(time)) / 60;
}
const offsetText = (offset) => {
  const s = Math.round(Math.abs(offset) * 60), seconds = s % 60;
  return `UTC${offset < 0 ? '−' : '+'}${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}${seconds ? `:${pad(seconds)}` : ''}`;
};
export function skyTimeZone(time, zone = false) {
  zone = normalize(zone);
  if (zone === 'UTC') return 'UTC';
  if (fixedOffset(zone) !== null) return offsetText(fixedOffset(zone));
  return `${zone} (${offsetText(skyOffset(time, zone))})`;
}
export function formatSkyTime(time, zone = false, showZone = true) {
  zone = normalize(zone);
  const p = skyTimeParts(time, zone);
  if (zone === 'UTC') return `${skyTimeInput(time, zone).replace(/^-/, '−')}${showZone ? ' UTC' : ''}`;
  const offset = fixedOffset(zone), d = new Date((time + (offset ?? 0) * 60) * 1000);
  const options = { timeZone: offset !== null ? 'UTC' : zone, calendar: 'gregory', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const text = p.year > 0 ? d.toLocaleString([], options) : new Intl.DateTimeFormat([], options).formatToParts(d)
    .map((part) => part.type === 'year' ? signedYear(p.year) : part.value).join('');
  return showZone ? `${text} ${skyTimeZone(time, zone)}` : text;
}
export function skyClock(time, zone = false, seconds = false) {
  const p = skyTimeParts(time, zone);
  return `${pad(p.hour)}:${pad(p.minute)}${seconds ? `:${pad(p.second)}` : ''}`;
}
export function skyTimeInput(time, zone = false) {
  const p = skyTimeParts(time, zone);
  return `${signedYear(p.year).replace('−', '-')}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
export const localSkyInput = (time) => skyTimeInput(time);
export function parseSkyInput(value, zone = false) {
  zone = normalize(zone);
  const m = /^([+\-−]?\d{1,6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value.trim());
  if (!m || !validSkyZone(zone)) return NaN;
  const [year, month, day, hour, minute] = m.slice(1).map((s) => Number(s.replace('−', '-')));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return NaN;
  const p = { year, month, day, hour, minute, second: 0 }, wall = wallTime(p);
  if (!Number.isFinite(wall)) return NaN;
  // Sample both sides of timezone transitions. Skip nonexistent wall times;
  // repeated clock times choose the earlier occurrence deterministically.
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) offsets.add(skyOffset(wall + hours * 3600, zone));
  return [...offsets].map((offset) => wall - offset * 60).sort((a, b) => a - b).find((t) => {
    const q = skyTimeParts(t, zone);
    return Object.keys(p).every((k) => p[k] === q[k]);
  }) ?? NaN;
}
export function skyDayBounds(time, zone = false) {
  const p = skyTimeParts(time, zone), midnight = { ...p, hour: 0, minute: 0, second: 0 };
  // Some date-line changes skip a whole civil day (e.g. Samoa, 2011).
  const dayAt = (wall) => {
    for (let hour = 0; hour < 72; hour++) {
      const text = skyTimeInput(wall + hour * 3600, 'UTC'), t = parseSkyInput(text, zone);
      if (Number.isFinite(t)) return t;
    }
    return NaN;
  };
  const wall = wallTime(midnight);
  return [dayAt(wall), dayAt(wall + 86400)];
}
