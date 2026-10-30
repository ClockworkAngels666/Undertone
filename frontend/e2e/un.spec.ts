import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, watchErrors } from "./helpers";

test("explores the UN General Debate data", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/un");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("UN General Debate");
  await expect(page.getByRole("img", { name: /Line chart/ })).toBeVisible();
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Legend" }).first()).toContainText("All-country average");

  await page.getByLabel("Metric").selectOption("hostility");
  await expect(page).toHaveURL(/m=hostility/);
  await expect(page.getByRole("heading", { name: "Hostile words / 1,000" })).toBeVisible();

  // A year can be typed digit by digit; one outside the data is pulled back when the field is left.
  const from = page.getByLabel("From", { exact: true });
  await from.fill("");
  await from.pressSequentially("2005");
  await expect(page).toHaveURL(/from=2005/);
  await from.fill("");
  await from.pressSequentially("1800");
  await from.press("Tab");
  await expect(from).not.toHaveValue("1800");

  // A turning point opens the speech in the close-reading panel and moves focus there.
  const shift = page.locator("tr.clickable").first();
  await expect(shift).toBeVisible();
  const country = await shift.getByRole("button").innerText();
  await shift.getByRole("button").press("Enter");
  await expect(page.locator("#read-country option:checked")).toHaveText(country);
  await expect(page.getByRole("heading", { name: "Close reading" })).toBeFocused();
  await expect(page.locator("#close-reading .sentences li").first()).toBeVisible();
  await expect(page.locator("#close-reading mark").first()).toBeVisible();

  await page.getByRole("tab", { name: "Year by year" }).click();
  await expect(page).toHaveURL(/v=year/);
  await expect(page.getByRole("heading", { name: "Country ranking" })).toBeVisible();
  await expect(page.locator(".bar-fill").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  noErrors();
});

test("shows the chart's numbers as a table and exports CSV", async ({ page, request }) => {
  await page.goto("/un?m=tone_balance");
  await page.getByText("Show the numbers as a table").click();
  await expect(page.locator("details.table-view table tbody tr").first()).toBeVisible();

  const href = await page.getByRole("link", { name: "Download selection (CSV)" }).getAttribute("href");
  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("country,country_name,year,session");
});

test("keeps the view in the address so it can be shared", async ({ page }) => {
  await page.goto("/un?m=negative_share&from=2000&to=2010&avg=0");
  await expect(page.getByRole("heading", { name: "Share of negative sentences" })).toBeVisible();
  await expect(page.getByLabel("Average of all countries")).not.toBeChecked();
  await expect(page.getByRole("spinbutton", { name: "From" })).toHaveValue("2000");
  // the chosen tab is part of the address too, and the arrow keys move between tabs
  await page.goto("/un?v=space");
  await expect(page.getByRole("tab", { name: "Rhetoric space" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Rhetoric space" }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Close reading" })).toBeFocused();
  await expect(page).toHaveURL(/v=read/);
});
