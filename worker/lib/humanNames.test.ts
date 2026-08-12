import { describe, expect, it } from "vitest";
import {
  collapseRepeatedFullName,
  humanNameParts,
  normalizeStoredNameParts,
} from "./humanNames";

describe("human-name normalization", () => {
  it("collapses a repeated full name without changing ordinary names", () => {
    expect(collapseRepeatedFullName("Marcus Okafor Marcus Okafor")).toBe(
      "Marcus Okafor",
    );
    expect(collapseRepeatedFullName("Priya Raman")).toBe("Priya Raman");
  });

  it("creates durable first and last name fields", () => {
    expect(humanNameParts("Marcus Okafor Marcus Okafor")).toEqual({
      firstName: "Marcus",
      lastName: "Okafor",
    });
    expect(normalizeStoredNameParts("Marcus Okafor", "Marcus Okafor")).toEqual({
      firstName: "Marcus",
      lastName: "Okafor",
    });
  });
});
