import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, watchErrors } from "./helpers";

const CSV = [
  "country,year,source,title,text",
  'VNM,2022,Test,One,"We welcome dialogue and cooperation with all partners. Mutual trust is our goal."',
  'VNM,2023,Test,Two,"We condemn illegal sanctions and interference. We still welcome dialogue."',
  'CHN,2022,Test,Three,"Hegemony and bloc confrontation threaten peace. We oppose any aggression."',
  'CHN,2023,Test,Four,"Win-win cooperation and a shared future for mankind guide our policy."',
  "RUS,2023,Test,Bad row,Too short.",
].join("\n");

test("uploads a CSV, compares it over time, exports and deletes it", async ({ page, request }) => {
  const noErrors = watchErrors(page);
  await page.goto("/datasets");
  await page.getByLabel("CSV file").setInputFiles({ name: "e2e.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await expect(page.getByText(/5 texts from 3 countries, 2022–2023/)).toBeVisible();
  await page.getByLabel("Dataset name").fill(`Automated test ${Date.now()}`);
  await page.getByRole("button", { name: "Create dataset" }).click();

  await expect(page).toHaveURL(/\/datasets\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/1 row was skipped/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Legend" }).first()).toContainText("Vietnam");
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "By country and year" })).toBeVisible();

  await page.getByLabel("Metric").selectOption("kw::sanction*");
  await expect(page.getByRole("heading", { name: "“sanction…” per 1,000 words" })).toBeVisible();
  await page.getByLabel(/Compare with the same countries/).check();

  const href = await page.getByRole("link", { name: /Results by country and year/ }).getAttribute("href");
  const csv = await request.get(href!);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Vietnam");
  await expectNoHorizontalScroll(page);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete dataset" }).click();
  await expect(page).toHaveURL(/\/datasets$/);
  const gone = await request.get(href!);
  expect(gone.status()).toBe(404);
  noErrors();
});

test("saves an analyzed text into a new dataset", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample text" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
  await page.getByText("Save this text to a dataset").click();
  await page.getByLabel("New dataset name").fill(`Saved text ${Date.now()}`);
  await page.getByLabel("Country code").fill("VNM");
  await page.getByRole("button", { name: "Save text" }).click();
  await page.getByRole("link", { name: /^Saved text/ }).click();
  await expect(page.getByText(/1 text · 1 country/)).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete dataset" }).click();
  await expect(page).toHaveURL(/\/datasets$/);
});

test("rejects a CSV without the required columns", async ({ page }) => {
  await page.goto("/datasets");
  await page.getByLabel("CSV file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") });
  await expect(page.getByText(/Missing columns: country, year, text/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create dataset" })).toBeDisabled();
});
