import { describe, expect, it } from "vitest";
import { acceptedSpeakerFileRequestStatement } from "./events";

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
