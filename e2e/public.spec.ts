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

test("shared calls to action retain readable spacing and contrast", async ({
  page,
}) => {
  await page.goto("/guide");
  const guideButton = page.getByRole("link", { name: "Open ProgramLoom" });
  await expect(guideButton).toBeVisible();
  const guideStyle = await guideButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      height: element.getBoundingClientRect().height,
      paddingInline: Number.parseFloat(style.paddingInlineStart),
    };
  });
  expect(guideStyle.color).toBe("rgb(255, 255, 255)");
  expect(guideStyle.height).toBeGreaterThanOrEqual(38);
  expect(guideStyle.paddingInline).toBeGreaterThanOrEqual(14);

  const largeButton = page.getByRole("link", {
    name: "Understand the workflow",
  });
  await expect(largeButton).toBeVisible();
  const largeStyle = await largeButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      height: element.getBoundingClientRect().height,
      paddingInline: Number.parseFloat(style.paddingInlineStart),
    };
  });
  expect(largeStyle.color).toBe("rgb(255, 255, 255)");
  expect(largeStyle.height).toBeGreaterThanOrEqual(51);
  expect(largeStyle.paddingInline).toBeGreaterThanOrEqual(19);
});
