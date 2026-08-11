import { describe, expect, it } from "vitest";
import {
  canSaveCrmSegment,
  defaultCrmSegmentType,
  reconcileCrmSelection,
  resolveCrmOrganization,
  resolveHandoffContacts,
} from "./CRMPage";

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

  it("defaults explicit selections to an exact curated segment", () => {
    expect(defaultCrmSegmentType(3)).toBe("curated");
    expect(defaultCrmSegmentType(0)).toBe("dynamic");
  });

  it("preserves valid selections across live refreshes", () => {
    expect(
      reconcileCrmSelection(
        ["contact-1", "removed"],
        [{ id: "contact-1" }, { id: "contact-2" }],
      ),
    ).toEqual(["contact-1"]);
  });

  it("shows every contact when event handoff opens without row selection", () => {
    const contacts = [{ id: "contact-1" }, { id: "contact-2" }];
    expect(resolveHandoffContacts(contacts, [])).toEqual(contacts);
    expect(resolveHandoffContacts(contacts, ["contact-2"])).toEqual([
      { id: "contact-2" },
    ]);
  });

  it("uses the target event workspace for speaker handoff", () => {
    const organizations = [{ id: "other" }, { id: "event-workspace" }];
    expect(resolveCrmOrganization(organizations, null, "event-workspace")).toBe(
      "event-workspace",
    );
    expect(resolveCrmOrganization(organizations, "other", null)).toBe("other");
  });
});
