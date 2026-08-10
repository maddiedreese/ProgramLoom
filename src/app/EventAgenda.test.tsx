import "@testing-library/jest-dom/vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventAgenda } from "./EventAgenda";

const eventId = "10000000-0000-4000-8000-000000000001";

afterEach(() => vi.unstubAllGlobals());

describe("agenda calendar lifecycle controls", () => {
  it("confirms cancellation and requires the explicit reschedule operation", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        requests.push({ path, init });
        if (path === `/api/agenda/admin/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              event: {
                id: eventId,
                organizationName: "Programs",
                name: "Production Readiness",
                status: "published",
                startsAt: "2027-09-14T14:00:00.000Z",
                endsAt: "2027-09-15T22:00:00.000Z",
                timezone: "America/New_York",
              },
              tracks: [],
              rooms: [
                {
                  id: "20000000-0000-4000-8000-000000000001",
                  name: "Main stage",
                  capacity: 100,
                },
              ],
              sessions: [],
              items: [
                {
                  id: "30000000-0000-4000-8000-000000000001",
                  submissionId: "40000000-0000-4000-8000-000000000001",
                  trackId: null,
                  roomId: "20000000-0000-4000-8000-000000000001",
                  itemType: "session",
                  title: "Active session",
                  description: null,
                  startsAt: "2027-09-14T14:00:00.000Z",
                  endsAt: "2027-09-14T14:45:00.000Z",
                  status: "published",
                  version: 1,
                  cancelledAt: null,
                  roomName: "Main stage",
                  trackName: null,
                },
                {
                  id: "30000000-0000-4000-8000-000000000002",
                  submissionId: "40000000-0000-4000-8000-000000000002",
                  trackId: null,
                  roomId: null,
                  itemType: "session",
                  title: "Cancelled session",
                  description: null,
                  startsAt: null,
                  endsAt: null,
                  status: "published",
                  version: 2,
                  cancelledAt: "2026-08-10T01:22:56.814Z",
                  roomName: null,
                  trackName: null,
                },
                {
                  id: "30000000-0000-4000-8000-000000000003",
                  submissionId: null,
                  trackId: null,
                  roomId: "20000000-0000-4000-8000-000000000001",
                  itemType: "hold",
                  title: "Production hold",
                  description: null,
                  startsAt: "2027-09-14T16:00:00.000Z",
                  endsAt: "2027-09-14T16:30:00.000Z",
                  status: "published",
                  version: 1,
                  cancelledAt: null,
                  roomName: "Main stage",
                  trackName: null,
                },
              ],
            }),
          );
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );

    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}/agenda`]}>
        <Routes>
          <Route
            path="/app/events/:eventId/agenda"
            element={
              <EventAgenda
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel session: Active session",
      }),
    );
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: `/api/agenda/admin/events/${eventId}/items/30000000-0000-4000-8000-000000000001/cancel`,
          init: expect.objectContaining({ method: "POST" }),
        }),
      ),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("removes it from public agendas"),
    );

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Remove block" }))[0],
    );
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: `/api/agenda/admin/events/${eventId}/items/30000000-0000-4000-8000-000000000003`,
          init: expect.objectContaining({ method: "DELETE" }),
        }),
      ),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("organizer and public agendas"),
    );

    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "Clear placement for Active session",
        })
      )[0],
    );
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: `/api/agenda/admin/events/${eventId}/items/30000000-0000-4000-8000-000000000001`,
          init: expect.objectContaining({ method: "PATCH" }),
        }),
      ),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("return to the unscheduled queue"),
    );

    const cancelledForm = document.getElementById(
      "agenda-placement-30000000-0000-4000-8000-000000000002",
    ) as HTMLFormElement;
    fireEvent.change(within(cancelledForm).getByLabelText("Room"), {
      target: { value: "20000000-0000-4000-8000-000000000001" },
    });
    fireEvent.change(within(cancelledForm).getByLabelText("Starts"), {
      target: { value: "2027-09-15T10:00" },
    });
    fireEvent.change(within(cancelledForm).getByLabelText("Ends"), {
      target: { value: "2027-09-15T10:45" },
    });
    fireEvent.click(
      within(cancelledForm).getByRole("button", { name: /reschedule/i }),
    );

    await waitFor(() => {
      const placement = requests.find(
        (request) =>
          request.path ===
            `/api/agenda/admin/events/${eventId}/items/30000000-0000-4000-8000-000000000002` &&
          request.init?.method === "PATCH",
      );
      expect(placement).toBeDefined();
      expect(JSON.parse(String(placement?.init?.body))).toMatchObject({
        reschedule: true,
        roomId: "20000000-0000-4000-8000-000000000001",
      });
    });
  });
});
