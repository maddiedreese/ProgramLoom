import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommandPalette", () => {
  it("opens by keyboard, groups permitted results, and records a validated recent destination", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") return Response.json({ ok: true });
        return Response.json({
          results: [
            {
              type: "speaker",
              id: "00000000-0000-4000-8000-000000000111",
              label: "Ada Lovelace",
              context: "Analytical Engines",
              path: "/app/events/00000000-0000-4000-8000-000000000003/speakers?speaker=00000000-0000-4000-8000-000000000111",
              organizationId: "00000000-0000-4000-8000-000000000002",
              eventId: "00000000-0000-4000-8000-000000000003",
              rank: 0,
            },
          ],
          recent: [],
          actions: [],
          scope: { events: [] },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter
        initialEntries={["/app/events/00000000-0000-4000-8000-000000000003"]}
      >
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const search = await screen.findByRole("combobox", {
      name: /search programloom/i,
    });
    fireEvent.change(search, { target: { value: "ada" } });
    expect(
      await screen.findByRole("heading", { name: "Speakers" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/search/recent",
        expect.objectContaining({
          method: "POST",
          body: expect.not.stringContaining('"query"'),
        }),
      ),
    );
  });
});
