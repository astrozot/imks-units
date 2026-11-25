// Existing settings tests follow the rail shortcut through its configure button.
export async function toggleLayerSettings(page) {
  await page.locator('[data-action="layers"]').click();
  if (await page.locator('.coelum-layerbar').isVisible()) {
    await page.locator('[data-action="configure-layers"]').click();
    await page.locator('.coelum-settings-section').evaluateAll(sections => { for (const section of sections) section.open = true; });
  }
}
