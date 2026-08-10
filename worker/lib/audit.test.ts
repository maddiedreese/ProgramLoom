import { describe, expect, it } from "vitest";
import { auditStatement } from "./audit";

describe("audit statements", () => {
  it("persists system mutations with a correlation id and no actor", () => {
    let sql = "";
    let values: unknown[] = [];
    const db = {
      prepare(nextSql: string) {
        sql = nextSql;
        return {
          bind(...nextValues: unknown[]) {
            values = nextValues;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    auditStatement(db, {
      organizationId: "organization-id",
      eventId: "event-id",
      action: "communication.provider_status",
      entityType: "communication",
      entityId: "message-id",
      before: { status: "sent" },
      after: { status: "delivered" },
      requestId: "provider-event-id",
      correlationId: "correlation-id",
    });

    expect(sql).toContain("correlation_id");
    expect(sql.match(/\?/g) ?? []).toHaveLength(values.length);
    expect(values).toHaveLength(11);
    expect(values[3]).toBeNull();
    expect(values.at(-1)).toBe("correlation-id");
  });
});
