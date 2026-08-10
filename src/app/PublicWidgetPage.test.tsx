import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicWidgetPage } from "./PublicWidgetPage";

const payload = {
  widget: {
    publicKey: "agenda-test",
    name: "Public program",
    widgetType: "agenda",
    config: {
      theme: "light",
      primaryColor: "#315c45",
      showSearch: true,
      showFilters: true,
      fields: [
        "title",
        "abstract",
        "speakers",
        "track",
        "room",
        "time",
        "company",
        "bio",
      ],
    },
  },
  event: {
    id: "event-1",
    name: "ProgramLoom Live",
    organizationName: "Programs",
    timezone: "America/New_York",
    venueName: "Convention center",
    startsAt: "2027-09-14T13:00:00.000Z",
    endsAt: "2027-09-15T22:00:00.000Z",
  },
  tracks: [{ id: "track-1", name: "Main", color: "#315c45" }],
  sessions: [
    {
      id: "submission-1",
      title: "Reliable programs",
      abstract: "A durable workflow.",
      format: "Talk",
      durationMinutes: 30,
      trackId: "track-1",
      speakerIds: ["speaker-1"],
      speakerNames: ["Priya Raman"],
    },
  ],
  speakers: [
    {
      id: "speaker-1",
      firstName: "Priya",
      lastName: "Raman",
      pronouns: "she/her",
      jobTitle: "Principal architect",
      company: "Reliable Systems",
      bio: "Builds calm program operations.",
      headshotUrl: "/headshot.png",
      social: {},
    },
  ],
  agenda: [
    {
      id: "agenda-1",
      submissionId: "submission-1",
      trackId: "track-1",
      itemType: "session",
      title: "Reliable programs",
      description: "A durable workflow.",
      startsAt: "2027-09-14T14:00:00.000Z",
      endsAt: "2027-09-14T14:30:00.000Z",
      roomName: "Main stage",
      trackName: "Main",
      trackColor: "#315c45",
    },
    {
      id: "agenda-2",
      submissionId: null,
      trackId: "track-1",
      itemType: "break",
      title: "Coffee",
      description: "Coffee break.",
      startsAt: "2027-09-15T15:00:00.000Z",
      endsAt: "2027-09-15T15:30:00.000Z",
      roomName: "Lobby",
      trackName: "Main",
      trackColor: "#315c45",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function renderWidget(widgetType: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          ...payload,
          widget: { ...payload.widget, widgetType },
        }),
      ),
    ),
  );
  render(
    <MemoryRouter initialEntries={["/embed/agenda-test"]}>
      <Routes>
        <Route path="/embed/:publicKey" element={<PublicWidgetPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("public widgets", () => {
  it("renders an accessible multi-day agenda grid with detail and itinerary controls", async () => {
    renderWidget("agenda");
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(
      screen.getByRole("columnheader", { name: "Main stage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to itinerary" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(screen.getByText("A durable workflow.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Close details" })).toBeVisible();
    expect(screen.getByText(/Principal architect/)).toBeVisible();
    expect(screen.getByText(/Reliable Systems/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add to itinerary" }));
    expect(localStorage.getItem("programloom-itinerary:agenda-test")).toContain(
      "agenda-1",
    );
    fireEvent.click(screen.getByRole("tab", { name: /Wednesday/ }));
    expect(
      screen.getByRole("columnheader", { name: "Lobby" }),
    ).toBeInTheDocument();
  });

  it("shows searchable speaker profiles and a speaker-centered gallery", async () => {
    renderWidget("gallery");
    expect(await screen.findByText("1 featured speaker")).toBeInTheDocument();
    const profile = screen.getByText("Priya Raman").closest("article");
    expect(profile).not.toBeNull();
    fireEvent.click(
      within(profile!).getByRole("button", { name: "View profile" }),
    );
    expect(
      within(profile!).getByText("Builds calm program operations."),
    ).toBeVisible();
    expect(within(profile!).getByText("Reliable programs")).toBeVisible();
    expect(within(profile!).getByText(/Main stage/)).toBeVisible();
  });

  it("shows complete speaker credentials on session cards", async () => {
    renderWidget("sessions");
    expect(await screen.findByText("1 session")).toBeInTheDocument();
    expect(
      screen.getByText("Principal architect · Reliable Systems"),
    ).toBeVisible();
    const sessionCard = screen
      .getByText("Reliable programs")
      .closest("article");
    expect(sessionCard).not.toBeNull();
    expect(
      within(sessionCard!).getByRole("button", { name: "View details" }),
    ).toBeVisible();
  });
});
