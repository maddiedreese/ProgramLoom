import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { createOverdueTaskNotificationsAndDispatchEmails } from "./notifications";

describe("scheduled speaker reminders", () => {
  it("creates overdue notifications before dispatching eligible emails", async () => {
    const operations: string[] = [];
    let taskQuery = "";
    const env = {
      DB: {
        prepare(sql: string) {
          if (sql.includes("FROM onboarding_tasks")) taskQuery = sql;
          operations.push(
            sql.includes("FROM onboarding_tasks")
              ? "find-overdue-tasks"
              : "find-email-notifications",
          );
          return {
            async all() {
              return { results: [] };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(
      createOverdueTaskNotificationsAndDispatchEmails(env),
    ).resolves.toEqual({
      notifications: { createdFor: 0 },
      emails: { prepared: 0, queued: 0 },
    });
    expect(operations).toEqual([
      "find-overdue-tasks",
      "find-email-notifications",
    ]);
    expect(taskQuery).toContain("datetime('now','+24 hours')");
    expect(taskQuery).toContain("due_soon");
  });
});
