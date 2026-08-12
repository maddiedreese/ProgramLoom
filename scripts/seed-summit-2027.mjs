import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const workspace = resolve(fileURLToPath(new URL("../", import.meta.url)));
const apply = process.argv.includes("--apply");
const remote = process.argv.includes("--remote");
const verifyOnly = process.argv.includes("--verify");
const eventId = "5c33f61d-3af6-41ff-8b2e-6268181001f8";
const organizationId = "694aeda7-0bb1-46ef-a822-d3985a0f9771";
const formId = "1d196d1a-eedc-4d5b-b430-b3d3efed9c0f";
const ownerId = "30000000-0000-4000-8000-000000000001";
const reviewerId = "30000000-0000-4000-8000-000000000003";
const initialRoundId = "a9918800-3799-4780-8696-28de23812414";
const finalRoundId = "62e00dad-73dd-48b8-9290-2a6c8ea9211f";

const tracks = {
  platform: "9a9439b2-7d0e-4cfb-b9b4-5876a8491627",
  community: "16305db4-83f6-4ad3-8d06-6f4f435032fa",
  ai: "61000000-0000-4000-8000-000000000001",
  developerExperience: "61000000-0000-4000-8000-000000000003",
};
const rooms = {
  main: "b2971145-0696-4b82-9822-1f40d58fd519",
  breakout: "134abe0e-2046-4bd4-88fc-087f0e0a4e1d",
  lab: "561e5010-7172-4b99-b38c-ee84a8896dc6",
};

const speakers = [
  [
    "71000000-0000-4000-8000-000000000001",
    "Aria",
    "Bennett",
    "Staff Reliability Engineer",
    "Northwind Studio",
  ],
  [
    "71000000-0000-4000-8000-000000000002",
    "Mateo",
    "Cruz",
    "Engineering Operations Lead",
    "Cedar Systems",
  ],
  [
    "71000000-0000-4000-8000-000000000003",
    "Nadia",
    "El-Sayed",
    "Platform Architect",
    "Signal Grove",
  ],
  [
    "71000000-0000-4000-8000-000000000004",
    "Elliot",
    "Foster",
    "Documentation Director",
    "Lantern Works",
  ],
  [
    "71000000-0000-4000-8000-000000000005",
    "Mei",
    "Huang",
    "Community Researcher",
    "Civic Stack",
  ],
  [
    "71000000-0000-4000-8000-000000000006",
    "Jonah",
    "Ibrahim",
    "Program Design Lead",
    "Gathering Lab",
  ],
  [
    "71000000-0000-4000-8000-000000000007",
    "Leila",
    "Khan",
    "Accessibility Strategist",
    "Open Path",
  ],
  [
    "71000000-0000-4000-8000-000000000008",
    "Theo",
    "Laurent",
    "Developer Educator",
    "Harbor Cloud",
  ],
  [
    "71000000-0000-4000-8000-000000000009",
    "Sofia",
    "Morales",
    "Hybrid Events Producer",
    "Bright Assembly",
  ],
  [
    "71000000-0000-4000-8000-000000000010",
    "Amara",
    "Nwosu",
    "Design Systems Manager",
    "Mosaic Tools",
  ],
  [
    "71000000-0000-4000-8000-000000000011",
    "Rowan",
    "Park",
    "Mentorship Program Director",
    "Common Thread",
  ],
].map(([id, firstName, lastName, jobTitle, company], index) => ({
  id,
  firstName,
  lastName,
  jobTitle,
  company,
  email: `programloom-speaker-${String(index + 1).padStart(2, "0")}@example.com`,
  bio: `${firstName} ${lastName} builds practical, inclusive systems for technical communities and shares field-tested lessons with program teams.`,
}));

