import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

for (const route of [
  "/help/",
  "/help/getting-started",
  "/help/glossary",
  "/help/organizers/control-room",
  "/help/organizers/proposals",
  "/help/organizers/reviewing",
  "/help/organizers/decisions",
  "/help/organizers/speakers",
  "/help/organizers/content",
  "/help/organizers/communications",
  "/help/organizers/schedule",
  "/help/organizers/publish",
  "/help/organizers/search-notifications",
  "/help/organizers/templates",
  "/help/organizers/crm",
  "/help/organizers/team-access",
  "/help/organizers/integrations",
  "/help/reviewers",
  "/help/speakers",
  "/help/attendees",
  "/help/troubleshooting",
]) {
  test(`${route} is responsive and accessible`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    await expect(
      page.getByRole("link", { name: "ProgramLoom Help" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });
}

test("help search finds plain-language recovery guidance", async ({ page }) => {
  await page.goto("/help/");
  await page.getByRole("button", { name: "Search help" }).click();
  const search = page.getByRole("searchbox");
  await expect(search).toBeFocused();
  await search.fill("retry delivery");
  await expect(
    page.getByRole("option", { name: /Understand message status/i }),
  ).toBeVisible();
});

test("help-center primary actions have readable contrast and touch targets", async ({
  page,
}) => {
  await page.goto("/help/");
  for (const name of ["Create your first event", "Open ProgramLoom"]) {
    const action = page.getByRole("link", { name, exact: true });
    await expect(action).toBeVisible();
    const style = await action.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        color: computed.color,
        background: computed.backgroundColor,
        height: element.getBoundingClientRect().height,
        paddingInline: Number.parseFloat(computed.paddingInlineStart),
      };
    });
    expect(style.color).toBe("rgb(255, 255, 255)");
    expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.height).toBeGreaterThanOrEqual(48);
    expect(style.paddingInline).toBeGreaterThanOrEqual(20);
  }
});

test("unknown help routes stay in the help center", async ({ page }) => {
  const response = await page.goto("/help/not-a-real-guide");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page Not Found" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "go to home" })).toHaveAttribute(
    "href",
    "/help/",
  );
});

test("the AI-readable help index is public", async ({ request }) => {
  const response = await request.get("/help/llms.txt");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/plain");
  await expect(response.text()).resolves.toContain("# ProgramLoom Help");
});
