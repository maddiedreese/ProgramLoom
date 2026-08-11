import DOMPurify from "dompurify";

export const defaultResourceEmbedDomains = [
  "www.youtube.com",
  "player.vimeo.com",
  "docs.google.com",
];

export function sanitizeResourceHtml(
  html: string,
  configuredDomains: string[] = defaultResourceEmbedDomains,
): string {
  const allowedDomains = new Set(
    [...defaultResourceEmbedDomains, ...configuredDomains].map((domain) =>
      domain.toLowerCase(),
    ),
  );
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "h2",
      "h3",
      "h4",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "blockquote",
      "code",
      "pre",
      "iframe",
    ],
    ALLOWED_ATTR: [
      "href",
      "title",
      "target",
      "rel",
      "src",
      "width",
      "height",
      "allow",
      "allowfullscreen",
      "loading",
      "sandbox",
      "referrerpolicy",
      "class",
    ],
    ALLOW_DATA_ATTR: false,
  });
  const document = new DOMParser().parseFromString(sanitized, "text/html");

  document.querySelectorAll("a").forEach((link) => {
    link.setAttribute("rel", "noopener noreferrer");
    if (link.getAttribute("target") === "_blank")
      link.setAttribute("target", "_blank");
    else link.removeAttribute("target");
  });
  document.querySelectorAll("iframe").forEach((frame) => {
    const source = frame.getAttribute("src") ?? "";
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      frame.remove();
      return;
    }
    if (
      url.protocol !== "https:" ||
      !allowedDomains.has(url.hostname.toLowerCase())
    ) {
      frame.remove();
      return;
    }
    frame.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("class", "resource-embed");
    frame.setAttribute(
      "title",
      frame.getAttribute("title") || "Embedded reference",
    );
  });

  return document.body.innerHTML;
}
