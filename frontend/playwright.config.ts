import { defineConfig, devices } from "@playwright/test";

// Local and CI runs start their own backend (fictional demo data in a throwaway SQLite file) and a production
// build of the frontend. Set E2E_BASE_URL to run the same tests against a deployed site instead, e.g.
//   E2E_BASE_URL=https://undertonelab.vercel.app npx playwright test
const deployed = process.env.E2E_BASE_URL;
const API_PORT = "8021";
// Headless Chrome has no graphics card; these switches give it software WebGL so the 3D views are tested too.
const WEBGL_ARGS = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI || deployed ? 1 : 0,
  workers: process.env.CI ? 2 : 4,      // software WebGL is CPU-heavy
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: deployed ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { args: WEBGL_ARGS } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { args: WEBGL_ARGS } } },
  ],
  webServer: deployed
    ? undefined
    : [
        {
          command: "node e2e/start-backend.mjs",
          url: `http://127.0.0.1:${API_PORT}/api/health`,
          env: { API_PORT },
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
        {
          command: "npx vite build --logLevel warn && npx vite preview --port 4173 --strictPort --host 127.0.0.1",
          url: "http://127.0.0.1:4173",
          env: { API_PORT },
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      ],
});
