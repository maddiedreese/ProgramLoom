import { describe, expect, it } from "vitest";
import {
  cfpAvailability,
  deriveProgramMetadata,
  matches,
  submissionSchema,
  submissionEditingIsClosed,
  submissionCanBeSavedAsDraft,
  validateAnswers,
} from "./public";

describe("public CFP validation", () => {
  it("closes submission and editing at the configured CFP deadline", () => {
    const form = {
      opensAt: "2027-01-01T00:00:00.000Z",
      closesAt: "2027-02-01T00:00:00.000Z",
      editClosesAt: "2027-03-01T00:00:00.000Z",
    };
    expect(cfpAvailability(form, "2027-01-31T23:59:59.999Z")).toBe("open");
    expect(cfpAvailability(form, "2027-02-01T00:00:00.000Z")).toBe("closed");
    expect(
      submissionEditingIsClosed(form, "pending", "2027-02-01T00:00:00.000Z"),
    ).toBe(true);
  });
  it("never lets an already-submitted proposal fall back to draft", () => {
    expect(submissionCanBeSavedAsDraft("draft")).toBe(true);
    expect(submissionCanBeSavedAsDraft("pending")).toBe(false);
    expect(submissionCanBeSavedAsDraft("accepted")).toBe(false);
  });
  it("evaluates scalar, list, checkbox, and numeric conditions", () => {
    expect(matches("equals", "Workshop", "Workshop")).toBe(true);
    expect(matches("contains", ["AI", "Web"], "AI")).toBe(true);
    expect(matches("is_checked", true, undefined)).toBe(true);
    expect(matches("greater_than", 9, 4)).toBe(true);
  });

  it("enforces conditional requirements and allowed select options", () => {
    const fields = [
      {
        id: "format",
        section: "session",
        fieldType: "select",
        fieldKey: "format",
        label: "Format",
        description: null,
        placeholder: null,
        required: false,
        options: ["Talk", "Workshop"],
        validation: undefined,
        optionsJson: undefined,
        validationJson: undefined,
        position: 0,
      },
      {
        id: "outline",
        section: "session",
        fieldType: "textarea",
        fieldKey: "outline",
        label: "Workshop outline",
        description: null,
        placeholder: null,
        required: false,
        options: undefined,
        validation: undefined,
        optionsJson: undefined,
        validationJson: undefined,
        position: 1,
      },
    ] as Parameters<typeof validateAnswers>[0];
    const conditions = [
      {
        id: "rule",
        sourceFieldId: "format",
        operator: "equals",
        compareValue: "Workshop",
        compareValueJson: undefined,
        targetFieldId: "outline",
        action: "require" as const,
      },
    ] as Parameters<typeof validateAnswers>[1];

    expect(validateAnswers(fields, conditions, { format: "Workshop" })).toEqual(
      { outline: "Workshop outline is required." },
    );
    expect(
      validateAnswers(fields, conditions, {
        format: "Keynote",
        outline: "Ready",
      }),
    ).toEqual({ format: "Choose one of the available options." });
    expect(validateAnswers(fields, conditions, { format: "Talk" })).toEqual({});
  });

  it("maps submitted format and track answers into program metadata", () => {
    const fields = [
      { id: "format", fieldKey: "session_format", label: "Format" },
      { id: "track", fieldKey: "preferred_track", label: "Track" },
    ] as Parameters<typeof deriveProgramMetadata>[0];

    expect(
      deriveProgramMetadata(
        fields,
        {
          session_format: "Talk (30 min)",
          preferred_track: "Platform & Infra",
        },
        [
          { id: "track-1", name: "AI Engineering" },
          { id: "track-2", name: "Platform & Infra" },
        ],
      ),
    ).toEqual({
      format: "Talk (30 min)",
      durationMinutes: 30,
      trackIds: ["track-2"],
    });
  });

  it("accepts an authenticated proposal resume with bounded co-presenters", () => {
    const input = submissionSchema.parse({
      submitter: { name: "Priya Raman", email: "PRIYA@example.com" },
      coSubmitters: [
        {
          name: "Marcus Chen",
          email: "MARCUS@example.com",
          participantRole: "panelist",
        },
      ],
      answers: { session_title: "Reliable programs" },
      action: "draft",
      submissionId: "10000000-0000-4000-8000-000000000001",
    });

    expect(input.submitter.email).toBe("priya@example.com");
    expect(input.coSubmitters[0].email).toBe("marcus@example.com");
    expect(input.coSubmitters[0].participantRole).toBe("panelist");
    expect(input.submissionId).toBe("10000000-0000-4000-8000-000000000001");
  });
});
