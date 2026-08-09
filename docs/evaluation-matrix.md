# Evaluation traceability matrix

This file is the delivery ledger for the 96-item Kill My SaaS evaluator. Criteria remain **planned** until linked implementation, test, and production evidence all exist. A polished screen alone is not evidence of a round trip, rule, scope boundary, or side effect.

| Area                  | Criterion IDs |  Count | Current state                                                                                       | Required evidence                                                                                                               |
| --------------------- | ------------: | -----: | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Call for papers       | CFP-01–CFP-16 |     16 | Implemented and locally protocol-tested; production mailbox/Turnstile evidence pending              | Anonymous submit, draft/edit/deadline enforcement, reviewer isolation, decisions, delivery evidence                             |
| Abstract management   | ABS-01–ABS-14 |     14 | Implemented and locally protocol-tested; live AI response evidence pending                          | Two-round scoring, assignment/scoping, blind review, COI, aggregate/export, AI override evidence                                |
| Speaker management    | SPK-01–SPK-16 |     16 | Implemented, locally protocol-tested, and deployed                                                  | Roster/import, portal scoping, profiles, tasks, files, email/logistics, handoff evidence                                        |
| Content management    | CNT-01–CNT-14 |     14 | Implemented, locally protocol-tested, and deployed; production mailbox/seeded ZIP evidence pending | Requests, uploads, versions, comments, constraints, approval, history, ZIP evidence                                             |
| Agenda and scheduling | AIA-01–AIA-08 |      8 | Implemented, locally protocol-tested, and deployed                                                  | Configuration, placement persistence, two conflict classes, move/clear, publish, assisted scheduling evidence                   |
| Public widgets        | EMB-01–EMB-16 |     16 | Implemented, locally protocol-tested, and deployed; seeded production data protocol pending         | All five anonymous widgets, search/filter/detail, navigation, schedule persistence/ICS, generator and live propagation evidence |
| Speaker CRM           | CRM-01–CRM-12 |     12 | Implemented, locally protocol-tested, and deployed; production seeded-data/mailbox protocol pending | Directory, filters, history, fields, import/dedupe, pipeline, segments, event handoff, outreach, analytics evidence             |
| **Total**             |               | **96** |                                                                                                     |                                                                                                                                 |

## Evidence states

- **Planned:** requirement understood; no completion claim.
- **Implemented:** general-purpose production code exists.
- **Tested:** the relevant behavior and negative/scoping cases pass repeatably.
- **Production verified:** the deployed application was exercised with recorded URL, identity, timestamp, and result.
- **Complete:** all evidence above exists, including any human-only mailbox, calendar, file, or multi-browser protocol.

The exact upstream evaluator at commit `d99935` validates all 96 IDs and 20 ordered scenarios in the zero-cost dry run. Final evidence collection must follow CFP → abstract management → speaker management → content → agenda → embeds, preserving generated state between areas. CRM then runs as required extra scope.

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

## Content management implementation evidence

