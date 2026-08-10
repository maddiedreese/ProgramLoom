import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EventLifecycleNav } from "./EventLifecycleNav";

afterEach(cleanup);

describe("EventLifecycleNav", () => {
  it("gives organizers stable, visible entry points to every lifecycle workspace", () => {
    render(
      <EventLifecycleNav
        eventId="event-1"
        active="control-room"
        role="owner"
      />,
    );

    for (const label of [
      "Control Room",
      "Call for proposals",
      "Submissions",
      "Reviews",
      "Speakers",
      "Content",
      "Agenda",
      "Public widgets",
      "Communications",
      "Calendar lifecycle",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeVisible();
    }
    expect(screen.getByRole("link", { name: "Control Room" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("combobox", { name: "Event lifecycle" }),
    ).toHaveValue("control-room");
  });

  it("limits reviewer navigation to the assigned review workspace", () => {
    render(
      <EventLifecycleNav eventId="event-1" active="reviews" role="reviewer" />,
    );
    expect(screen.getByRole("link", { name: "Reviews" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Submissions" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Control Room" })).toBeNull();
  });

  it("routes speakers only to their complete speaker portal", () => {
    render(
      <EventLifecycleNav eventId="event-1" active="speakers" role="speaker" />,
    );
    expect(screen.getByRole("link", { name: "Speakers" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Content" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Agenda" })).toBeNull();
  });
});
