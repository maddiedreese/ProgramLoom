import { describe, expect, it } from "vitest";
import { sanitizeResourceHtml } from "./sanitizeResource";

describe("sanitizeResourceHtml", () => {
  it("keeps safe content and approved embeds", () => {
    const result = sanitizeResourceHtml(
      '<h2>Guide</h2><a href="https://example.com" target="_blank">Read</a><iframe src="https://www.youtube.com/embed/abc"></iframe>',
    );

    expect(result).toContain("<h2>Guide</h2>");
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('src="https://www.youtube.com/embed/abc"');
    expect(result).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation"',
    );
    expect(result).toContain('loading="lazy"');
    expect(result).toContain('referrerpolicy="no-referrer"');
    expect(result).toContain('class="resource-embed"');
  });

  it("removes executable markup and unapproved embeds", () => {
    const result = sanitizeResourceHtml(
      '<script>alert(1)</script><img src=x onerror=alert(1)><p style="background:url(https://evil.example)">Safe</p><iframe src="https://evil.example/embed"></iframe><a href="javascript:alert(1)">Bad link</a>',
    );

    expect(result).toBe('<p>Safe</p><a rel="noopener noreferrer">Bad link</a>');
  });

  it("accepts exact organization domains over HTTPS without trusting subdomains", () => {
    const result = sanitizeResourceHtml(
      '<iframe src="https://references.example/embed/1"></iframe><iframe src="https://untrusted.references.example/embed/2"></iframe><iframe src="http://references.example/embed/3"></iframe>',
      ["references.example"],
    );

    expect(result).toContain("https://references.example/embed/1");
    expect(result).not.toContain("untrusted.references.example");
    expect(result).not.toContain("http://references.example");
  });
});
