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
    expect(supportedCommunicationMergeFields).toContain("speaker.first_name");
    expect(supportedCommunicationMergeFields).toContain("speaker.name");
    expect(supportedCommunicationMergeFields).toContain("speaker_name");
    expect(
      defaultCommunicationTemplates.find(
        (template) => template.category === "speaker_message",
      )?.bodyText,
    ).toContain("{{speaker.first_name}}");
  });
});
