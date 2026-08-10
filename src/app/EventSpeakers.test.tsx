import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSpeakers } from "./EventSpeakers";

const eventId = "10000000-0000-4000-8000-000000000001";

afterEach(() => vi.unstubAllGlobals());

describe("speaker workspace", () => {
  it("shows only speaker-authorized event navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === `/api/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              role: "speaker",
              event: {
                id: eventId,
                organizationName: "Programs",
                name: "Assigned Program",
                status: "draft",
                timezone: "America/Los_Angeles",
                startsAt: "2027-10-01T16:00:00.000Z",
                endsAt: "2027-10-02T23:00:00.000Z",
                venueName: "Verification venue",
              },
            }),
          );
        if (path === `/api/speakers/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              profile: {
                id: "speaker-1",
                email: "speaker@example.test",
                firstName: "Priya",
                lastName: "Raman",
                pronouns: null,
                jobTitle: null,
                company: null,
                bio: null,
                headshotKey: null,
                social: {},
                logistics: {},
                portalStatus: "active",
              },
              sessions: [],
              tasks: [],
              resources: [],
              files: [],
            }),
          );
        return Promise.resolve(
          Response.json(
            { error: { message: "Unexpected request" } },
            { status: 500 },
          ),
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}/speakers`]}>
        <Routes>
          <Route
            path="/app/events/:eventId/speakers"
            element={
              <EventSpeakers
                user={{
                  id: "speaker-1",
                  name: "Priya Raman",
                  email: "speaker@example.test",
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Welcome, Priya." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Speakers" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Call for proposals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Submissions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Content" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Agenda" })).not.toBeInTheDocument();
  });
});
