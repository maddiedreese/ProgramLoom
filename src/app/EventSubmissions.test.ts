import { describe, expect, it } from "vitest";
import { submissionDetailPath, submissionListPath } from "./EventSubmissions";

describe("submission workspace routes", () => {
  it("gives every proposal an addressable detail route and a stable return path", () => {
    expect(submissionDetailPath("event-1", "submission-1", "?sort=score")).toBe(
      "/app/events/event-1/submissions/submission-1?sort=score",
    );
    expect(
      submissionListPath(
        "event-1",
        "?submission=submission-1&sort=score&direction=desc",
      ),
    ).toBe("/app/events/event-1/submissions?sort=score&direction=desc");
  });
});
