import { describe, expect, it } from "vitest";
import { pkceS256Challenge } from "./developer-oauth";

describe("OAuth 2.1 PKCE", () => {
  it("produces the RFC 7636 S256 challenge", async () => {
    await expect(
      pkceS256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
