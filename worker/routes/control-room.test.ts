import { describe, expect, it } from "vitest";
import { issuesSql } from "./control-room";

describe("Control Room accepted-session categories", () => {
  it("excludes sessions that were withdrawn after an accepted decision", () => {
    const acceptedCategories = issuesSql
      .split(/\n\s*UNION ALL\n/)
      .filter((query) => query.includes("decision_state='accepted'"));
    expect(acceptedCategories.length).toBeGreaterThan(0);
    expect(
      acceptedCategories.every((query) =>
        query.includes("s.status='accepted'"),
      ),
    ).toBe(true);
  });

  it("emits one speaker blocker even when that speaker has several sessions", () => {
    const speakerCategories = issuesSql
      .split(/\n\s*UNION ALL\n/)
      .filter(
        (query) =>
          query.includes("'portal_access','speaker'") ||
          query.includes("'assets','speaker'"),
      );
    expect(speakerCategories).toHaveLength(2);
    expect(
      speakerCategories.every(
        (query) =>
          query.includes("FROM speaker_profiles sp") &&
          query.includes("EXISTS (") &&
          !query.includes("FROM submissions s JOIN session_speakers"),
      ),
    ).toBe(true);
  });

  it("surfaces submitted proposals that have no matching reviewer route", () => {
    const routingQuery = issuesSql
      .split(/\n\s*UNION ALL\n/)
      .find((query) => query.includes("'routing_unmatched'"));
    expect(routingQuery).toContain("review_routing_rules");
    expect(routingQuery).toContain("submission_routing_state");
    expect(routingQuery).toContain("s.status='pending'");
  });
});
