import { describe, expect, it } from "vitest";
import {
  demoteAgendaForUnapprovedContentStatement,
  uniqueCurrentExportRows,
} from "./content";

describe("content export selection", () => {
  it("keeps every selected logical file even when storage objects are shared", () => {
    expect(
      uniqueCurrentExportRows([
        { id: "slides", r2Key: "event/slides-v2.pdf" },
        { id: "corrupt-alias", r2Key: "event/slides-v2.pdf" },
        { id: "headshot", r2Key: "event/headshot-v4.png" },
      ]),
    ).toEqual([
      { id: "slides", r2Key: "event/slides-v2.pdf" },
      { id: "corrupt-alias", r2Key: "event/slides-v2.pdf" },
      { id: "headshot", r2Key: "event/headshot-v4.png" },
    ]);
  });

  it("removes returned content from published agenda state", () => {
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

    demoteAgendaForUnapprovedContentStatement(db, "submission-1", "event-1");

    expect(observed.sql).toContain("status='draft'");
    expect(observed.sql).toContain("status='published'");
    expect(observed.bindings).toEqual(["submission-1", "event-1"]);
  });
});
