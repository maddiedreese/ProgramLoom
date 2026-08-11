import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isoToZonedLocal, zonedLocalToIso } from "../lib/zonedTime";
import { EventTemplateStudio } from "./EventTemplateStudio";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EventTemplateStudio", () => {
  it("interprets event date fields in the selected timezone and rejects DST gaps", () => {
    expect(zonedLocalToIso("2033-06-10T09:00", "Europe/London")).toBe(
      "2033-06-10T08:00:00.000Z",
    );
    expect(zonedLocalToIso("2033-01-10T09:00", "America/New_York")).toBe(
      "2033-01-10T14:00:00.000Z",
    );
    expect(
      isoToZonedLocal("2033-01-10T14:00:00.000Z", "America/New_York"),
    ).toBe("2033-01-10T09:00");
    expect(() =>
      zonedLocalToIso("2033-03-13T02:30", "America/New_York"),
    ).toThrow(/daylight-saving/i);
  });

  it("requires an explicit preview before creating from a starter", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (!init?.method)
          return Response.json({
            templates: [],
            starters: [
              {
                id: "conference",
                name: "Conference",
                description: "Full program",
              },
            ],
          });
        if (path.endsWith("/preview"))
          return Response.json({
            preview: {
              sourceName: "Conference",
              totalRecords: 18,
              domains: [{ id: "cfp", count: 6 }],
              translatedDeadlines: [
                {
                  label: "CFP closes",
                  from: "2030-05-01T00:00:00.000Z",
                  to: "2031-05-01T00:00:00.000Z",
                },
              ],
              warnings: [],
              excluded: ["Submissions, reviews, scores, and decisions"],
            },
          });
        return Response.json(
          {
            event: {
              id: "created-event",
              name: "Next Conference",
              slug: "next-conference",
              eventType: "conference",
              timezone: "UTC",
              startsAt: "2031-06-10T16:00:00.000Z",
              endsAt: "2031-06-12T00:00:00.000Z",
              venueName: null,
              status: "draft",
            },
          },
          { status: 201 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(
      <EventTemplateStudio
        organizationId="organization-1"
        events={[]}
        onCreated={onCreated}
      />,
    );
    await screen.findByText("Full program");
    fireEvent.change(screen.getByLabelText("Event name"), {
      target: { value: "Next Conference" },
    });
    fireEvent.change(screen.getByLabelText("Timezone"), {
      target: { value: "UTC" },
    });
    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2031-06-10T16:00" },
    });
    fireEvent.change(screen.getByLabelText("Ends"), {
      target: { value: "2031-06-12T00:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /preview event copy/i }),
    );
    const preview = (
      await screen.findByRole("heading", { name: /review before creating/i })
    ).closest("section");
    expect(preview).toHaveTextContent(/18 configuration records/i);
    expect(screen.getByText(/Submissions, reviews/)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /confirm and create/i }),
    );
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: "created-event", status: "draft" }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/events"),
      expect.objectContaining({
        body: expect.stringContaining('"confirmPreview":true'),
      }),
    );
  });
});
