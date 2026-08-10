import { describe, expect, it } from "vitest";
import { shouldApplyProviderStatus } from "./communications";

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
});
