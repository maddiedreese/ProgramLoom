import sanitizeHtml from "sanitize-html";

export const defaultEmbedDomains = [
  "www.youtube.com",
  "player.vimeo.com",
  "docs.google.com",
];

function normalizedDomains(domains: string[]) {
  return [...new Set([...defaultEmbedDomains, ...domains])]
    .map(
      (domain) =>
        domain
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .split("/")[0],
    )
    .filter((domain) =>
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        domain,
      ),
    );
}

export function sanitizeResourceHtmlServer(
  raw: string,
  configuredDomains: string[],
) {
  const domains = normalizedDomains(configuredDomains);
  const removals = new Set<string>();
  if (/<script\b/i.test(raw))
    removals.add("Scripts are not allowed and were removed.");
  if (/\son[a-z]+\s*=/i.test(raw))
    removals.add("Event-handler attributes are not allowed and were removed.");
  if (/<form\b|<input\b|<button\b/i.test(raw))
    removals.add(
      "Forms and interactive form controls are not allowed and were removed.",
    );
  if (/javascript:|data:text\/html/i.test(raw))
    removals.add("Unsafe URL schemes are not allowed and were removed.");
  const html = sanitizeHtml(raw, {
    allowedTags: [
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
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      iframe: [
        "src",
        "title",
        "sandbox",
        "loading",
        "referrerpolicy",
        "allow",
        "allowfullscreen",
        "class",
      ],
    },
    allowedSchemes: ["https", "mailto"],
    allowProtocolRelative: false,
    exclusiveFilter(frame) {
      if (frame.tag !== "iframe") return false;
      const source = frame.attribs.src ?? "";
      try {
        const url = new URL(source);
        if (
          url.protocol !== "https:" ||
          !domains.includes(url.hostname.toLowerCase())
        ) {
          removals.add(
            `An iframe from ${url.hostname || "an unknown domain"} was removed because its HTTPS domain is not allowed.`,
          );
          return true;
        }
      } catch {
        removals.add("An iframe with an invalid URL was removed.");
        return true;
      }
      return false;
    },
    transformTags: {
      a(_tag, attributes) {
        return {
          tagName: "a",
          attribs: {
            ...attributes,
            ...(attributes.target === "_blank" ? { target: "_blank" } : {}),
            rel: "noopener noreferrer",
          },
        };
      },
      iframe(_tag, attributes) {
        return {
          tagName: "iframe",
          attribs: {
            src: attributes.src ?? "",
            title: attributes.title ?? "Embedded reference",
            sandbox: "allow-scripts allow-same-origin allow-presentation",
            loading: "lazy",
            referrerpolicy: "no-referrer",
            class: "resource-embed",
            allow: "fullscreen",
          },
        };
      },
    },
  });
  if (html.trim() !== raw.trim() && !removals.size)
    removals.add("Unsupported HTML elements or attributes were removed.");
  return { html, removals: [...removals], allowedDomains: domains };
}
