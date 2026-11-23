export const activeTimeMode = page => page.locator('[data-time-zone][aria-pressed="true"]').getAttribute('data-time-zone');
export async function setTimeMode(page, mode) {
  await page.click(`[data-time-zone="${mode}"]`);
  if (mode === 'location') {
    await page.click('[data-reset-place-zone]');
    await page.click('[data-zone-cancel]');
  }
}
// Seed a saved override for date/format tests, including legacy fixed offsets.
// Interactive globe selection is covered by coelum-timezone-map-browser.mjs.
export async function setLocalTimezone(page, zone) {
  const instant = Number(await page.locator('.coelum-full').getAttribute('data-time'));
  await page.evaluate(zone => {
    const place = JSON.parse(localStorage.getItem('imks.coelumPlace')) || JSON.parse(localStorage.getItem('imks.settings') || '{}').location || { lat: 51.4769, lon: -0.0005 };
    const key = [place.lat, place.lon].map(x => x.toFixed(4)).join(',');
    const zones = JSON.parse(localStorage.getItem('imks.coelumPlaceZones') || '{}');
    zones[key] = zone;
    localStorage.setItem('imks.coelumPlaceZones', JSON.stringify(zones));
    localStorage.setItem('imks.coelumTimeZone', JSON.stringify('location'));
  }, zone);
  await page.reload();
  await page.waitForSelector('.coelum-full');
  await page.click('[data-action="time"]');
  const value = await page.evaluate(async ({ instant, zone }) => {
    const { skyTimeInput } = await import('../js/coelumtime.js');
    return skyTimeInput(instant, zone, true);
  }, { instant, zone });
  await page.click('[data-time-date-mode]');
  await page.fill('[data-time-input]', value);
  await page.locator('[data-time-input]').dispatchEvent('change');
  await page.locator('[data-time-input]').blur();
}
export async function resetLocalTimezone(page) {
  await page.click('[data-time-zone="location"]');
  await page.click('[data-reset-place-zone]');
  await page.click('[data-zone-cancel]');
}
