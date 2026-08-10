import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const final = process.argv.includes("--final");
const root = new URL("../", import.meta.url);
const load = (path) => readFile(new URL(path, root), "utf8");
const requiredPromise =
  "ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.";
const errors = [];

const manifestPath =
  process.env.PROGRAMLOOM_EVIDENCE_MANIFEST ??
  "docs/evidence/production-manifest.json";
const [readme, guide, parity, evidence, manifestText] = await Promise.all([
  load("README.md"),
  load("docs/evaluator-guide.md"),
  load("docs/parity-map.md"),
  load("docs/evidence/README.md"),
  manifestPath.startsWith("/")
    ? readFile(manifestPath, "utf8")
    : load(manifestPath),
]);
const manifest = JSON.parse(manifestText);

for (const [name, content] of [
  ["README", readme],
  ["evaluator guide", guide],
  ["parity map", parity],
]) {
  if (!content.includes(requiredPromise))
    errors.push(`${name} does not contain the canonical product promise.`);
}

for (const url of [
  "https://programloom.com",
  "https://app.programloom.com",
  "https://github.com/maddiedreese/SaaS",
]) {
  if (!readme.includes(url)) errors.push(`README is missing ${url}.`);
}

if (!evidence.includes("Outlook is explicitly waived and untested"))
  errors.push("Evidence claim rules do not preserve the Outlook waiver.");
if (manifest.schemaVersion !== 1)
  errors.push("Unsupported production evidence manifest schema.");

if (final) {
  const release = manifest.release ?? {};
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL(".", root),
    encoding: "utf8",
  }).trim();
  if (manifest.status !== "final") errors.push("Manifest status is not final.");
  if (!/^[0-9a-f]{40}$/.test(release.sourceCommit ?? ""))
    errors.push("Manifest sourceCommit must be a full Git SHA.");
  else if (release.sourceCommit !== head)
    errors.push(
      `Manifest sourceCommit ${release.sourceCommit} does not match HEAD ${head}.`,
    );
  if (!/^[0-9a-f-]{36}$/i.test(release.workerVersion ?? ""))
    errors.push("Manifest workerVersion must be a Cloudflare version UUID.");
  if (!release.verifiedAt || Number.isNaN(Date.parse(release.verifiedAt)))
    errors.push("Manifest verifiedAt must be an ISO timestamp.");
  if (
    manifest.airtable?.pending !== 0 ||
    manifest.airtable?.failed !== 0 ||
    manifest.airtable?.openConflicts !== 0
  )
    errors.push(
      "Final Airtable state is not zero pending/failed/open conflicts.",
    );
  if (manifest.controlRoom?.reconciled !== true)
    errors.push("Final Control Room state is not marked reconciled.");
  if (/^- \[ \]/m.test(guide))
    errors.push(
      "Submission documentation still contains an unfinished checklist item.",
    );

  try {
    const response = await fetch(manifest.production.healthUrl, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    if (health.sourceCommit !== release.sourceCommit)
      errors.push(
        `Production source commit ${health.sourceCommit} does not match manifest ${release.sourceCommit}.`,
      );
    if (health.workerVersion !== release.workerVersion)
      errors.push(
        `Production Worker version ${health.workerVersion} does not match manifest ${release.workerVersion}.`,
      );
  } catch (error) {
    errors.push(`Could not verify production health: ${error.message}`);
  }

  for (const url of [
    manifest.production.marketingUrl,
    manifest.production.applicationUrl,
  ]) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) errors.push(`${url} returned HTTP ${response.status}.`);
    } catch (error) {
      errors.push(`${url} could not be reached: ${error.message}`);
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    final
      ? "Production claims match the deployed release and submission package."
      : "Submission evidence structure and canonical claims are consistent (draft mode).",
  );
}
