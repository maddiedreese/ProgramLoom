import { describe, expect, it } from "vitest";
import { airtableConflictRetryStatement } from "./integrations";

describe("Airtable conflict retry", () => {
  it("keeps the conflict open until the queue worker confirms recovery", () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(nextSql: string) {
        sql = nextSql;
        return {
          bind(...nextBindings: unknown[]) {
            bindings = nextBindings;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    airtableConflictRetryStatement(
      db,
      "organization-id",
      "speaker_task",
      "task-id:speaker-id",
    );

    expect(sql).toContain("UPDATE integration_outbox");
    expect(sql).not.toContain("UPDATE integration_conflicts");
    expect(bindings).toEqual([
      "organization-id",
      "speaker_task",
      "task-id:speaker-id",
    ]);
  });
});
