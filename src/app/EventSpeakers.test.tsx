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
import { EventSpeakers } from "./EventSpeakers";

const eventId = "10000000-0000-4000-8000-000000000001";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
              tasks: [
                {
                  id: "task-1",
                  title: "Confirm participation",
                  description: "Confirm that you can attend.",
                  taskType: "confirmation",
                  dueAt: "2027-09-01T23:59:00.000Z",
                  status: "pending",
                  responseJson: {},
                  completedAt: null,
                  updatedAt: "2027-08-01T00:00:00.000Z",
                },
              ],
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
    expect(
      screen.queryByRole("link", { name: "Call for proposals" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Submissions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Reviews" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Content" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Agenda" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark complete" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View my submissions" }),
    ).toHaveAttribute("href", "/app#my-proposals-title");
  });

  it("makes speaker import, status filtering, and durable status changes explicit", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        requests.push({ path, init });
        if (path === `/api/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              role: "owner",
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
        if (path === `/api/speakers/admin/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              speakers: [
                {
                  id: "speaker-1",
                  email: "speaker@example.test",
                  firstName: "Priya",
                  lastName: "Raman",
                  pronouns: null,
                  jobTitle: "Staff engineer",
                  company: "Example Labs",
                  bio: "Builds reliable programs.",
                  headshotKey: "org/event/speaker/headshot.png",
                  social: {},
                  logistics: {},
                  portalStatus: "active",
                  eventStatus: "confirmed",
                  sessionCount: 1,
                  taskCount: 1,
                  completedTaskCount: 1,
                  fileRequestCount: 1,
                  approvedFileCount: 1,
                },
              ],
              tasks: [
                {
                  id: "task-1",
                  title: "Confirm participation",
                  description: "Confirm attendance.",
                  taskType: "action",
                  dueAt: null,
                },
              ],
              taskAssignments: [
                {
                  taskId: "task-1",
                  speakerId: "speaker-1",
                  speakerName: "Priya Raman",
                  title: "Confirm participation",
                  status: "todo",
                  response: {},
                  completedAt: null,
                },
              ],
              resources: [],
              files: [],
            }),
          );
        return Promise.resolve(Response.json({ ok: true }));
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
      await screen.findByRole("link", { name: "Import speakers" }),
    ).toHaveAttribute(
      "href",
      `/app/crm?action=import-speakers&eventId=${eventId}`,
    );
    expect(screen.getByRole("link", { name: "Add speaker" })).toHaveAttribute(
      "href",
      `/app/crm?action=add-speaker&eventId=${eventId}`,
    );
    expect(
      screen.getByRole("link", { name: "Add existing CRM contact" }),
    ).toHaveAttribute(
      "href",
      `/app/crm?action=handoff-speaker&eventId=${eventId}`,
    );
    expect((await screen.findAllByText("Priya Raman"))[0]).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Priya Raman headshot" }),
    ).toHaveAttribute(
      "src",
      `/api/speakers/admin/events/${eventId}/speakers/speaker-1/headshot`,
    );
    expect(screen.getByText("Builds reliable programs.")).toBeVisible();
    expect(screen.getByLabelText("Filter speaker status")).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete task" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Remove assignment" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Filter task progress")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Filter task progress"), {
      target: { value: "incomplete" },
    });
    expect(
      screen.queryByRole("link", { name: "Edit speaker profile" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter task progress"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("Program status"), {
      target: { value: "invited" },
    });
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              `/api/speakers/admin/events/${eventId}/speakers/speaker-1/status` &&
            request.init?.method === "PATCH" &&
            String(request.init.body).includes('"invited"'),
        ),
      ).toBe(true),
    );
  });
});
