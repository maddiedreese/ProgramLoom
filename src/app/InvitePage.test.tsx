import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvitePage } from "./InvitePage";

afterEach(() => { vi.unstubAllGlobals(); window.location.hash = ""; });

describe("invitation acceptance", () => {
  it("previews a fragment-carried invitation without exposing the token in a request URL", async () => {
    window.location.hash = "token=secure-invitation-token-value-123456789";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ invitation: { email: "reviewer@example.com", role: "reviewer", organizationName: "Example Events", eventName: "DevFlow Conf", expiresAt: "2027-01-01T00:00:00.000Z", needsName: true } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvitePage />);
    expect(await screen.findByRole("heading", { name: /join example events/i })).toBeInTheDocument();
    expect(screen.getByText(/devflow conf/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/invitations/preview", expect.objectContaining({ method: "POST" }));
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("secure-invitation-token");
  });
});
