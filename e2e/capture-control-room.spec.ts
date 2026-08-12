import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

test("capture the current Control Room for public product documentation", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.PROGRAMLOOM_UPDATE_MARKETING_CAPTURE !== "1" ||
      testInfo.project.name !== "desktop-1440x900",
    "Run explicitly in the 1440×900 project to update the reviewed marketing capture.",
  );
  const eventId = "5c33f61d-3af6-41ff-8b2e-6268181001f8";
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "controlled-organizer",
          name: "Avery Chen",
          email: "organizer@example.com",
        },
      },
    }),
  );
  await page.route(`**/api/control-room/events/${eventId}*`, (route) =>
    route.fulfill({
      json: {
        event: { id: eventId, name: "ProgramLoom Summit 2027" },
        counts: {
          reviews_incomplete: 2,
          decisions_uncommunicated: 1,
          onboarding: 3,
          content_review: 1,
          agenda_unpublished: 1,
        },
        severityCounts: { blocking: 2, warning: 4, info: 1 },
        total: 7,
        owners: [{ id: "controlled-organizer", name: "Avery Chen" }],
        tracks: [
          { id: "track-1", name: "Engineering" },
          { id: "track-2", name: "Leadership" },
        ],
        pagination: { page: 1, pageSize: 50, total: 7 },
        refreshedAt: "2026-08-12T20:00:00.000Z",
        lifecycle: [
          [
            "Collect proposals",
            "Complete",
            "28 proposals collected",
            "Manage CFP",
            "collect-proposals",
          ],
          [
            "Review proposals",
            "In progress",
            "26 of 28 proposals reviewed",
            "Assign reviewers",
            "reviews",
          ],
          [
            "Make decisions",
            "Blocked",
            "27 of 28 decisions staged",
            "Stage decision",
            "decisions",
          ],
          [
            "Prepare speakers",
            "In progress",
            "12 of 15 speakers ready",
            "Prepare speakers",
            "speakers",
          ],
          [
            "Approve content",
            "In progress",
            "12 of 13 sessions approved",
            "Approve content",
            "content",
          ],
          [
            "Build the agenda",
            "Complete",
            "13 of 13 sessions placed",
            "Schedule session",
            "agenda",
          ],
          [
            "Publish the program",
            "In progress",
            "12 of 13 placements published",
            "Publish agenda",
            "publish",
          ],
        ].map(([label, state, countLabel, primaryAction, key], index) => ({
          number: index + 1,
          key,
          label,
          state,
          count: Number(String(countLabel).match(/\d+/)?.[0] ?? 0),
          total: Number(String(countLabel).match(/of (\d+)/)?.[1] ?? 1),
          countLabel,
          blockerCount: state === "Blocked" ? 1 : 0,
          primaryAction,
          actionUrl: `/app/events/${eventId}/${key === "collect-proposals" ? "cfp" : key === "decisions" ? "submissions" : key === "publish" ? "agenda" : key}`,
        })),
        items: [
          {
            category: "decisions_uncommunicated",
            entityType: "proposal",
            entityId: "proposal-1",
            title: "Resilient systems start with humane defaults",
            detail: "Acceptance is staged and ready for recipient preview.",
            severity: "blocking",
            status: "prepared",
            deadline: "2026-08-14T20:00:00.000Z",
            occurredAt: "2026-08-12T18:00:00.000Z",
            actionUrl: `/app/events/${eventId}/communications?status=prepared`,
            trackId: "track-1",
            ownerUserId: "controlled-organizer",
            ownerName: "Avery Chen",
          },
          {
            category: "content_review",
            entityType: "session",
            entityId: "session-1",
            title: "Designing reliable human handoffs",
            detail: "Updated deck and session description await approval.",
            severity: "warning",
            status: "submitted",
            deadline: "2026-08-16T20:00:00.000Z",
            occurredAt: "2026-08-12T17:00:00.000Z",
            actionUrl: `/app/events/${eventId}/content?status=in_review`,
            trackId: "track-2",
            ownerUserId: null,
            ownerName: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/notifications*", (route) =>
    route.fulfill({
      json: {
        notifications: [],
        total: 0,
        unread: 0,
        globalUnread: 0,
        organizations: [],
        events: [],
      },
    }),
  );

  await page.goto(`/app/events/${eventId}/control-room`);
  await expect(
    page.getByRole("heading", { name: "What is blocking this program?" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.screenshot({
    path: resolve("public/programloom-control-room.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: false,
  });
});
