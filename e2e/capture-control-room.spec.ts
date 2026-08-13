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
          name: "Jordan Alvarez",
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
          submissions_new: 6,
          routing_unmatched: 5,
          reviewer_assignment: 5,
          review_conflicts: 1,
          reviews_incomplete: 2,
          decisions_pending: 0,
          decisions_uncommunicated: 1,
          deliveries: 24,
          portal_access: 12,
          onboarding: 36,
          assets: 23,
          content_review: 0,
          public_exclusions: 0,
          agenda_missing: 0,
          schedule_conflicts: 1,
          agenda_unpublished: 1,
          queue_failures: 14,
          airtable_sync: 0,
          integration_failures: 0,
          webhook_failures: 0,
        },
        severityCounts: { blocking: 57, warning: 60, info: 14 },
        total: 131,
        owners: [{ id: "controlled-organizer", name: "Jordan Alvarez" }],
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
            "28 submitted proposals",
            "Manage CFP",
            "collect-proposals",
            0,
          ],
          [
            "Review proposals",
            "Blocked",
            "2 of 4 assigned reviews complete",
            "Assign reviewers",
            "reviews",
            6,
          ],
          [
            "Make decisions",
            "Complete",
            "2 of 2 reviewed proposals decided",
            "Stage decision",
            "decisions",
            0,
          ],
          [
            "Prepare speakers",
            "Blocked",
            "10 of 15 accepted speakers ready",
            "Prepare speakers",
            "speakers",
            5,
          ],
          [
            "Approve content",
            "Blocked",
            "13 of 13 accepted sessions approved",
            "Approve content",
            "content",
            1,
          ],
          [
            "Build the agenda",
            "Blocked",
            "13 of 13 approved sessions placed",
            "Schedule session",
            "agenda",
            1,
          ],
          [
            "Publish the program",
            "Blocked",
            "13 of 13 placed sessions published",
            "Publish agenda",
            "publish",
            1,
          ],
        ].map(
          (
            [label, state, countLabel, primaryAction, key, blockerCount],
            index,
          ) => ({
            number: index + 1,
            key,
            label,
            state,
            count: Number(String(countLabel).match(/\d+/)?.[0] ?? 0),
            total: Number(String(countLabel).match(/of (\d+)/)?.[1] ?? 1),
            countLabel,
            blockerCount,
            primaryAction,
            actionUrl: `/app/events/${eventId}/${key === "collect-proposals" ? "cfp" : key === "decisions" ? "submissions" : key === "publish" ? "agenda" : key}`,
          }),
        ),
        recommendations: [
          {
            category: "submissions_new",
            actionLabel: "Open proposals",
            reason: "New proposals are waiting for organizer triage.",
            affectedRecordCount: 6,
            actionUrl: `/app/events/${eventId}/submissions`,
          },
          {
            category: "routing_unmatched",
            actionLabel: "Run routing",
            reason:
              "Submitted proposals do not match an active reviewer-routing rule.",
            affectedRecordCount: 5,
            actionUrl: `/app/events/${eventId}/reviews?routing=1`,
          },
          {
            category: "reviewer_assignment",
            actionLabel: "Assign reviewers",
            reason: "Submitted proposals have no active reviewer assignment.",
            affectedRecordCount: 5,
            actionUrl: `/app/events/${eventId}/reviews`,
          },
          {
            category: "review_conflicts",
            actionLabel: "Resolve reviewer conflicts",
            reason: "Reviewer conflicts or recusals need organizer action.",
            affectedRecordCount: 1,
            actionUrl: `/app/events/${eventId}/reviews?conflicts=1`,
          },
        ],
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
            ownerName: "Jordan Alvarez",
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
