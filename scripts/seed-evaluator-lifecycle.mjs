import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");
const workspace = resolve(fileURLToPath(new URL("../", import.meta.url)));
const ids = {
  event: "5c33f61d-3af6-41ff-8b2e-6268181001f8",
  archivedEvent: "f82bb167-1987-4bc0-9b57-7569f0bbf6be",
  organization: "694aeda7-0bb1-46ef-a822-d3985a0f9771",
  form: "1d196d1a-eedc-4d5b-b430-b3d3efed9c0f",
  organizer: "30000000-0000-4000-8000-000000000001",
  speakerUser: "30000000-0000-4000-8000-000000000002",
  reviewer: "30000000-0000-4000-8000-000000000003",
  priya: "90b57c7a-6864-4ada-b270-f279e50ee9ef",
  marcus: "985da49a-3787-4448-a79f-b29d6efb71e1",
  platformTrack: "9a9439b2-7d0e-4cfb-b9b4-5876a8491627",
  communityTrack: "16305db4-83f6-4ad3-8d06-6f4f435032fa",
  aiTrack: "61000000-0000-4000-8000-000000000001",
  devxTrack: "61000000-0000-4000-8000-000000000003",
  room2a: "89988efd-3ef0-489d-bd6e-be42eeee3faa",
  taming: "7a7ef84d-999f-4ed9-a4e2-bb5bdb036bfe",
  aiPair: "61000000-0000-4000-8000-000000000101",
  docs: "61000000-0000-4000-8000-000000000102",
  lightning: "61000000-0000-4000-8000-000000000103",
  lightningAgenda: "61000000-0000-4000-8000-000000000301",
  initialRound: "a9918800-3799-4780-8696-28de23812414",
};

