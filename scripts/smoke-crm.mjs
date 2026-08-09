const baseUrl = process.env.PROGRAMLOOM_SMOKE_URL ?? "http://localhost:5179";
const session = process.env.PROGRAMLOOM_SMOKE_SESSION;
const organizationId =
  process.env.PROGRAMLOOM_SMOKE_ORGANIZATION ??
  "00000000-0000-4000-8000-000000000002";
const eventId =
  process.env.PROGRAMLOOM_SMOKE_EVENT ?? "00000000-0000-4000-8000-000000000003";
const organizationSlug =
  process.env.PROGRAMLOOM_SMOKE_ORGANIZATION_SLUG ?? "local-events";

if (!session) {
  throw new Error(
    "Set PROGRAMLOOM_SMOKE_SESSION to a disposable local session token.",
  );
}

async function api(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie: `programloom_session=${session}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const suffix = Date.now();
const first = await api(`/api/crm/organizations/${organizationId}/contacts`, {
  method: "POST",
  body: JSON.stringify({
    firstName: "Priya",
    lastName: "Raman",
    email: `priya.${suffix}@example.com`,
    company: "Latticework Systems",
    jobTitle: "VP Platform",
    bio: "Builds reliable developer platforms.",
    tags: ["AI", "Keynote"],
    social: { linkedin: "https://www.linkedin.com/in/example" },
    source: "manual",
  }),
});
const second = await api(`/api/crm/organizations/${organizationId}/contacts`, {
  method: "POST",
  body: JSON.stringify({
    firstName: "Miguel",
    lastName: "Santos",
    email: `miguel.${suffix}@example.com`,
    company: "Northstar Cloud",
    jobTitle: "Staff Engineer",
    tags: ["Platform"],
    social: {},
    source: "import",
  }),
});
const duplicate = await api(
  `/api/crm/organizations/${organizationId}/contacts`,
  {
    method: "POST",
    body: JSON.stringify({
      firstName: "Priya",
      lastName: "Raman",
      email: `priya.duplicate.${suffix}@example.com`,
      company: "Latticework Systems",
      jobTitle: "VP Platform",
      tags: ["AI"],
      social: {},
      source: "manual",
    }),
  },
);

const filtered = await api(
  `/api/crm/organizations/${organizationId}/contacts?search=latticework&tag=AI`,
);
assert(
  filtered.contacts.some((contact) => contact.id === first.contact.id),
  "Directory filtering did not return the expected contact.",
);

await api(
  `/api/crm/organizations/${organizationId}/contacts/${first.contact.id}/notes`,
  {
    method: "POST",
    body: JSON.stringify({
      body: "Met at DevFlow 2026 — shortlist for keynote.",
    }),
  },
);
const detail = await api(
  `/api/crm/organizations/${organizationId}/contacts/${first.contact.id}`,
);
assert(
  detail.notes.some((note) => note.body.includes("shortlist")),
  "Contact note did not persist.",
);

const field = await api(`/api/crm/organizations/${organizationId}/fields`, {
  method: "POST",
  body: JSON.stringify({
    name: `Speaker Type ${suffix}`,
    fieldType: "select",
    options: ["Internal", "External"],
  }),
});
await api(
  `/api/crm/organizations/${organizationId}/contacts/${first.contact.id}`,
  {
    method: "PATCH",
    body: JSON.stringify({ customFields: { [field.field.id]: "External" } }),
  },
);

const segment = await api(`/api/crm/organizations/${organizationId}/segments`, {
  method: "POST",
  body: JSON.stringify({
    name: `AI Experts ${suffix}`,
    segmentType: "dynamic",
    filter: { companies: ["Latticework Systems"], jobTitles: [], tags: ["AI"] },
    contactIds: [],
  }),
});
const segmentMembers = await api(
  `/api/crm/organizations/${organizationId}/segments/${segment.segment.id}`,
);
assert(
  segmentMembers.contacts.some((contact) => contact.id === first.contact.id),
  "Dynamic segment did not resolve its member.",
);

const card = await api(`/api/crm/organizations/${organizationId}/pipeline`, {
  method: "POST",
  body: JSON.stringify({
    contactId: first.contact.id,
    stage: "identified",
    score: 92,
    rationale: "Strong platform expertise.",
  }),
});
await api(`/api/crm/organizations/${organizationId}/pipeline/${card.card.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    stage: "contacted",
    note: "Personal invitation sent.",
  }),
});
await api(
  `/api/crm/organizations/${organizationId}/pipeline/${card.card.id}/notes`,
  {
    method: "POST",
    body: JSON.stringify({ body: "Follow up next week." }),
  },
);
const cardDetail = await api(
  `/api/crm/organizations/${organizationId}/pipeline/${card.card.id}`,
);
assert(
  cardDetail.card.stage === "contacted" && cardDetail.history.length >= 2,
  "Pipeline stage history did not persist.",
);

