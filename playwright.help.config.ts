import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5176";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "help.spec.ts",
  outputDir: "test-results/playwright-help",
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "WRANGLER_LOG_PATH=.wrangler.log npx wrangler dev --local --port 5176",
    url: baseURL,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
