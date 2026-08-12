import { expect, test } from "@playwright/test";

const eventId = process.env.PROGRAMLOOM_E2E_EVENT_ID;
const authenticated = Boolean(
  eventId && process.env.PROGRAMLOOM_E2E_STORAGE_STATE,
);
const widgetKeys = (process.env.PROGRAMLOOM_E2E_WIDGET_KEYS ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);
const snapshotProject = (name: string) =>
  name === "desktop-1440x900" || name === "mobile-390x844";

for (const [name, route] of [
  ["marketing", "/"],
  ["product-guide", "/guide"],
  ["developer-reference", "/developers"],
  ["cfp-directory", "/cfp"],
  ["sign-in", "/login"],
] as const) {
  test(`${name} visual baseline`, async ({ page }, testInfo) => {
    await page.goto(route);
    await page
      .locator(".loading-page")
      .waitFor({ state: "detached", timeout: 10_000 })
      .catch(() => undefined);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Loading ProgramLoom…")).toHaveCount(0);
    if (!snapshotProject(testInfo.project.name)) return;
    await expect(page).toHaveScreenshot(`${name}-${testInfo.project.name}.png`, {
      animations: "disabled",
      fullPage: true,
      caret: "hide",
    });
  });
}

if (authenticated) {
  for (const route of [
    "control-room",
    "cfp",
    "submissions",
    "reviews",
    "communications",
    "speakers",
    "content",
    "agenda",
    "calendar",
    "widgets",
  ]) {
    test(`organizer ${route} visual baseline`, async ({ page }, testInfo) => {
      await page.goto(`/app/events/${eventId}/${route}`);
      await expect(page.locator("main")).toBeVisible();
      if (!snapshotProject(testInfo.project.name)) return;
      await expect(page).toHaveScreenshot(
        `organizer-${route}-${testInfo.project.name}.png`,
        {
          animations: "disabled",
          fullPage: true,
          caret: "hide",
          mask: page.locator("time, [data-dynamic-time]"),
        },
      );
    });
  }
}

if (widgetKeys.length === 5) {
  for (const key of widgetKeys) {
    test(`public widget ${key.split("-")[0]} visual baseline`, async ({
      page,
    }, testInfo) => {
      await page.goto(`/embed/${key}`);
      await expect(page.locator("main")).toBeVisible();
      if (!snapshotProject(testInfo.project.name)) return;
      await expect(page).toHaveScreenshot(
        `widget-${key.split("-")[0]}-${testInfo.project.name}.png`,
        { animations: "disabled", fullPage: true, caret: "hide" },
      );
    });
  }
}
