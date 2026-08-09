import { describe, expect, it } from "vitest";
import { evaluateScorecard } from "./reviews";

const fields = [
  { id: "quality", label: "Quality", fieldType: "numeric", minValue: 1, maxValue: 5, weight: 2, required: 1 },
  { id: "fit", label: "Program fit", fieldType: "select", optionsJson: JSON.stringify([{ label: "Strong", value: 5 }, { label: "Weak", value: 1 }]), weight: 1, required: 1 },
  { id: "note", label: "Private note", fieldType: "text", weight: 1, required: 0 },
];

describe("review scorecard evaluation", () => {
  it("computes a weighted mean across numeric and scored select fields", () => {
    expect(evaluateScorecard(fields, { quality: 4, fit: "Strong", note: "Useful" }, true)).toEqual({ errors: {}, weightedScore: 4.33 });
  });

  it("allows incomplete drafts but rejects invalid final scorecards", () => {
    expect(evaluateScorecard(fields, {}, false)).toEqual({ errors: {}, weightedScore: null });
    expect(evaluateScorecard(fields, { quality: 8, fit: "Unknown" }, true)).toEqual({ errors: { quality: "Enter a score from 1 to 5.", fit: "Choose an available score." }, weightedScore: null });
    expect(evaluateScorecard(fields, { quality: 4 }, true).errors).toEqual({ fit: "Program fit is required." });
  });
});
