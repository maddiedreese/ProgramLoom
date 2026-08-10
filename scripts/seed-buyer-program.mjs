import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");
const workspace = resolve(fileURLToPath(new URL("../", import.meta.url)));
const ids = {
  event: "5c33f61d-3af6-41ff-8b2e-6268181001f8",
  organization: "694aeda7-0bb1-46ef-a822-d3985a0f9771",
  form: "1d196d1a-eedc-4d5b-b430-b3d3efed9c0f",
  owner: "30000000-0000-4000-8000-000000000001",
  communityTrack: "16305db4-83f6-4ad3-8d06-6f4f435032fa",
  mainTrack: "9a9439b2-7d0e-4cfb-b9b4-5876a8491627",
  breakoutRoom: "134abe0e-2046-4bd4-88fc-087f0e0a4e1d",
  mainRoom: "b2971145-0696-4b82-9822-1f40d58fd519",
  priya: "90b57c7a-6864-4ada-b270-f279e50ee9ef",
  marcusChen: "40000000-0000-4000-8000-000000000202",
  dana: "40000000-0000-4000-8000-000000000203",
  marcusOkafor: "985da49a-3787-4448-a79f-b29d6efb71e1",
};

const proposals = [
  {
    id: "50000000-0000-4000-8000-000000000101",
    title: "Operational Calm Under Pressure",
    abstract:
      "A hands-on workshop for building visible ownership, deterministic priorities, and humane recovery paths into live program operations.",
    format: "Workshop (60 min)",
    minutes: 60,
    status: "accepted",
    decision: "accepted",
    track: ids.mainTrack,
    speakers: [ids.priya, ids.marcusOkafor],
    placement: {
      roomId: ids.mainRoom,
      startsAt: "2027-09-16T14:00:00.000Z",
      endsAt: "2027-09-16T15:00:00.000Z",
    },
  },
  {
    id: "50000000-0000-4000-8000-000000000102",
    title: "Inclusive Speaker Communication Patterns",
    abstract:
      "Practical language and delivery patterns that keep invitations, deadlines, feedback, and changes clear for every speaker.",
    format: "Lightning talk (20 min)",
    minutes: 20,
    status: "accepted",
    decision: "accepted",
    track: ids.communityTrack,
    speakers: [ids.dana],
    placement: {
      roomId: ids.breakoutRoom,
      startsAt: "2027-09-16T14:00:00.000Z",
      endsAt: "2027-09-16T14:20:00.000Z",
    },
  },
  {
    id: "50000000-0000-4000-8000-000000000103",
    title: "From Feedback to Follow-up",
    abstract:
      "A field-tested approach to turning content feedback, agenda changes, and post-event follow-up into one understandable speaker journey.",
    format: "Talk (30 min)",
    minutes: 30,
    status: "accepted",
    decision: "accepted",
    track: ids.communityTrack,
    speakers: [ids.marcusChen, ids.dana],
    placement: {
      roomId: ids.mainRoom,
      startsAt: "2027-09-16T16:00:00.000Z",
      endsAt: "2027-09-16T16:30:00.000Z",
    },
  },
  {
    id: "50000000-0000-4000-8000-000000000104",
    title: "A Spreadsheet Is Not a Workflow",
    abstract:
      "Lessons from migrating a community program into explicit states and ownership.",
    format: "Talk (30 min)",
    minutes: 30,
    status: "declined",
    decision: "rejected",
    track: ids.mainTrack,
    speakers: [],
  },
  {
    id: "50000000-0000-4000-8000-000000000105",
    title: "Designing Better Deadline Reminders",
    abstract:
      "A behavioral study of useful, accessible deadline communication.",
    format: "Lightning talk (20 min)",
    minutes: 20,
    status: "declined",
    decision: "rejected",
    track: ids.communityTrack,
    speakers: [],
  },
  {
    id: "50000000-0000-4000-8000-000000000106",
    title: "Review Rubrics for Community Events",
    abstract: "A scorecard design clinic for volunteer review teams.",
    format: "Workshop (60 min)",
    minutes: 60,
    status: "declined",
    decision: "rejected",
    track: ids.communityTrack,
    speakers: [],
  },
  {
    id: "50000000-0000-4000-8000-000000000107",
    title: "When the Room Changes at the Last Minute",
    abstract: "Communication techniques for unavoidable program changes.",
    format: "Talk (30 min)",
    minutes: 30,
    status: "declined",
    decision: "rejected",
    track: ids.mainTrack,
    speakers: [],
  },
  {
    id: "50000000-0000-4000-8000-000000000108",
    title: "Portable Speaker Profiles",
    abstract:
      "Responsible reuse of speaker information across community programs.",
    format: "Talk (30 min)",
    minutes: 30,
    status: "declined",
    decision: "rejected",
    track: ids.communityTrack,
    speakers: [],
  },
  {
    id: "50000000-0000-4000-8000-000000000109",
    title: "A Draft Session About Drafts",
    abstract: "Withdrawn by its fictional submitter before review.",
    format: "Talk (30 min)",
    minutes: 30,
    status: "withdrawn",
    decision: "none",
    track: ids.mainTrack,
    speakers: [],
  },
];

