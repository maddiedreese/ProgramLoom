import { describe, expect, it } from "vitest";
import { privacySafeProductProperties } from "./telemetry";

describe("privacySafeProductProperties", () => {
  it("keeps bounded operational facts and removes personal or nested data", () => {
    expect(
      privacySafeProductProperties({
        category: "decision",
        result_count: 4,
        event_scoped: true,
        query: "speaker@example.com",
        recipientName: "Private person",
        payload: { nested: "data" },
      }),
    ).toEqual({
      category: "decision",
      result_count: 4,
      event_scoped: true,
    });
  });
});