const sessions = [
  {
    id: "72000000-0000-4000-8000-000000000001",
    title: "Designing Calm Incident Communication",
    abstract:
      "A practical workshop for keeping owners, speakers, and attendees aligned while a live program changes under pressure.",
    format: "Workshop (60 min)",
    duration: 60,
    trackId: tracks.platform,
    roomId: rooms.lab,
    startsAt: "2027-09-14T16:00:00.000Z",
    endsAt: "2027-09-14T17:00:00.000Z",
    speakerIndexes: [0, 1, 2],
    journeyRole: "conflict_reserved_a",
  },
  {
    id: "72000000-0000-4000-8000-000000000002",
    title: "Documentation Gardens That Stay Useful",
    abstract:
      "Patterns for sustaining documentation that remains findable, current, and grounded in the questions a community actually asks.",
    format: "Panel (45 min)",
    duration: 45,
    trackId: tracks.developerExperience,
    roomId: rooms.breakout,
    startsAt: "2027-09-15T17:00:00.000Z",
    endsAt: "2027-09-15T17:45:00.000Z",
    speakerIndexes: [2, 3],
    journeyRole: "conflict_reserved_b",
  },
  {
    id: "72000000-0000-4000-8000-000000000003",
    title: "Building Sustainable Review Panels",
    abstract:
      "A transparent approach to reviewer capacity, recusal, calibration, and consistent feedback across multiple rounds.",
    format: "Talk (30 min)",
    duration: 30,
    trackId: tracks.community,
    roomId: rooms.main,
    startsAt: "2027-09-14T18:00:00.000Z",
    endsAt: "2027-09-14T18:30:00.000Z",
    speakerIndexes: [4, 5],
    journeyRole: "public_program",
  },
  {
    id: "72000000-0000-4000-8000-000000000004",
    title: "Rooms That Work for Every Attendee",
    abstract:
      "Concrete room, signage, pacing, and facilitation choices that make technical sessions more accessible without slowing the program.",
    format: "Talk (30 min)",
    duration: 30,
    trackId: tracks.community,
    roomId: rooms.breakout,
    startsAt: "2027-09-14T19:00:00.000Z",
    endsAt: "2027-09-14T19:30:00.000Z",
    speakerIndexes: [6, 7],
    journeyRole: "public_program",
  },
  {
    id: "72000000-0000-4000-8000-000000000005",
    title: "Accessible Moderation for Hybrid Sessions",
    abstract:
      "A live demonstration of moderation techniques that give remote and in-room participants equitable ways to follow and contribute.",
    format: "Interactive session (45 min)",
    duration: 45,
    trackId: tracks.developerExperience,
    roomId: rooms.lab,
    startsAt: "2027-09-15T19:00:00.000Z",
    endsAt: "2027-09-15T19:45:00.000Z",
    speakerIndexes: [8, 9],
    journeyRole: "public_program",
  },
  {
    id: "72000000-0000-4000-8000-000000000006",
    title: "Mentor Match Roundtable",
    abstract:
      "A facilitated exchange on creating durable mentorship connections before, during, and after a community program.",
    format: "Roundtable (45 min)",
    duration: 45,
    trackId: tracks.community,
    roomId: rooms.main,
    startsAt: "2027-09-15T20:00:00.000Z",
    endsAt: "2027-09-15T20:45:00.000Z",
    speakerIndexes: [10],
    journeyRole: "cancellation_reserved",
  },
];

const quote = (value) =>
  value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const statements = [];

statements.push(
  `UPDATE events SET name='ProgramLoom Summit 2027',slug='programloom-summit-2027',timezone='America/New_York',starts_at='2027-09-14T13:00:00.000Z',ends_at='2027-09-16T22:00:00.000Z',status='active',updated_at=CURRENT_TIMESTAMP WHERE id='${eventId}';`,
);

for (const speaker of speakers) {
  statements.push(
    `INSERT INTO speaker_profiles (id,organization_id,email,first_name,last_name,job_title,company,bio,portal_status) VALUES (${quote(speaker.id)},${quote(organizationId)},${quote(speaker.email)},${quote(speaker.firstName)},${quote(speaker.lastName)},${quote(speaker.jobTitle)},${quote(speaker.company)},${quote(speaker.bio)},'active') ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,job_title=excluded.job_title,company=excluded.company,bio=excluded.bio,portal_status=excluded.portal_status,updated_at=CURRENT_TIMESTAMP;`,
  );
}

