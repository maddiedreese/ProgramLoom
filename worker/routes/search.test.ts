import { describe, expect, it } from "vitest";
import { rank, searchTerms } from "./search";

describe("organizer search ranking", () => {
  const item = (label: string, context = "") => ({ label, context });

  it("ranks exact and prefix matches ahead of contained and fuzzy matches", () => {
    expect(rank(item("Ada"), "ada")).toBe(0);
    expect(rank(item("Ada Lovelace"), "ada")).toBe(1);
    expect(rank(item("Meet Ada"), "ada")).toBe(2);
    expect(rank(item("Keynote xada"), "ada")).toBe(3);
    expect(rank(item("Opening keynote", "Ada Lovelace"), "ada")).toBe(4);
    expect(rank(item("Speaker"), "speker")).toBeGreaterThan(5);
    expect(rank(item("Completely unrelated"), "ada")).toBe(99);
  });

  it("treats user wildcard characters as text in bounded LIKE candidates", () => {
    const terms = searchTerms("100%_complete").slice(1).map(String);
    expect(terms[0]).toContain("\\%");
    expect(terms[0]).toContain("\\_");
    expect(terms.every((term) => term.length < 110)).toBe(true);
  });
});
