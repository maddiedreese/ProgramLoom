import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

const HELP_ROUTES = [
  "/help/",
  "/help/getting-started",
  "/help/glossary",
  "/help/organizers/control-room",
  "/help/organizers/proposals",
  "/help/organizers/reviewing",
  "/help/organizers/decisions",
  "/help/organizers/speakers",
  "/help/organizers/onboarding",
  "/help/organizers/content",
  "/help/organizers/communications",
  "/help/organizers/schedule",
  "/help/organizers/calendar",
  "/help/organizers/publish",
  "/help/organizers/search-notifications",
  "/help/organizers/notifications",
  "/help/organizers/templates",
  "/help/organizers/crm",
  "/help/organizers/team-access",
  "/help/organizers/integrations",
  "/help/organizers/airtable",
  "/help/organizers/developer-platform",
  "/help/organizers/settings",
  "/help/reviewers",
  "/help/speakers",
  "/help/attendees",
  "/help/troubleshooting",
] as const;

for (const route of HELP_ROUTES) {
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
  const logo = page.locator(".VPNavBarTitle img");
  await expect(logo).toBeVisible();
  await expect
    .poll(() =>
      logo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  for (const name of [
    "Create your first event",
    "Open ProgramLoom (sign-in required)",
  ]) {
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

  if ((page.viewportSize()?.width ?? 1000) <= 640) {
    const undersizedControls = await page
      .locator(
        ".VPNav button, .VPNav a, .VPNavBarSearch button, .VPLocalNav button, .VPSidebar button, .VPSidebar a, .VPDocFooter a",
      )
      .evaluateAll((controls) =>
        controls
          .map((control) => {
            const bounds = control.getBoundingClientRect();
            return {
              name:
                control.getAttribute("aria-label") ?? control.textContent ?? "",
              width: bounds.width,
              height: bounds.height,
            };
          })
          .filter(
            (control) =>
              control.width > 0 &&
              control.height > 0 &&
              (control.width < 44 || control.height < 44),
          ),
      );
    expect(undersizedControls).toEqual([]);
  }
});

test("anonymous help crawler finds no broken links, redirects, or incomplete metadata", async ({
  request,
}) => {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const pending = ["/help/"];
  const visited = new Set<string>();
  const failures: string[] = [];

  while (pending.length) {
    const route = pending.shift()!;
    if (visited.has(route)) continue;
    visited.add(route);
    const response = await request.get(route, { maxRedirects: 0 });
    if (response.status() !== 200) {
      failures.push(`${route} returned ${response.status()}`);
      continue;
    }
    const html = await response.text();
    const expectedCanonical = `https://programloom.com${route === "/help/" ? route : route.replace(/\/$/, "")}`;
    const canonical = html.match(
      /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i,
    )?.[1];
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    const description = html.match(
      /<meta[^>]+name="description"[^>]+content="([^"]+)"/i,
    )?.[1];
    if (canonical !== expectedCanonical)
      failures.push(`${route} canonical is ${canonical ?? "missing"}`);
    if (!title || !title.includes("ProgramLoom"))
      failures.push(`${route} title is missing or incorrect`);
    if (!description?.trim()) failures.push(`${route} description is missing`);

    for (const match of html.matchAll(
      /<a\b([^>]*?)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi,
    )) {
      const href = match[2];
      const label = match[4]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (href.startsWith("/help/")) {
        const child = href.split("#")[0].replace(/\.html$/, "");
        if (!visited.has(child)) pending.push(child);
      }
      if (
        /^https:\/\/app\.programloom\.com\/app/.test(href) &&
        !/sign-in required/i.test(label)
      )
        failures.push(
          `${route} links to authenticated app without a label: ${label}`,
        );
      if (href.startsWith(origin)) {
        const child = new URL(href).pathname;
        if (child.startsWith("/help/") && !visited.has(child))
          pending.push(child);
      }
    }
  }

  expect(visited.size).toBeGreaterThanOrEqual(HELP_ROUTES.length);
  expect(failures).toEqual([]);
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

test("help pages expose route-accurate social metadata", async ({ page }) => {
  await page.goto("/help/getting-started");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://programloom.com/help/getting-started",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Create your first event | ProgramLoom Help",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://programloom.com/help/getting-started",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
});
