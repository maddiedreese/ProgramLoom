import { describe, expect, it } from "vitest";
import {
  compatibleSpeakerMergeData,
  shouldApplyProviderStatus,
} from "./communications";

describe("communication provider lifecycle", () => {
  it("advances messages without allowing terminal-state downgrades", () => {
    expect(shouldApplyProviderStatus("processing", "sent")).toBe(true);
    expect(shouldApplyProviderStatus("sent", "delivered")).toBe(true);
    expect(shouldApplyProviderStatus("sent", "bounced")).toBe(true);
    expect(shouldApplyProviderStatus("sent", "failed")).toBe(true);

    expect(shouldApplyProviderStatus("delivered", "sent")).toBe(false);
    expect(shouldApplyProviderStatus("delivered", "bounced")).toBe(false);
    expect(shouldApplyProviderStatus("bounced", "delivered")).toBe(false);
    expect(shouldApplyProviderStatus("failed", "sent")).toBe(false);
    expect(shouldApplyProviderStatus("cancelled", "delivered")).toBe(false);
  });

  it("resolves modern and legacy speaker-name fields identically", () => {
    expect(
      compatibleSpeakerMergeData("Priya Raman", {
        "speaker.first_name": "Priya",
        "speaker.last_name": "Raman",
      }),
    ).toMatchObject({
      "speaker.name": "Priya Raman",
      speaker_name: "Priya Raman",
    });
  });
});
