import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  App,
  canonicalUrlForPath,
  descriptionForPath,
  shouldIndexPath,
  titleForPath,
} from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProgramLoom application", () => {
  it("gives public and workspace routes useful browser titles", () => {
    expect(titleForPath("/")).toBe(
      "ProgramLoom — Turn proposals into a trusted program",
    );
    expect(titleForPath("/app/events/event-1/control-room")).toBe(
      "Control Room — ProgramLoom",
    );
    expect(titleForPath("/app/events/event-1/communications")).toBe(
      "Communications Center — ProgramLoom",
    );
    expect(titleForPath("/app/events/event-1/submissions/submission-1")).toBe(
      "Proposal details — ProgramLoom",
    );
    expect(titleForPath("/oauth/authorize")).toBe(
      "Authorize application — ProgramLoom",
    );
    expect(titleForPath("/action/submission-edit")).toBe(
      "Edit proposal — ProgramLoom",
    );
    expect(titleForPath("/not-a-real-page")).toBe(
      "Page not found — ProgramLoom",
    );
    expect(descriptionForPath("/guide")).toContain("proposal");
    expect(descriptionForPath("/interest/devflow/speakers")).toContain(
      "speaking interests",
    );
    expect(shouldIndexPath("/cfp")).toBe(true);
    expect(shouldIndexPath("/app/events/event-1/control-room")).toBe(false);
    expect(shouldIndexPath("/login")).toBe(false);
    expect(canonicalUrlForPath("/", "https://app.programloom.com")).toBe(
      "https://programloom.com/",
    );
    expect(canonicalUrlForPath("/cfp", "https://programloom.com")).toBe(
      "https://app.programloom.com/cfp",
    );
    expect(canonicalUrlForPath("/app", "http://localhost:5173")).toBe(
      "http://localhost:5173/app",
    );
  });

  it("updates canonical and privacy-conscious route metadata", async () => {
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <App />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(document.title).toBe("Events — ProgramLoom"));
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "Events — ProgramLoom",
    );
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "http://localhost:3000/app",
    );
  });

  it("presents the core program workflow", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", {
        name: /turn session ideas into a schedule people can trust/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start free/i })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(screen.getByRole("link", { name: /browse cfps/i })).toHaveAttribute(
      "href",
      "/cfp",
    );
    expect(
      screen.getByRole("link", { name: /create your first event/i }),
    ).toHaveAttribute("href", "/register");
    expect(
      screen.getByRole("link", { name: /^open programloom/i }),
    ).toHaveAttribute("href", "/app");
    expect(
      screen.getByRole("link", { name: /read the help center/i }),
    ).toHaveAttribute("href", "/help/");
    expect(
      screen.getByText(
        /programloom shows organizers exactly what is blocking/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /know what is ready—and what needs attention next/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/staging a decision does not communicate it/i),
    ).toBeInTheDocument();
  });

  it("publishes the privacy notice", async () => {
    render(
      <MemoryRouter initialEntries={["/privacy"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: /privacy notice/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/we do not sell personal information/i),
    ).toBeInTheDocument();
  });

  it("publishes the terms of service", async () => {
    render(
      <MemoryRouter initialEntries={["/terms"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: /terms of service/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/acceptable use/i)).toBeInTheDocument();
  });

  it("publishes a first-time user guide without requiring an account", async () => {
    render(
      <MemoryRouter initialEntries={["/guide"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", {
        name: /run a complete event program without losing the thread/i,
      }),
    ).toBeVisible();
    expect(screen.getByText(/stage decision records/i)).toBeVisible();
    expect(screen.getByText(/begin in the control room/i)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /open programloom/i }),
    ).toHaveAttribute("href", "/app");
  });

  it("makes published calls discoverable without an account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          forms: [
            {
              id: "form-1",
              name: "Main call for proposals",
              description: "Share your session idea.",
              eventName: "DevFlow Conf 2027",
              eventStartsAt: "2027-05-12T09:00:00-07:00",
              organizationName: "DevFlow Programs",
              closesAt: "2027-03-15T23:59:00-07:00",
              availability: "open",
              url: "/c/devflow-programs/devflow-conf-2027/main-call-for-proposals",
            },
          ],
        }),
      ),
    );
    render(
      <MemoryRouter initialEntries={["/cfp"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "DevFlow Conf 2027" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /submit a proposal/i }),
    ).toHaveAttribute(
      "href",
      "/c/devflow-programs/devflow-conf-2027/main-call-for-proposals",
    );
  });

  it("explains unknown routes instead of silently showing the marketing page", () => {
    render(
      <MemoryRouter initialEntries={["/app/events/missing/unrecognized"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", {
        name: /this programloom page does not exist/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /return to workspace/i }),
    ).toHaveAttribute("href", "/app");
    expect(
      screen.queryByRole("heading", {
        name: /turn session ideas into a schedule people can trust/i,
      }),
    ).not.toBeInTheDocument();
  });
});
