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
        distinct_id: "attempted-override",
        $process_person_profile: true,
        payload: { nested: "data" },
      }),
    ).toEqual({
      category: "decision",
      result_count: 4,
      event_scoped: true,
    });
  });
});
