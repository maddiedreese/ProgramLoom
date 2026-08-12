import { describe, expect, it } from "vitest";
import {
  extractMergeFields,
  renderMergeFields,
  safeOperationalError,
  validateMergeFields,
} from "./operations";

describe("operational foundations", () => {
  it("extracts, validates, and renders merge fields deterministically", () => {
    expect(
      extractMergeFields(
        "Hello {{ recipient.name }}",
        "{{event.name}} / {{recipient.name}}",
      ),
    ).toEqual(["event.name", "recipient.name"]);
    expect(
      validateMergeFields(["{{event.name}} {{private.link}}"], ["event.name"]),
    ).toEqual(["private.link"]);
    expect(
      renderMergeFields("Hi {{recipient.name}} — {{event.name}}", {
        "recipient.name": "Priya",
      }),
    ).toEqual({
      rendered: "Hi Priya — {{event.name}}",
      unresolved: ["event.name"],
    });
  });

  it("redacts email addresses from operational errors", () => {
    expect(
      safeOperationalError(new Error("Delivery to person@example.com failed")),
    ).toBe("Delivery to [email] failed");
    expect(
      safeOperationalError(
        new Error(
          "POST https://provider.example/send?recipient=person@example.com token=private-value",
        ),
      ),
    ).toBe("POST [url] token=[redacted]");
  });
});
