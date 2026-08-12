import { describe, expect, it } from "vitest";
import {
  acceptedSpeakerFileRequestStatement,
  eventChangeNeedsCalendarSync,
  updateEventStatement,
} from "./events";

describe("event updates", () => {
  it("persists lifecycle status and avoids calendar work for status-only changes", () => {
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

    updateEventStatement(
      db,
      {
        name: "ProgramLoom Summit",
        timezone: "America/Los_Angeles",
        startsAt: "2027-05-01T16:00:00.000Z",
        endsAt: "2027-05-03T23:00:00.000Z",
        venueName: "Harbor Center",
        websiteUrl: "https://example.com",
        status: "archived",
      },
      "event-id",
    );

    expect(sql).toContain("website_url=?,status=?");
    expect(bindings.at(-2)).toBe("archived");
    expect(bindings.at(-1)).toBe("event-id");
    expect(eventChangeNeedsCalendarSync({ status: "archived" })).toBe(false);
    expect(
      eventChangeNeedsCalendarSync({ websiteUrl: "https://new.test" }),
    ).toBe(false);
    expect(eventChangeNeedsCalendarSync({ name: "New event name" })).toBe(true);
  });
});

describe("accepted speaker onboarding", () => {
  it("creates an idempotent upload record for a file-request task", () => {
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

    acceptedSpeakerFileRequestStatement(db, {
      id: "file-id",
      organizationId: "organization-id",
      eventId: "event-id",
      submissionId: "submission-id",
      speakerId: "speaker-id",
      taskId: "task-id",
      purpose: "Upload final slides",
    });

    expect(sql).toContain("INSERT INTO files");
    expect(sql).toContain("WHERE NOT EXISTS");
    expect(sql).toContain("event_id=? AND speaker_id=? AND task_id=?");
    expect(bindings).toEqual([
      "file-id",
      "organization-id",
      "event-id",
      "submission-id",
      "speaker-id",
      "task-id",
      "Upload final slides",
      "event-id",
      "speaker-id",
      "task-id",
    ]);
  });
});
