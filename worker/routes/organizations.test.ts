import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { app } from "../index";

const userId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const eventId = "00000000-0000-4000-8000-000000000003";

function environment(role: "owner" | "member") {
  return {
    APP_ENV: "test",
    APP_URL: "https://app.example.test",
    MARKETING_URL: "https://example.test",
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...next: unknown[]) {
            values = next;
            return this;
          },
          async first() {
            if (sql.includes("FROM auth_sessions"))
              return {
                id: userId,
                email: "participant@example.test",
                name: "Participant",
              };
            if (sql.includes("FROM organization_members")) return { role };
            return null;
          },
          async all() {
            if (role === "member") {
              expect(sql).toContain("JOIN event_members");
              expect(values).toEqual([userId, organizationId]);
            } else {
              expect(sql).not.toContain("JOIN event_members");
              expect(values).toEqual([role, organizationId]);
            }
            return {
              results: [
                {
                  id: eventId,
                  name: "Assigned Program",
                  accessRole: role === "member" ? "speaker" : "owner",
                },
              ],
            };
          },
        };
      },
    },
  } as unknown as Env;
}

describe("organization event listing", () => {
  it.each(["member", "owner"] as const)(
    "scopes the %s event list at the database query",
    async (role) => {
      const response = await app.request(
        `/api/organizations/${organizationId}/events`,
        { headers: { cookie: "programloom_session=fixture-session" } },
        environment(role),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        events: [{ id: eventId }],
      });
    },
  );
});
