import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

for (const route of [
  "/help/",
  "/help/getting-started",
  "/help/organizers/control-room",
  "/help/reviewers",
  "/help/speakers",
  "/help/attendees",
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
