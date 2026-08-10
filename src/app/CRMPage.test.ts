import { describe, expect, it } from "vitest";
import { canSaveCrmSegment } from "./CRMPage";

const empty = { companies: [], jobTitles: [], tags: [] };

describe("CRM segment availability", () => {
  it("supports dynamic filters and curated selections", () => {
    expect(canSaveCrmSegment(empty, 0)).toBe(false);
    expect(canSaveCrmSegment({ ...empty, search: "architect" }, 0)).toBe(true);
    expect(canSaveCrmSegment({ ...empty, companies: ["Gather Well"] }, 0)).toBe(
      true,
    );
    expect(canSaveCrmSegment(empty, 2)).toBe(true);
  });
});
