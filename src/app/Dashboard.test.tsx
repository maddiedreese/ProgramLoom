import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

afterEach(() => vi.unstubAllGlobals());

describe("organizer onboarding", () => {
  it("offers real workspace creation when the organizer has none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ organizations: [] }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<Dashboard user={{ id: "user-1", email: "organizer@example.com", name: "Mina Organizer" }} />);
    expect(await screen.findByRole("heading", { name: /create your event workspace/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/workspace name/i)).toBeRequired();
    expect(screen.getByRole("button", { name: /create workspace/i })).toBeEnabled();
  });
});
