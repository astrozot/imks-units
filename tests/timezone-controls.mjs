export const activeTimeMode = page => page.locator('[data-time-zone][aria-pressed="true"]').getAttribute('data-time-zone');
export async function setTimeMode(page, mode) {
  await page.click(`[data-time-zone="${mode}"]`);
  if (mode === 'location') await page.click('[data-zone-done]');
}
export async function setLocalTimezone(page, zone) {
  await page.click('[data-time-zone="location"]');
  await page.fill('[data-place-zone]', zone);
  await page.locator('[data-place-zone]').dispatchEvent('change');
  await page.click('[data-zone-done]');
}
export async function resetLocalTimezone(page) {
  await page.click('[data-time-zone="location"]');
  await page.click('[data-reset-place-zone]');
  await page.click('[data-zone-done]');
}
