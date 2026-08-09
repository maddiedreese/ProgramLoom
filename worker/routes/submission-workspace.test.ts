import { describe, expect, it } from "vitest";
import {
  querySchema,
  safeSpreadsheetText,
  viewConfigSchema,
} from "./submission-workspace";

describe("submission workspace contracts", () => {
  it("accepts combined bounded filters and rejects unbounded pages", () => {
    const parsed = querySchema.parse({
      filters: {
        formIds: ["form-1"],
        statuses: ["pending"],
        trackIds: ["track-1"],
        formats: ["talk"],
        reviewerIds: ["reviewer-1"],
        roundIds: ["round-1"],
        reviewCompletion: "incomplete",
        decisionStates: ["none"],
        notificationStates: ["not_prepared"],
        tagIds: ["tag-1"],
        custom: [
          { fieldId: "field-1", operator: "contains", value: "systems" },
        ],
      },
      sort: { field: "averageScore", direction: "desc" },
      page: 2,
      pageSize: 100,
    });
    expect(parsed.filters.custom).toHaveLength(1);
    expect(() => querySchema.parse({ pageSize: 101 })).toThrow();
  });

  it("persists accessible column order and neutralizes spreadsheet formulas", () => {
    const parsed = viewConfigSchema.parse({
      columns: [
        { id: "title", visible: true, width: 320 },
        { id: "field:field-1", visible: false, width: 180 },
      ],
      filters: {},
      sort: { field: "submittedAt", direction: "desc" },
      pageSize: 50,
    });
    expect(parsed.columns.map((column) => column.id)).toEqual([
      "title",
      "field:field-1",
    ]);
    expect(safeSpreadsheetText('=HYPERLINK("bad")')).toBe(
      '\'=HYPERLINK("bad")',
    );
    expect(safeSpreadsheetText("  +1+1")).toBe("'  +1+1");
    expect(safeSpreadsheetText("ProgramLoom")).toBe("ProgramLoom");
  });
});
