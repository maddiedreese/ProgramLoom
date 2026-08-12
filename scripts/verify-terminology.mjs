import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(
    (path) =>
      /^(README\.md|src\/|worker\/|help\/|docs\/|scripts\/|e2e\/)/.test(path) &&
      !/\.(png|jpe?g|gif|ico|pdf|ics)$/.test(path) &&
      !path.startsWith("docs/evidence/") &&
      path !== "scripts/verify-terminology.mjs",
  );

const forbidden = [
  "evaluate proposals",
  "decide & communicate",
  "decide and communicate",
  "choosing an outcome",
  "staging an outcome",
  "decision email",
  "review submissions",
  "notify submitters",
  "proposal or submission",
];
const errors = [];
for (const path of files) {
  const content = (await readFile(resolve(root, path), "utf8")).toLowerCase();
  for (const phrase of forbidden)
    if (content.includes(phrase))
      errors.push(`${path}: conflicting phrase “${phrase}”`);
}

const glossary = await readFile(resolve(root, "help/glossary.md"), "utf8");
for (const concept of [
  "**Proposal**",
  "**Review**",
  "**Decision**",
  "**Send decision**",
  "**Onboarding tasks**",
  "**Content requests**",
  "**Agenda placement**",
  "**Publish agenda**",
  "**Calendar invitation**",
])
  if (!glossary.includes(concept))
    errors.push(`help/glossary.md: missing ${concept}`);

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Terminology verified across ${files.length} repository files.`);
}
