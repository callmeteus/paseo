import { expect, test } from "../support/fixtures";
import type { Page } from "@playwright/test";
import { chooseSettingsFontFamily, openSettingsSection } from "../support/helpers/settings";

async function openAppearance(page: Page) {
  await page.goto("/settings");
  await openSettingsSection(page, "appearance");
}

for (const name of ["Code font family", "Interface font family"] as const) {
  test(`keeps settings usable after an unfinished quote in ${name}`, async ({ page }, testInfo) => {
    await openAppearance(page);
    await chooseSettingsFontFamily(page, name, "'Fira Code', monospace");
    await expect(page.getByRole("button", { name })).toContainText("'Fira Code', monospace");

    await chooseSettingsFontFamily(page, name, "'foo");
    await expect(page.getByRole("button", { name })).toContainText("'Fira Code', monospace");
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
    await expect(page.getByText("Theme", { exact: true }).first()).toHaveCSS("font-size", "12px");

    await page.screenshot({ path: testInfo.outputPath("rejected-font.png") });
    await page.reload();
    await expect(page.getByRole("button", { name })).toContainText("'Fira Code', monospace");
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
    await chooseSettingsFontFamily(page, name, "");
    await expect(page.getByRole("button", { name })).toContainText("System default");
  });
}

test("opens settings with defaults when a malformed font was already saved", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ monoFontFamily: "'foo", uiFontFamily: '"foo' }),
    );
  });
  await openAppearance(page);
  await expect(page.getByRole("button", { name: "Code font family" })).toContainText(
    "System default",
  );
  await expect(page.getByRole("button", { name: "Interface font family" })).toContainText("Allo");
  await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
  await expect(page.getByText("Theme", { exact: true }).first()).toHaveCSS("font-size", "12px");
});
