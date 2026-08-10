import { describe, expect, it } from "vitest";
import { widgetRemovalStatements } from "./widgets";

describe("widget deletion", () => {
  it("scopes the delete and retains an audited before state", () => {
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const record = { sql, bindings: [] as unknown[] };
        prepared.push(record);
        return {
          bind(...bindings: unknown[]) {
            record.bindings = bindings;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    const statements = widgetRemovalStatements(db, {
      widgetId: "widget-1",
      eventId: "event-1",
      organizationId: "organization-1",
      actorUserId: "user-1",
      requestId: "request-1",
      before: {
        name: "Old sessions widget",
        widgetType: "sessions",
        publicKey: "sessions-old",
      },
    });

    expect(statements).toHaveLength(2);
    expect(prepared[0]).toMatchObject({
      sql: "DELETE FROM widget_configs WHERE id=? AND event_id=?",
      bindings: ["widget-1", "event-1"],
    });
    expect(prepared[1].bindings).toContain("widget.deleted");
    expect(prepared[1].bindings).toContain("widget_config");
    expect(prepared[1].bindings).toContain("widget-1");
    expect(prepared[1].bindings).toContain(
      JSON.stringify({
        name: "Old sessions widget",
        widgetType: "sessions",
        publicKey: "sessions-old",
      }),
    );
  });
});
