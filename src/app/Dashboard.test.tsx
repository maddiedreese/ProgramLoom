import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("organizer onboarding", () => {
  it("offers real workspace creation when the organizer has none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ organizations: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(
      <Dashboard
        user={{
          id: "user-1",
          email: "organizer@example.com",
          name: "Mina Organizer",
        }}
      />,
    );
    expect(
      await screen.findByRole("heading", {
        name: /create your event workspace/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/workspace name/i)).toBeRequired();
    expect(
      screen.getByRole("button", { name: /create workspace/i }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeEnabled();
  });

  it("shows participants only their assigned events and participant controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        const body = path.includes("/events")
          ? {
              events: [
                {
                  id: "event-1",
                  name: "Assigned Program",
                  slug: "assigned-program",
                  eventType: "conference",
                  timezone: "UTC",
                  startsAt: "2027-09-14T13:00:00.000Z",
                  endsAt: "2027-09-16T22:00:00.000Z",
                  venueName: "Community Hall",
                  status: "draft",
                  accessRole: "speaker",
                },
              ],
            }
          : {
              organizations: [
                {
                  id: "organization-1",
                  name: "Programs",
                  slug: "programs",
                  storageMode: "airtable",
                  role: "member",
                  eventCount: 1,
                },
              ],
            };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    render(
      <Dashboard
        user={{
          id: "speaker-1",
          email: "speaker@example.com",
          name: "Priya Speaker",
        }}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Assigned Program" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /team/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /speaker crm/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new event/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /create an event/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open speaker portal/i }),
    ).toHaveAttribute("href", "/app/events/event-1/speakers");
  });

  it("gives speakers an explicit persisted proposal tracker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        const body = path.includes("/my-submissions")
          ? {
              submissions: [
                {
                  id: "submission-1",
                  title: "Reliable programs",
                  status: "pending",
                  decisionState: "none",
                  submittedAt: "2027-01-01T00:00:00.000Z",
                  updatedAt: "2027-01-02T00:00:00.000Z",
                  formName: "Community CFP",
                  formSlug: "community-cfp",
                  editClosesAt: null,
                  eventName: "Assigned Program",
                  eventSlug: "assigned-program",
                  eventStatus: "active",
                  organizationName: "Programs",
                  organizationSlug: "programs",
                },
                {
                  id: "submission-past",
                  title: "A proposal from last year",
                  status: "accepted",
                  decisionState: "communicated_accept",
                  submittedAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-02T00:00:00.000Z",
                  formName: "Past CFP",
                  formSlug: "past-cfp",
                  editClosesAt: null,
                  eventName: "Past Program",
                  eventSlug: "past-program",
                  eventStatus: "archived",
                  organizationName: "Programs",
                  organizationSlug: "programs",
                },
              ],
            }
          : path.includes("/events")
            ? { events: [] }
            : {
                organizations: [
                  {
                    id: "organization-1",
                    name: "Programs",
                    slug: "programs",
                    storageMode: "native",
                    role: "member",
                    eventCount: 1,
                  },
                ],
              };
        return Promise.resolve(Response.json(body));
      }),
    );

    render(
      <Dashboard
        user={{
          id: "speaker-1",
          email: "speaker@example.com",
          name: "Priya Speaker",
        }}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Proposals you submitted" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reliable programs")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open proposal/i }),
    ).toHaveAttribute(
      "href",
      "/c/programs/assigned-program/community-cfp?submission=submission-1",
    );
    expect(screen.getByText("Past proposals (1)")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /a proposal from last year/i }),
    ).not.toBeInTheDocument();
  });

  it("puts organizer events first and makes event identity visibly editable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/my-submissions"))
          return Promise.resolve(
            Response.json({
              submissions: [
                {
                  id: "submission-1",
                  title: "A proposal I submitted",
                  status: "pending",
                  decisionState: "none",
                  updatedAt: "2027-01-02T00:00:00.000Z",
                  formName: "Community CFP",
                  formSlug: "community-cfp",
                  eventName: "Another Event",
                  eventSlug: "another-event",
                  eventStatus: "active",
                  organizationSlug: "programs",
                },
              ],
            }),
          );
        if (path.includes("/integrations/"))
          return Promise.resolve(
            Response.json({
              configured: true,
              pending: 0,
              failed: 0,
              lastSyncedAt: "2027-01-02T00:00:00.000Z",
              conflicts: [],
              resources: [],
            }),
          );
        if (path.includes("/event-templates/"))
          return Promise.resolve(
            Response.json({ templates: [], starters: [] }),
          );
        if (path.includes("/events"))
          return Promise.resolve(
            Response.json({
              events: [
                {
                  id: "event-1",
                  name: "DevFlow Summit",
                  slug: "devflow-summit",
                  eventType: "conference",
                  timezone: "America/Los_Angeles",
                  startsAt: "2027-09-14T16:00:00.000Z",
                  endsAt: "2027-09-16T23:00:00.000Z",
                  venueName: "Harbor Conference Center",
                  websiteUrl: "https://example.com",
                  status: "active",
                },
              ],
            }),
          );
        return Promise.resolve(
          Response.json({
            organizations: [
              {
                id: "organization-1",
                name: "Programs",
                slug: "programs",
                storageMode: "airtable",
                role: "owner",
                eventCount: 1,
              },
            ],
          }),
        );
      }),
    );

    render(
      <Dashboard
        user={{
          id: "organizer-1",
          email: "organizer@example.com",
          name: "Mina Organizer",
        }}
      />,
    );

    const eventHeading = await screen.findByRole("heading", {
      name: "DevFlow Summit",
    });
    const proposalHeading = await screen.findByRole("heading", {
      name: "Proposals you submitted",
    });
    expect(
      eventHeading.compareDocumentPosition(proposalHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("0 pending")).toBeInTheDocument();
    expect(screen.getByText("0 failed")).toBeInTheDocument();
    expect(screen.getByText("0 open conflicts")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /edit event details/i }),
    );
    const dialog = screen.getByRole("dialog", {
      name: /edit event details/i,
    });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Event name")).toHaveValue(
      "DevFlow Summit",
    );
    expect(within(dialog).getByLabelText(/event status/i)).toHaveValue(
      "active",
    );
    expect(
      within(dialog).getByText(/archiving closes the public cfp/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close event details/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /save event details/i }),
    ).toBeEnabled();
  });
});
