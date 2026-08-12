import { describe, expect, it } from "vitest";
import { cancelledSessionAgendaStatement } from "./developer-api";

describe("developer API session lifecycle", () => {
  it("cancels placements using a schema-valid draft state", () => {
    const observed: { sql?: string; bindings?: unknown[] } = {};
    const db = {
      prepare(sql: string) {
        observed.sql = sql;
        return {
          bind(...bindings: unknown[]) {
            observed.bindings = bindings;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    cancelledSessionAgendaStatement(
      db,
      "submission-1",
      "2026-08-12T12:00:00.000Z",
    );

    expect(observed.sql).toContain("status='draft'");
    expect(observed.sql).not.toContain("status='cancelled'");
    expect(observed.sql).toContain("version=version+1");
    expect(observed.bindings).toEqual([
      "2026-08-12T12:00:00.000Z",
      "2026-08-12T12:00:00.000Z",
      "submission-1",
    ]);
  });
});
