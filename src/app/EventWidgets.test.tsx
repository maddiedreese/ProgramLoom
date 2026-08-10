import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventWidgets } from "./EventWidgets";

const eventId = "10000000-0000-4000-8000-000000000001";

afterEach(() => vi.unstubAllGlobals());

describe("EventWidgets", () => {
  it("explains and audits widget deletion through an explicit control", async () => {
    let widgets = [
      {
        id: "20000000-0000-4000-8000-000000000001",
        publicKey: "sessions-old",
        name: "Old sessions widget",
        widgetType: "sessions",
        config: {
          theme: "light",
          primaryColor: "#315c45",
          showSearch: true,
          showFilters: true,
          trackIds: [],
          fields: ["title", "speakers"],
        },
      },
    ];
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === "DELETE") {
          widgets = [];
          return Response.json({ deleted: true });
        }
        if (path === `/api/widgets/admin/events/${eventId}`)
          return Response.json({
            event: {
              id: eventId,
              name: "ProgramLoom Programs",
              organizationName: "ProgramLoom",
            },
            tracks: [],
            widgets,
          });
        return Response.json(
          { error: { message: "Unexpected request" } },
          { status: 500 },
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}/widgets`]}>
        <Routes>
          <Route
            path="/app/events/:eventId/widgets"
            element={
              <EventWidgets
                user={{ id: "owner-1", name: "Owner", email: "owner@test" }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByLabelText("Embed code for Old sessions widget"),
    ).toHaveAttribute("tabindex", "0");

    fireEvent.click(screen.getByRole("button", { name: "Delete widget" }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/public URLs will stop working immediately/i),
    );
    await waitFor(() =>
      expect(screen.queryByText("Old sessions widget")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/remaining live widgets are unchanged/i),
    ).toBeVisible();
  });
});
