import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, watchErrors } from "./helpers";

test("the start page shows the 3D intro globe", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".intro-globe canvas")).toBeVisible();
  await expectNoHorizontalScroll(page);
  noErrors();
});

test("the analysis shows a 3D sentence landscape", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample text" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.locator('.landscape3d[data-ready="true"] canvas')).toBeVisible();
  noErrors();
});

test("the 3D flag line plays through the years and switches views", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/un");
  await expect(page.locator(".globe3d")).toHaveCount(0);                // the big globe is gone
  const flags = page.locator('.flags3d[data-ready="true"]');
  await expect(flags.locator("canvas")).toBeVisible();
  const yearLabel = page.locator(".flags3d-year");

  const slider = page.getByLabel("Year shown by the flags");
  const min = await slider.getAttribute("min");
  await slider.fill(min!);
  await expect(yearLabel).toHaveText(min!);
  await page.getByRole("button", { name: /Play years/ }).click();
  await expect(yearLabel).not.toHaveText(min!, { timeout: 5_000 });
  await page.getByRole("button", { name: /Pause/ }).click();

  const mode = page.getByLabel("Flags", { exact: true });
  await mode.selectOption("top");
  await mode.selectOption("bottom");
  await expect(mode).toHaveValue("bottom");
  await expectNoHorizontalScroll(page);
  noErrors();
});

test("close reading shows the speaker's rostrum, and the rhetoric space draws", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/un");
  await expect(page.locator('.space3d[data-ready="true"] canvas')).toBeVisible();
  await page.locator("#close-reading").scrollIntoViewIfNeeded();
  await expect(page.locator('.rostrum3d[data-ready="true"] canvas')).toBeVisible();
  await expect(page.locator(".reading-title")).not.toBeEmpty();
  noErrors();
});
