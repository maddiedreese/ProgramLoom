import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventControlRoom } from "./EventControlRoom";

afterEach(() => vi.unstubAllGlobals());

const baseOverview = {
  event: { id: "event-1", name: "DevFlow Conf" },
  role: "owner",
  counts: { reviewer_assignment: 1 },
  severityCounts: { blocking: 1, warning: 0, info: 0 },
  total: 1,
  owners: [{ id: "owner-1", name: "Mina" }],
  tracks: [{ id: "track-1", name: "Systems" }],
  pagination: { page: 1, pageSize: 30, total: 1 },
  refreshedAt: "2027-01-01T12:00:00.000Z",
  items: [
    {
      category: "reviewer_assignment",
      entityType: "submission",
      entityId: "submission-1",
      title: "Reliable systems",
      detail: "No active reviewer assignment",
      severity: "blocking",
      status: "pending",
      deadline: null,
      occurredAt: "2027-01-01T10:00:00.000Z",
      actionUrl: "/app/events/event-1/reviews?submission=submission-1",
      trackId: null,
      ownerUserId: null,
      ownerName: null,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/events/event-1/control-room"]}>
      <Routes>
        <Route
          path="/app/events/:eventId/control-room"
          element={
            <EventControlRoom
              user={{ id: "owner-1", name: "Mina", email: "mina@example.com" }}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EventControlRoom", () => {
  it("renders live blockers with deep links and an accessible owner control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(baseOverview)),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: /what is blocking/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reliable systems")).toHaveAttribute(
      "href",
      "/app/events/event-1/reviews?submission=submission-1",
    );
    expect(screen.getByLabelText("Owner for Reliable systems")).toBeEnabled();
  });

  it("updates issue ownership and refreshes without a document reload", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") return Response.json({ ok: true });
        return Response.json(baseOverview);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    const owner = await screen.findByLabelText("Owner for Reliable systems");
    fireEvent.change(owner, { target: { value: "owner-1" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/owner"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3),
    );
  });

  it("explains a clear filtered category", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...baseOverview,
          counts: {},
          severityCounts: { blocking: 0, warning: 0, info: 0 },
          total: 0,
          items: [],
          pagination: { page: 1, pageSize: 30, total: 0 },
        }),
      ),
    );
    renderPage();
    expect(
      await screen.findByText("This category is clear."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/surface new work here automatically/i),
    ).toBeInTheDocument();
  });
});
