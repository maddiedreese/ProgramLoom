import { describe, expect, it } from "vitest";
import {
  COPY_DOMAINS,
  makePreview,
  previewSchema,
  selectConfiguration,
  starterConfiguration,
} from "./event-templates";

describe("event template contracts", () => {
  it("maintains all four starter programs with real reusable configuration", () => {
    for (const key of ["conference", "meetup", "workshop", "community-cfp"]) {
      const starter = starterConfiguration(key);
      expect(starter.cfp.forms).toHaveLength(1);
      expect(starter.cfp.fields.length).toBeGreaterThanOrEqual(4);
      expect(starter.review.rounds).toHaveLength(1);
      expect(starter.onboarding.length).toBeGreaterThanOrEqual(3);
      expect(starter.resources).toHaveLength(1);
    }
  });

  it("translates relative deadlines and explicitly excludes private history", () => {
    const starter = starterConfiguration("conference");
    const preview = makePreview(starter, [...COPY_DOMAINS], {
      name: "Conference 2031",
      timezone: "America/New_York",
      startsAt: "2031-06-10T16:00:00.000Z",
      endsAt: "2031-06-12T00:00:00.000Z",
    });
    expect(preview.translatedDeadlines[0]?.to).toContain("2031-");
    expect(preview.excluded.join(" ")).toMatch(/Submissions/);
    expect(preview.excluded.join(" ")).toMatch(/Airtable external IDs/);
    expect(preview.totalRecords).toBeGreaterThan(10);
    expect(preview.domains.find((item) => item.id === "review")?.count).toBe(4);
    expect(
      preview.domains.find((item) => item.id === "communications")?.count,
    ).toBe(4);
    expect(preview.domains.find((item) => item.id === "crm")?.count).toBe(2);
  });

  it("removes unselected domains from stored organization templates", () => {
    const selected = selectConfiguration(starterConfiguration("conference"), [
      "cfp",
    ]);
    expect(selected.cfp.forms).toHaveLength(1);
    expect(selected.review.rounds).toHaveLength(0);
    expect(selected.onboarding).toHaveLength(0);
  });

  it("rejects invalid ranges and unsupported template sources", () => {
    expect(() =>
      previewSchema.parse({
        source: { kind: "starter_template", id: "paid-enterprise" },
        domains: ["cfp"],
        target: {
          name: "Bad",
          timezone: "UTC",
          startsAt: "2031-01-02T00:00:00.000Z",
          endsAt: "2031-01-01T00:00:00.000Z",
        },
      }),
    ).toThrow();
  });
});
