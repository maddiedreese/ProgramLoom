import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCommunications } from "./EventCommunications";

afterEach(() => vi.unstubAllGlobals());

describe("EventCommunications", () => {
  it("renders an accountable empty outbox and template catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/recipients"))
          return Response.json({ recipients: [], count: 0, truncated: false });
        return Response.json({
          event: { id: "event-1", name: "DevFlow Conf 2027" },
          scope: null,
          supportedMergeFields: ["recipient.name", "event.name"],
          templates: [
            {
              id: "template-1",
              category: "speaker_message",
              name: "Organizer message",
              subject: "A message from {{event.name}}",
              bodyHtml: "<p>{{organizer.message}}</p>",
              bodyText: "{{organizer.message}}",
              mergeFields: ["event.name", "organizer.message"],
              enabled: true,
              version: 1,
            },
          ],
          stats: {},
          messages: [],
          pagination: { page: 1, pageSize: 50, total: 0 },
        });
      }),
    );
    render(
      <MemoryRouter initialEntries={["/app/events/event-1/communications"]}>
        <Routes>
          <Route
            path="/app/events/:eventId/communications"
            element={
              <EventCommunications
                user={{ id: "user-1", name: "Mina", email: "mina@example.com" }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", {
        name: /every message, one accountable outbox/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no communications match this view/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /templates/i })).toBeEnabled();
  });
});
