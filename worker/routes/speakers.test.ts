import { describe, expect, it } from "vitest";
import {
  allowedUploadTypesForPurpose,
  assignAllFileTargets,
  submittedTaskAssignmentStatement,
} from "./speakers";

describe("speaker file-request assignment", () => {
  it("keeps slide decks out of headshot version history", () => {
    expect(allowedUploadTypesForPurpose("Speaker headshot")).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    expect(allowedUploadTypesForPurpose("Upload final slides")).toContain(
      "application/pdf",
    );
  });

  it("creates one deterministic target per accepted event speaker", async () => {
    const observed: { sql?: string; bindings?: unknown[] } = {};
    const db = {
      prepare(sql: string) {
        observed.sql = sql;
        return {
          bind(...bindings: unknown[]) {
            observed.bindings = bindings;
            return this;
          },
          async all() {
            return {
              results: [
                { speakerId: "speaker-1", submissionId: "submission-1" },
              ],
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await assignAllFileTargets(db, "event-1");

    expect(observed.sql).toContain("GROUP BY ss.speaker_id");
    expect(observed.sql).toContain("MIN(s.id) AS submissionId");
    expect(observed.bindings).toEqual(["event-1"]);
    expect(result.results).toHaveLength(1);
  });

  it("clears an old completion timestamp when replacement work is submitted", () => {
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

    submittedTaskAssignmentStatement(db, {
      taskId: "task-1",
      speakerId: "speaker-1",
      responseJson: '{"version":2}',
    });

    expect(observed.sql).toContain("completed_at=NULL");
    expect(observed.bindings).toEqual(['{"version":2}', "task-1", "speaker-1"]);
  });
});
