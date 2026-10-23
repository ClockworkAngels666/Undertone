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
  await expect(page.getByRole("heading", { name: "Sentence landscape" })).toBeVisible();
  noErrors();
});

test("the 3D globe plays through the years", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/un");
  const globe = page.locator('.globe3d[data-ready="true"]');
  await expect(globe.locator("canvas")).toBeVisible();
  const yearLabel = page.locator(".globe3d-year");
  const last = await yearLabel.innerText();

  // The slider moves the globe to another year
  const slider = page.getByLabel("Year shown on the globe");
  const min = await slider.getAttribute("min");
  await slider.fill(min!);
  await expect(yearLabel).toHaveText(min!);
  await expect(page.locator(".globe3d-note")).toContainText("delegations spoke");

  // Play steps through the years, Pause stops
  await page.getByRole("button", { name: /Play years/ }).click();
  await expect(yearLabel).not.toHaveText(min!, { timeout: 5_000 });
  await page.getByRole("button", { name: /Pause/ }).click();
  expect(Number(await yearLabel.innerText())).toBeLessThanOrEqual(Number(last));
  await page.getByRole("button", { name: "Reset view" }).first().click();

  // The globe follows the page's metric
  await page.getByLabel("Metric").selectOption("hostility");
  await expect(page.locator(".globe3d-legend")).toContainText("Hostile words / 1,000");
  await expectNoHorizontalScroll(page);
  noErrors();
});

test("the 3D rhetoric space draws the chosen countries", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/un");
  const space = page.locator('.space3d[data-ready="true"]');
  await expect(space.locator("canvas")).toBeVisible();
  await expect(space.getByRole("list", { name: "Legend" }).locator("li")).not.toHaveCount(0);
  await expect(space).toContainText(/\d+ points/);
  noErrors();
});
