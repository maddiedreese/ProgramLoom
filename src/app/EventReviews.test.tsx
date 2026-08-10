import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventReviews } from "./EventReviews";

const eventId = "10000000-0000-4000-8000-000000000001";

afterEach(() => vi.unstubAllGlobals());

describe("reviewer workspace", () => {
  it("shows only reviewer-authorized event navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === `/api/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              role: "reviewer",
              event: {
                id: eventId,
                organizationName: "Programs",
                name: "Assigned Program",
                status: "draft",
              },
            }),
          );
        if (path.startsWith("/api/reviews/me/assignments"))
          return Promise.resolve(Response.json({ assignments: [] }));
        return Promise.resolve(
          Response.json(
            { error: { message: "Unexpected request" } },
            { status: 500 },
          ),
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}/reviews`]}>
        <Routes>
          <Route
            path="/app/events/:eventId/reviews"
            element={
              <EventReviews
                user={{
                  id: "reviewer-1",
                  name: "Sam Reviewer",
                  email: "reviewer@example.test",
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Your review queue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reviews" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Submissions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Speakers" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Content" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Agenda" }),
    ).not.toBeInTheDocument();
  });
});