- Organizer file-request tasks retain instructions and deadlines, assign every accepted speaker, and create a private upload slot for each speaker/session pair. The upload setting is persisted per event and enforced server-side. The speaker portal shows only the signed-in speaker's tasks, sessions, deadlines, status, and upload slots; organizer APIs return `403` to that identity.
- Private R2 uploads enforce visible and server-side PDF, PowerPoint, ZIP, PNG, JPEG, and WebP constraints with a 25 MB ceiling. Re-uploading creates immutable SHA-256-numbered versions; both roles can inspect author/timestamp history, identify the current version, and download any prior version. Per-file comments preserve author and timestamp across roles without generating unwanted comment email.
- The organizer Content workspace exposes all speaker-task pairs with task/incomplete/overdue filters, upload-reflected status, bulk Resend reminders naming every outstanding task/deadline, a central session/speaker file library, version/comment detail, and secure seven-day share links.
- Central editing persists session title/abstract and speaker bio/headshot changes. Every session edit snapshots the prior value with actor and timestamp; restore creates a new revision before applying the selected version. Draft/in-review/approved state is durable, and all public session, speaker, and agenda widget reads require approval while non-session agenda blocks remain publishable.
- Distribution multi-selects uploaded files, supports session/speaker/flat grouping, creates a real ZIP in R2 from latest versions only, enforces a 100 MB generation bound, records ready/failed export history, and returns an authenticated archive download. Workers AI can suggest clarity/tone/length improvements with a 25-per-event daily free-tier guard; suggestions remain reviewable and require an explicit human apply/save.
- The repeatable two-role local protocol passed two tasks × two speakers → scoped speaker upload v1/v2 → cross-role comments → organizer status reflection → two edits/history/restore → speaker bio/headshot → approved-in/unapproved-out public widget gate → latest-only grouped ZIP byte verification → anonymous share-link byte verification on 2026-08-09. Speaker access to content administration returned `403`; the full suite now has 25 passing tests.
- Migration `0007_content_management.sql` executed all ten additive commands successfully against local and production D1. Deployed Worker `046330c9-d0b7-44b4-a02c-ca69db55dc42` returns production health `200`, the Content SPA route `200`, protected content administration `401` anonymously, and an invalid/expired share URL `404`. The Content screen is route-split into a 5.42 KB gzipped chunk.

## Public widget implementation evidence