for (const [index, session] of sessions.entries()) {
  const answers = JSON.stringify({
    session_title: session.title,
    abstract: session.abstract,
    session_format: session.format,
    journey_role: session.journeyRole,
  });
  statements.push(
    `INSERT INTO submissions (id,form_id,event_id,title,abstract,format,duration_minutes,status,answers_json,submitted_at,organizer_seen_at,decision_state,decision_staged_at,decision_staged_by) VALUES (${quote(session.id)},${quote(formId)},${quote(eventId)},${quote(session.title)},${quote(session.abstract)},${quote(session.format)},${session.duration},'accepted',${quote(answers)},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'accepted',CURRENT_TIMESTAMP,${quote(ownerId)}) ON CONFLICT(id) DO UPDATE SET title=excluded.title,abstract=excluded.abstract,format=excluded.format,duration_minutes=excluded.duration_minutes,status='accepted',answers_json=excluded.answers_json,decision_state='accepted',updated_at=CURRENT_TIMESTAMP;`,
  );
  const primary = speakers[session.speakerIndexes[0]];
  statements.push(
    `INSERT INTO submission_people (id,submission_id,email,name,role,organization,position) VALUES (${quote(`73000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`)},${quote(session.id)},${quote(primary.email)},${quote(`${primary.firstName} ${primary.lastName}`)},'primary',${quote(primary.company)},0) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,organization=excluded.organization;`,
  );
  statements.push(
    `INSERT OR IGNORE INTO submission_tracks (submission_id,track_id) VALUES (${quote(session.id)},${quote(session.trackId)});`,
  );
  for (const [
    speakerPosition,
    speakerIndex,
  ] of session.speakerIndexes.entries()) {
    statements.push(
      `INSERT OR IGNORE INTO session_speakers (submission_id,speaker_id,role) VALUES (${quote(session.id)},${quote(speakers[speakerIndex].id)},${quote(speakerPosition === 0 ? "speaker" : "panelist")});`,
    );
  }
  statements.push(
    `INSERT INTO session_content_state (submission_id,status,updated_by) VALUES (${quote(session.id)},'approved',${quote(ownerId)}) ON CONFLICT(submission_id) DO UPDATE SET status='approved',updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP;`,
  );
  statements.push(
    `INSERT INTO agenda_items (id,event_id,submission_id,track_id,room_id,item_type,title,description,starts_at,ends_at,status,version) VALUES (${quote(`74000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`)},${quote(eventId)},${quote(session.id)},${quote(session.trackId)},${quote(session.roomId)},'session',${quote(session.title)},${quote(session.abstract)},${quote(session.startsAt)},${quote(session.endsAt)},'published',1) ON CONFLICT(id) DO UPDATE SET track_id=excluded.track_id,room_id=excluded.room_id,title=excluded.title,description=excluded.description,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status='published',cancelled_at=NULL,cancelled_by=NULL,updated_at=CURRENT_TIMESTAMP;`,
  );
}

statements.push(
  `INSERT INTO agenda_items (id,event_id,item_type,title,description,starts_at,ends_at,status,version) VALUES ('74000000-0000-4000-8000-000000000099','${eventId}','hold','Speaker transition buffer','An internal hold that remains unpublished while production timing is finalized.','2027-09-16T19:30:00.000Z','2027-09-16T19:45:00.000Z','draft',1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status='draft',cancelled_at=NULL,cancelled_by=NULL,updated_at=CURRENT_TIMESTAMP;`,
);

// Preserve explicit decision states without sending messages.
statements.push(
  `UPDATE submissions SET decision_state='acceptance_staged',decision_staged_at=CURRENT_TIMESTAMP,decision_staged_by='${ownerId}' WHERE id='61000000-0000-4000-8000-000000000101';`,
);
statements.push(
  `UPDATE submissions SET decision_state='waitlisted',decision_staged_at=CURRENT_TIMESTAMP,decision_staged_by='${ownerId}' WHERE id='61000000-0000-4000-8000-000000000102';`,
);

