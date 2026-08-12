import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ProgramLoom Help",
  description:
    "Plain-language guidance for planning proposals, reviews, speakers, schedules, and public event programs with ProgramLoom.",
  lang: "en-US",
  base: "/help/",
  cleanUrls: true,
  outDir: "../dist/client/help",
  sitemap: { hostname: "https://programloom.com/help/" },
  transformHead({ pageData }) {
    const cleanPath = pageData.relativePath
      .replace(/(?:^|\/)index\.md$/, "")
      .replace(/\.md$/, "");
    const url = `https://programloom.com/help/${cleanPath}`;
    const title =
      pageData.title && pageData.title !== "ProgramLoom Help"
        ? `${pageData.title} | ProgramLoom Help`
        : "ProgramLoom Help";
    const description =
      pageData.description ||
      "Plain-language guidance for proposals, reviews, speakers, schedules, and public event programs.";
    return [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
    ];
  },
  head: [
    ["meta", { name: "theme-color", content: "#315c45" }],
    ["link", { rel: "icon", href: "/help/favicon.svg", type: "image/svg+xml" }],
    ["meta", { property: "og:site_name", content: "ProgramLoom" }],
    ["meta", { property: "og:type", content: "website" }],
    [
      "meta",
      {
        property: "og:image",
        content: "https://programloom.com/programloom-og.jpg",
      },
    ],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    [
      "meta",
      {
        property: "og:image:alt",
        content:
          "Program cards, speaker profiles, messages, and a calendar connected into one organized event schedule.",
      },
    ],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    [
      "meta",
      {
        name: "twitter:image",
        content: "https://programloom.com/programloom-twitter.jpg",
      },
    ],
  ],
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "ProgramLoom Help",
    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "Search help", buttonAriaLabel: "Search help" },
        },
      },
    },
    nav: [
      { text: "Help home", link: "/" },
      { text: "Organizers", link: "/organizers/control-room" },
      { text: "Reviewers", link: "/reviewers" },
      { text: "Speakers", link: "/speakers" },
      { text: "Open ProgramLoom", link: "https://app.programloom.com/app" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Welcome to ProgramLoom", link: "/" },
          { text: "Create your first event", link: "/getting-started" },
          { text: "Words used in ProgramLoom", link: "/glossary" },
        ],
      },
      {
        text: "For organizers",
        items: [
          { text: "Use the Control Room", link: "/organizers/control-room" },
          { text: "Collect proposals", link: "/organizers/proposals" },
          { text: "Assign and collect reviews", link: "/organizers/reviewing" },
          { text: "Make and send decisions", link: "/organizers/decisions" },
          { text: "Prepare speakers", link: "/organizers/speakers" },
          { text: "Collect and approve content", link: "/organizers/content" },
          {
            text: "Send and track messages",
            link: "/organizers/communications",
          },
          { text: "Build the schedule", link: "/organizers/schedule" },
          { text: "Publish for attendees", link: "/organizers/publish" },
          {
            text: "Search and notifications",
            link: "/organizers/search-notifications",
          },
          { text: "Reuse events and templates", link: "/organizers/templates" },
          { text: "Manage speaker relationships", link: "/organizers/crm" },
          { text: "Invite your team", link: "/organizers/team-access" },
          { text: "Connect other tools", link: "/organizers/integrations" },
        ],
      },
      {
        text: "For everyone",
        items: [
          { text: "Reviewer guide", link: "/reviewers" },
          { text: "Speaker guide", link: "/speakers" },
          { text: "Attendee guide", link: "/attendees" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ],
      },
    ],
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous guide", next: "Next guide" },
    footer: {
      message: "ProgramLoom is open-source event program software.",
      copyright: "Copyright 2026 ProgramLoom contributors · AGPL-3.0",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/maddiedreese/SaaS" },
    ],
  },
});
