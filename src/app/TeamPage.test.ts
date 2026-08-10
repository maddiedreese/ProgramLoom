import { describe, expect, it } from "vitest";
import { invitationDeliveryMessage } from "./TeamPage";

describe("invitation delivery wording", () => {
  it("keeps prepared, queued, and provider-accepted states distinct", () => {
    expect(
      invitationDeliveryMessage("prepared", "person@example.test"),
    ).toMatch(/only prepared/i);
    expect(invitationDeliveryMessage("queued", "person@example.test")).toMatch(
      /queued/i,
    );
    expect(invitationDeliveryMessage("sent", "person@example.test")).toMatch(
      /provider accepted/i,
    );
    expect(invitationDeliveryMessage("sent", "person@example.test")).toMatch(
      /delivery is not claimed/i,
    );
  });
});