// Two active rounds plus completed, incomplete, conflicted, and recused work.
statements.push(
  `UPDATE review_rounds SET status='open' WHERE id IN ('${initialRoundId}','${finalRoundId}');`,
);
statements.push(
  `INSERT OR IGNORE INTO review_round_reviewers (round_id,reviewer_user_id,capacity) VALUES ('${finalRoundId}','${reviewerId}',20);`,
);
statements.push(
  `INSERT INTO review_assignments (id,round_id,submission_id,reviewer_user_id,completed_at) VALUES ('75000000-0000-4000-8000-000000000001','${finalRoundId}','${sessions[2].id}','${reviewerId}',CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET completed_at=CURRENT_TIMESTAMP,recused_at=NULL,recusal_reason=NULL;`,
);
statements.push(
  `INSERT INTO reviews (id,assignment_id,answers_json,weighted_score,recommendation,comment,submitted_at) VALUES ('75000000-0000-4000-8000-000000000011','75000000-0000-4000-8000-000000000001','{"program_fit":5,"clarity":4}',4.5,'approve','Clear audience value and a practical delivery plan.',CURRENT_TIMESTAMP) ON CONFLICT(assignment_id) DO UPDATE SET answers_json=excluded.answers_json,weighted_score=excluded.weighted_score,recommendation=excluded.recommendation,comment=excluded.comment,submitted_at=CURRENT_TIMESTAMP;`,
);
statements.push(
  `INSERT INTO review_assignments (id,round_id,submission_id,reviewer_user_id) VALUES ('75000000-0000-4000-8000-000000000002','${finalRoundId}','${sessions[3].id}','${reviewerId}') ON CONFLICT(id) DO UPDATE SET completed_at=NULL,recused_at=NULL,recusal_reason=NULL;`,
);
statements.push(
  `INSERT INTO review_assignments (id,round_id,submission_id,reviewer_user_id,recused_at,recusal_reason) VALUES ('75000000-0000-4000-8000-000000000003','${initialRoundId}','${sessions[4].id}','${reviewerId}',CURRENT_TIMESTAMP,'Prior collaboration disclosed before scoring.') ON CONFLICT(id) DO UPDATE SET completed_at=NULL,recused_at=CURRENT_TIMESTAMP,recusal_reason=excluded.recusal_reason;`,
);
statements.push(
  `INSERT INTO review_conflicts (id,organization_id,event_id,round_id,assignment_id,submission_id,reviewer_user_id,conflict_type,reason,status) VALUES ('75000000-0000-4000-8000-000000000004','${organizationId}','${eventId}','${initialRoundId}','75000000-0000-4000-8000-000000000003','${sessions[4].id}','${reviewerId}','recusal','Prior collaboration disclosed before scoring.','unresolved') ON CONFLICT(id) DO UPDATE SET status='unresolved',resolved_by=NULL,resolved_at=NULL;`,
);

const taskId = "76000000-0000-4000-8000-000000000001";
statements.push(
  `INSERT INTO onboarding_tasks (id,event_id,title,description,task_type,due_at,position) VALUES ('${taskId}','${eventId}','Confirm session delivery details','Confirm accessibility needs, arrival plans, and presentation format.','action','2027-08-20T21:00:00.000Z',90) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,due_at=excluded.due_at;`,
);
statements.push(
  `INSERT INTO speaker_task_assignments (task_id,speaker_id,status,response_json,completed_at) VALUES ('${taskId}','${speakers[0].id}','complete','{"confirmed":true}',CURRENT_TIMESTAMP) ON CONFLICT(task_id,speaker_id) DO UPDATE SET status='complete',response_json=excluded.response_json,completed_at=CURRENT_TIMESTAMP;`,
);
statements.push(
  `INSERT INTO speaker_task_assignments (task_id,speaker_id,status,response_json,completed_at) VALUES ('${taskId}','${speakers[1].id}','todo','{}',NULL) ON CONFLICT(task_id,speaker_id) DO UPDATE SET status='todo',response_json='{}',completed_at=NULL;`,
);
statements.push(
  `INSERT INTO files (id,organization_id,event_id,submission_id,speaker_id,task_id,purpose,status) VALUES ('76000000-0000-4000-8000-000000000002','${organizationId}','${eventId}','${sessions[0].id}','${speakers[0].id}','${taskId}','Final presentation deck','needs_changes') ON CONFLICT(id) DO UPDATE SET status='needs_changes',updated_at=CURRENT_TIMESTAMP;`,
);
statements.push(
  `INSERT INTO files (id,organization_id,event_id,submission_id,speaker_id,task_id,purpose,status) VALUES ('76000000-0000-4000-8000-000000000003','${organizationId}','${eventId}','${sessions[0].id}','${speakers[1].id}','${taskId}','Speaker release','pending') ON CONFLICT(id) DO UPDATE SET status='pending',updated_at=CURRENT_TIMESTAMP;`,
);

