import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, watchErrors } from "./helpers";

test("the analysis shows a 3D sentence landscape", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample text" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.locator('.landscape3d[data-ready="true"] canvas')).toBeVisible();
  await expect(page.locator('.balance3d[data-ready="true"] canvas')).toBeVisible();
  await expect(page.getByText(/Each block is one word/)).toBeVisible();
  await page.getByRole("button", { name: "Weigh again" }).click();
  await expect(page.locator('.balance3d[data-ready="true"] canvas')).toBeVisible();
  noErrors();
});

test("the 3D flag line plays through the years and switches views", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/un");
  await expect(page.locator(".globe3d")).toHaveCount(0);                // the big globe is gone
  const flags = page.locator('.flags3d[data-ready="true"]');
  await expect(flags.locator("canvas")).toBeVisible();
  const yearLabel = page.locator(".view3d-year");

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

test("the assembly hall seats the year's delegations and plays the years", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/un");
  await page.getByRole("tab", { name: "Assembly hall" }).click();
  await expect(page.getByRole("tab", { name: "Assembly hall" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('.hall3d[data-ready="true"] canvas')).toBeVisible();
  await expect(page.getByText(/\d+ delegations spoke in \d{4}\./)).toBeVisible();

  const slider = page.getByLabel("Year shown in the hall");
  const min = await slider.getAttribute("min");
  await slider.fill(min!);
  await expect(page.locator(".view3d-year")).toHaveText(min!);
  await page.getByLabel("Seats").selectOption("name");
  await expect(page.getByText(/Seats run from the lowest/)).toHaveCount(0);
  await page.getByRole("button", { name: /Play years/ }).click();
  await expect(page.locator(".view3d-year")).not.toHaveText(min!, { timeout: 5_000 });
  await page.getByRole("button", { name: /Pause/ }).click();

  await page.getByRole("tab", { name: "Flags" }).click();
  await expect(page.locator('.flags3d[data-ready="true"] canvas')).toBeVisible();
  await expectNoHorizontalScroll(page);
  noErrors();
});

test("the ranking shows the year's top three on a podium", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/un");
  const podium = page.locator('.podium3d[data-ready="true"]');
  await podium.scrollIntoViewIfNeeded();
  await expect(podium.locator("canvas")).toBeVisible();
  await expect(podium).toHaveAttribute("aria-label", /^Podium: 1\. .+, 2\. .+, 3\. /);
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
