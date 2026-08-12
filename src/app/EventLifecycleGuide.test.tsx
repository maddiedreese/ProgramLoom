import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventLifecycleGuide, type LifecycleStageView } from "./EventLifecycleGuide";

const stages: LifecycleStageView[] = [
  {
    number: 1,
    label: "Collect proposals",
    state: "Complete",
    count: 20,
    total: 1,
    countLabel: "20 submitted proposals",
    blockerCount: 0,
    primaryAction: "Manage CFP",
    actionUrl: "/app/events/event-1/cfp?lifecycle=collect-proposals",
  },
  ...["Review proposals", "Make decisions", "Prepare speakers", "Approve content", "Build the agenda", "Publish the program"].map(
    (label, index): LifecycleStageView => ({
      number: index + 2,
      label,
      state: "In progress",
      count: index,
      total: 10,
      countLabel: `${index} of 10 complete`,
      blockerCount: 0,
      primaryAction: "Continue",
      actionUrl: `/app/events/event-1/workspace?lifecycle=${index + 2}`,
    }),
  ),
];

describe("EventLifecycleGuide", () => {
  it("shows all persisted counts, states, and keyboard-reachable primary actions", () => {
    render(<EventLifecycleGuide eventId="event-1" stages={stages} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("20 submitted proposals")).toBeVisible();
    expect(screen.getByText("Complete")).toBeVisible();
    const action = screen.getByRole("link", {
      name: "Primary action: Manage CFP",
    });
    expect(action).toHaveAttribute(
      "href",
      "/app/events/event-1/cfp?lifecycle=collect-proposals",
    );
    action.focus();
    expect(action).toHaveFocus();
  });
});
