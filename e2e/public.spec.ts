import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

for (const route of [
  "/",
  "/guide",
  "/developers",
  "/login",
  "/privacy",
  "/terms",
  "/cfp",
]) {
  test(`${route} is responsive and accessible`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
    await page
      .locator(".inline-empty", { hasText: /^Loading/ })
      .waitFor({ state: "detached" })
      .catch(() => undefined);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });
}

test("developer machine-readable references are public and versioned", async ({
  request,
}) => {
  const openapi = await request.get("/api/v1/openapi.json");
  expect(openapi.ok()).toBeTruthy();
  expect(await openapi.json()).toMatchObject({
    openapi: "3.1.0",
    info: { version: "1.0.0" },
    servers: [{ url: "https://app.programloom.com/api/v1" }],
  });
  const collection = await request.get("/api/v1/collection.json");
  expect(collection.ok()).toBeTruthy();
  expect(await collection.json()).toMatchObject({
    info: { name: "ProgramLoom v1" },
  });
});
