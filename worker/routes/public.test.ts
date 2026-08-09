import { describe, expect, it } from "vitest";
import { matches, validateAnswers } from "./public";

describe("public CFP validation", () => {
  it("evaluates scalar, list, checkbox, and numeric conditions", () => {
    expect(matches("equals", "Workshop", "Workshop")).toBe(true);
    expect(matches("contains", ["AI", "Web"], "AI")).toBe(true);
    expect(matches("is_checked", true, undefined)).toBe(true);
    expect(matches("greater_than", 9, 4)).toBe(true);
  });

  it("enforces conditional requirements and allowed select options", () => {
    const fields = [
      { id: "format", section: "session", fieldType: "select", fieldKey: "format", label: "Format", description: null, placeholder: null, required: false, options: ["Talk", "Workshop"], validation: undefined, optionsJson: undefined, validationJson: undefined, position: 0 },
      { id: "outline", section: "session", fieldType: "textarea", fieldKey: "outline", label: "Workshop outline", description: null, placeholder: null, required: false, options: undefined, validation: undefined, optionsJson: undefined, validationJson: undefined, position: 1 },
    ] as Parameters<typeof validateAnswers>[0];
    const conditions = [{ id: "rule", sourceFieldId: "format", operator: "equals", compareValue: "Workshop", compareValueJson: undefined, targetFieldId: "outline", action: "require" as const }] as Parameters<typeof validateAnswers>[1];

    expect(validateAnswers(fields, conditions, { format: "Workshop" })).toEqual({ outline: "Workshop outline is required." });
    expect(validateAnswers(fields, conditions, { format: "Keynote", outline: "Ready" })).toEqual({ format: "Choose one of the available options." });
    expect(validateAnswers(fields, conditions, { format: "Talk" })).toEqual({});
  });
});
