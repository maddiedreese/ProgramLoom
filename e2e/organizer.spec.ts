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
      { path: "control-room", heading: "What is blocking this program?" },
      {
        path: "communications",
        heading: "Preview every recipient. Send with confidence.",
      },
      { path: "submissions", heading: "Find and move proposals forward." },
      {
        path: "calendar",
        heading: "Send invitations that update instead of duplicate.",
      },
    ];

    for (const surface of surfaces) {
      const response = await page.goto(
        `/app/events/${eventId}/${surface.path}`,
      );
      expect(response?.ok()).toBeTruthy();
      await expect(
        page.getByRole("heading", { name: surface.heading, level: 1 }),
      ).toBeVisible();
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

  test("required workflow controls are explicit and reachable", async ({
    page,
  }) => {
    await page.goto(`/app/events/${eventId}/submissions`);
    const openSubmission = page
      .getByRole("button", { name: /Open submission:/ })
      .first();
    if (await openSubmission.count())
      await expect(openSubmission).toBeVisible();
    else {
      await expect(page.getByText("No matching proposals")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Open call for proposals" }),
      ).toBeVisible();
    }

    await page.goto(`/app/events/${eventId}/reviews`);
    await expect(
      page.getByRole("button", { name: "Go to reviewer assignment" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Assign reviewers" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save review round settings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Save .+ reviewer pool$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Review progress and aggregate results",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Send each proposal to the right review path.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create routing rule" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run routing" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Current proposal impact" }),
    ).toBeVisible();

    await page.goto(`/app/events/${eventId}/speakers`);
    await expect(
      page.getByRole("link", { name: "Invite speaker" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add speaker", exact: true }),
    ).toBeVisible();
    const editSpeaker = page
      .getByRole("link", { name: "Edit speaker profile" })
      .first();
    if (await editSpeaker.count()) await expect(editSpeaker).toBeVisible();
    else
      await expect(
        page.getByText("No speakers match these filters."),
      ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Import speakers" }),
    ).toBeVisible();
    await expect(page.getByLabel("Filter speaker status")).toBeVisible();
    await expect(page.getByLabel("Program status").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preview sanitized resource" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save approved domains" }),
    ).toBeVisible();

    await page.goto(`/app/events/${eventId}/content`);
    await page.getByRole("button", { name: "Session content" }).click();
    const contentRecord = page.locator(".content-record-card").first();
    if (await contentRecord.count()) {
      await contentRecord.click();
      await expect(
        page.getByRole("link", { name: "Schedule session" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Close session editor" }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { name: "No session content to review yet" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Open proposals" }),
      ).toBeVisible();
    }

    await page.goto(`/app/events/${eventId}/agenda`);
    await expect(
      page.getByRole("button", { name: "Build schedule automatically" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish agenda" }),
    ).toBeVisible();
    for (const view of ["List", "Day", "Week", "Track", "Room"])
      await expect(
        page.getByRole("button", { name: view, exact: true }),
      ).toBeVisible();
    await page.getByRole("button", { name: "Track", exact: true }).click();
    await expect(page).toHaveURL(/view=track/);
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(page).toHaveURL(/view=day/);
    const draggableSession = page
      .getByRole("button", { name: /^Drag .+ (to another|into the)/ })
      .first();
    if (await draggableSession.count()) {
      await expect(draggableSession).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Cancel session:/ }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Clear placement for/ }).first(),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();
    } else {
      await expect(
        page.getByText("No scheduled sessions match this view."),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Add an accepted session" }),
      ).toBeVisible();
    }

    await page.goto(`/app/events/${eventId}/calendar`);
    const sendCalendar = page
      .getByRole("button", { name: /Send calendar (invitation|update)/ })
      .first();
    if ((await sendCalendar.count()) === 0) {
      const reschedule = page
        .getByRole("button", { name: "Explicitly reschedule" })
        .first();
      if (await reschedule.count()) {
        await expect(reschedule).toBeVisible();
        page.once("dialog", (dialog) => dialog.accept());
        await reschedule.click();
        await expect(sendCalendar).toBeVisible();
      } else {
        await expect(
          page.getByRole("heading", { name: "No participant invitations yet" }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Schedule a session" }),
        ).toBeVisible();
      }
    }
    if (await sendCalendar.count()) {
      await expect(sendCalendar).toBeVisible();
      await expect(
        page
          .getByRole("button", { name: "Cancel calendar invitation" })
          .first(),
      ).toBeVisible();
    }

    await page.goto(`/app/events/${eventId}/communications`);
    await expect(page.getByRole("tab", { name: "Compose" })).toBeVisible();
    await page.getByRole("tab", { name: "Compose" }).click();
    await expect(
      page.getByRole("button", { name: "Preview recipients" }),
    ).toBeVisible();

    await page.goto(`/app/events/${eventId}/widgets`);
    await expect
      .poll(() =>
        page.locator(".widget-config-list article em").allTextContents(),
      )
      .toEqual(
        expect.arrayContaining([
          "sessions",
          "speakers",
          "agenda",
          "itinerary",
          "gallery",
        ]),
      );
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);

    await page.goto("/app/settings?tab=tokens");
    await expect(
      page.getByRole("heading", { name: "Developer platform" }),
    ).toBeVisible();
    for (const tab of ["API tokens", "Webhooks", "OAuth clients"])
      await expect(page.getByRole("button", { name: tab })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Read API guide" }),
    ).toHaveAttribute("href", "/developers");
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
