import DOMPurify from "dompurify";

const allowedEmbedPrefixes = [
  "https://www.youtube.com/embed/",
  "https://player.vimeo.com/video/",
  "https://docs.google.com/presentation/",
];

export function sanitizeResourceHtml(html: string): string {
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
    if (!allowedEmbedPrefixes.some((prefix) => source.startsWith(prefix))) {
      frame.remove();
      return;
    }
    frame.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
    frame.setAttribute("loading", "lazy");
  });

  return document.body.innerHTML;
}
