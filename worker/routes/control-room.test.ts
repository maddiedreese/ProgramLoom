import { describe, expect, it } from "vitest";
import {
  buildControlRoomRecommendations,
  issuesSql,
  recommendationCategories,
} from "./control-room";

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

describe("Control Room recommendations", () => {
  it.each(recommendationCategories)(
    "builds the %s recommendation from its persisted affected-record count",
    (category, actionLabel, reason) => {
      const result = buildControlRoomRecommendations(
        { [category]: 3 },
        "event-1",
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        category,
        actionLabel,
        reason,
        affectedRecordCount: 3,
      });
      expect(result[0].actionUrl).toMatch(/^\/app\//);
    },
  );

  it("uses the declared deterministic priority when affected counts tie", () => {
    const counts = Object.fromEntries(
      recommendationCategories.map(([category]) => [category, 2]),
    );
    expect(buildControlRoomRecommendations(counts, "event-1")).toEqual(
      recommendationCategories
        .slice(0, 4)
        .map(([category, actionLabel, reason, suffix]) => ({
          category,
          actionLabel,
          reason,
          affectedRecordCount: 2,
          actionUrl: suffix.startsWith("../")
            ? `/app/${suffix.slice(3)}`
            : `/app/events/event-1/${suffix}`,
        })),
    );
  });
});
