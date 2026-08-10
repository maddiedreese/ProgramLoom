import { describe, expect, it } from "vitest";
import {
  publishedAgendaItemAuditStatements,
  requiresExplicitReschedule,
} from "./agenda";

describe("agenda publication audits", () => {
  it("emits one Airtable-addressable audit for every real agenda item id", () => {
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

    const statements = publishedAgendaItemAuditStatements(
      db,
      {
        organizationId: "organization-id",
        eventId: "event-id",
        actorUserId: "user-id",
        requestId: "request-id",
      },
      ["agenda-item-1", "agenda-item-2"],
    );

    expect(statements).toHaveLength(2);
    expect(prepared.map((record) => record.bindings[4])).toEqual([
      "agenda_item.published",
      "agenda_item.published",
    ]);
    expect(prepared.map((record) => record.bindings[5])).toEqual([
      "agenda_item",
      "agenda_item",
    ]);
    expect(prepared.map((record) => record.bindings[6])).toEqual([
      "agenda-item-1",
      "agenda-item-2",
    ]);
  });

  it("requires an explicit action before restoring a cancelled session", () => {
    expect(requiresExplicitReschedule("2026-08-10T01:00:00.000Z", false)).toBe(
      true,
    );
    expect(requiresExplicitReschedule("2026-08-10T01:00:00.000Z", true)).toBe(
      false,
    );
    expect(requiresExplicitReschedule(null, false)).toBe(false);
  });
});
