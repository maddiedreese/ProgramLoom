import { execFileSync } from "node:child_process";
import { request } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const required = [
  "PROGRAMLOOM_E2E_STORAGE_STATE",
  "PROGRAMLOOM_SPEAKER_STORAGE_STATE",
  "PROGRAMLOOM_REVIEWER_STORAGE_STATE",
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
const marketingURL =
  process.env.PROGRAMLOOM_MARKETING_URL ?? "https://programloom.com";
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

async function verifyPersonaAccess(storageState, email, expectedRole, eventId) {
  const personaContext = await request.newContext({ baseURL, storageState });
  try {
    const sessionResponse = await personaContext.get("/api/auth/session");
    const session = await sessionResponse.json();
    if (
      !sessionResponse.ok() ||
      session.user?.email?.toLowerCase() !== email.toLowerCase()
    )
      throw new Error(`${expectedRole} storage state has the wrong identity.`);
    const eventResponse = await personaContext.get(`/api/events/${eventId}`);
    const eventAccess = await eventResponse.json();
    if (!eventResponse.ok() || eventAccess.role !== expectedRole)
      throw new Error(`${expectedRole} event access was not provisioned.`);
  } finally {
    await personaContext.dispose();
  }
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
let createdEvent;

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
  createdEvent = event;

  const fixtureTracks = [
    "AI Engineering",
    "Platform & Infra",
    "Developer Experience",
  ];
  let trackWorkspace = await api(`/api/events/${event.id}/tracks`);
  for (const name of fixtureTracks) {
    if (trackWorkspace.tracks.some((track) => track.name === name)) continue;
    await api(`/api/events/${event.id}/tracks`, {
      method: "POST",
      body: { name, color: "#315c45" },
    });
  }
  trackWorkspace = await api(`/api/events/${event.id}/tracks`);
  if (
    fixtureTracks.some(
      (name) => !trackWorkspace.tracks.some((track) => track.name === name),
    )
  )
    throw new Error("The isolated event is missing a fixture track.");

  const wrangler = resolve(workspace, "node_modules/.bin/wrangler");
  const membershipSql = `
INSERT OR IGNORE INTO event_members(event_id,user_id,role,invited_by)
SELECT ${quote(event.id)},id,'speaker',${quote(session.user.id)} FROM users
WHERE email=${quote(process.env.PROGRAMLOOM_SPEAKER_EMAIL)} COLLATE NOCASE;
INSERT OR IGNORE INTO event_members(event_id,user_id,role,invited_by)
SELECT ${quote(event.id)},id,'reviewer',${quote(session.user.id)} FROM users
WHERE email=${quote(process.env.PROGRAMLOOM_REVIEWER_EMAIL)} COLLATE NOCASE;`;
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
  await verifyPersonaAccess(
    process.env.PROGRAMLOOM_SPEAKER_STORAGE_STATE,
    process.env.PROGRAMLOOM_SPEAKER_EMAIL,
    "speaker",
    event.id,
  );
  await verifyPersonaAccess(
    process.env.PROGRAMLOOM_REVIEWER_STORAGE_STATE,
    process.env.PROGRAMLOOM_REVIEWER_EMAIL,
    "reviewer",
    event.id,
  );

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

  const widgetTypes = [
    ["sessions", "Sessions list"],
    ["speakers", "Speaker directory"],
    ["agenda", "Agenda"],
    ["itinerary", "Personal itinerary"],
    ["gallery", "Speaker gallery"],
  ];
  let widgetWorkspace = await api(`/api/widgets/admin/events/${event.id}`);
  for (const [widgetType, name] of widgetTypes) {
    if (
      widgetWorkspace.widgets.some((widget) => widget.widgetType === widgetType)
    )
      continue;
    await api(`/api/widgets/admin/events/${event.id}`, {
      method: "POST",
      body: {
        name,
        widgetType,
        config: {
          theme: "light",
          primaryColor: "#315c45",
          showSearch: true,
          showFilters: true,
          trackIds: [],
          fields: [
            "title",
            "abstract",
            "speakers",
            "track",
            "room",
            "time",
            "company",
            "bio",
          ],
        },
      },
    });
  }
  widgetWorkspace = await api(`/api/widgets/admin/events/${event.id}`);
  if (
    widgetWorkspace.widgets.length !== widgetTypes.length ||
    widgetTypes.some(
      ([widgetType]) =>
        !widgetWorkspace.widgets.some(
          (widget) => widget.widgetType === widgetType,
        ),
    )
  )
    throw new Error("The isolated event is missing a required public widget.");

  const { forms } = await api(`/api/events/${event.id}/forms`);
  if (forms.length !== 1)
    throw new Error(`Expected exactly one CFP form; found ${forms.length}.`);
  // Keep "open now" deterministic across time zones and overnight runs. The
  // scenario can still edit these values, but it never begins on a translated
  // future starter-template timestamp.
  await api(`/api/events/${event.id}/forms/${forms[0].id}`, {
    method: "PATCH",
    body: {
      opensAt: "2026-08-10T12:00:00.000-07:00",
      closesAt: "2027-04-30T23:59:00.000-07:00",
      editClosesAt: "2027-04-30T23:59:00.000-07:00",
    },
  });
  let formDefinition = await api(
    `/api/events/${event.id}/forms/${forms[0].id}`,
  );
  const formatField = formDefinition.fields.find(
    (field) => field.fieldKey === "format",
  );
  if (!formatField)
    throw new Error("The isolated CFP is missing its format field.");
  const fixtureFormats = [
    "Keynote (45 min)",
    "Talk (30 min)",
    "Lightning Talk (10 min)",
    "Workshop (120 min)",
    "Panel (45 min)",
  ];
  await api(
    `/api/events/${event.id}/forms/${forms[0].id}/fields/${formatField.id}`,
    { method: "PATCH", body: { options: fixtureFormats } },
  );
  const evaluatorFields = [
    {
      section: "session",
      fieldType: "select",
      fieldKey: "track",
      label: "Track",
      required: true,
      searchable: true,
      options: fixtureTracks,
    },
    {
      section: "speaker",
      fieldType: "textarea",
      fieldKey: "speaker_bio",
      label: "Speaker bio",
      required: true,
      searchable: true,
    },
    {
      section: "custom",
      fieldType: "text",
      fieldKey: "key_takeaway",
      label: "Key takeaway",
      required: true,
      searchable: true,
    },
    {
      section: "custom",
      fieldType: "select",
      fieldKey: "audience_level",
      label: "Audience level",
      required: false,
      searchable: true,
      options: ["Beginner", "Intermediate", "Advanced"],
    },
    {
      section: "custom",
      fieldType: "textarea",
      fieldKey: "workshop_prerequisites",
      label: "Workshop prerequisites",
      required: false,
      searchable: false,
    },
  ];
  for (const field of evaluatorFields) {
    if (formDefinition.fields.some((item) => item.fieldKey === field.fieldKey))
      continue;
    await api(`/api/events/${event.id}/forms/${forms[0].id}/fields`, {
      method: "POST",
      body: field,
    });
  }
  formDefinition = await api(`/api/events/${event.id}/forms/${forms[0].id}`);
  const preparedFormatField = formDefinition.fields.find(
    (field) => field.fieldKey === "format",
  );
  const workshopField = formDefinition.fields.find(
    (field) => field.fieldKey === "workshop_prerequisites",
  );
  const workshopCondition = formDefinition.conditions.some(
    (condition) =>
      condition.sourceFieldId === preparedFormatField?.id &&
      condition.targetFieldId === workshopField?.id &&
      condition.action === "show" &&
      condition.operator === "equals" &&
      condition.compareValue === "Workshop (120 min)",
  );
  if (!workshopCondition) {
    if (!preparedFormatField || !workshopField)
      throw new Error("The isolated CFP is missing conditional field inputs.");
    await api(`/api/events/${event.id}/forms/${forms[0].id}/conditions`, {
      method: "POST",
      body: {
        sourceFieldId: preparedFormatField.id,
        operator: "equals",
        compareValue: "Workshop (120 min)",
        targetFieldId: workshopField.id,
        action: "show",
      },
    });
  }
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
    publicWidgets: Object.fromEntries(
      widgetWorkspace.widgets.map((widget) => [
        widget.widgetType,
        `${marketingURL}/embed/${widget.publicKey}`,
      ]),
    ),
    formId: forms[0].id,
    expectedInitialState: {
      forms: 1,
      publishedForms: 0,
      submissions: 0,
      reviewRounds: 1,
      reviewRoundName: "CFP Review",
      reviewAssignments: 0,
      widgetConfigs: 5,
      fixtureTracks,
      fixtureFormats,
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
} catch (error) {
  if (createdEvent?.id) {
    try {
      await api(`/api/events/${createdEvent.id}`, {
        method: "PATCH",
        body: {
          name: `${eventName} (setup failed)`,
          status: "archived",
        },
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Evaluator preparation failed and event ${createdEvent.id} could not be archived safely.`,
      );
    }
  }
  throw error;
} finally {
  await context.dispose();
}
