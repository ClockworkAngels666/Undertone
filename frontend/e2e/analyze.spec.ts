import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, watchErrors } from "./helpers";

test("analyzes the sample text", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample text" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();

  await expect(page.getByTestId("metric-tone_balance")).toContainText(/[+−]\d\.\d\d/);
  await expect(page.getByTestId("baseline-sentence")).toContainText("more hostile than");
  await expect(page.getByTestId("highlighted-text").locator("mark.hostile").first()).toBeVisible();
  await expect(page.getByTestId("highlighted-text").locator("mark.cooperative").first()).toBeVisible();
  const sentences = page.getByRole("table").last();
  await expect(sentences.getByRole("row")).toHaveCount(11);           // header + 10 sentences
  await page.getByLabel("Most negative (VADER)").check();
  await expect(sentences.getByRole("row").nth(1)).toContainText("−0.");    // a real minus sign
  await expectNoHorizontalScroll(page);
  noErrors();
});

test("reads an uploaded .txt file", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "statement.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("We condemn the illegal blockade. We welcome dialogue and cooperation with all partners."),
  });
  await expect(page.getByRole("textbox", { name: "Text" })).toHaveValue(/illegal blockade/);
  await expect(page.getByText(/Loaded statement\.txt/)).toBeVisible();
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByTestId("metric-hostility")).toBeVisible();
});

test("explains a text that is too short", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Text" }).fill("Thank you.");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByRole("alert")).toContainText("too short");
});

test("custom dictionaries change the scores and switch off the UN comparison", async ({ page }) => {
  await page.goto("/dictionaries");
  await page.getByRole("textbox", { name: /Hostile words/ }).fill("sanction*");
  await page.getByRole("button", { name: "Save dictionaries" }).click();
  await expect(page.getByText("Saved in this browser.")).toBeVisible();

  await page.getByRole("link", { name: "Analyze a text" }).click();
  await page.getByRole("button", { name: "Use sample text" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByText(/Custom dictionaries are in use/)).toBeVisible();
  await expect(page.getByText(/1 hostile and \d+ cooperative dictionary words/)).toBeVisible();
  await expect(page.getByTestId("baseline-sentence")).toHaveCount(0);

  await page.goto("/dictionaries");
  await page.getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByText("You are using the default dictionaries.")).toBeVisible();
});
