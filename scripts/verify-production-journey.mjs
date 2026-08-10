import { request } from "@playwright/test";

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
    "Set PROGRAMLOOM_PRODUCTION_CONFIRM=programloom-production to authorize the disposable production journey.",
  );
}

const baseURL =
  process.env.PROGRAMLOOM_E2E_URL ?? "https://app.programloom.com";
const context = await request.newContext({
  baseURL,
  storageState: process.env.PROGRAMLOOM_E2E_STORAGE_STATE,
});

async function api(path, init = {}) {
  const { body: requestBody, ...options } = init;
  const response = await context.fetch(path, {
    ...options,
    ...(requestBody ? { data: requestBody } : {}),
    headers: {
      ...(requestBody ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) {
    const code = body?.error?.code ?? "request_failed";
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status()} ${code} request=${body?.requestId ?? "missing"}`,
    );
  }
  return body;
}

try {
  const session = await api("/api/auth/session");
  if (
    !session.user ||
    session.user.email.toLowerCase() !==
      process.env.PROGRAMLOOM_ORGANIZER_EMAIL.toLowerCase()
  ) {
    throw new Error("The storage state is not the authorized organizer alias.");
  }

  const { organizations } = await api("/api/organizations");
  const organization = organizations.find(
    (item) => item.role === "owner" && item.storageMode === "airtable",
  );
  if (!organization)
    throw new Error("No owned Airtable workspace is available.");

  const slug = "programloom-production-readiness";
  let { events } = await api(`/api/organizations/${organization.id}/events`);
  let event = events.find((item) => item.slug === slug);
  if (!event) {
    const target = {
      name: "ProgramLoom Production Readiness",
      slug,
      timezone: "America/New_York",
      startsAt: "2027-09-14T13:00:00.000Z",
      endsAt: "2027-09-16T22:00:00.000Z",
      venueName: "ProgramLoom verification venue",
      websiteUrl: "https://programloom.com",
    };
    const domains = [
      "cfp",
      "review",
      "onboarding",
      "resources",
      "communications",
      "roomsTracksLocations",
      "contentWorkflow",
      "widgets",
      "crm",
    ];
    await api(`/api/event-templates/organizations/${organization.id}/preview`, {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "starter_template", id: "conference" },
        domains,
        target,
      }),
    });
    const created = await api(
      `/api/event-templates/organizations/${organization.id}/events`,
      {
        method: "POST",
        body: JSON.stringify({
          source: { kind: "starter_template", id: "conference" },
          domains,
          target,
          confirmPreview: true,
        }),
      },
    );
    event = created.event;
  }

  const { forms } = await api(`/api/events/${event.id}/forms`);
  if (!forms.length)
    throw new Error("The starter event did not create a CFP form.");
  if (!forms[0].publishedAt) {
    await api(`/api/events/${event.id}/forms/${forms[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ published: true }),
    });
  }

  let contacts = (
    await api(
      `/api/crm/organizations/${organization.id}/contacts?search=${encodeURIComponent(process.env.PROGRAMLOOM_SPEAKER_EMAIL)}`,
    )
  ).contacts;
  let contact = contacts.find(
    (item) =>
      item.email.toLowerCase() ===
      process.env.PROGRAMLOOM_SPEAKER_EMAIL.toLowerCase(),
  );
  if (!contact) {
    contact = (
      await api(`/api/crm/organizations/${organization.id}/contacts`, {
        method: "POST",
        body: JSON.stringify({
          email: process.env.PROGRAMLOOM_SPEAKER_EMAIL,
          firstName: "ProgramLoom",
          lastName: "Speaker",
          company: "ProgramLoom QA",
          jobTitle: "Verification speaker",
          bio: "Controlled production verification identity.",
          tags: ["production-verification"],
          social: {},
          source: "production_verification",
        }),
      })
    ).contact;
  }
  const handoff = await api(
    `/api/crm/organizations/${organization.id}/handoff`,
    {
      method: "POST",
      body: JSON.stringify({ contactId: contact.id, eventId: event.id }),
    },
  );

  const members = await api(`/api/organizations/${organization.id}/members`);
  const invite = async (email, role) => {
    const active = members.invitations.some(
      (item) =>
        item.email.toLowerCase() === email.toLowerCase() &&
        item.role === role &&
        item.eventId === event.id,
    );
    if (active) return "existing";
    await api(`/api/organizations/${organization.id}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email, role, eventId: event.id }),
    });
    return "created";
  };
  const speakerInvite = await invite(
    process.env.PROGRAMLOOM_SPEAKER_EMAIL,
    "speaker",
  );
  const reviewerInvite = await invite(
    process.env.PROGRAMLOOM_REVIEWER_EMAIL,
    "reviewer",
  );

  const overview = await api(`/api/communications/events/${event.id}`);
  const sentCategories = [];
  const deferredCategories = [];
  const categories = [
    "speaker_invitation",
    "scheduling_notice",
    "calendar_invitation",
    "calendar_update",
    "calendar_cancellation",
    "speaker_message",
    "crm_outreach",
  ];
  for (const category of categories) {
    const template = overview.templates.find(
      (item) => item.category === category && item.enabled,
    );
    if (!template) continue;
    const recipientResult = await api(
      `/api/communications/events/${event.id}/recipients?category=${category}`,
    );
    const recipient = recipientResult.recipients[0];
    if (!recipient) continue;
    try {
      await api(`/api/communications/events/${event.id}/preview`, {
        method: "POST",
        body: JSON.stringify({
          templateId: template.id,
          category,
          recipientKey: recipient.key,
          organizerMessage: "Controlled ProgramLoom production verification.",
        }),
      });
      await api(`/api/communications/events/${event.id}/test-send`, {
        method: "POST",
        body: JSON.stringify({
          templateId: template.id,
          category,
          recipientKey: recipient.key,
          organizerMessage: "Controlled ProgramLoom production verification.",
        }),
      });
      sentCategories.push(category);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("unresolved_merge_fields")
      ) {
        deferredCategories.push(category);
        continue;
      }
      throw error;
    }
  }

  const airtable = await api(
    `/api/integrations/organizations/${organization.id}/airtable`,
  );
  console.log(
    JSON.stringify({
      organizationId: organization.id,
      eventId: event.id,
      formId: forms[0].id,
      speakerId: handoff.speakerId,
      invitationStates: { speaker: speakerInvite, reviewer: reviewerInvite },
      sentCategories,
      deferredCategories,
      airtable: {
        configured: airtable.configured,
        pending: airtable.pending,
        failed: airtable.failed,
        conflicts: airtable.conflicts.length,
      },
    }),
  );
} finally {
  await context.dispose();
}
