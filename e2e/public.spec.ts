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

test("unknown browser routes render a useful recovery page", async ({
  page,
}) => {
  await page.goto("/not-a-real-programloom-page");
  await expect(
    page.getByRole("heading", {
      name: "This ProgramLoom page does not exist.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Return to workspace" }),
  ).toBeVisible();
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

test("mobile navigation and documentation links retain reliable touch targets", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile contract only.");
  const routes = [
    { path: "/", selector: ".brand, a.text-link, .site-shell > footer a" },
    {
      path: "/guide",
      selector:
        ".wordmark, .product-guide > header a, .product-guide > footer a",
    },
    {
      path: "/developers",
      selector:
        ".wordmark, .docs-layout > aside a, .developer-docs article a, .developer-docs > footer a",
    },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    const undersized = await page.locator(route.selector).evaluateAll((items) =>
      items
        .map((item) => {
          const bounds = item.getBoundingClientRect();
          return {
            label:
              item.getAttribute("aria-label") ?? item.textContent?.trim() ?? "",
            width: bounds.width,
            height: bounds.height,
          };
        })
        .filter(
          (item) =>
            item.width > 0 &&
            item.height > 0 &&
            (item.width < 44 || item.height < 44),
        ),
    );
    expect(undersized, `${route.path} has undersized touch targets`).toEqual(
      [],
    );
  }
});
