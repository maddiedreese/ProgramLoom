import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

afterEach(() => vi.unstubAllGlobals());

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
});
