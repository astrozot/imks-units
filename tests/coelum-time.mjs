import assert from 'node:assert/strict';
import tzlookup from '../js/tzlookup.js';
import { skyTimeInput, parseSkyInput, skyOffset, skyTimeZone, skyDayBounds, formatSkyTime, validSkyZone } from '../js/coelumtime.js';
const t = (s) => Date.parse(s) / 1000;
for (const [lat, lon, zone] of [[45.4642, 9.19, 'Europe/Rome'], [35.6762, 139.6503, 'Asia/Tokyo'], [40.7128, -74.006, 'America/New_York'], [-33.8688, 151.2093, 'Australia/Sydney'], [27.7172, 85.324, 'Asia/Kathmandu']]) assert.equal(tzlookup(lat, lon), zone);
for (const zone of ['UTC', 'Europe/Rome', 'America/New_York', 'Asia/Tokyo', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'UTC+02:00', '-03:30']) {
  for (const date of ['-001000-06-01T12:34:00Z', '0000-06-01T12:34:00Z', '0099-06-01T12:34:00Z', '2026-01-01T12:34:00Z', '2026-06-01T12:34:00Z', '3000-06-01T12:34:00Z']) {
    const time = t(date), input = skyTimeInput(time, zone), parsed = parseSkyInput(input, zone);
    assert.equal(skyTimeInput(parsed, zone), input, `${zone} ${date}`);
    assert.ok(Math.abs(parsed - time) < 60, 'Minute precision, including historic second offsets');
  }
}
assert.equal(skyOffset(t('2026-01-01T12:00Z'), 'America/New_York'), -300);
assert.equal(skyOffset(t('2026-07-01T12:00Z'), 'America/New_York'), -240);
assert.equal(skyOffset(t('2026-01-01T12:00Z'), 'UTC+02:00'), 120);
assert.equal(skyOffset(t('2026-07-01T12:00Z'), 'UTC+02:00'), 120);
assert.equal(skyOffset(t('2026-07-01T12:00Z'), 'Asia/Kathmandu'), 345);
assert.ok(Number.isNaN(parseSkyInput('2026-03-08 02:30', 'America/New_York')), 'Reject a DST gap');
assert.equal(parseSkyInput('2026-11-01 01:30', 'America/New_York'), t('2026-11-01T05:30Z'), 'Earlier occurrence in a DST overlap');
assert.ok(Number.isNaN(parseSkyInput('2026-02-30 12:00', 'Asia/Tokyo')));
for (const [date, hours] of [['2026-03-08T12:00Z', 23], ['2026-11-01T12:00Z', 25]]) {
  const [start, end] = skyDayBounds(t(date), 'America/New_York');
  assert.equal((end - start) / 3600, hours);
}
{
  const [start, end] = skyDayBounds(t('2011-12-29T12:00Z'), 'Pacific/Apia');
  assert.equal((end - start) / 3600, 24, 'Skip a missing civil day at the date line');
}
assert.match(skyTimeZone(t('2026-01-01T12:00Z'), 'America/New_York'), /America\/New_York \(UTC−05:00\)/);
assert.match(formatSkyTime(t('0000-06-01T12:00Z'), 'Asia/Tokyo'), /0000.*Asia\/Tokyo.*UTC/s);
assert.equal(validSkyZone('Not/AZone'), false);
assert.equal(validSkyZone('UTC−03:30'), true);
console.log('Coelum time checks passed: offline zones, BCE, DST gaps/overlaps, short/long days, fractional and fixed offsets');
