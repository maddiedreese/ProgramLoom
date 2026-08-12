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
    {
      name: "desktop-1440x900",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "laptop-1024x768",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "tablet-768x1024",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "mobile-390x844",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
});
