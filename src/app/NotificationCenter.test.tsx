import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "./NotificationCenter";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NotificationCenter", () => {
  it("shows durable unread work and updates read state and preferences", async () => {
    const notification = {
      id: "00000000-0000-4000-8000-000000000101",
      organizationId: "00000000-0000-4000-8000-000000000002",
      eventId: "00000000-0000-4000-8000-000000000003",
      eventName: "DevFlow",
      category: "review",
      notificationType: "review.completed",
      severity: "info",
      title: "Review completed",
      body: "A reviewer completed an assigned scorecard.",
      actionUrl: "/app/events/00000000-0000-4000-8000-000000000003/reviews",
      entityType: "review",
      entityId: "00000000-0000-4000-8000-000000000102",
      occurrenceCount: 1,
      lastOccurredAt: "2026-08-09T16:00:00.000Z",
      readAt: null,
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/preferences") && !init?.method)
          return Response.json({
            preferences: [
              { category: "review", inAppEnabled: true, emailEnabled: false },
            ],
          });
        if (init?.method) return Response.json({ ok: true });
        return Response.json({
          notifications: [notification],
          events: [
            {
              id: notification.eventId,
              name: notification.eventName,
              organizationId: notification.organizationId,
            },
          ],
          organizations: [
            { id: notification.organizationId, name: "DevFlow Programs" },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          unread: 1,
          globalUnread: 1,
          hasMore: false,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationCenter />);

    fireEvent.click(
      await screen.findByRole("button", { name: /notifications, 1 unread/i }),
    );
    expect(await screen.findByText("Review completed")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Mark Review completed read" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/notifications/${notification.id}`,
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Notification preferences" }),
    );
    const email = await screen.findByRole("checkbox", {
      name: "Email review notifications",
    });
    fireEvent.click(email);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/preferences",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"emailEnabled":true'),
        }),
      ),
    );
  });
});
