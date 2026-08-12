import { describe, expect, it } from "vitest";
import {
  agendaPublicationEligibilitySql,
  directPlacementSchema,
  eventActivationStatement,
  publishedAgendaItemAuditStatements,
  requiresExplicitReschedule,
  sessionSpeakersSchema,
} from "./agenda";

describe("agenda publication audits", () => {
  it("publishes breaks plus accepted sessions with approved content only", () => {
    const predicate = agendaPublicationEligibilitySql("agenda_items");
    expect(predicate).toContain("agenda_items.submission_id IS NULL");
    expect(predicate).toContain("eligibleSubmission.status='accepted'");
    expect(predicate).toContain(
      "eligibleSubmission.event_id=agenda_items.event_id",
    );
    expect(predicate).toContain("eligibleContent.status='approved'");
  });
  it("validates a bounded atomic direct placement payload", () => {
    expect(
      directPlacementSchema.parse({
        submissionId: "00000000-0000-4000-8000-000000000001",
        roomId: "00000000-0000-4000-8000-000000000002",
        trackId: null,
        startsAt: "2026-11-02T09:00:00-08:00",
        endsAt: "2026-11-02T09:45:00-08:00",
      }),
    ).toMatchObject({ trackId: null });
  });
  it("activates a draft event when its conflict-free agenda is published", () => {
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

    eventActivationStatement(db, "event-id");

    expect(prepared[0]).toMatchObject({
      sql: "UPDATE events SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'",
      bindings: ["event-id"],
    });
  });

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

  it("bounds agenda speaker assignments to a non-empty event roster selection", () => {
    const speakerId = "67ab6d64-93fb-45f8-8f6f-1cc0d358c327";
    expect(sessionSpeakersSchema.parse({ speakerIds: [speakerId] })).toEqual({
      speakerIds: [speakerId],
    });
    expect(() => sessionSpeakersSchema.parse({ speakerIds: [] })).toThrow();
    expect(() =>
      sessionSpeakersSchema.parse({ speakerIds: ["not-a-speaker-id"] }),
    ).toThrow();
    expect(() =>
      sessionSpeakersSchema.parse({ speakerIds: Array(25).fill(speakerId) }),
    ).toThrow();
  });
});
