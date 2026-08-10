import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventWorkspace } from "./EventWorkspace";

const eventId = "10000000-0000-4000-8000-000000000001";
const event = {
  id: eventId,
  organizationName: "DevFlow Programs",
  organizationSlug: "devflow-programs",
  name: "DevFlow Conf 2027",
  slug: "devflow-conf-2027",
  timezone: "America/Los_Angeles",
  startsAt: "2027-05-12T09:00:00-07:00",
  endsAt: "2027-05-14T17:00:00-07:00",
  status: "draft",
  storageMode: "native",
};

afterEach(() => vi.unstubAllGlobals());

describe("EventWorkspace", () => {
  it("keeps the form element across the async create request", async () => {
    let forms: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === `/api/events/${eventId}`)
          return Response.json({ event, role: "owner" });
        if (path === `/api/events/${eventId}/tracks`)
          return Response.json({ tracks: [] });
        if (
          path === `/api/events/${eventId}/forms` &&
          init?.method === "POST"
        ) {
          const created = {
            id: "20000000-0000-4000-8000-000000000001",
            name: "Main call for proposals",
            slug: "main-call-for-proposals",
            description: "Share your session idea with our program team.",
            opensAt: null,
            closesAt: null,
            editClosesAt: null,
            allowDrafts: true,
            submissionLimit: null,
            confirmationSubject: null,
            confirmationBody: null,
            publishedAt: null,
            fieldCount: 0,
          };
          forms = [created];
          await Promise.resolve();
          return Response.json({ form: created }, { status: 201 });
        }
        if (path === `/api/events/${eventId}/forms`)
          return Response.json({ forms });
        if (path.includes("/forms/"))
          return Response.json({ fields: [], conditions: [] });
        return Response.json(
          { error: { message: "Unexpected request" } },
          { status: 500 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}`]}>
        <Routes>
          <Route
            path="/app/events/:eventId"
            element={
              <EventWorkspace
                user={{
                  id: "user-1",
                  name: "Jordan Alvarez",
                  email: "jordan@example.com",
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const input = await screen.findByLabelText("New form");
    fireEvent.change(input, { target: { value: "Main call for proposals" } });
    fireEvent.click(screen.getByTitle("Create form"));

    expect(
      await screen.findByText(/CFP created. Add the questions/i),
    ).toBeInTheDocument();
    expect(input).toHaveValue("");
  });
});
