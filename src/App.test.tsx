import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("ProgramLoom application", () => {
  it("presents the core program workflow", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /weave every moving part/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start free/i })).toHaveAttribute("href", "/register");
  });
});
