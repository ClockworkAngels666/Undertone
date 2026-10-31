import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "./helpers";

test("the API is healthy and has UN data", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: "ok", database: "ok" });
  expect(body.un_data.statements).toBeGreaterThan(0);
});

test("the API documentation loads", async ({ request }) => {
  expect((await request.get("/api/docs")).status()).toBe(200);
  const schema = await (await request.get("/api/openapi.json")).json();
  expect(Object.keys(schema.paths)).toContain("/api/analyze");
});

test("unknown API paths answer with JSON, unknown pages with the app", async ({ page, request }) => {
  const api = await request.get("/api/does-not-exist");
  expect(api.status()).toBe(404);
  expect((await api.json()).detail).toContain("No API endpoint");
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

for (const path of ["/", "/un", "/datasets", "/dictionaries", "/method"]) {
  test(`page ${path} opens directly and fits the screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

// Automatic accessibility checks (WCAG 2.2 A and AA) on every page, in light and dark mode
for (const scheme of ["light", "dark"] as const) {
  test(`every page passes the accessibility checks (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const check = async (name: string) => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(violations.map((v) => `${name}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    };
    for (const path of ["/", "/un", "/datasets", "/dictionaries", "/dictionaries?v=counts", "/method"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await check(path);
    }
    await page.goto("/");
    await page.getByRole("button", { name: "Use sample text" }).click();
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByTestId("highlighted-text")).toBeVisible();
    // The page scrolls smoothly to the results; mid-scroll the sticky header covers the buttons, so wait for it to stop
    await expect.poll(() => page.evaluate(() => new Promise<boolean>((done) => {
      const y = window.scrollY;
      setTimeout(() => done(window.scrollY === y), 200);
    }))).toBe(true);
    await check("analysis");
  });
}
