import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

for (const route of ["/", "/login", "/privacy", "/terms", "/cfp"]) {
  test(`${route} is responsive and accessible`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });
}
