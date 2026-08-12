import { describe, expect, it } from "vitest";
import {
  evaluateScorecard,
  parseAiAssessmentResponse,
  reviewResultsCsv,
  safeReviewSpreadsheetText,
} from "./reviews";

const fields = [
  {
    id: "quality",
    label: "Quality",
    fieldType: "numeric",
    minValue: 1,
    maxValue: 5,
    weight: 2,
    required: 1,
  },
  {
    id: "fit",
    label: "Program fit",
    fieldType: "select",
    optionsJson: JSON.stringify([
      { label: "Strong", value: 5 },
      { label: "Weak", value: 1 },
    ]),
    weight: 1,
    required: 1,
  },
  {
    id: "note",
    label: "Private note",
    fieldType: "text",
    weight: 1,
    required: 0,
  },
];

describe("review scorecard evaluation", () => {
  it("neutralizes formula injection in review-result exports", () => {
    expect(safeReviewSpreadsheetText('=HYPERLINK("bad")')).toBe(
      '\'=HYPERLINK("bad")',
    );
    expect(safeReviewSpreadsheetText("Normal title")).toBe("Normal title");
  });

  it("exports durable progress, score, and recommendation evidence", () => {
    const csv = reviewResultsCsv([
      {
        title: "Taming CI",
        assignmentCount: 2,
        completedCount: 2,
        aggregateScore: 3.25,
        recommendations: "approve; maybe",
      },
    ]);
    expect(csv).toContain('"Review status"');
    expect(csv).toContain('"Recommendations"');
    expect(csv).toContain('"Complete"');
    expect(csv).toContain('"approve; maybe"');
  });

  it("computes a weighted mean across numeric and scored select fields", () => {
    expect(
      evaluateScorecard(
        fields,
        { quality: 4, fit: "Strong", note: "Useful" },
        true,
      ),
    ).toEqual({ errors: {}, weightedScore: 4.33 });
  });

  it("allows incomplete drafts but rejects invalid final scorecards", () => {
    expect(evaluateScorecard(fields, {}, false)).toEqual({
      errors: {},
      weightedScore: null,
    });
    expect(
      evaluateScorecard(fields, { quality: 8, fit: "Unknown" }, true),
    ).toEqual({
      errors: {
        quality: "Enter a score from 1 to 5.",
        fit: "Choose an available score.",
      },
      weightedScore: null,
    });
    expect(evaluateScorecard(fields, { quality: 4 }, true).errors).toEqual({
      fit: "Program fit is required.",
    });
  });

  it("parses structured, fenced, nested, and explanatory AI responses", () => {
    const assessment = {
      score: 82,
      reasoning: "The proposal connects its CI evidence to concrete outcomes.",
      strengths: ["Specific"],
      risks: ["Timing"],
    };
    expect(parseAiAssessmentResponse(assessment)).toMatchObject(assessment);
    expect(
      parseAiAssessmentResponse({
        response: `\`\`\`json\n${JSON.stringify(assessment)}\n\`\`\``,
      }),
    ).toMatchObject(assessment);
    expect(
      parseAiAssessmentResponse({
        result: {
          response: `Assessment follows: ${JSON.stringify(assessment)}`,
        },
      }),
    ).toMatchObject(assessment);
  });
});
