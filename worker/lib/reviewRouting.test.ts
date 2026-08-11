import { describe, expect, it } from "vitest";
import {
  contradictoryRuleConditions,
  routingConditionMatches,
  routingRuleMatches,
  type RoutingCondition,
  type RoutingRule,
  type RoutingSubmission,
} from "./reviewRouting";

const proposal: RoutingSubmission = {
  id: "proposal-workshop",
  title: "Build reliable AI systems",
  formId: "form-cfp",
  formName: "Main CFP",
  format: "Workshop",
  answers: { discipline: "AI Engineering", level: "Advanced" },
  tracks: ["track-ai"],
  tags: ["tag-hands-on"],
  fieldKeys: { "field-discipline": "discipline", "field-level": "level" },
  speakerEmails: ["speaker@example.com"],
};

const condition = (
  source: RoutingCondition["source"],
  value: unknown,
  fieldId: string | null = null,
): RoutingCondition => ({
  id: crypto.randomUUID(),
  source,
  fieldId,
  operator: "equals",
  value,
  position: 0,
});

const rule = (conditions: RoutingCondition[]): RoutingRule => ({
  id: "rule-ai-workshop",
  eventId: "event-one",
  name: "AI Engineering workshops",
  description: null,
  priority: 10,
  enabled: true,
  groupOperator: "and",
  roundId: "round-workshops",
  roundName: "Workshop review",
  reviewersPerSubmission: 2,
  ownerUserId: null,
  ownerName: null,
  excludedReviewerIds: [],
  tagIds: [],
  groups: [
    {
      id: "group-one",
      position: 0,
      conditionOperator: "and",
      conditions,
    },
  ],
});

describe("review routing rules", () => {
  it("matches form, track, format, tags, and custom CFP values", () => {
    const conditions = [
      condition("form", "form-cfp"),
      condition("track", "track-ai"),
      condition("format", "Workshop"),
      condition("tag", "tag-hands-on"),
      condition("custom_field", "AI Engineering", "field-discipline"),
    ];
    expect(
      conditions.every((item) => routingConditionMatches(item, proposal)),
    ).toBe(true);
    expect(routingRuleMatches(rule(conditions), proposal)).toBe(true);
  });

  it("supports OR groups without allowing an unmatched disabled rule", () => {
    const item = rule([
      condition("format", "Panel"),
      condition("track", "track-ai"),
    ]);
    item.groups[0].conditionOperator = "or";
    expect(routingRuleMatches(item, proposal)).toBe(true);
    item.enabled = false;
    expect(routingRuleMatches(item, proposal)).toBe(false);
  });

  it("detects contradictory values inside an AND group", () => {
    const item = rule([
      condition("format", "Workshop"),
      condition("format", "Panel"),
    ]);
    expect(contradictoryRuleConditions(item)).toEqual([
      "AI Engineering workshops requires conflicting values for format.",
    ]);

    const excluded = condition("track", "track-ai");
    excluded.operator = "not_equals";
    expect(
      contradictoryRuleConditions(
        rule([condition("track", "track-ai"), excluded]),
      ),
    ).toContain(
      "AI Engineering workshops both requires and excludes the same value for track.",
    );
  });
});
