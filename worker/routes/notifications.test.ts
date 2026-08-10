import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { app } from "../index";

const userId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const eventId = "00000000-0000-4000-8000-000000000003";

function database() {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) {
          values = next;
          return this;
        },
        async first() {
          if (sql.includes("FROM auth_sessions"))
            return { id: userId, email: "owner@example.test", name: "Owner" };
          if (sql.includes("SUM(CASE WHEN n.read_at"))
            return { total: 1, unread: 1 };
          if (sql.includes("SELECT COUNT(*) unread FROM notifications"))
            return { unread: 1 };
          if (sql.includes("CASE") && sql.includes("FROM events e"))
            return null;
          if (sql.includes("SELECT id FROM notifications")) return null;
          return null;
        },
        async all() {
          if (sql.includes("FROM notifications n LEFT JOIN events")) {
            expect(values[0]).toBe(userId);
            return {
              results: [
                {
                  id: "notification-1",
                  organizationId,
                  eventId,
                  eventName: "Program",
                  category: "review",
                  notificationType: "review.completed",
                  severity: "info",
                  title: "Review completed",
                  body: "A scorecard is ready.",
                  actionUrl: `/app/events/${eventId}/reviews`,
                  occurrenceCount: 1,
                  readAt: null,
                },
              ],
            };
          }
          if (sql.includes("FROM events e"))
            return {
              results: [{ id: eventId, name: "Program", organizationId }],
            };
          if (sql.includes("FROM organizations o"))
            return { results: [{ id: organizationId, name: "Programs" }] };
          return { results: [] };
        },
        async run() {
          return { meta: { changes: 0 } };
        },
      };
    },
  } as unknown as D1Database;
}

const env = {
  APP_ENV: "test",
  APP_URL: "https://app.example.test",
  MARKETING_URL: "https://example.test",
  DB: database(),
} as unknown as Env;

describe("notification routes", () => {
  it("returns only the authenticated recipient's bounded notification page", async () => {
    const response = await app.request(
      "/api/notifications?pageSize=25",
      { headers: { cookie: "programloom_session=fixture-session" } },
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      unread: 1,
      globalUnread: 1,
      notifications: [{ id: "notification-1", category: "review" }],
    });
  });

  it("fails closed for a preference scope outside the user's events", async () => {
    const response = await app.request(
      `/api/notifications/preferences?organizationId=${organizationId}&eventId=${eventId}`,
      { headers: { cookie: "programloom_session=fixture-session" } },
      env,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "event_not_found" },
    });
  });

  it("does not allow a user to mutate another recipient's notification", async () => {
    const response = await app.request(
      "/api/notifications/someone-elses-notification",
      {
        method: "PATCH",
        headers: {
          cookie: "programloom_session=fixture-session",
          "content-type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      },
      env,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "notification_not_found" },
    });
  });
});
