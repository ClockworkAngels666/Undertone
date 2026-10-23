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
