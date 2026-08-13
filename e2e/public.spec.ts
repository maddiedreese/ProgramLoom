import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

const widgetKeys = (process.env.PROGRAMLOOM_E2E_WIDGET_KEYS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

for (const route of [
  "/",
  "/guide",
  "/developers",
  "/login",
  "/privacy",
  "/terms",
  "/cfp",
  "/program",
  "/evaluate",
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

test("evaluator persona notes retain normal authorization routes", async ({
  page,
}) => {
  await page.goto("/evaluate");
  const applicationOrigin = process.env.PROGRAMLOOM_E2E_EXTERNAL_SERVER
    ? "https://app.programloom.com"
    : "";
  const expected = [
    [
      "Organizer",
      `/login?returnTo=/app/events/5c33f61d-3af6-41ff-8b2e-6268181001f8/control-room`,
    ],
    [
      "Reviewer",
      `/login?returnTo=/app/events/5c33f61d-3af6-41ff-8b2e-6268181001f8/reviews`,
    ],
    [
      "Speaker",
      `/login?returnTo=/app/events/5c33f61d-3af6-41ff-8b2e-6268181001f8/speaker`,
    ],
    ["Attendee", "/program"],
  ] as const;
  for (const [persona, href] of expected) {
    await expect(page.getByRole("heading", { name: persona })).toBeVisible();
    await expect(
      page.getByRole("link", { name: `Continue as ${persona}` }),
    ).toHaveAttribute(
      "href",
      persona === "Attendee" ? href : `${applicationOrigin}${href}`,
    );
  }
  await expect(
    page.getByText(/no public privileged session is created/i),
  ).toBeVisible();
});

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

test("public pages expose complete social and favicon metadata", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.svg",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/$/,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://programloom.com/programloom-og.jpg",
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
    "content",
    "1200",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  const [favicon, openGraph, twitter] = await Promise.all([
    request.get("/favicon.svg"),
    request.get("/programloom-og.jpg"),
    request.get("/programloom-twitter.jpg"),
  ]);
  expect(favicon.ok()).toBeTruthy();
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");
  expect(openGraph.ok()).toBeTruthy();
  expect(openGraph.headers()["content-type"]).toContain("image/jpeg");
  expect(twitter.ok()).toBeTruthy();
  expect(twitter.headers()["content-type"]).toContain("image/jpeg");
});

test("private pages opt out of search indexing", async ({ page }) => {
  const login = await page.goto("/login");
  expect(login?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
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

test("public routes reflow at 320 CSS pixels, zoom to 200%, and honor reduced motion", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name !== "desktop-1440x900") {
    expect(page.viewportSize()).toBeTruthy();
    return;
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Turn session ideas into a schedule people can trust.",
    }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expectNoHorizontalOverflow(page);
  await expect(
    page.getByRole("link", { name: /Create your first event/i }),
  ).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  for (const route of ["/", "/guide", "/developers", "/login", "/cfp"]) {
    await page.goto(route);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    const moving = await page.locator("*").evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.animationName !== "none" &&
            style.animationIterationCount === "infinite"
          );
        }).length,
    );
    expect(moving).toBe(0);
  }
});

test.describe("five production public widgets", () => {
  test.skip(
    widgetKeys.length !== 5,
    "Set PROGRAMLOOM_E2E_WIDGET_KEYS to the five production widget keys.",
  );

  test("all widget types expose complete public program records", async ({
    page,
    request,
  }) => {
    const seen = new Set<string>();
    for (const key of widgetKeys) {
      const response = await request.get(`/api/widgets/public/${key}`);
      expect(response.ok()).toBeTruthy();
      const payload = await response.json();
      expect(payload.event.name).toBe("ProgramLoom Summit 2027");
      seen.add(payload.widget.widgetType);
      expect(payload.sessions.length).toBeGreaterThanOrEqual(12);
      expect(payload.speakers.length).toBeGreaterThanOrEqual(15);
      expect(
        payload.sessions.every(
          (session: Record<string, unknown>) =>
            session.format && Array.isArray(session.speakerIds),
        ),
      ).toBe(true);
      expect(
        payload.agenda.every(
          (item: Record<string, unknown>) =>
            item.startsAt && item.endsAt && item.roomName && item.trackName,
        ),
      ).toBe(true);
      const surnames = payload.speakers.map(
        (speaker: { lastName: string }) => speaker.lastName,
      );
      expect(surnames).toEqual(
        [...surnames].sort((left, right) => left.localeCompare(right)),
      );
      expect(
        payload.speakers.every(
          (speaker: Record<string, unknown>) =>
            speaker.firstName &&
            speaker.lastName &&
            speaker.jobTitle &&
            speaker.company &&
            speaker.bio &&
            "headshotUrl" in speaker,
        ),
      ).toBe(true);

      const html = await page.goto(`/embed/${key}`);
      expect(html?.ok()).toBeTruthy();
      await expect(page.getByText("ProgramLoom Summit 2027")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
    }
    expect([...seen].sort()).toEqual(
      ["agenda", "gallery", "itinerary", "sessions", "speakers"].sort(),
    );
  });

  test("machine-readable and embed outputs have valid content contracts", async ({
    request,
  }) => {
    const key = widgetKeys[0];
    const [json, xml, ics, javascript] = await Promise.all([
      request.get(`/api/widgets/public/${key}/feed.json`),
      request.get(`/api/widgets/public/${key}/feed.xml`),
      request.get(`/api/widgets/public/${key}/agenda.ics`),
      request.get(`/api/widgets/public/${key}/embed.js`),
    ]);
    expect(json.ok()).toBeTruthy();
    expect(json.headers()["content-type"]).toContain("application/json");
    expect((await json.json()).event.name).toBe("ProgramLoom Summit 2027");
    expect(xml.ok()).toBeTruthy();
    expect(xml.headers()["content-type"]).toContain("application/xml");
    expect(await xml.text()).toContain("<programloom>");
    expect(ics.ok()).toBeTruthy();
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const calendar = await ics.text();
    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).toContain("END:VCALENDAR");
    expect(javascript.ok()).toBeTruthy();
    expect(javascript.headers()["content-type"]).toContain(
      "application/javascript",
    );
    expect(await javascript.text()).toContain('createElement("iframe")');
  });

  test("itinerary add, persistence, removal, and export stay visible", async ({
    page,
  }) => {
    const key = widgetKeys.find((value) => value.startsWith("itinerary-"))!;
    await page.goto(`/embed/${key}`);
    const add = page.getByRole("button", { name: /^Add / }).first();
    await expect(add).toBeVisible();
    const label = await add.getAttribute("aria-label");
    await add.click();
    await page.reload();
    const remove = page.getByRole("button", {
      name: label!.replace(/^Add to /, "Remove from "),
    });
    await expect(remove).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export my ICS" }),
    ).toBeEnabled();
    await remove.click();
    await expect(page.getByRole("button", { name: label! })).toBeVisible();
  });
});
