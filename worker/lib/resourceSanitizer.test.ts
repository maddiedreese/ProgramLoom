import { describe, expect, it } from "vitest";
import { sanitizeResourceHtmlServer } from "./resourceSanitizer";

describe("sanitizeResourceHtmlServer", () => {
  it("preserves approved references with fixed privacy and sandbox controls", () => {
    const result = sanitizeResourceHtmlServer(
      '<h2>Speaker guide</h2><iframe src="https://docs.google.com/document/d/example/preview" onload="steal()"></iframe>',
      [],
    );

    expect(result.html).toContain(
      "https://docs.google.com/document/d/example/preview",
    );
    expect(result.html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation"',
    );
    expect(result.html).toContain('loading="lazy"');
    expect(result.html).toContain('referrerpolicy="no-referrer"');
    expect(result.html).not.toContain("onload");
    expect(result.removals).toContain(
      "Event-handler attributes are not allowed and were removed.",
    );
  });

  it("rejects executable, interactive, insecure, and unapproved content with explanations", () => {
    const result = sanitizeResourceHtmlServer(
      '<script>alert(1)</script><form action="https://evil.example"><input></form><iframe src="http://references.example/a"></iframe><iframe src="https://evil.example/b"></iframe><a href="javascript:alert(1)">Bad</a>',
      ["references.example"],
    );

    expect(result.html).not.toMatch(/script|form|input|iframe|javascript:/);
    expect(result.removals.join(" ")).toMatch(/Scripts are not allowed/);
    expect(result.removals.join(" ")).toMatch(/Forms and interactive/);
    expect(result.removals.join(" ")).toMatch(/HTTPS domain is not allowed/);
  });

  it("uses exact organization-managed domain matching", () => {
    const result = sanitizeResourceHtmlServer(
      '<iframe src="https://references.example/a"></iframe><iframe src="https://child.references.example/b"></iframe>',
      ["references.example"],
    );

    expect(result.html).toContain("https://references.example/a");
    expect(result.html).not.toContain("child.references.example");
  });
});
