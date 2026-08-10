import { describe, expect, it } from "vitest";
import { issuesSql } from "./control-room";

describe("Control Room accepted-session categories", () => {
  it("excludes sessions that were withdrawn after an accepted decision", () => {
    const acceptedCategories = issuesSql
      .split(/\n\s*UNION ALL\n/)
      .filter((query) => query.includes("decision_state='accepted'"));
    expect(acceptedCategories.length).toBeGreaterThan(0);
    expect(
      acceptedCategories.every((query) => query.includes("s.status='accepted'")),
    ).toBe(true);
  });
});
