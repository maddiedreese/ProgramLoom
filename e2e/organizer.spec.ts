import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

const eventId = process.env.PROGRAMLOOM_E2E_EVENT_ID;
const hasAuth = Boolean(process.env.PROGRAMLOOM_E2E_STORAGE_STATE && eventId);
const reviewerStorage = process.env.PROGRAMLOOM_E2E_REVIEWER_STORAGE_STATE;
const speakerStorage = process.env.PROGRAMLOOM_E2E_SPEAKER_STORAGE_STATE;
const baseURL =
  process.env.PROGRAMLOOM_E2E_URL ?? "https://app.programloom.com";

test.describe("authenticated organizer operations", () => {
  test.skip(
    !hasAuth,
    "Provide an ignored organizer storage state and disposable event id.",
  );

  test("core operational surfaces load with persisted data", async ({
    page,
  }) => {
    const surfaces = [
      { path: "control-room", marker: /Organizer Control Room/i },
      { path: "communications", marker: /Communications/i },
      { path: "submissions", marker: /Submissions/i },
      { path: "calendar", marker: /Calendar/i },
    ];

    for (const surface of surfaces) {
      const response = await page.goto(
        `/app/events/${eventId}/${surface.path}`,
      );
      expect(response?.ok()).toBeTruthy();
      await expect(page.getByText(surface.marker).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
    }
  });

  test("command palette and notifications are keyboard operable", async ({
    page,
  }) => {
    await page.goto(`/app/events/${eventId}`);
    await expect(
      page.getByRole("button", { name: /Search and commands/i }),
    ).toBeVisible();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+K" : "Control+K",
    );
    const search = page.getByRole("combobox", { name: /search/i });
    await expect(search).toBeFocused();
    await search.fill("session");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    const bell = page.getByRole("button", { name: /Notifications/i });
    await bell.click();
    await expect(
      page.getByRole("dialog", { name: /Notifications/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bell).toBeFocused();
  });

  test("judge-first workflow controls are explicit and reachable", async ({
    page,
  }) => {
    await page.goto(`/app/events/${eventId}/submissions`);
    await expect(
      page.getByRole("button", { name: /Open submission:/ }).first(),
    ).toBeVisible();

    await page.goto(`/app/events/${eventId}/reviews`);
    await expect(
      page.getByRole("button", { name: "Go to reviewer assignment" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Assign reviewers" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save review window" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save reviewer pool" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Review progress and aggregate results",
      }),
    ).toBeVisible();

    await page.goto(`/app/events/${eventId}/speakers`);
    await expect(
      page.getByRole("link", { name: "Invite speaker" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add speaker", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Edit speaker profile" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Import speakers" }),
    ).toBeVisible();
    await expect(page.getByLabel("Filter speaker status")).toBeVisible();
    await expect(page.getByLabel("Program status").first()).toBeVisible();

    await page.goto(`/app/events/${eventId}/content`);
    await page.getByRole("button", { name: "Session content" }).click();
    await page.locator(".content-record-card").first().click();
    await expect(
      page.getByRole("link", { name: "Schedule session" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close session editor" }),
    ).toBeVisible();

    await page.goto(`/app/events/${eventId}/agenda`);
    await expect(
      page.getByRole("button", { name: "Build schedule automatically" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish agenda" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Cancel session:/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Clear placement for/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();

    await page.goto(`/app/events/${eventId}/calendar`);
    await expect(
      page
        .getByRole("button", { name: /Send calendar (invitation|update)/ })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel calendar invitation" }).first(),
    ).toBeVisible();

    await page.goto(`/app/events/${eventId}/communications`);
    await expect(page.getByRole("tab", { name: "Compose" })).toBeVisible();
    await page.getByRole("tab", { name: "Compose" }).click();
    await expect(
      page.getByRole("button", { name: "Preview recipients" }),
    ).toBeVisible();

    await page.goto(`/app/events/${eventId}/widgets`);
    await expect(
      page.getByRole("button", { name: "Delete widget" }),
    ).toHaveCount(5);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });

  test("reviewer and speaker land in isolated role workspaces", async ({
    browser,
  }) => {
    test.skip(
      !reviewerStorage || !speakerStorage,
      "Provide ignored reviewer and speaker storage states.",
    );
    const reviewer = await browser.newContext({
      baseURL,
      storageState: reviewerStorage,
    });
    const speaker = await browser.newContext({
      baseURL,
      storageState: speakerStorage,
    });
    try {
      const reviewerPage = await reviewer.newPage();
      await reviewerPage.goto(`/app/events/${eventId}/reviews`);
      await expect(
        reviewerPage.getByRole("heading", { name: "Your review queue" }),
      ).toBeVisible();
      const reviewerLifecycle = reviewerPage.getByRole("combobox", {
        name: "Event lifecycle",
      });
      if (await reviewerLifecycle.isVisible()) {
        await expect(reviewerLifecycle).toHaveValue("reviews");
        await expect(reviewerLifecycle.locator("option")).toHaveCount(1);
      } else {
        await expect(
          reviewerPage.getByRole("link", { name: "Reviews" }),
        ).toBeVisible();
      }
      await expect(
        reviewerPage.getByRole("link", { name: "Submissions" }),
      ).toHaveCount(0);
      await expectAccessible(reviewerPage);

      const speakerPage = await speaker.newPage();
      await speakerPage.goto(`/app/events/${eventId}/speakers`);
      await expect(
        speakerPage.getByRole("heading", { name: /^Welcome,/ }),
      ).toBeVisible();
      const speakerLifecycle = speakerPage.getByRole("combobox", {
        name: "Event lifecycle",
      });
      if (await speakerLifecycle.isVisible()) {
        await expect(speakerLifecycle).toHaveValue("speakers");
        await expect(speakerLifecycle.locator("option")).toHaveCount(1);
      } else {
        await expect(
          speakerPage.getByRole("link", { name: "Speakers" }),
        ).toBeVisible();
      }
      await expect(
        speakerPage.getByRole("link", { name: "Content", exact: true }),
      ).toHaveCount(0);
      await expectAccessible(speakerPage);
    } finally {
      await reviewer.close();
      await speaker.close();
    }
  });

  test("server authorization fails closed across events", async ({
    request,
  }) => {
    const unknownEvent = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    for (const path of [
      "control-room",
      "communications",
      "submissions/workspace",
    ]) {
      const response = await request.get(`/api/events/${unknownEvent}/${path}`);
      expect([403, 404]).toContain(response.status());
    }
    const unknownSpeaker = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const crossEventHeadshot = await request.get(
      `/api/speakers/admin/events/${unknownEvent}/speakers/${unknownSpeaker}/headshot`,
    );
    expect([403, 404]).toContain(crossEventHeadshot.status());
    const missingHeadshot = await request.get(
      `/api/speakers/admin/events/${eventId}/speakers/${unknownSpeaker}/headshot`,
    );
    expect(missingHeadshot.status()).toBe(404);
  });
});
