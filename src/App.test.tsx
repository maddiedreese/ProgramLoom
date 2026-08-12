import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => vi.unstubAllGlobals());

describe("ProgramLoom application", () => {
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
      screen.getByRole("link", { name: /see how programloom works/i }),
    ).toHaveAttribute("href", "#walkthrough");
    expect(
      screen.getByRole("heading", {
        name: /know what is ready—and what needs attention next/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/choosing an outcome does not send an email/i),
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
});
