import { describe, expect, it } from "vitest";
import {
  buildLifecycleStages,
  deriveLifecycleState,
  type LifecycleSnapshot,
} from "./eventLifecycle";

describe("event lifecycle state transitions", () => {
  it.each([
    [{ started: false, current: 0, total: 1, blockers: 0 }, "Not started"],
    [{ started: true, current: 0, total: 1, blockers: 0 }, "In progress"],
    [{ started: true, current: 0, total: 1, blockers: 1 }, "Blocked"],
    [{ started: true, current: 1, total: 1, blockers: 0 }, "Complete"],
    [{ started: true, current: 1, total: 1, blockers: 1 }, "Blocked"],
  ] as const)("derives %s as %s", (input, expected) => {
    expect(deriveLifecycleState(input)).toBe(expected);
  });
});

describe("event lifecycle API contract", () => {
  it("returns the exact seven stages, persisted counts, and filtered actions", () => {
    const snapshot: LifecycleSnapshot = {
      publishedForms: 1,
      proposals: 20,
      reviewAssignments: 12,
      completedReviews: 9,
      unassignedPending: 0,
      reviewConflicts: 0,
      reviewedProposals: 9,
      finalDecisions: 9,
      stagedDecisions: 0,
      acceptedSpeakers: 8,
      readySpeakers: 8,
      acceptedSessions: 7,
      approvedSessions: 7,
      needsChangesContent: 0,
      placedSessions: 7,
      openScheduleConflicts: 0,
      publishedSessions: 7,
    };
    const stages = buildLifecycleStages(snapshot, "event-1");
    expect(stages.map(({ label }) => label)).toEqual([
      "Collect proposals",
      "Review proposals",
      "Make decisions",
      "Prepare speakers",
      "Approve content",
      "Build the agenda",
      "Publish the program",
    ]);
    expect(stages).toHaveLength(7);
    expect(stages.every(({ count }) => Number.isInteger(count))).toBe(true);
    expect(stages.every(({ primaryAction }) => primaryAction.length > 0)).toBe(
      true,
    );
    expect(
      stages.every(
        ({ actionUrl }) =>
          actionUrl.startsWith("/app/events/event-1") &&
          actionUrl.includes("lifecycle="),
      ),
    ).toBe(true);
  });

  it("surfaces blockers from authorized event aggregates", () => {
    const blocked = buildLifecycleStages(
      {
        publishedForms: 1,
        proposals: 2,
        reviewAssignments: 1,
        completedReviews: 0,
        unassignedPending: 1,
        reviewConflicts: 1,
        reviewedProposals: 0,
        finalDecisions: 0,
        stagedDecisions: 0,
        acceptedSpeakers: 1,
        readySpeakers: 0,
        acceptedSessions: 1,
        approvedSessions: 0,
        needsChangesContent: 1,
        placedSessions: 1,
        openScheduleConflicts: 1,
        publishedSessions: 0,
      },
      "event-1",
    );
    expect(blocked.map(({ state }) => state)).toEqual([
      "Complete",
      "Blocked",
      "Not started",
      "Blocked",
      "Blocked",
      "Blocked",
      "Blocked",
    ]);
  });
});
