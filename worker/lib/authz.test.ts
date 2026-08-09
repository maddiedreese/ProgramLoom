import { describe, expect, it } from "vitest";
import { normalizeSlug } from "./authz";

describe("tenant URL normalization", () => {
  it("creates stable, readable slugs", () => {
    expect(normalizeSlug("  Maddie's Évents & Co.  ")).toBe("maddie-s-events-co");
    expect(normalizeSlug("DevFlow Conf 2027")).toBe("devflow-conf-2027");
  });

  it("removes unsafe URL characters and enforces the length limit", () => {
    expect(normalizeSlug("../../admin?owner=true")).toBe("admin-owner-true");
    expect(normalizeSlug("x".repeat(100))).toHaveLength(64);
  });
});
