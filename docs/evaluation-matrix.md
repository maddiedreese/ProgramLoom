# Evaluation traceability matrix

This file is the delivery ledger for the 96-item Kill My SaaS evaluator. Criteria remain **planned** until linked implementation, test, and production evidence all exist. A polished screen alone is not evidence of a round trip, rule, scope boundary, or side effect.

| Area | Criterion IDs | Count | Current state | Required evidence |
|---|---:|---:|---|---|
| Call for papers | CFP-01–CFP-16 | 16 | In progress: organizer form builder implemented and runtime-tested | Anonymous submit, draft/edit/deadline enforcement, reviewer isolation, decisions, delivery evidence |
| Abstract management | ABS-01–ABS-14 | 14 | Planned | Two-round scoring, assignment/scoping, blind review, COI, aggregate/export, AI override evidence |
| Speaker management | SPK-01–SPK-16 | 16 | Planned | Roster/import, portal scoping, profiles, tasks, files, email/logistics, handoff evidence |
| Content management | CNT-01–CNT-14 | 14 | Planned | Requests, uploads, versions, comments, constraints, approval, history, ZIP evidence |
| Agenda and scheduling | AIA-01–AIA-08 | 8 | Planned | Configuration, placement persistence, two conflict classes, move/clear, publish, assisted scheduling evidence |
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
