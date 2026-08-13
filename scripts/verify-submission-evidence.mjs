import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const final = process.argv.includes("--final");
const root = new URL("../", import.meta.url);
const requiredPromise =
  "ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.";
const manifestPath =
  process.env.PROGRAMLOOM_EVIDENCE_MANIFEST ??
  "docs/evidence/production-manifest.json";
const manifestFile = isAbsolute(manifestPath)
  ? manifestPath
  : fileURLToPath(new URL(manifestPath, root));
const manifestDirectory = dirname(manifestFile);
const [readme, help, manifestText] = await Promise.all([
  readFile(new URL("README.md", root), "utf8"),
  readFile(new URL("help/index.md", root), "utf8"),
  readFile(manifestFile, "utf8"),
]);
const manifest = JSON.parse(manifestText);
const errors = [];
const expectedUrls = {
  marketingUrl: "https://programloom.com",
  applicationUrl: "https://app.programloom.com",
  helpUrl: "https://programloom.com/help/",
  cfpDirectoryUrl: "https://app.programloom.com/cfp",
  healthUrl: "https://app.programloom.com/api/health",
};
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

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

requireValue(
  manifest.schemaVersion === 3,
  "Unsupported production manifest schema.",
);
requireValue(
  readme.includes(requiredPromise),
  "README has the wrong product promise.",
);
requireValue(
  help.includes("Stage decision") && help.includes("Send decision"),
  "Help uses incorrect communication-state terminology.",
);
for (const [field, url] of Object.entries(expectedUrls)) {
  requireValue(
    manifest.production?.[field] === url,
    `Wrong production URL for ${field}.`,
  );
  if (field !== "healthUrl")
    requireValue(readme.includes(url), `README is missing ${url}.`);
}
requireValue(
  JSON.stringify(manifest.communications?.states) ===
    JSON.stringify(communicationStates),
  "Communication states do not use the canonical lifecycle.",
);
requireValue(
  JSON.stringify(manifest.calendarClients) ===
    JSON.stringify({
      tested: ["Gmail", "Apple Calendar"],
      waived: ["Outlook"],
    }),
  "Unsupported calendar-client claim.",
);
requireValue(
  manifest.paidEvaluator?.status === "not_run" &&
    manifest.paidEvaluator?.count === 0,
  "Paid evaluator count is stale or the evaluator was run prematurely.",
);

