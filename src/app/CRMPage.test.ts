import { describe, expect, it } from "vitest";
import { canSaveCrmSegment, reconcileCrmSelection } from "./CRMPage";

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

  it("preserves valid selections across live refreshes", () => {
    expect(
      reconcileCrmSelection(
        ["contact-1", "removed"],
        [{ id: "contact-1" }, { id: "contact-2" }],
      ),
    ).toEqual(["contact-1"]);
  });
});
