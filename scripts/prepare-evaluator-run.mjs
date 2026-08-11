import { execFileSync } from "node:child_process";
import { request } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const required = [
  "PROGRAMLOOM_E2E_STORAGE_STATE",
  "PROGRAMLOOM_ORGANIZER_EMAIL",
  "PROGRAMLOOM_SPEAKER_EMAIL",
  "PROGRAMLOOM_REVIEWER_EMAIL",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}
if (process.env.PROGRAMLOOM_PRODUCTION_CONFIRM !== "programloom-production") {
  throw new Error(
    "Set PROGRAMLOOM_PRODUCTION_CONFIRM=programloom-production to create an isolated evaluator event.",
  );
}

const baseURL =
  process.env.PROGRAMLOOM_E2E_URL ?? "https://app.programloom.com";
const runId = (
  process.env.PROGRAMLOOM_EVALUATOR_RUN_ID ??
  new Date().toISOString().replace(/\D/g, "").slice(0, 14)
)
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-");
const eventName = `DevFlow Conf 2027 — Evaluator ${runId}`;
const eventSlug = `devflow-evaluator-${runId}`.slice(0, 64);
const workspace = resolve(fileURLToPath(new URL("../", import.meta.url)));
const context = await request.newContext({
  baseURL,
  storageState: process.env.PROGRAMLOOM_E2E_STORAGE_STATE,
});

async function api(path, init = {}) {
  const { body, ...options } = init;
  const response = await context.fetch(path, {
    ...options,
    ...(body ? { data: body } : {}),
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok()) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status()} ${value?.error?.code ?? "request_failed"} request=${value?.requestId ?? "missing"}`,
    );
  }
  return value;
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

try {
  const session = await api("/api/auth/session");
  if (
    session.user?.email?.toLowerCase() !==
    process.env.PROGRAMLOOM_ORGANIZER_EMAIL.toLowerCase()
  ) {
    throw new Error("The storage state is not the approved organizer persona.");
  }
  const { organizations } = await api("/api/organizations");
  const organization = organizations.find(
    (item) => item.role === "owner" && item.storageMode === "airtable",
  );
  if (!organization)
    throw new Error("No owned Airtable-authoritative workspace is available.");

  const domains = [
    "cfp",
    "onboarding",
    "resources",
    "communications",
    "roomsTracksLocations",
    "contentWorkflow",
    "widgets",
    "crm",
  ];
  const target = {
    name: eventName,
    slug: eventSlug,
    timezone: "America/Los_Angeles",
    startsAt: "2027-05-12T16:00:00.000Z",
    endsAt: "2027-05-15T00:00:00.000Z",
    venueName: "DevFlow Convention Center",
    websiteUrl: "https://programloom.com",
  };
  const source = { kind: "starter_template", id: "conference" };
  await api(`/api/event-templates/organizations/${organization.id}/preview`, {
    method: "POST",
    body: { source, domains, target },
  });
  const created = await api(
    `/api/event-templates/organizations/${organization.id}/events`,
    {
      method: "POST",
      body: { source, domains, target, confirmPreview: true },
    },
  );
  const event = created.event;

  const wrangler = resolve(workspace, "node_modules/.bin/wrangler");
  const membershipSql = `
INSERT INTO event_members(event_id,user_id,role,invited_by)
SELECT ${quote(event.id)},id,'speaker',${quote(session.user.id)} FROM users
WHERE email=${quote(process.env.PROGRAMLOOM_SPEAKER_EMAIL)} COLLATE NOCASE
ON CONFLICT(event_id,user_id) DO UPDATE SET role='speaker';
INSERT INTO event_members(event_id,user_id,role,invited_by)
SELECT ${quote(event.id)},id,'reviewer',${quote(session.user.id)} FROM users
WHERE email=${quote(process.env.PROGRAMLOOM_REVIEWER_EMAIL)} COLLATE NOCASE
ON CONFLICT(event_id,user_id) DO UPDATE SET role='reviewer';`;
  const membershipResult = JSON.parse(
    execFileSync(
      wrangler,
      [
        "d1",
        "execute",
        "programloom-production",
        "--remote",
        "--json",
        "--command",
        membershipSql,
      ],
      {
        cwd: workspace,
        encoding: "utf8",
        env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler.log" },
      },
    ),
  );
  if (!membershipResult.every((result) => result.success))
    throw new Error("Evaluator persona membership provisioning failed.");

  let reviews = await api(`/api/reviews/events/${event.id}`);
  const reviewer = reviews.reviewers.find(
    (item) =>
      item.email.toLowerCase() ===
      process.env.PROGRAMLOOM_REVIEWER_EMAIL.toLowerCase(),
  );
  if (!reviewer)
    throw new Error("The evaluator reviewer persona was not provisioned.");
  const basicRound = (
    await api(`/api/reviews/events/${event.id}/rounds`, {
      method: "POST",
      body: {
        name: "CFP Review",
        isBlind: false,
        opensAt: "2026-08-01T00:00:00.000Z",
        closesAt: "2027-04-30T23:59:00.000Z",
      },
    })
  ).round;
  await api(`/api/reviews/events/${event.id}/rounds/${basicRound.id}/fields`, {
    method: "POST",
    body: {
      label: "Rating",
      fieldType: "numeric",
      minValue: 1,
      maxValue: 5,
      weight: 1,
      required: true,
    },
  });
  await api(
    `/api/reviews/events/${event.id}/rounds/${basicRound.id}/reviewer-pool`,
    {
      method: "PUT",
      body: {
        reviewers: [{ reviewerUserId: reviewer.id, capacity: 20 }],
      },
    },
  );
  await api(`/api/reviews/events/${event.id}/rounds/${basicRound.id}`, {
    method: "PATCH",
    body: { status: "open" },
  });

  const { forms } = await api(`/api/events/${event.id}/forms`);
  if (forms.length !== 1)
    throw new Error(`Expected exactly one CFP form; found ${forms.length}.`);
  if (forms[0].publishedAt) {
    await api(`/api/events/${event.id}/forms/${forms[0].id}`, {
      method: "PATCH",
      body: { published: false },
    });
  }
  reviews = await api(`/api/reviews/events/${event.id}`);
  const submissions = await api(`/api/events/${event.id}/submissions`);
  if (
    reviews.rounds.length !== 1 ||
    reviews.rounds[0].name !== "CFP Review" ||
    reviews.rounds[0].assignmentCount !== 0
  )
    throw new Error("The isolated event has an invalid CFP review baseline.");
  if (submissions.submissions.length)
    throw new Error("The isolated event unexpectedly contains submissions.");

  const manifest = {
    runId,
    organizationId: organization.id,
    eventId: event.id,
    eventName,
    eventSlug,
    eventRoute: `${baseURL}/app/events/${event.id}`,
    publicCfpRoute: `${baseURL}/c/${organization.slug}/${eventSlug}/${forms[0].slug}`,
    formId: forms[0].id,
    expectedInitialState: {
      forms: 1,
      publishedForms: 0,
      submissions: 0,
      reviewRounds: 1,
      reviewRoundName: "CFP Review",
      reviewAssignments: 0,
      startsAt: target.startsAt,
      endsAt: target.endsAt,
      timezone: target.timezone,
    },
    personas: {
      organizer: process.env.PROGRAMLOOM_ORGANIZER_EMAIL,
      speaker: process.env.PROGRAMLOOM_SPEAKER_EMAIL,
      reviewer: process.env.PROGRAMLOOM_REVIEWER_EMAIL,
    },
  };
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await context.dispose();
}