if (final) {
  const release = manifest.release ?? {};
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL(".", root),
    encoding: "utf8",
  }).trim();
  requireValue(manifest.status === "final", "Manifest status is not final.");
  requireValue(
    /^[0-9a-f]{40}$/i.test(release.sourceCommit ?? ""),
    "Wrong source commit.",
  );
  if (/^[0-9a-f]{40}$/i.test(release.sourceCommit ?? "")) {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", release.sourceCommit, head],
        { cwd: new URL(".", root), stdio: "ignore" },
      );
      const postReleaseFiles = execFileSync(
        "git",
        ["diff", "--name-only", `${release.sourceCommit}..${head}`],
        { cwd: new URL(".", root), encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      requireValue(
        postReleaseFiles.every((path) => path.startsWith("docs/evidence/")),
        "Runtime source changed after the deployed source commit.",
      );
    } catch {
      errors.push("Deployed source commit is not an ancestor of the evidence commit.");
    }
  }
  requireValue(
    /^[0-9a-f-]{36}$/i.test(release.workerVersion ?? ""),
    "Wrong Worker version.",
  );
  requireValue(
    !Number.isNaN(Date.parse(release.verifiedAt ?? "")),
    "Release verification timestamp is missing.",
  );
  requireValue(
    manifest.airtable?.pending === 0 &&
      manifest.airtable?.failed === 0 &&
      manifest.airtable?.openConflicts === 0,
    "Airtable pending, failed, or conflicting state is non-zero.",
  );
  requireValue(
    manifest.controlRoom?.reconciled === true,
    "Control Room count is stale.",
  );
  requireValue(
    Number.isInteger(manifest.controlRoom?.openItems),
    "Control Room count is missing.",
  );
  requireValue(
    manifest.controlRoom.openItems === 0 ||
      Boolean(manifest.controlRoom.explanation?.trim()),
    "Non-zero Control Room count has no reconciliation explanation.",
  );
  requireValue(
    manifest.tests?.unit?.passed === manifest.tests?.unit?.executed,
    "Unit test count is stale.",
  );
  requireValue(
    manifest.tests?.desktop?.passed === manifest.tests?.desktop?.executed,
    "Desktop Playwright count is stale.",
  );
  requireValue(
    manifest.tests?.mobile?.passed === manifest.tests?.mobile?.executed,
    "Mobile Playwright count is stale.",
  );
  requireValue(
    manifest.tests?.accessibility?.serious === 0 &&
      manifest.tests?.accessibility?.critical === 0,
    "Accessibility violations remain.",
  );
  requireValue(
    manifest.tests?.skippedRequired === 0 && manifest.tests?.focused === 0,
    "Required tests were skipped or focused.",
  );
  requireValue(
    Array.isArray(manifest.commands) &&
      manifest.commands.length >= 9 &&
      manifest.commands.every((command) => command.exitStatus === 0),
    "A verification command is missing or non-zero.",
  );
  for (const field of [
    "resend",
    "calendar",
    "posthog",
    "publicWidgets",
    "authorization",
    "migrations",
    "dependencies",
    "helpCrawler",
  ]) {
    requireValue(
      manifest.evidence?.[field]?.status === "pass",
      `Missing or failing ${field} evidence artifact.`,
    );
  }
  requireValue(
    manifest.evidence.helpCrawler.brokenLinks === 0,
    "Broken README or help link.",
  );
  requireValue(
    manifest.evidence.dependencies.high === 0 &&
      manifest.evidence.dependencies.critical === 0,
    "High or critical dependency vulnerability remains.",
  );
  requireValue(
    /^https:\/\//.test(manifest.walkthrough?.url ?? ""),
    "Broken walkthrough link.",
  );
  requireValue(
    manifest.walkthrough?.continuous === true,
    "Walkthrough is not continuous.",
  );
  requireValue(
    manifest.controlRoomScreenshot?.sourceCommit === release.sourceCommit,
    "Stale Control Room screenshot path.",
  );
  const referencedPaths = [
    manifest.controlRoomScreenshot?.path,
    ...(manifest.evidencePaths ?? []),
  ].filter(Boolean);
  requireValue(referencedPaths.length >= 8, "Missing evidence artifact.");
  for (const path of referencedPaths) {
    const target = isAbsolute(path) ? path : resolve(manifestDirectory, path);
    try {
      await access(target);
    } catch {
      errors.push(`Missing evidence artifact: ${path}.`);
    }
  }

  try {
    const response = await fetch(manifest.production.healthUrl, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    requireValue(
      health.sourceCommit === release.sourceCommit,
      "Production health reports the wrong source commit.",
    );
    requireValue(
      health.workerVersion === release.workerVersion,
      "Production health reports the wrong Worker version.",
    );
  } catch (error) {
    errors.push(`Production health could not be verified: ${error.message}`);
  }
  for (const url of [
    ...Object.values(expectedUrls).filter(
      (url) => !url.endsWith("/api/health"),
    ),
    ...(manifest.production.publicWidgetUrls ?? []),
    manifest.walkthrough.url,
  ]) {
    try {
      const response = await fetch(url, { redirect: "error" });
      if (!response.ok)
        errors.push(`Broken public link ${url}: HTTP ${response.status}.`);
    } catch (error) {
      errors.push(`Broken public link ${url}: ${error.message}`);
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    final
      ? "Final production identity and evidence are consistent."
      : "Submission evidence schema and canonical claims are consistent (draft mode).",
  );
}
