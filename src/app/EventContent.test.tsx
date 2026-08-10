import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventContent } from "./EventContent";

const eventId = "10000000-0000-4000-8000-000000000001";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("EventContent detail navigation", () => {
  it("opens a speaker editor from a stable query and closes without reopening", async () => {
    window.history.replaceState({}, "", "/?speaker=speaker-1");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === `/api/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              role: "owner",
              event: {
                id: eventId,
                organizationName: "Programs",
                name: "Production Readiness",
                status: "draft",
              },
            }),
          );
        if (path === `/api/content/admin/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              event: { fileUploadsEnabled: true },
              sessions: [],
              speakers: [
                {
                  id: "speaker-1",
                  firstName: "Priya",
                  lastName: "Raman",
                  jobTitle: "Principal architect",
                  company: "Reliable Systems",
                  bio: "Builds calm programs.",
                  logistics: {
                    dietary: "Vegetarian",
                    accessibility: "Aisle seating",
                    travelNotes: "Arrives the evening before.",
                  },
                  headshotUrl: null,
                },
              ],
              assignments: [],
              files: [],
              exports: [],
            }),
          );
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );

    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}/content`]}>
        <Routes>
          <Route
            path="/app/events/:eventId/content"
            element={
              <EventContent
                user={{
                  id: "owner-1",
                  name: "Owner",
                  email: "owner@example.test",
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("dialog", { name: "Edit speaker profile" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Travel notes")).toHaveValue(
      "Arrives the evening before.",
    );
    expect(
      screen.getByRole("button", { name: "Save profile and logistics" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Close speaker editor" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit speaker profile" }),
      ).not.toBeInTheDocument(),
    );
    expect(window.location.search).not.toContain("speaker=");
  });
});
