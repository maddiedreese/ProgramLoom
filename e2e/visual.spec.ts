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
  ["published-cfp", "/c/devflow-programs/programloom-summit-2027/cfp"],
  ["public-program", "/program"],
  ["evaluator-entry", "/evaluate"],
  ["sign-in", "/login"],
] as const) {
  test(`${name} visual baseline`, async ({ page }, testInfo) => {
    if (name === "sign-in") await page.context().clearCookies();
    if (name === "published-cfp") {
      await page.route("**/api/auth/session", (route) =>
        route.fulfill({ json: { user: null } }),
      );
      await page.route("**/api/public/cfp/**", (route) =>
        route.fulfill({
          json: {
            form: {
              name: "Call for proposals",
              description:
                "Share a practical session for teams building reliable, inclusive event programs.",
              eventName: "ProgramLoom Summit 2027",
              organizationName: "ProgramLoom Programs",
              timezone: "America/New_York",
              primaryColor: "#315d49",
              opensAt: null,
              closesAt: "2027-08-01T21:00:00.000Z",
              editClosesAt: "2027-08-01T21:00:00.000Z",
              allowDrafts: true,
              availability: "open",
            },
            fields: [
              {
                id: "abstract",
                section: "session",
                fieldType: "textarea",
                fieldKey: "abstract",
                label: "Session abstract",
                description:
                  "Explain the audience problem, practical approach, and intended outcome.",
                required: true,
                position: 1,
              },
            ],
            conditions: [],
          },
        }),
      );
    }
    if (name === "marketing" || name === "public-program") {
      await page.route("**/api/widgets/public/*", (route) => {
        const agendaWidget = route.request().url().includes("agenda-");
        const publicKey = agendaWidget
          ? "agenda-8b0020bb6481415f864a"
          : "sessions-bfdfc1515f0d4bf8aea4";
        return route.fulfill({
          json: {
            widget: {
              publicKey,
              name: "Summit sessions",
              widgetType: agendaWidget ? "agenda" : "sessions",
              config: {
                theme: "light",
                primaryColor: "#315d49",
                showSearch: true,
                showFilters: true,
                fields: [
                  "title",
                  "abstract",
                  "format",
                  "track",
                  "room",
                  "speakers",
                ],
              },
            },
            event: {
              id: "5c33f61d-3af6-41ff-8b2e-6268181001f8",
              name: "ProgramLoom Summit 2027",
              organizationName: "ProgramLoom Programs",
              timezone: "America/New_York",
              venueName: "Harbor Conference Center",
              startsAt: "2027-09-14T13:00:00.000Z",
              endsAt: "2027-09-16T22:00:00.000Z",
            },
            tracks: [
              {
                id: "community",
                name: "Community Systems",
                color: "#315d49",
              },
            ],
            sessions: [
              {
                id: "session-review-panels",
                title: "Building Sustainable Review Panels",
                abstract:
                  "A transparent approach to reviewer capacity, recusal, calibration, and consistent feedback across multiple rounds.",
                format: "Talk (30 min)",
                durationMinutes: 30,
                trackId: "community",
                speakerIds: ["mei", "jonah"],
                speakerNames: ["Mei Huang", "Jonah Ibrahim"],
              },
            ],
            speakers: [
              {
                id: "mei",
                firstName: "Mei",
                lastName: "Huang",
                pronouns: null,
                jobTitle: "Community Researcher",
                company: "Civic Stack",
                bio: "Mei builds inclusive review systems.",
                headshotUrl: null,
                social: {},
              },
              {
                id: "jonah",
                firstName: "Jonah",
                lastName: "Ibrahim",
                pronouns: null,
                jobTitle: "Program Design Lead",
                company: "Gathering Lab",
                bio: "Jonah designs durable program operations.",
                headshotUrl: null,
                social: {},
              },
            ],
            agenda: [
              {
                id: "agenda-review-panels",
                submissionId: "session-review-panels",
                trackId: "community",
                itemType: "session",
                title: "Building Sustainable Review Panels",
                description: "A transparent approach to reviewer capacity.",
                startsAt: "2027-09-14T18:00:00.000Z",
                endsAt: "2027-09-14T18:30:00.000Z",
                roomName: "Main Hall",
                trackName: "Community Systems",
                trackColor: "#315d49",
              },
            ],
          },
        });
      });
    }
    await page.goto(route);
    await page
      .locator(".loading-page")
      .waitFor({ state: "detached", timeout: 10_000 })
      .catch(() => undefined);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Loading ProgramLoom…")).toHaveCount(0);
    if (name === "sign-in") {
      await page
        .getByRole("button", { name: "Email me a secure link" })
        .evaluate((button: HTMLButtonElement) => {
          button.disabled = true;
        });
    }
    if (name === "marketing" || name === "public-program") {
      const widget = page.frameLocator("iframe").last();
      await expect(widget.locator("main")).toBeVisible();
      await expect(
        widget.getByText("Building Sustainable Review Panels"),
      ).toBeVisible();
      await widget.locator("body").evaluate((body) => {
        (body.ownerDocument.activeElement as HTMLElement | null)?.blur();
      });
    }
    if (name === "marketing") {
      await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
        await new Promise<void>((resolve, reject) => {
          video.addEventListener("loadedmetadata", () => resolve(), {
            once: true,
          });
          video.addEventListener(
            "error",
            () => reject(new Error("Walkthrough video metadata failed to load")),
            { once: true },
          );
        });
      });
    }
    if (!snapshotProject(testInfo.project.name)) return;
    await expect(page).toHaveScreenshot(
      `${name}-${testInfo.project.name}.png`,
      {
        animations: "disabled",
        fullPage: true,
        caret: "hide",
        // Chromium's native video controls can vary by a few antialiased pixels
        // even after metadata is stable; keep the rest of the page pixel-strict.
        maxDiffPixels: name === "marketing" ? 500 : 0,
        mask: [page.locator("[data-visual-dynamic]")],
      },
    );
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
      await page
        .locator(".loading-page")
        .waitFor({ state: "detached", timeout: 10_000 })
        .catch(() => undefined);
      await expect(page.getByText("Loading ProgramLoom…")).toHaveCount(0);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main").getByText(/^Loading/i)).toHaveCount(0);
      if (!snapshotProject(testInfo.project.name)) return;
      await expect(page).toHaveScreenshot(
        `organizer-${route}-${testInfo.project.name}.png`,
        {
          animations: "disabled",
          fullPage: true,
          caret: "hide",
          mask: [
            page.locator("time, [data-dynamic-time]"),
            page
              .locator("article")
              .filter({ hasText: "Last refreshed" })
              .locator("strong"),
          ],
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
      await page
        .locator(".loading-page")
        .waitFor({ state: "detached", timeout: 10_000 })
        .catch(() => undefined);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/^Loading/i)).toHaveCount(0);
      if (!snapshotProject(testInfo.project.name)) return;
      await expect(page).toHaveScreenshot(
        `widget-${key.split("-")[0]}-${testInfo.project.name}.png`,
        { animations: "disabled", fullPage: true, caret: "hide" },
      );
    });
  }
}
