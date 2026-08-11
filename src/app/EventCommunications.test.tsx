import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCommunications } from "./EventCommunications";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

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
    const { container } = render(
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
        name: /preview every recipient. send with confidence/i,
      }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".event-workspace.communications-shell"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no communications match this view/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /templates/i })).toBeEnabled();
  });

  it("makes recipient preview and decision delivery explicit", async () => {
    window.history.replaceState({}, "", "/?category=decision");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/recipients"))
          return Response.json({
            recipients: [
              {
                key: "submission:proposal-1",
                entityType: "submission",
                entityId: "proposal-1",
                email: "speaker@example.test",
                name: "Priya Raman",
                context: "Accepted proposal",
              },
            ],
          });
        return Response.json({
          event: { id: "event-1", name: "DevFlow Conf 2027" },
          scope: null,
          supportedMergeFields: ["recipient.name", "event.name"],
          templates: [
            {
              id: "decision-template",
              category: "decision",
              name: "Decision",
              subject: "Your {{event.name}} decision",
              bodyHtml: "<p>Hello {{recipient.name}}</p>",
              bodyText: "Hello {{recipient.name}}",
              mergeFields: ["event.name", "recipient.name"],
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
    fireEvent.click(await screen.findByRole("tab", { name: /compose/i }));
    expect(
      await screen.findByRole("button", { name: "Preview recipients" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Send decision" })).toBeVisible();
    expect(
      screen.getByRole("radio", { name: /send after confirmation/i }),
    ).toBeChecked();
  });
});
