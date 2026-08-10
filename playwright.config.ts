import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PROGRAMLOOM_E2E_URL ?? "http://127.0.0.1:5174";
const storageState = process.env.PROGRAMLOOM_E2E_STORAGE_STATE;
const host = new URL(baseURL).hostname;
const local = host === "127.0.0.1" || host === "localhost";
const externalServer = process.env.PROGRAMLOOM_E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    storageState,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer:
    local && !externalServer
      ? {
          command: "npm run dev -- --host 127.0.0.1 --port 5174",
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        }
      : undefined,
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
