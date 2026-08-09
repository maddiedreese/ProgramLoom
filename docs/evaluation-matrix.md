# Evaluation traceability matrix

This file is the delivery ledger for the 96-item Kill My SaaS evaluator. Criteria remain **planned** until linked implementation, test, and production evidence all exist. A polished screen alone is not evidence of a round trip, rule, scope boundary, or side effect.

| Area | Criterion IDs | Count | Current state | Required evidence |
|---|---:|---:|---|---|
| Call for papers | CFP-01–CFP-16 | 16 | Implemented and locally protocol-tested; production mailbox/Turnstile evidence pending | Anonymous submit, draft/edit/deadline enforcement, reviewer isolation, decisions, delivery evidence |
| Abstract management | ABS-01–ABS-14 | 14 | Implemented and locally protocol-tested; live AI response evidence pending | Two-round scoring, assignment/scoping, blind review, COI, aggregate/export, AI override evidence |
| Speaker management | SPK-01–SPK-16 | 16 | Implemented, locally protocol-tested, and deployed | Roster/import, portal scoping, profiles, tasks, files, email/logistics, handoff evidence |
| Content management | CNT-01–CNT-14 | 14 | Planned | Requests, uploads, versions, comments, constraints, approval, history, ZIP evidence |
| Agenda and scheduling | AIA-01–AIA-08 | 8 | Implemented, locally protocol-tested, and deployed | Configuration, placement persistence, two conflict classes, move/clear, publish, assisted scheduling evidence |
| Public widgets | EMB-01–EMB-16 | 16 | Planned | All five anonymous widgets, search/filter/detail, navigation, schedule persistence/ICS, generator and live propagation evidence |
| Speaker CRM | CRM-01–CRM-12 | 12 | Planned and required | Directory, filters, history, fields, import/dedupe, pipeline, segments, event handoff, outreach, analytics evidence |
| **Total** |  | **96** |  |  |

## Evidence states

- **Planned:** requirement understood; no completion claim.
- **Implemented:** general-purpose production code exists.
- **Tested:** the relevant behavior and negative/scoping cases pass repeatably.
- **Production verified:** the deployed application was exercised with recorded URL, identity, timestamp, and result.
- **Complete:** all evidence above exists, including any human-only mailbox, calendar, file, or multi-browser protocol.

The detailed row-level ledger will be populated from the evaluator YAML before module implementation begins. Ordered scenario execution must follow CFP → abstract management → speaker management → content → agenda → embeds, preserving generated state between areas. CRM is then run as required extra scope.

## CFP implementation evidence

- Event access resolves organization owners/admins and scoped event roles server-side.
- Organizer APIs support form create/read/update/delete, protected deletion, publish/unpublish, field create/update/delete, tracks, and conditional rules.
- Select options and conditional values round-trip as structured JSON; forms require a field and a valid future deadline, when configured, before publication.
- The organizer UI exposes field types, required flags, sections, options, deadlines, draft policy, submission limits, confirmation messaging, and conditional show/hide/require rules.
- Local Worker + D1 runtime protocol verified authenticated create → fields → conditional rule → publish → read-back on 2026-08-09. This is development evidence, not production-complete evaluator evidence.
- Anonymous submitter flow now renders published configuration, applies conditional visibility/requirements on both client and server, supports hashed private draft/edit tokens, enforces availability/edit windows and submission limits, transitions drafts into the review queue, and records real Resend confirmation attempts. Local draft → validation rejection → submit → private read-back protocol passed on 2026-08-09; production mailbox evidence remains pending.
- Organizer submission management now provides owner/admin-scoped search and status filters, structured answer/submitter detail, aggregate review progress, decision queues, and auditable status transitions. Local filtered list → detail → accept queue → audit read-back protocol passed on 2026-08-09.

## Abstract review implementation evidence

- Organizer review configuration supports ordered multi-round evaluation, blind/non-blind mode, weighted numeric criteria, scored-select criteria, reviewer notes, required fields, round lifecycle, bulk assignment, progress, and aggregate scores.
- Assignment creation requires event-scoped reviewer access and rejects speaker/self assignments as explicit conflicts. Duplicate assignment requests are idempotent and reported separately.
- Reviewer endpoints are identity-scoped to assigned proposals. Draft/future rounds remain invisible; blind detail removes people and speaker-section answers; direct organizer submission access by a reviewer returns `403`.
- Reviewers can save partial drafts, submit only valid final scorecards, receive a server-computed weighted score, and recuse with a persisted rationale. Organizer aggregates update from the same review records.
- Two-session local protocol passed draft invisibility → blind assignment → PII denial → required-score rejection → weighted final score `4.33` → organizer `1/1` completion on 2026-08-09.
- Workers AI advisory assessment stores model, original score, reasoning, strengths, and risks; human override preserves the original while setting an effective score, actor, and rationale. A 25-assessment event/day guard protects the free tier. Local stored assessment `82` → human override `76` → transparent read-back passed without invoking AI on 2026-08-09. Live model-response evidence remains pending.
- Decision delivery requires proposals to enter the matching accept/decline queue, personalizes documented placeholders, sends through verified Resend infrastructure, records provider/error history idempotently, and leaves failed deliveries queued. Final states cannot be bypassed through the status API.
- A successful acceptance atomically records final status and audit history, creates/updates the organization speaker profile, links it to the accepted session, grants an existing user event-scoped speaker access or creates a hashed 30-day invitation, and includes the portal link in the real decision message. Local queue → test-mode delivery → D1 proof of accepted/email/speaker/session/invitation state passed on 2026-08-09; production mailbox evidence remains pending.

## Speaker operations implementation evidence

- Accepted speakers receive an event-scoped portal with linked sessions, public profile fields, private logistics, onboarding tasks, published resources, headshots, and requested files. Organizer endpoints remain inaccessible to speaker identities and organizer identities cannot enter speaker-scoped endpoints.
- Headshots and requested content use private R2 objects. File requests enforce type/size policy, keep immutable numbered versions with SHA-256 digests, and expose authorized speaker and organizer downloads only.
- Organizer operations provide readiness totals, task review, file approval/needs-changes comments, resource publishing, and bulk task/file assignment. Existing onboarding tasks are automatically assigned during future acceptance handoffs.
- Two-role local protocol passed speaker profile/logistics → task submission → deck/headshot upload → organizer task/file approval → byte-identical authorized downloads on 2026-08-09. Deployed Worker `96145937-fcd1-4c5f-8aa4-e228c1c5e1db` passed production health and anonymous-auth-boundary checks.

## Agenda implementation evidence

- Organizers can configure rooms/tracks, add accepted sessions and non-session blocks, place/move/clear items, and publish only a complete conflict-free schedule. Every mutation is event-scoped, versioned, and audited.
- Placement rejects overlapping use of the same room and independently rejects a shared speaker appearing in overlapping sessions across different rooms. Publication performs a final global scan for both conflict classes.
- The assisted scheduler is a deterministic multi-room greedy algorithm. It accounts for existing occupancy and speaker sets, returns a preview, and applies only compatible placements; it is not mocked or demo data.
- Local protocol passed incomplete publish rejection → combined room/speaker collision → cross-room speaker collision → assisted next-slot placement → publication → clear/move → republish with persisted version increments on 2026-08-09. Deployed Worker `9b1de170-576f-4001-a8d6-22fb1fc22a16` exposed the authenticated agenda boundary on both production domains after edge propagation.