if (!apply) {
  console.log(
    JSON.stringify(
      {
        mode: "plan",
        eventId: ids.event,
        eventName: "ProgramLoom Production Readiness",
        archivedEventId: ids.archivedEvent,
        exactEvaluatorProposals: 4,
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
    "Set PROGRAMLOOM_PRODUCTION_CONFIRM=programloom-production to apply evaluator lifecycle data.",
  );

const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const answer = (title, abstract, format, track, takeaway) =>
  q(
    JSON.stringify({
      title,
      abstract,
      format,
      track,
      key_takeaway: takeaway,
      audience_level: "Intermediate",
    }),
  );

const tamingTitle = "Taming 40-Minute CI: Incremental Builds at Monorepo Scale";
const tamingAbstract =
  "A practical case study in dependency-aware caching, hermetic tasks, and incremental validation that reduced monorepo feedback loops without sacrificing confidence.";
const aiPairTitle =
  "Your AI Pair Programmer Is Lying to You: Verification Patterns That Scale";
const aiPairAbstract =
  "A field guide to contracts, adversarial tests, provenance, and human checkpoints for teams shipping AI-assisted software.";
const docsTitle =
  "Docs That Answer Back: Retrieval-Grounded Documentation Sites";
const docsAbstract =
  "How to build documentation experiences that cite their sources, expose uncertainty, and route unanswered questions back into the content roadmap.";
const lightningTitle = "Lightning: Agents in Production Q&A";
const lightningAbstract =
  "A concise, audience-led clinic on the operational realities of production AI agents.";

const sql = `
-- Retire the incomplete chained-run scratch event so the evaluator has one
-- unambiguous workspace and one public CFP.
UPDATE events SET name='Evaluator scratchpad (archived)',slug='devflow-evaluator-scratchpad',status='archived',updated_at=CURRENT_TIMESTAMP
WHERE id=${q(ids.archivedEvent)};
UPDATE cfp_forms SET published_at=NULL,updated_at=CURRENT_TIMESTAMP
WHERE event_id=${q(ids.archivedEvent)};

UPDATE events SET status='active',updated_at=CURRENT_TIMESTAMP
WHERE id=${q(ids.event)};
UPDATE cfp_forms SET
  description='Share a practical session that helps engineering teams build reliable, inclusive developer programs.',
  opens_at='2026-08-01T07:00:00.000Z',closes_at='2027-05-01T06:59:00.000Z',
  edit_closes_at='2027-05-06T06:59:00.000Z',allow_drafts=1,
  published_at=COALESCE(published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
WHERE id=${q(ids.form)};

UPDATE tracks SET name='Platform & Infra',slug='platform-infra',description='Build, release, reliability, and developer infrastructure.'
WHERE id=${q(ids.platformTrack)};
UPDATE tracks SET name='Community',slug='community',description='Inclusive programs, communication, and community operations.'
WHERE id=${q(ids.communityTrack)};
INSERT INTO tracks(id,event_id,name,slug,color,description,position)
VALUES(${q(ids.aiTrack)},${q(ids.event)},'AI Engineering','ai-engineering','#805ad5','Applied AI systems, evaluation, and operations.',2)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,color=excluded.color,description=excluded.description,position=excluded.position;
INSERT INTO tracks(id,event_id,name,slug,color,description,position)
VALUES(${q(ids.devxTrack)},${q(ids.event)},'Developer Experience','developer-experience','#d97757','Tooling, documentation, and productive engineering systems.',3)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,color=excluded.color,description=excluded.description,position=excluded.position;

UPDATE form_fields SET options_json='["Keynote (45 min)","Talk (30 min)","Lightning Talk (10 min)","Workshop (120 min)","Panel (45 min)"]',required=1
WHERE form_id=${q(ids.form)} AND field_key='format';
INSERT INTO form_fields(id,form_id,section,field_type,field_key,label,required,options_json,position,searchable)
VALUES
('61000000-0000-4000-8001-000000000001',${q(ids.form)},'session','select','track','Track',1,'["AI Engineering","Platform & Infra","Developer Experience","Community"]',2,1),
('61000000-0000-4000-8001-000000000002',${q(ids.form)},'custom','text','key_takeaway','Key takeaway',1,NULL,5,1),
('61000000-0000-4000-8001-000000000003',${q(ids.form)},'custom','select','audience_level','Audience level',0,'["Beginner","Intermediate","Advanced"]',6,1),
('61000000-0000-4000-8001-000000000004',${q(ids.form)},'custom','textarea','workshop_prerequisites','Workshop prerequisites',0,NULL,7,0)
ON CONFLICT(id) DO UPDATE SET label=excluded.label,required=excluded.required,options_json=excluded.options_json,position=excluded.position,searchable=excluded.searchable;

INSERT OR IGNORE INTO event_members(event_id,user_id,role,invited_by)
VALUES(${q(ids.event)},${q(ids.reviewer)},'reviewer',${q(ids.organizer)}),
      (${q(ids.event)},${q(ids.speakerUser)},'speaker',${q(ids.organizer)});
INSERT INTO event_speakers(event_id,speaker_id,source,added_by,status)
VALUES(${q(ids.event)},${q(ids.priya)},'accepted_submission',${q(ids.organizer)},'confirmed'),
      (${q(ids.event)},${q(ids.marcus)},'accepted_submission',${q(ids.organizer)},'confirmed')
ON CONFLICT(event_id,speaker_id) DO UPDATE SET status='confirmed';
UPDATE speaker_profiles SET
  job_title='Principal Developer Productivity Engineer',company='Latticework Systems',
  bio='Priya Raman leads developer productivity at Latticework Systems, where she builds humane, measurable systems for monorepo delivery, review quality, and reliable engineering programs.',
  portal_status='active',updated_at=CURRENT_TIMESTAMP
WHERE id=${q(ids.priya)};

UPDATE submissions SET
  submitter_user_id=${q(ids.speakerUser)},title=${q(tamingTitle)},abstract=${q(tamingAbstract)},
  format='Talk (30 min)',duration_minutes=30,status='accepted',decision_state='accepted',
  answers_json=${answer(tamingTitle, tamingAbstract, "Talk (30 min)", "Platform & Infra", "Make CI latency visible, bounded, and trustworthy.")},updated_at=CURRENT_TIMESTAMP
WHERE id=${q(ids.taming)};
UPDATE submission_people SET user_id=${q(ids.speakerUser)},name='Priya Raman',email='maddie+programloom-speaker@maddiedreese.com',organization='Latticework Systems',role='primary',position=0
WHERE submission_id=${q(ids.taming)} AND position=0;
INSERT OR IGNORE INTO submission_people(id,submission_id,email,name,role,organization,position)
VALUES('61000000-0000-4000-8002-000000000001',${q(ids.taming)},'marcus.okafor@example.com','Marcus Okafor','coauthor','Cloudreach Labs',1);
INSERT OR IGNORE INTO session_speakers(submission_id,speaker_id,role)
VALUES(${q(ids.taming)},${q(ids.priya)},'speaker'),(${q(ids.taming)},${q(ids.marcus)},'co-presenter');
DELETE FROM submission_tracks WHERE submission_id=${q(ids.taming)};
INSERT INTO submission_tracks(submission_id,track_id) VALUES(${q(ids.taming)},${q(ids.platformTrack)});
UPDATE agenda_items SET title=${q(tamingTitle)},description=${q(tamingAbstract)},track_id=${q(ids.platformTrack)},status='published',updated_at=CURRENT_TIMESTAMP
WHERE submission_id=${q(ids.taming)};
INSERT INTO session_content_state(submission_id,status,updated_by)
VALUES(${q(ids.taming)},'approved',${q(ids.organizer)})
ON CONFLICT(submission_id) DO UPDATE SET status='approved',updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP;

INSERT INTO submissions(id,form_id,event_id,submitter_user_id,title,abstract,format,duration_minutes,status,answers_json,submitted_at,decision_state)
VALUES
(${q(ids.aiPair)},${q(ids.form)},${q(ids.event)},${q(ids.speakerUser)},${q(aiPairTitle)},${q(aiPairAbstract)},'Workshop (120 min)',120,'pending',${answer(aiPairTitle, aiPairAbstract, "Workshop (120 min)", "AI Engineering", "Trust AI output only after observable verification.")},CURRENT_TIMESTAMP,'none'),
(${q(ids.docs)},${q(ids.form)},${q(ids.event)},NULL,${q(docsTitle)},${q(docsAbstract)},'Talk (30 min)',30,'pending',${answer(docsTitle, docsAbstract, "Talk (30 min)", "Developer Experience", "Documentation answers should remain grounded and reviewable.")},CURRENT_TIMESTAMP,'none'),
(${q(ids.lightning)},${q(ids.form)},${q(ids.event)},NULL,${q(lightningTitle)},${q(lightningAbstract)},'Lightning Talk (10 min)',10,'accepted',${answer(lightningTitle, lightningAbstract, "Lightning Talk (10 min)", "AI Engineering", "Production agents need explicit operating boundaries.")},CURRENT_TIMESTAMP,'accepted')
ON CONFLICT(id) DO UPDATE SET title=excluded.title,abstract=excluded.abstract,format=excluded.format,duration_minutes=excluded.duration_minutes,answers_json=excluded.answers_json,updated_at=CURRENT_TIMESTAMP;
INSERT INTO submission_people(id,submission_id,user_id,email,name,role,organization,position)
VALUES
('61000000-0000-4000-8002-000000000002',${q(ids.aiPair)},${q(ids.speakerUser)},'maddie+programloom-speaker@maddiedreese.com','Priya Raman','primary','Latticework Systems',0),
('61000000-0000-4000-8002-000000000003',${q(ids.docs)},NULL,'dana.docs@example.com','Dana Kowalski','primary','Docs That Work',0),
('61000000-0000-4000-8002-000000000004',${q(ids.lightning)},NULL,'marcus.okafor@example.com','Marcus Okafor','primary','Cloudreach Labs',0)
ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,email=excluded.email,name=excluded.name,organization=excluded.organization;
INSERT OR IGNORE INTO submission_tracks(submission_id,track_id)
VALUES(${q(ids.aiPair)},${q(ids.aiTrack)}),(${q(ids.docs)},${q(ids.devxTrack)}),(${q(ids.lightning)},${q(ids.aiTrack)});
INSERT OR IGNORE INTO session_speakers(submission_id,speaker_id,role)
VALUES(${q(ids.lightning)},${q(ids.marcus)},'speaker');
INSERT INTO session_content_state(submission_id,status,updated_by)
VALUES(${q(ids.lightning)},'approved',${q(ids.organizer)})
ON CONFLICT(submission_id) DO UPDATE SET status='approved',updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP;
INSERT INTO agenda_items(id,event_id,submission_id,track_id,item_type,title,description,starts_at,ends_at,status)
VALUES(${q(ids.lightningAgenda)},${q(ids.event)},${q(ids.lightning)},${q(ids.aiTrack)},'session',${q(lightningTitle)},${q(lightningAbstract)},NULL,NULL,'draft')
ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,track_id=excluded.track_id,starts_at=NULL,ends_at=NULL,status='draft',cancelled_at=NULL,updated_at=CURRENT_TIMESTAMP;

UPDATE review_rounds SET name='Initial Review',status='open',opens_at='2026-08-01T00:00:00.000Z',closes_at='2027-04-01T00:00:00.000Z'
WHERE id=${q(ids.initialRound)};
UPDATE review_rounds SET name='Final Review',status='draft' WHERE id='62e00dad-73dd-48b8-9290-2a6c8ea9211f';
UPDATE review_rounds SET name='Executive Review',status='draft' WHERE id='59998ae1-7351-48bf-b262-a9c659465196';
INSERT INTO review_round_reviewers(round_id,reviewer_user_id,capacity)
VALUES(${q(ids.initialRound)},${q(ids.reviewer)},20)
ON CONFLICT(round_id,reviewer_user_id) DO UPDATE SET capacity=20;
INSERT INTO review_routing_rules
  (id,organization_id,event_id,name,description,priority,enabled,group_operator,round_id,reviewers_per_submission,owner_user_id,created_by,updated_by)
VALUES
  ('62000000-0000-4000-8000-000000000001',${q(ids.organization)},${q(ids.event)},'AI Engineering workshops','Route hands-on AI Engineering workshops into Initial Review with an eligible reviewer.',10,1,'and',${q(ids.initialRound)},1,${q(ids.organizer)},${q(ids.organizer)},${q(ids.organizer)})
ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,priority=excluded.priority,enabled=1,round_id=excluded.round_id,reviewers_per_submission=excluded.reviewers_per_submission,owner_user_id=excluded.owner_user_id,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP;
INSERT INTO review_routing_condition_groups(id,rule_id,position,condition_operator)
VALUES('62000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',0,'and')
ON CONFLICT(id) DO UPDATE SET position=0,condition_operator='and';
INSERT INTO review_routing_conditions(id,group_id,source,field_id,operator,value_json,position)
VALUES
  ('62000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000002','track',NULL,'equals',${q(JSON.stringify(ids.aiTrack))},0),
  ('62000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000002','format',NULL,'equals',${q(JSON.stringify("Workshop (120 min)"))},1)
ON CONFLICT(id) DO UPDATE SET source=excluded.source,field_id=excluded.field_id,operator=excluded.operator,value_json=excluded.value_json,position=excluded.position;
UPDATE scorecard_fields SET weight=2 WHERE id='3da0a1d3-fd6a-4493-ae09-33b8bc78c046';
UPDATE scorecard_fields SET weight=1 WHERE id='3be936e3-f342-4d1c-af33-97be2a0596d7';
INSERT INTO scorecard_fields(id,round_id,label,field_type,min_value,max_value,weight,required,position)
VALUES('61000000-0000-4000-8003-000000000001',${q(ids.initialRound)},'Technical depth','numeric',1,5,3,1,2)
ON CONFLICT(id) DO UPDATE SET weight=3,required=1;

INSERT OR IGNORE INTO speaker_task_assignments(task_id,speaker_id,status)
SELECT id,${q(ids.marcus)},'todo' FROM onboarding_tasks
WHERE event_id=${q(ids.event)} AND title IN ('Confirm participation','Complete bio and profile','Sign speaker release form');

INSERT OR IGNORE INTO audit_events(id,organization_id,event_id,actor_user_id,action,entity_type,entity_id,after_json,request_id,correlation_id)
VALUES
('61000000-0000-4000-8004-000000000001',${q(ids.organization)},${q(ids.event)},${q(ids.organizer)},'evaluator.lifecycle_seeded','event',${q(ids.event)},'{"fixture":"coherent-devflow-lifecycle","version":1}','evaluator-seed-v1','evaluator-seed-v1'),
('61000000-0000-4000-8004-000000000002',${q(ids.organization)},${q(ids.event)},${q(ids.organizer)},'submission.seeded','submission',${q(ids.aiPair)},'{"title":"Your AI Pair Programmer Is Lying to You: Verification Patterns That Scale"}','evaluator-seed-v1','evaluator-seed-v1'),
('61000000-0000-4000-8004-000000000003',${q(ids.organization)},${q(ids.event)},${q(ids.organizer)},'submission.seeded','submission',${q(ids.docs)},'{"title":"Docs That Answer Back: Retrieval-Grounded Documentation Sites"}','evaluator-seed-v1','evaluator-seed-v1');
INSERT OR IGNORE INTO integration_outbox(id,organization_id,event_id,integration,action,entity_type,entity_id,payload_json,idempotency_key)
VALUES
('airtable-61000000-0000-4000-8004-000000000001',${q(ids.organization)},${q(ids.event)},'airtable','upsert','event',${q(ids.event)},'{"action":"evaluator.lifecycle_seeded"}','airtable:evaluator:event:v1'),
('airtable-61000000-0000-4000-8004-000000000002',${q(ids.organization)},${q(ids.event)},'airtable','upsert','submission',${q(ids.aiPair)},'{"action":"submission.seeded"}','airtable:evaluator:ai-pair:v1'),
('airtable-61000000-0000-4000-8004-000000000003',${q(ids.organization)},${q(ids.event)},'airtable','upsert','submission',${q(ids.docs)},'{"action":"submission.seeded"}','airtable:evaluator:docs:v1'),
('airtable-61000000-0000-4000-8004-000000000004',${q(ids.organization)},${q(ids.event)},'airtable','upsert','submission',${q(ids.lightning)},'{"action":"submission.seeded"}','airtable:evaluator:lightning:v1'),
('airtable-61000000-0000-4000-8004-000000000005',${q(ids.organization)},${q(ids.archivedEvent)},'airtable','upsert','event',${q(ids.archivedEvent)},'{"action":"evaluator.scratchpad_archived"}','airtable:evaluator:archived-event:v2'),
('airtable-61000000-0000-4000-8004-000000000006',${q(ids.organization)},${q(ids.event)},'airtable','upsert','cfp_form',${q(ids.form)},'{"action":"evaluator.cfp_aligned"}','airtable:evaluator:cfp:v2');
`;

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
      sql,
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler.log" },
    },
  ),
);
if (!result.every(({ success }) => success)) throw new Error("D1 seed failed.");

console.log(
  JSON.stringify({
    mode: "applied",
    eventId: ids.event,
    eventName: "ProgramLoom Production Readiness",
    publicCfp:
      "https://app.programloom.com/c/devflow-programs/programloom-production-readiness/cfp",
    exactEvaluatorProposals: [
      tamingTitle,
      aiPairTitle,
      docsTitle,
      lightningTitle,
    ],
  }),
);