- Organizers can create and edit five persistent public configurations: sessions, speakers, agenda, personal itinerary, and gallery. Theme, brand color, search, track filtering, selected tracks, and visible fields are stored in D1 and read on every public request, so edits propagate without replacing embed code.
- Anonymous widget reads expose accepted-session and published-agenda read models only. Speaker headshots remain private R2 objects served through an acceptance-scoped public route; organizer endpoints require owner/admin event access.
- Search, track filtering, expandable session details, responsive layouts, durable device-local itinerary choices, and personal ICS export are functional client behavior. JSON, XML, and full-agenda iCal feeds share the same track-restricted server read model.
- Local Worker + D1 protocol created all five types, validated anonymous JSON/XML/iCal payloads, rejected unauthorized administration, and confirmed PATCH propagation on 2026-08-09. Browser protocol rendered the live agenda and confirmed an itinerary addition survived a full reload.
- Deployed Worker `d54caf33-a364-4308-8c20-a6021bde1b5f` passed production health and authorization-boundary checks. The embed shell returns `200` with `frame-ancestors *` and no `X-Frame-Options`; normal application routes retain `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Production D1 has no event records yet, so full seeded public-data evidence remains pending.
- PostHog is configured with the existing US project token, lazy loading, identified-only person profiles, no session recording, and no autocapture. Explicit widget and itinerary events plus route pageviews are enabled; the core app is 105.48 KB gzipped. Speaker operations, CRM, content, and public interest are route-split into 16.48 KB, 12.66 KB, 5.42 KB, and 2.15 KB gzipped chunks, and XLSX parsing loads only when a spreadsheet is selected.

## Speaker CRM implementation evidence

- Organization-level CRM navigation exposes a persistent cross-event directory with debounced partial search, combinable company/title/tag filters, clearable chips, reusable dynamic or curated segments, CSV export, and validated CSV/XLSX import with column mapping and create/update-by-email behavior.
- Contact profiles retain identity, pronouns, company/title, phone, region, bio, tags, social data, global custom fields, timestamped private notes, sent-email activity, event connections, and session history. Duplicate candidates are identified by name and can be permanently merged into an explicit primary record while preserving linked notes, fields, segments, pipeline history, outreach history, interest submissions, and the operator-selected email.
- The sourcing pipeline persists all eight evaluator stages, drag/select movement, score and rationale, card notes, and actor-attributed stage history. Contacts can be handed into any workspace event without re-entry; the shared speaker profile and explicit event roster connection feed existing speaker operations.
- Bulk outreach personalizes supported merge tags per recipient, sends through the verified Resend domain, and records campaign/recipient provider state for history and analytics. The dashboard derives live contact, event-speaker, returning-speaker, pipeline, company, source, and email metrics from D1 rather than fixtures.
- Optional scope is implemented as required: year-round public speaker-interest forms with speaker-only or speaker-plus-session modes, custom fields, availability windows, future-event association, management/notification metadata, Turnstile validation, automatic contact upsert, and automatic Identified pipeline enrollment. CRM write actions remain owner/admin-only while workspace members have read access.
- The repeatable local D1 smoke protocol passed create/import/search → note/custom field → dynamic segment → pipeline move/note/history → event handoff → public interest-form publication → duplicate merge with duplicate-email selection → live dashboard totals on 2026-08-09. Unit and authorization-boundary coverage brings the project suite to 22 passing tests.
- Migration `0005_speaker_crm.sql` executed all 19 additive commands successfully against local and production D1. Deployed Worker `9ec6e52b-ea76-490c-bfa1-007ec873575d` returns production health `200`, protected CRM reads `401` anonymously, public missing forms `404`, and the CRM/public interest SPA routes `200` with the expected frame and content security policy. Seeded production workflow and real outreach mailbox evidence remain pending.

## Airtable and operations evidence

- Airtable-authoritative workspaces use a real audit-driven D1 outbox, Cloudflare Queue consumer, stable external IDs, bounded exponential backoff, retryable conflicts, and pull reconciliation for organizations, events, CRM contacts, and pipeline cards. Client-side Airtable deletions propagate for deletable domains; tenancy-row deletion is intentionally surfaced as a conflict.
- The HMAC-authenticated Airtable webhook is filtered to client table-data add/update/remove changes. Closely spaced pings are durably coalesced, Worker API writes do not echo, a ten-minute cron drains due D1 work without polling Airtable, and the daily payload read keeps the webhook active.
- Owners/admins can see configuration, pending/failed counts, conflicts, resource timestamps, and last sync in the workspace and can run an explicit recovery sync. Identity and authorization remain exclusively in D1.
- Migration `0006_airtable_sync.sql` passed locally and in production. A production QA workspace completed D1 outbox → Cloudflare Queue → Airtable record creation → D1 external-record mapping with zero pending work, zero failures, and zero conflicts on 2026-08-09. Worker `b774d6ad-712a-483c-bfad-00230eff156b` passed health `200`, undiscoverable webhook-path `404`, and anonymous integration `401` probes.
- Third-party error collection has been removed from source, packages, secrets, build configuration, and CSP. Server request, queue, scheduled-task, and integration failures emit structured JSON into enabled Cloudflare Workers Observability; PostHog remains limited to explicit product analytics.

## Production hardening evidence

- Worker `046330c9-d0b7-44b4-a02c-ca69db55dc42` is live on both production domains. Health returns `200` with a request ID; normal application pages send HSTS with subdomains, a restrictive CSP, no-sniff, permissions policy, strict-origin referrer policy, and frame denial. Embed pages retain the intentionally narrow framing exception.
- Magic-link and invitation sessions are random-token, SHA-256-indexed, revocable, expiring, `HttpOnly`, `Secure` in production, and `SameSite=Lax`. Anonymous authentication, CFP, and interest-form writes are protected by Cloudflare Turnstile. Server-side organization/event membership checks return nondisclosing `404` for absent scope and `403` for insufficient roles.
- Speaker resource HTML now passes through a tested DOMPurify tag/attribute allowlist. Only approved YouTube, Vimeo, and Google Slides iframe origins survive, and every surviving frame is sandboxed and lazy-loaded. Executable markup, inline styles, unsafe URLs, images, and unapproved frames are removed.
- `npm audit --audit-level=high` reports zero vulnerabilities. The full typecheck, 25-test suite, and production build pass. The upstream evaluator browser smoke passes navigation, text/select input, upload, drag, click, and screenshot operations; its `--include-optional` dry run validates all 7 areas, 20 scenarios, and 96 rubrics.
- A production axe-core run across marketing, login, and authenticated organizer onboarding reports zero WCAG 2 A/AA/2.1 AA violations at 1440×1000 and 390×844. All six layouts have no horizontal overflow. Measured DOM-ready timing was 194–439 ms in the same run.
