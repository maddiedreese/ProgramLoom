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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  localStorage.clear();
});

function renderWidget(widgetType: string, data = payload) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          ...data,
          widget: { ...data.widget, widgetType },
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

  it("facets the session catalog by track, format, and location", async () => {
    renderWidget("sessions", {
      ...payload,
      sessions: [
        ...payload.sessions,
        {
          ...payload.sessions[0],
          id: "submission-2",
          title: "Hands-on reliability",
          format: "Workshop",
          trackId: "track-1",
        },
      ],
      agenda: [
        ...payload.agenda,
        {
          ...payload.agenda[0],
          id: "agenda-3",
          submissionId: "submission-2",
          title: "Hands-on reliability",
          roomName: "Workshop lab",
          trackId: "track-1",
          trackName: "Main",
        },
      ],
    });
    expect(await screen.findByText("2 sessions")).toBeVisible();
    expect(screen.getByLabelText("Filter by track")).toBeVisible();
    expect(screen.getByLabelText("Filter by format")).toBeVisible();
    expect(screen.getByLabelText("Filter by location")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Filter by format"), {
      target: { value: "Workshop" },
    });
    expect(screen.getByText("1 session")).toBeVisible();
    expect(screen.getByText("Hands-on reliability")).toBeVisible();
    expect(screen.queryByText("Reliable programs")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by format"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Filter by location"), {
      target: { value: "Main stage" },
    });
    expect(screen.getByText("Reliable programs")).toBeVisible();
    expect(screen.queryByText("Hands-on reliability")).not.toBeInTheDocument();
  });

  it("uses polished singular itinerary copy", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:itinerary"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    localStorage.setItem(
      "programloom-itinerary:agenda-test",
      JSON.stringify(["agenda-1"]),
    );
    renderWidget("itinerary");
    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === "P" &&
          /1 session in your personal schedule/i.test(
            element.textContent ?? "",
          ),
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Export my ICS" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "ICS exported with 1 session. Your saved itinerary is unchanged.",
    );
  });

  it("shows a saved itinerary even when earlier filters excluded it", async () => {
    localStorage.setItem(
      "programloom-itinerary:agenda-test",
      JSON.stringify(["agenda-1"]),
    );
    renderWidget("itinerary");
    await screen.findByText("Reliable programs");
    fireEvent.change(screen.getByLabelText("Search program"), {
      target: { value: "does not match" },
    });
    expect(screen.queryByText("Reliable programs")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show my schedule only" }),
    );
    expect(screen.getByText("Reliable programs")).toBeVisible();
    expect(screen.getByLabelText("Search program")).toHaveValue("");
  });

  it("keeps every event day available even when one day has no sessions", async () => {
    renderWidget("agenda", {
      ...payload,
      event: {
        ...payload.event,
        endsAt: "2027-09-16T22:00:00.000Z",
      },
    });
    expect(await screen.findAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: /Thursday/ }));
    expect(
      screen.getByText(/No sessions match these filters on this day/),
    ).toBeVisible();
  });
});