const messageStates = ["sent", "delivered", "failed", "cancelled"];
for (const [index, status] of messageStates.entries()) {
  const messageId = `77000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  statements.push(
    `INSERT INTO communication_messages (id,organization_id,event_id,category,recipient_email,recipient_name,subject,body_html,body_text,metadata_json,idempotency_key,status,attempts,max_attempts,${status}_at,prepared_by,correlation_id) VALUES ('${messageId}','${organizationId}','${eventId}','speaker_message','programloom-delivery@example.com','ProgramLoom Delivery Alias','Program update','<p>A controlled ProgramLoom Summit communication record.</p>','A controlled ProgramLoom Summit communication record.','{"journey_role":"state_coverage"}','summit-2027-state-${status}','${status}',1,5,CURRENT_TIMESTAMP,'${ownerId}','summit-2027-state-${status}') ON CONFLICT(id) DO UPDATE SET status='${status}',attempts=1,updated_at=CURRENT_TIMESTAMP;`,
  );
}
const retriedMessageId = "77000000-0000-4000-8000-000000000005";
statements.push(
  `INSERT INTO communication_messages (id,organization_id,event_id,category,recipient_email,recipient_name,subject,body_html,body_text,metadata_json,idempotency_key,status,attempts,max_attempts,delivered_at,prepared_by,correlation_id) VALUES ('${retriedMessageId}','${organizationId}','${eventId}','speaker_message','programloom-delivery@example.com','ProgramLoom Delivery Alias','Updated program details','<p>The updated details are now available.</p>','The updated details are now available.','{"journey_role":"retried_delivery"}','summit-2027-state-retried','delivered',2,5,CURRENT_TIMESTAMP,'${ownerId}','summit-2027-state-retried') ON CONFLICT(id) DO UPDATE SET status='delivered',attempts=2,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;`,
);
statements.push(
  `INSERT OR IGNORE INTO communication_attempts (id,message_id,attempt_number,status,error_code,error_message,request_id,job_id,finished_at) VALUES ('77000000-0000-4000-8001-000000000001','${retriedMessageId}',1,'failed','temporary_provider_error','Temporary provider response.','summit-retry-request-1','summit-retry-job-1',CURRENT_TIMESTAMP);`,
);
statements.push(
  `INSERT OR IGNORE INTO communication_attempts (id,message_id,attempt_number,status,request_id,job_id,finished_at) VALUES ('77000000-0000-4000-8001-000000000002','${retriedMessageId}',2,'delivered','summit-retry-request-2','summit-retry-job-2',CURRENT_TIMESTAMP);`,
);
statements.push(
  `INSERT INTO audit_events (id,organization_id,event_id,actor_user_id,action,entity_type,entity_id,after_json,request_id,correlation_id) VALUES ('78000000-0000-4000-8000-000000000001','${organizationId}','${eventId}','${ownerId}','production_journey.seeded','event','${eventId}','{"event":"ProgramLoom Summit 2027","seedVersion":1}','summit-2027-seed-v1','summit-2027-seed-v1') ON CONFLICT(id) DO UPDATE SET after_json=excluded.after_json,correlation_id=excluded.correlation_id;`,
);

const verificationSql = `
SELECT
  (SELECT name FROM events WHERE id='${eventId}') event_name,
  (SELECT COUNT(*) FROM submissions WHERE event_id='${eventId}') proposals,
  (SELECT COUNT(*) FROM submissions s JOIN session_content_state cs ON cs.submission_id=s.id JOIN agenda_items ai ON ai.submission_id=s.id WHERE s.event_id='${eventId}' AND s.status='accepted' AND s.decision_state='accepted' AND cs.status='approved' AND ai.status='published' AND ai.cancelled_at IS NULL) approved_public_sessions,
  (SELECT COUNT(DISTINCT ss.speaker_id) FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id='${eventId}') speakers,
  (SELECT COUNT(*) FROM (SELECT ss.submission_id FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id='${eventId}' GROUP BY ss.submission_id HAVING COUNT(*)>=2)) multi_speaker_sessions,
  (SELECT COUNT(*) FROM rooms WHERE event_id='${eventId}') rooms,
  (SELECT COUNT(*) FROM tracks WHERE event_id='${eventId}') tracks,
  (SELECT COUNT(DISTINCT format) FROM submissions WHERE event_id='${eventId}' AND format IS NOT NULL) formats,
  (SELECT COUNT(*) FROM review_rounds WHERE event_id='${eventId}') review_rounds,
  (SELECT COUNT(*) FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id WHERE rr.event_id='${eventId}' AND ra.completed_at IS NOT NULL) completed_reviews,
  (SELECT COUNT(*) FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id WHERE rr.event_id='${eventId}' AND ra.completed_at IS NULL AND ra.recused_at IS NULL) incomplete_reviews,
  (SELECT COUNT(*) FROM review_conflicts WHERE event_id='${eventId}') conflicted_reviews,
  (SELECT COUNT(*) FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id WHERE rr.event_id='${eventId}' AND ra.recused_at IS NOT NULL) recused_reviews,
  (SELECT COUNT(*) FROM submissions WHERE event_id='${eventId}' AND decision_state IN ('acceptance_staged','waitlist_staged','rejection_staged')) staged_decisions,
  (SELECT COUNT(*) FROM submissions WHERE event_id='${eventId}' AND decision_state IN ('accepted','rejected')) communicated_decisions,
  (SELECT COUNT(*) FROM submissions WHERE event_id='${eventId}' AND decision_state='rejected') rejected_decisions,
  (SELECT COUNT(*) FROM submissions WHERE event_id='${eventId}' AND decision_state IN ('waitlisted','waitlist_staged')) waitlisted_decisions,
  (SELECT COUNT(*) FROM submissions WHERE event_id='${eventId}' AND status='withdrawn') withdrawn_proposals,
  (SELECT COUNT(*) FROM speaker_task_assignments sta JOIN onboarding_tasks ot ON ot.id=sta.task_id WHERE ot.event_id='${eventId}' AND sta.status='complete') completed_tasks,
  (SELECT COUNT(*) FROM speaker_task_assignments sta JOIN onboarding_tasks ot ON ot.id=sta.task_id WHERE ot.event_id='${eventId}' AND sta.status!='complete') incomplete_tasks,
  (SELECT COUNT(*) FROM session_content_state cs JOIN submissions s ON s.id=cs.submission_id WHERE s.event_id='${eventId}' AND cs.status='approved') approved_content,
  (SELECT COUNT(*) FROM files WHERE event_id='${eventId}' AND status='needs_changes') needs_changes_content,
  (SELECT COUNT(*) FROM files WHERE event_id='${eventId}' AND status='pending') missing_content,
  (SELECT COUNT(*) FROM communication_messages WHERE event_id='${eventId}' AND status='sent') sent_messages,
  (SELECT COUNT(*) FROM communication_messages WHERE event_id='${eventId}' AND status='delivered') delivered_messages,
  (SELECT COUNT(*) FROM communication_messages WHERE event_id='${eventId}' AND status='failed') failed_messages,
  (SELECT COUNT(*) FROM communication_messages WHERE event_id='${eventId}' AND attempts>1) retried_messages,
  (SELECT COUNT(*) FROM communication_messages WHERE event_id='${eventId}' AND status='cancelled') cancelled_messages,
  (SELECT COUNT(*) FROM agenda_items WHERE event_id='${eventId}' AND status='published' AND cancelled_at IS NULL) published_agenda,
  (SELECT COUNT(*) FROM agenda_items WHERE event_id='${eventId}' AND status!='published' AND cancelled_at IS NULL) unpublished_agenda,
  (SELECT COUNT(*) FROM agenda_items WHERE event_id='${eventId}' AND status='published' AND cancelled_at IS NULL AND (lower(title) LIKE '%test%' OR lower(title) LIKE '%fixture%' OR lower(title) LIKE '%failure%' OR lower(title) LIKE '%broken%')) forbidden_public_titles,
  (SELECT COUNT(*) FROM submissions WHERE event_id='${eventId}' AND json_extract(answers_json,'$.journey_role')='cancellation_reserved') cancellation_reserved,
  (SELECT COUNT(*) FROM submissions WHERE event_id='${eventId}' AND json_extract(answers_json,'$.journey_role') LIKE 'conflict_reserved_%') conflict_reserved
;`;

function wranglerQuery(sql) {
  const result = JSON.parse(
    execFileSync(
      resolve(workspace, "node_modules/.bin/wrangler"),
      [
        "d1",
        "execute",
        "programloom-production",
        remote ? "--remote" : "--local",
        "--json",
        "--command",
        sql,
      ],
      {
        cwd: workspace,
        encoding: "utf8",
        env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler.log" },
        maxBuffer: 16 * 1024 * 1024,
      },
    ),
  );
  if (!result.every((entry) => entry.success))
    throw new Error("D1 operation failed.");
  return result;
}

function verify() {
  const [result] = wranglerQuery(verificationSql);
  const evidence = result.results[0];
  const requirements = {
    event_name: (value) => value === "ProgramLoom Summit 2027",
    proposals: (value) => value >= 20,
    approved_public_sessions: (value) => value >= 12,
    speakers: (value) => value >= 15,
    multi_speaker_sessions: (value) => value >= 2,
    rooms: (value) => value >= 3,
    tracks: (value) => value >= 4,
    formats: (value) => value >= 3,
    review_rounds: (value) => value >= 2,
    completed_reviews: (value) => value >= 1,
    incomplete_reviews: (value) => value >= 1,
    conflicted_reviews: (value) => value >= 1,
    recused_reviews: (value) => value >= 1,
    staged_decisions: (value) => value >= 1,
    communicated_decisions: (value) => value >= 1,
    rejected_decisions: (value) => value >= 1,
    waitlisted_decisions: (value) => value >= 1,
    withdrawn_proposals: (value) => value >= 1,
    completed_tasks: (value) => value >= 1,
    incomplete_tasks: (value) => value >= 1,
    approved_content: (value) => value >= 1,
    needs_changes_content: (value) => value >= 1,
    missing_content: (value) => value >= 1,
    sent_messages: (value) => value >= 1,
    delivered_messages: (value) => value >= 1,
    failed_messages: (value) => value >= 1,
    retried_messages: (value) => value >= 1,
    cancelled_messages: (value) => value >= 1,
    published_agenda: (value) => value >= 12,
    unpublished_agenda: (value) => value >= 1,
    forbidden_public_titles: (value) => value === 0,
    cancellation_reserved: (value) => value === 1,
    conflict_reserved: (value) => value === 2,
  };
  const checks = Object.fromEntries(
    Object.entries(requirements).map(([name, predicate]) => [
      name,
      { value: evidence[name], pass: predicate(evidence[name]) },
    ]),
  );
  const failed = Object.entries(checks).filter(([, check]) => !check.pass);
  console.log(
    JSON.stringify(
      { eventId, target: remote ? "remote" : "local", checks },
      null,
      2,
    ),
  );
  if (failed.length)
    throw new Error(
      `Summit production journey verification failed: ${failed.map(([name]) => name).join(", ")}`,
    );
}

if (!apply && !verifyOnly) {
  console.log(
    JSON.stringify(
      {
        mode: "plan",
        eventId,
        eventName: "ProgramLoom Summit 2027",
        additions: {
          approvedSessions: sessions.length,
          speakers: speakers.length,
        },
        apply:
          "PROGRAMLOOM_PRODUCTION_CONFIRM=programloom-production npm run seed:summit -- --apply --remote",
        verify: "npm run verify:summit -- --remote",
      },
      null,
      2,
    ),
  );
} else {
  if (
    apply &&
    remote &&
    process.env.PROGRAMLOOM_PRODUCTION_CONFIRM !== "programloom-production"
  )
    throw new Error(
      "Set PROGRAMLOOM_PRODUCTION_CONFIRM=programloom-production before applying the Summit seed remotely.",
    );
  if (apply) wranglerQuery(statements.join("\n"));
  verify();
}
