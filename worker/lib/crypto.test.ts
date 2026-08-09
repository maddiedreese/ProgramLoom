import { describe, expect, it } from "vitest";
import { randomToken, sha256 } from "./crypto";

describe("authentication cryptography", () => {
  it("generates URL-safe, non-repeating tokens", () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(second).not.toBe(first);
  });

  it("hashes tokens deterministically without retaining the raw value", async () => {
    const token = "single-use-secret";
    const digest = await sha256(token);
    expect(digest).toBe(await sha256(token));
    expect(digest).not.toContain(token);
    expect(digest).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
