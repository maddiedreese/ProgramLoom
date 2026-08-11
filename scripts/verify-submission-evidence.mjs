import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const final = process.argv.includes("--final");
const root = new URL("../", import.meta.url);
const load = (path) => readFile(new URL(path, root), "utf8");
const requiredPromise =
  "ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.";
const errors = [];

const manifestPath =
  process.env.PROGRAMLOOM_EVIDENCE_MANIFEST ??
  "docs/evidence/production-manifest.json";
const manifestFile = isAbsolute(manifestPath)
  ? manifestPath
  : fileURLToPath(new URL(manifestPath, root));
const manifestDirectory = dirname(manifestFile);
const [readme, guide, routeMap, parity, matrix, evidence, manifestText] =
  await Promise.all([
    load("README.md"),
    load("docs/evaluator-guide.md"),
    load("docs/evaluator-route-map.md"),
    load("docs/parity-map.md"),
    load("docs/evaluation-matrix.md"),
    load("docs/evidence/README.md"),
    readFile(manifestFile, "utf8"),
  ]);
const manifest = JSON.parse(manifestText);
const communicationStates = [
  "prepared",
  "queued",
  "processing",
  "sent",
  "delivered",
  "bounced",
  "failed",
  "cancelled",
];
const exactCalendarScope = {
  tested: ["Gmail", "Apple Calendar"],
  waived: ["Outlook"],
};

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
if (manifest.schemaVersion !== 2)
  errors.push("Unsupported production evidence manifest schema.");
if (
  JSON.stringify(manifest.communications?.states) !==
  JSON.stringify(communicationStates)
)
  errors.push("Communication states do not use the canonical lifecycle.");
if (
  JSON.stringify(manifest.calendarClients) !==
  JSON.stringify(exactCalendarScope)
)
  errors.push("Calendar claims must name only Gmail/Apple and waive Outlook.");
if (manifest.production?.publicWidgetUrls?.length !== 5)
  errors.push("Manifest must contain exactly five public widget URLs.");
for (const url of manifest.production?.publicWidgetUrls ?? []) {
  if (!routeMap.includes(url))
    errors.push(`Evaluator route map is missing widget URL ${url}.`);
}

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
  if (
    !Number.isInteger(manifest.controlRoom?.openItems) ||
    manifest.controlRoom.openItems < 0
  )
    errors.push("Final Control Room open-item count is missing or invalid.");
  if (
    manifest.controlRoom?.openItems > 0 &&
    !String(manifest.controlRoom?.explanation ?? "").trim()
  )
    errors.push(
      "A nonzero final Control Room needs an explicit reconciliation explanation.",
    );
  if (
    !Number.isInteger(manifest.tests?.unitFiles) ||
    manifest.tests.unitFiles < 1 ||
    !Number.isInteger(manifest.tests?.unitCases) ||
    manifest.tests.unitCases < 1
  )
    errors.push("Final unit test counts are missing or invalid.");
  if (
    !Number.isInteger(manifest.tests?.playwrightExecuted) ||
    manifest.tests.playwrightExecuted < 1 ||
    manifest.tests.playwrightExecuted !== manifest.tests.playwrightPassed ||
    manifest.tests.desktopAndMobile !== true
  )
    errors.push(
      "Final desktop/mobile Playwright counts are not fully passing.",
    );
  if (
    manifest.evaluator?.areas !== 7 ||
    manifest.evaluator?.scenarios !== 20 ||
    manifest.evaluator?.criteria !== 96 ||
    manifest.evaluator?.manualPending !== 0
  )
    errors.push("Final evaluator counts or manual-checklist state are stale.");
  for (const field of [
    "route",
    "environment",
    "cloudflareRegion",
    "device",
    "method",
  ]) {
    if (!String(manifest.performance?.[field] ?? "").trim())
      errors.push(`Final performance evidence is missing ${field}.`);
  }
  if (!(manifest.performance?.sampleSize > 0))
    errors.push("Final performance sample size is missing or invalid.");
  if (!manifest.walkthrough?.continuous || !manifest.walkthrough?.path)
    errors.push(
      "Final uninterrupted walkthrough is not recorded in the manifest.",
    );
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length < 8)
    errors.push(
      "Final manifest needs at least eight captioned product captures.",
    );
  if (
    !Array.isArray(manifest.evidencePaths) ||
    manifest.evidencePaths.length < 8
  )
    errors.push("Final manifest needs the complete production evidence index.");
  const referencedPaths = [
    manifest.walkthrough?.path,
    ...(manifest.evidencePaths ?? []),
    ...(manifest.screenshots ?? []).map((item) => item.path),
  ].filter(Boolean);
  for (const item of manifest.screenshots ?? []) {
    if (!String(item.caption ?? "").trim())
      errors.push(
        `Screenshot ${item.path ?? "(missing path)"} has no caption.`,
      );
  }
  for (const path of referencedPaths) {
    const target = isAbsolute(path) ? path : resolve(manifestDirectory, path);
    try {
      await access(target);
    } catch {
      errors.push(`Manifest evidence path does not exist: ${path}.`);
    }
  }
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
    ...manifest.production.publicWidgetUrls,
  ]) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) errors.push(`${url} returned HTTP ${response.status}.`);
    } catch (error) {
      errors.push(`${url} could not be reached: ${error.message}`);
    }
  }

  const unitClaim = matrix.match(/(\d+)-file\/(\d+)-test suite/);
  if (
    unitClaim &&
    (Number(unitClaim[1]) !== manifest.tests.unitFiles ||
      Number(unitClaim[2]) !== manifest.tests.unitCases)
  )
    errors.push("Traceability-matrix unit test count is stale.");
  const playwrightClaim = matrix.match(/passed (\d+)\/(\d+)/);
  if (
    playwrightClaim &&
    (Number(playwrightClaim[1]) !== manifest.tests.playwrightPassed ||
      Number(playwrightClaim[2]) !== manifest.tests.playwrightExecuted)
  )
    errors.push("Traceability-matrix Playwright count is stale.");
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
