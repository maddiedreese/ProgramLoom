import { describe, expect, it } from "vitest";
import { matchesFilter, personalize } from "./crm";

const contact = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "priya@example.com",
  firstName: "Priya",
  lastName: "Raman",
  company: "Latticework Systems",
  jobTitle: "VP Platform",
  bio: "Builds reliable developer platforms.",
  source: "manual",
  tags: ["AI", "Keynote"],
  social: {},
};

describe("speaker CRM helpers", () => {
  it("combines search, company, title, tags, and custom-field filters", () => {
    const fieldValues = new Map([
      [contact.id, { "00000000-0000-4000-8000-000000000099": "External" }],
    ]);
    expect(
      matchesFilter(
        contact,
        {
          search: "latticework",
          companies: ["Latticework Systems"],
          jobTitles: ["VP Platform"],
          tags: ["AI", "Keynote"],
          fieldId: "00000000-0000-4000-8000-000000000099",
          fieldValue: "External",
        },
        fieldValues,
      ),
    ).toBe(true);
    expect(matchesFilter(contact, { tags: ["Workshop"] }, fieldValues)).toBe(
      false,
    );
  });

  it("personalizes supported outreach merge tags", () => {
    expect(
      personalize(
        "Hi {{first_name}} {{last_name}} from {{company}} — {{full_name}}",
        contact,
      ),
    ).toBe("Hi Priya Raman from Latticework Systems — Priya Raman");
  });
});
