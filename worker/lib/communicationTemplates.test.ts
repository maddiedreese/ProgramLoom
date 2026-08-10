import { describe, expect, it } from "vitest";
import {
  defaultCommunicationTemplates,
  supportedCommunicationMergeFields,
} from "./communicationTemplates";
import { communicationCategories, validateMergeFields } from "./operations";

describe("communication template catalog", () => {
  it("provides one safe default for every supported category", () => {
    expect(
      defaultCommunicationTemplates.map((item) => item.category).sort(),
    ).toEqual([...communicationCategories].sort());
    for (const template of defaultCommunicationTemplates) {
      expect(template.subject).toBeTruthy();
      expect(template.bodyText).toBeTruthy();
      expect(template.bodyHtml).toContain("<p>");
      expect(
        validateMergeFields(
          [template.subject, template.bodyText, template.bodyHtml],
          supportedCommunicationMergeFields,
        ),
      ).toEqual([]);
    }
  });
});