await api(`/api/crm/organizations/${organizationId}/handoff`, {
  method: "POST",
  body: JSON.stringify({ contactId: first.contact.id, eventId }),
});
const afterHandoff = await api(
  `/api/crm/organizations/${organizationId}/contacts/${first.contact.id}`,
);
assert(
  afterHandoff.connections.some((event) => event.id === eventId),
  "Event handoff did not create a durable connection.",
);

const imported = await api(`/api/crm/organizations/${organizationId}/import`, {
  method: "POST",
  body: JSON.stringify({
    mode: "create_and_update",
    rows: [
      {
        firstName: "Miguel",
        lastName: "Santos",
        email: second.contact.email,
        company: "Northstar Cloud",
        jobTitle: "Principal Engineer",
        tags: ["Platform", "Returning"],
        social: {},
        source: "import",
      },
    ],
  }),
});
assert(
  imported.updated === 1,
  "Import did not update the existing email safely.",
);

const interest = await api(
  `/api/crm/organizations/${organizationId}/interest-forms`,
  {
    method: "POST",
    body: JSON.stringify({
      name: `Speaker interest ${suffix}`,
      title: "Share your expertise with DevFlow",
      description: "Join the year-round speaker network.",
      mode: "sessions_and_speakers",
      eventIds: [],
      fields: [
        {
          key: "linkedin",
          label: "LinkedIn profile",
          type: "url",
          required: false,
          options: [],
        },
        {
          key: "areas",
          label: "Areas of expertise",
          type: "text",
          required: true,
          options: [],
        },
      ],
      managerIds: [],
      notification: { organizerConfirmation: true },
      published: true,
    }),
  },
);
const publicInterest = await api(
  `/api/crm/public/${organizationSlug}/${interest.form.slug}`,
);
assert(
  publicInterest.form.accepting === true &&
    publicInterest.form.fields.length === 2,
  "Published interest form was not available publicly.",
);

await api(`/api/crm/organizations/${organizationId}/merge`, {
  method: "POST",
  body: JSON.stringify({
    primaryId: first.contact.id,
    duplicateIds: [duplicate.contact.id],
    preferred: { email: duplicate.contact.id },
  }),
});
const merged = await api(
  `/api/crm/organizations/${organizationId}/contacts/${first.contact.id}`,
);
assert(
  merged.contact.email === duplicate.contact.email,
  "Merge did not preserve the selected duplicate email.",
);

const overview = await api(`/api/crm/organizations/${organizationId}/overview`);
assert(
  Number(overview.totals.contacts) >= 2,
  "CRM dashboard totals were not updated.",
);

console.log(
  JSON.stringify({
    ok: true,
    contactsCreated: 3,
    filtered: filtered.total,
    segmentMembers: segmentMembers.contacts.length,
    pipelineStage: cardDetail.card.stage,
    eventConnections: afterHandoff.connections.length,
    importedUpdated: imported.updated,
    interestFormPublished: publicInterest.form.accepting,
    duplicateMerged: merged.contact.email === duplicate.contact.email,
  }),
);
