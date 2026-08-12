import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { inferDurableState, MutationResultPanel } from "./MutationResultPanel";

describe("MutationResultPanel", () => {
  it.each([
    ["Decision staged. Nothing was sent.", "Decision staged — nothing sent"],
    ["Agenda published.", "Published"],
    ["Session scheduled.", "Scheduled"],
    ["Content approved.", "Approved"],
  ])("derives %s as %s", (message, state) => {
    expect(inferDurableState(message)).toBe(state);
  });

  it("shows the result, durable state, and a direct next action", () => {
    render(
      <MutationResultPanel
        feedback={{ kind: "success", message: "Agenda published." }}
        nextAction={{ label: "Open public widgets", href: "/widgets" }}
      />,
    );
    expect(screen.getByText("What changed")).toBeVisible();
    expect(screen.getByText("New durable state")).toBeVisible();
    expect(screen.getByText("Next recommended action")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open public widgets" })).toHaveAttribute(
      "href",
      "/widgets",
    );
  });
});
