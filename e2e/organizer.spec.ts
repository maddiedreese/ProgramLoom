import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./accessibility";

const eventId = process.env.PROGRAMLOOM_E2E_EVENT_ID;
const hasAuth = Boolean(process.env.PROGRAMLOOM_E2E_STORAGE_STATE && eventId);

test.describe("authenticated organizer operations", () => {
  test.skip(
    !hasAuth,
    "Provide an ignored organizer storage state and disposable event id.",
  );

  test("core operational surfaces load with persisted data", async ({
    page,
  }) => {
    const surfaces = [
      { path: "control-room", marker: /Organizer Control Room/i },
      { path: "communications", marker: /Communications/i },
      { path: "submissions", marker: /Submissions/i },
      { path: "calendar", marker: /Calendar/i },
    ];

    for (const surface of surfaces) {
      const response = await page.goto(
        `/app/events/${eventId}/${surface.path}`,
      );
      expect(response?.ok()).toBeTruthy();
      await expect(page.getByText(surface.marker).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
    }
  });

  test("command palette and notifications are keyboard operable", async ({
    page,
  }) => {
    await page.goto(`/app/events/${eventId}`);
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+K" : "Control+K",
    );
    const search = page.getByRole("combobox", { name: /search/i });
    await expect(search).toBeFocused();
    await search.fill("session");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    const bell = page.getByRole("button", { name: /Notifications/i });
    await bell.click();
    await expect(
      page.getByRole("dialog", { name: /Notifications/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bell).toBeFocused();
  });

  test("server authorization fails closed across events", async ({
    request,
  }) => {
    const unknownEvent = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    for (const path of [
      "control-room",
      "communications",
      "submissions/workspace",
    ]) {
      const response = await request.get(`/api/events/${unknownEvent}/${path}`);
      expect([403, 404]).toContain(response.status());
    }
  });
});
