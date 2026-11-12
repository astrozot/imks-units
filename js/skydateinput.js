// Native calendar/time controls for positive years; signed astronomical years
// remain available explicitly, since HTML date inputs cannot represent year 0/BC.
import { skyTimeInput, parseSkyInput } from './coelumtime.js';
export function calendarSkyTime(time, zone) {
  const text = skyTimeInput(time, zone);
  if (Number(text.split(' ')[0].slice(0, -6)) > 0) return time;
  // Calendar browsing starts at the same month/day in 1 CE. Merely switching
  // input mode never changes the selected sky/almanac day.
  const candidate = parseSkyInput(`0001${text.slice(text.indexOf('-', 1))}`, zone);
  return Number.isFinite(candidate) ? candidate : parseSkyInput('0001-01-01 12:00', zone);
}
export function setSkyDateInput(input, time, zone, { dateOnly = false, extended = false } = {}) {
  const text = skyTimeInput(time, zone), date = text.split(' ')[0];
  const signed = extended || Number(date.slice(0, -6)) <= 0;
  input.type = signed ? 'text' : dateOnly ? 'date' : 'datetime-local';
  input.value = dateOnly ? date : signed ? text : text.replace(' ', 'T');
  input.placeholder = dateOnly ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm';
  input.dataset.signed = String(signed);
  if (signed) { input.removeAttribute('min'); input.removeAttribute('max'); }
  else { input.min = dateOnly ? '0001-01-01' : '0001-01-01T00:00'; input.max = dateOnly ? '3000-12-31' : '3000-12-31T23:59'; }
  input.setCustomValidity('');
  return signed;
}
export function openSkyDatePicker(input) {
  if (input.type === 'text') return;
  // showPicker needs a direct user gesture; native controls still work when
  // the browser doesn't implement it (or opens its own picker on focus).
  try { input.showPicker?.(); } catch { /* native fallback */ }
}
