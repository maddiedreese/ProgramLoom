import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventPageGuide } from "./EventPageGuide";

describe("EventPageGuide", () => {
  it("explains where the current workspace fits and names the next action", () => {
    render(<EventPageGuide eventId="event-1" surface="communications" />);

    expect(screen.getByText("Step 3 · Decide and communicate")).toBeVisible();
    expect(
      screen.getByText(
        /staging records the organizer's decision without contacting anyone/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /next: prepare accepted speakers/i }),
    ).toHaveAttribute("href", "/app/events/event-1/speakers");
  });
});