if (!apply) {
  console.log(
    JSON.stringify(
      {
        mode: "plan",
        eventId: ids.event,
        proposals: proposals.length,
        acceptedSessions: proposals.filter(
          ({ status }) => status === "accepted",
        ).length,
        historicalProposals: proposals.filter(
          ({ status }) => status !== "accepted",
        ).length,
        note: "Pass --apply with PROGRAMLOOM_PRODUCTION_CONFIRM=programloom-production.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (process.env.PROGRAMLOOM_PRODUCTION_CONFIRM !== "programloom-production")
  throw new Error(
    "Set PROGRAMLOOM_PRODUCTION_CONFIRM=programloom-production to apply buyer-grade production data.",
  );

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const statements = [];
for (const [index, proposal] of proposals.entries()) {
  const auditId = `50000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`;
  const personEmail = `programloom.proposal.${index + 1}@example.com`;
  const personName = [
    "Avery Brooks",
    "Taylor Flores",
    "Jordan Kim",
    "Robin Singh",
    "Casey Morgan",
    "Emery Clark",
    "Sasha Bell",
    "Noor Patel",
    "Alex Rivera",
  ][index];
  const answers = JSON.stringify({
    session_title: proposal.title,
    abstract: proposal.abstract,
    session_format: proposal.format,
  });
  statements.push(`
    INSERT OR IGNORE INTO submissions
      (id,form_id,event_id,title,abstract,format,duration_minutes,status,answers_json,submitted_at,decision_state,decision_staged_at,decision_staged_by)
    VALUES (${quote(proposal.id)},${quote(ids.form)},${quote(ids.event)},${quote(proposal.title)},${quote(proposal.abstract)},${quote(proposal.format)},${proposal.minutes},${quote(proposal.status)},${quote(answers)},CURRENT_TIMESTAMP,${quote(proposal.decision)},${proposal.decision === "none" ? "NULL" : "CURRENT_TIMESTAMP"},${proposal.decision === "none" ? "NULL" : quote(ids.owner)});
    INSERT OR IGNORE INTO submission_people
      (id,submission_id,email,name,role,organization,position)
    VALUES (${quote(`50000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`)},${quote(proposal.id)},${quote(personEmail)},${quote(personName)},'primary','ProgramLoom Community',0);
    INSERT OR IGNORE INTO submission_tracks(submission_id,track_id)
    VALUES (${quote(proposal.id)},${quote(proposal.track)});
    INSERT OR IGNORE INTO audit_events
      (id,organization_id,event_id,actor_user_id,action,entity_type,entity_id,after_json,request_id,correlation_id)
    VALUES (${quote(auditId)},${quote(ids.organization)},${quote(ids.event)},${quote(ids.owner)},'submission.seeded','submission',${quote(proposal.id)},${quote(JSON.stringify({ title: proposal.title, status: proposal.status, source: "buyer_grade_seed" }))},'buyer-grade-seed-v1','buyer-grade-seed-v1');
    INSERT OR IGNORE INTO integration_outbox
      (id,organization_id,event_id,integration,action,entity_type,entity_id,payload_json,idempotency_key)
    VALUES (${quote(`airtable-${auditId}`)},${quote(ids.organization)},${quote(ids.event)},'airtable','upsert','submission',${quote(proposal.id)},${quote(JSON.stringify({ auditId, action: "submission.seeded" }))},${quote(`airtable:audit:${auditId}`)});
  `);
  for (const [speakerIndex, speakerId] of proposal.speakers.entries())
    statements.push(
      `INSERT OR IGNORE INTO session_speakers(submission_id,speaker_id,role) VALUES (${quote(proposal.id)},${quote(speakerId)},${quote(speakerIndex ? "panelist" : "speaker")});`,
    );
  if (proposal.status === "accepted")
    statements.push(
      `INSERT INTO session_content_state(submission_id,status,updated_by) VALUES (${quote(proposal.id)},'approved',${quote(ids.owner)}) ON CONFLICT(submission_id) DO UPDATE SET status='approved',updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP;`,
    );
}

const wrangler = resolve(workspace, "node_modules/.bin/wrangler");
const result = JSON.parse(
  execFileSync(
    wrangler,
    [
      "d1",
      "execute",
      "programloom-production",
      "--remote",
      "--json",
      "--command",
      statements.join("\n"),
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler.log" },
    },
  ),
);
if (!result.every(({ success }) => success)) throw new Error("D1 seed failed.");

const storagePath =
  process.env.PROGRAMLOOM_E2E_STORAGE_STATE ??
  "/private/tmp/programloom-evals/.auth/app.programloom.com.organizer.json";
const storage = JSON.parse(await readFile(storagePath, "utf8"));
const cookie = storage.cookies.find(
  ({ name }) => name === "programloom_session",
);
if (!cookie)
  throw new Error("Organizer storage state has no ProgramLoom session.");
const headers = {
  cookie: `${cookie.name}=${cookie.value}`,
  "content-type": "application/json",
};
async function api(path, options = {}) {
  const response = await fetch(`https://app.programloom.com${path}`, {
    ...options,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`,
    );
  return body;
}

const agendaPath = `/api/agenda/admin/events/${ids.event}`;
for (const proposal of proposals.filter(({ placement }) => placement)) {
  let agenda = await api(agendaPath);
  let item = agenda.items.find(
    ({ submissionId }) => submissionId === proposal.id,
  );
  if (!item)
    item = (
      await api(`${agendaPath}/items`, {
        method: "POST",
        body: JSON.stringify({
          submissionId: proposal.id,
          itemType: "session",
          trackId: proposal.track,
        }),
      })
    ).item;
  if (!item.startsAt || item.cancelledAt)
    await api(`${agendaPath}/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...proposal.placement,
        trackId: proposal.track,
        reschedule: false,
      }),
    });
}
await api(`${agendaPath}/publish`, { method: "POST", body: "{}" });
await api(`/api/integrations/organizations/${ids.organization}/airtable/sync`, {
  method: "POST",
  body: "{}",
});

console.log(
  JSON.stringify({
    mode: "applied",
    eventId: ids.event,
    proposals: proposals.length,
    acceptedSessions: proposals.filter(({ status }) => status === "accepted")
      .length,
    publicAgendaRepublished: true,
    airtableSyncRequested: true,
  }),
);
