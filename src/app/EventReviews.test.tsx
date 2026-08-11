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
import { EventReviews } from "./EventReviews";

const eventId = "10000000-0000-4000-8000-000000000001";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reviewer workspace", () => {
  it("shows only reviewer-authorized event navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === `/api/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              role: "reviewer",
              event: {
                id: eventId,
                organizationName: "Programs",
                name: "Assigned Program",
                status: "draft",
              },
            }),
          );
        if (path.startsWith("/api/reviews/me/assignments"))
          return Promise.resolve(Response.json({ assignments: [] }));
        return Promise.resolve(
          Response.json(
            { error: { message: "Unexpected request" } },
            { status: 500 },
          ),
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}/reviews`]}>
        <Routes>
          <Route
            path="/app/events/:eventId/reviews"
            element={
              <EventReviews
                user={{
                  id: "reviewer-1",
                  name: "Sam Reviewer",
                  email: "reviewer@example.test",
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Your review queue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reviews" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Submissions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Speakers" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Content" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Agenda" }),
    ).not.toBeInTheDocument();
  });

  it("lets organizers configure durable per-round open and close dates", async () => {
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
              },
            }),
          );
        if (path === `/api/reviews/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              rounds: [
                {
                  id: "round-1",
                  name: "Program fit",
                  position: 1,
                  isBlind: true,
                  opensAt: "2027-01-10T17:00:00.000Z",
                  closesAt: "2027-01-20T17:00:00.000Z",
                  status: "draft",
                  assignmentCount: 0,
                  completedCount: 0,
                  reviewerCount: 0,
                  averageScore: null,
                },
              ],
              scorecards: [],
              reviewers: [
                {
                  id: "20000000-0000-4000-8000-000000000001",
                  name: "Sam Reviewer",
                  email: "reviewer@example.test",
                  assignmentCount: 0,
                  completedCount: 0,
                },
              ],
              reviewerPools: [],
              results: [],
            }),
          );
        if (path.includes("/submissions?status=pending"))
          return Promise.resolve(Response.json({ submissions: [] }));
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );

    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}/reviews`]}>
        <Routes>
          <Route
            path="/app/events/:eventId/reviews"
            element={
              <EventReviews
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
      await screen.findByRole("button", { name: "Save review window" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Sort aggregate score")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Export review results CSV" }),
    ).toHaveAttribute(
      "href",
      `/api/reviews/events/${eventId}/export?roundId=round-1`,
    );
    expect(
      screen.getByRole("link", { name: "Send reviewer reminder" }),
    ).toBeVisible();
    const opens = screen.getAllByLabelText("Opens");
    const closes = screen.getAllByLabelText("Closes");
    fireEvent.change(opens[1], { target: { value: "2027-01-11T09:00" } });
    fireEvent.change(closes[1], { target: { value: "2027-01-21T17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save review window" }));

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === `/api/reviews/events/${eventId}/rounds/round-1` &&
            request.init?.method === "PATCH" &&
            String(request.init.body).includes('"opensAt"'),
        ),
      ).toBe(true),
    );

    fireEvent.click(
      document.querySelector(
        'input[name="reviewerUserId"]',
      ) as HTMLInputElement,
    );
    fireEvent.change(screen.getByLabelText("Capacity"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reviewer pool" }));
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              `/api/reviews/events/${eventId}/rounds/round-1/reviewer-pool` &&
            request.init?.method === "PUT" &&
            String(request.init.body).includes('"capacity":4'),
        ),
      ).toBe(true),
    );
  });

  it("exposes individual reviewer scores and comments from aggregate results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === `/api/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              role: "owner",
              event: {
                id: eventId,
                organizationName: "Programs",
                name: "Assigned Program",
                status: "active",
              },
            }),
          );
        if (path === `/api/reviews/events/${eventId}`)
          return Promise.resolve(
            Response.json({
              rounds: [
                {
                  id: "round-1",
                  name: "Initial Review",
                  position: 1,
                  isBlind: false,
                  opensAt: null,
                  closesAt: null,
                  status: "open",
                  assignmentCount: 1,
                  completedCount: 1,
                  reviewerCount: 1,
                  averageScore: 4,
                },
              ],
              scorecards: [
                {
                  id: "quality",
                  roundId: "round-1",
                  label: "Quality",
                  fieldType: "numeric",
                  weight: 2,
                  required: true,
                },
              ],
              reviewers: [],
              reviewerPools: [],
              results: [
                {
                  roundId: "round-1",
                  submissionId: "submission-1",
                  title: "Reliable programs",
                  aggregateScore: 4,
                  assignmentCount: 1,
                  completedCount: 1,
                },
              ],
              reviewDetails: [
                {
                  roundId: "round-1",
                  submissionId: "submission-1",
                  assignmentId: "assignment-1",
                  reviewerName: "Sam Reviewer",
                  reviewerEmail: "reviewer@example.test",
                  answers: { quality: 4 },
                  weightedScore: 4,
                  recommendation: "approve",
                  comment: "Clear, useful, and ready for the program.",
                  submittedAt: "2027-01-12T12:00:00.000Z",
                },
              ],
            }),
          );
        if (path.includes("/submissions?status=pending"))
          return Promise.resolve(Response.json({ submissions: [] }));
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );
    render(
      <MemoryRouter initialEntries={[`/app/events/${eventId}/reviews`]}>
        <Routes>
          <Route
            path="/app/events/:eventId/reviews"
            element={
              <EventReviews
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
      await screen.findByRole("button", { name: "View review details" }),
    );
    expect(screen.getByText("Sam Reviewer")).toBeVisible();
    expect(
      screen.getByText("Comment: Clear, useful, and ready for the program."),
    ).toBeVisible();
    expect(screen.getAllByText("Quality")).toHaveLength(2);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });
});
