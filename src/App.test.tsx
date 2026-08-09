import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("ProgramLoom application", () => {
  it("presents the core program workflow", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /weave every moving part/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start free/i })).toHaveAttribute(
      "href",
      "/register",
    );
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
});
