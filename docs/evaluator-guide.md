# ProgramLoom evaluator guide

ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.

- Product: ProgramLoom
- Marketing: <https://programloom.com>
- Application: <https://app.programloom.com>
- Source: <https://github.com/maddiedreese/ProgramLoom>
- License: GNU AGPL-3.0-only
- Transactional sender: `ProgramLoom <notifications@mail.programloom.com>`

## Product narrative

The Organizer Control Room is the center of ProgramLoom. It prioritizes live blockers and links directly to the workflow or record that resolves each one. A proposal proceeds through assignment and review before an organizer stages a decision. Staging changes program state but sends nothing. The Communications Center separately previews the real recipients and delivers the decision. An acceptance then creates the connected speaker, session, portal, onboarding, content, notification, audit, and communication records needed to carry the work into scheduling, calendar delivery, agenda publication, attendee widgets, and follow-up.

Three product decisions should be stated verbatim during judging:

1. **Stage decision is not Send decision.** This prevents an organizer from accidentally emailing hundreds of speakers while outcomes are still being prepared.
2. **The Control Room derives next actions from persisted facts.** Organizers do not maintain decorative completion statuses.
3. **The calendar lifecycle includes update and cancellation semantics.** Stable UID and increasing sequence prevent moved or cancelled sessions from remaining stale on participant calendars.

## First five minutes

Open <https://programloom.com/evaluate>. Select **Judge ProgramLoom**, watch the 90-second Control Room tour, then open the Organizer, Reviewer, Speaker, and Public Program cards. Use the direct seeded routes on that page to prove the CFP, incomplete review, outstanding tasks, scheduling conflict, communication recovery, and public outputs. Do not begin with the CFP builder: begin with the Control Room finding persisted blockers and taking the organizer directly to their resolution.

## Uninterrupted evaluator walkthrough

Use one coherent production-readiness event and the prescribed organizer, reviewer, and speaker personas. Keep generated state between steps; isolate disposable conflict/failure/cancellation records from the polished public program.

Before a scored run, create a new isolated event instead of reusing records from an earlier evaluation:

```bash
PROGRAMLOOM_PRODUCTION_CONFIRM=programloom-production \
PROGRAMLOOM_EVALUATOR_RUN_ID=final-01 \
npm run prepare:evaluator
```

The command also requires `PROGRAMLOOM_E2E_STORAGE_STATE`, `PROGRAMLOOM_SPEAKER_STORAGE_STATE`, and `PROGRAMLOOM_REVIEWER_STORAGE_STATE` to point at the three restricted browser-state files, plus the matching `PROGRAMLOOM_ORGANIZER_EMAIL`, `PROGRAMLOOM_SPEAKER_EMAIL`, and `PROGRAMLOOM_REVIEWER_EMAIL` values. It verifies each saved identity and its event role before continuing. The command creates an unpublished conference dated May 12–14, 2027, provisions the controlled speaker and reviewer personas, creates only the basic CFP review round needed by the CFP scenario, generates all five anonymous widget configurations, and then fails unless there is exactly one unpublished form, zero submissions, zero assignments, and no extra review rounds. Copy the emitted event ID, CFP route, and widget routes into the private evaluator configuration. Never point a scored run at an event mutated by an earlier run. If preparation or recording fails, delete that exact isolated event and verify that its ID no longer exists before trying again.

1. State the product promise above in one sentence and open the **Control Room**. Show one incomplete review, one unsent decision, one missing speaker asset, and one accepted talk without a slot. Explain that the recommendation and affected-record counts come from persisted facts.
2. From the dashboard, create the fresh walkthrough event from a maintained reusable template. Preview selected configuration and excluded private/history domains before confirming, then return immediately to its Control Room.
3. Open **Call for proposals** from the Control Room action, customize the duplicated form, and publish it. Open its working public route.
4. Submit a proposal as the speaker persona, return as organizer, and locate it in **Submissions** using search and filters.
5. Configure useful columns, save a personal review-readiness view, share an organization view, and reopen it.
6. Choose **Assign reviewers**, assign the reviewer, switch personas, and complete the scorecard. Return as organizer.
7. Open the proposal and choose **Stage decision: Acceptance**. Show the persistent **Staged, not sent** state; no email has been requested yet.
8. Choose **Preview recipients and send decision**. In **Communications**, verify merge fields against the real recipient and send through the Queue-backed outbox.
9. Show the automatically connected speaker, session, portal access, onboarding task, audit event, notification, and communication timeline.
10. As the speaker, update the profile, complete onboarding, and upload the requested headshot, slides, and content. Return as organizer and show corresponding Control Room blockers disappearing.
11. Approve the content and schedule the session. Deliver the initial calendar invitation from **Calendar lifecycle**.
12. Change its time and room. Show the same UID, higher sequence, and in-place update evidence.
13. Introduce a real room or speaker conflict, open the explicit conflict workflow, resolve it, and show the Control Room count reconcile.
14. Choose **Publish agenda** and demonstrate all five anonymous public widgets: sessions, speaker directory, agenda, itinerary, and speaker gallery. Exercise details, multi-day navigation, search/filter counts, two itinerary additions, reload persistence, removal, ICS export, and live configuration propagation.
15. Open the command palette with the visible Search control and macOS **Command+K**. Find the same speaker, session, file, and communication; exercise safe quick-action routing.
16. Demonstrate one legible Airtable loop: change a proposal or speaker in ProgramLoom, choose **Sync now**, and show the matching external record in the recent-record list. If demonstrating a supported reverse change, make it in Airtable, sync again, and show the ProgramLoom record converge with zero pending, zero failed, and zero open conflicts.
17. Show one recovery path in under 30 seconds: open a controlled retryable failed communication, choose **Retry delivery**, and show the durable delivered state plus its audit and notification. Do not manufacture a live outage.
18. Cancel an isolated disposable session. Show its higher-sequence `CANCEL`, removal from public surfaces, notification, audit, communication, and Control Room consequences. Demonstrate explicit rescheduling after cancellation only if the scenario calls for it.
19. End in the Control Room, refresh, reconcile its counts with the underlying records, and show a clear or intentionally explained state. Delete the exact walkthrough event after the recording and retain only sanitized evidence of the run.

The recording should remain one continuous story: no unexplained fixture switching, undocumented URLs, hidden controls, long setup detours, or claims that are not visible on screen. Use concise on-screen chapter overlays and action callouts; do not add a voiceover. Cut or accelerate unavoidable provider waits in post-production, label every accelerated interval on screen, and reject a final video containing an unexplained static interval longer than ten seconds.

## What is production-backed

- D1 persists multi-tenant identity, authorization, workflow, audit, message, calendar, notification, search-view, integration and recovery state.
- R2 stores real private upload versions and generated exports; no required file workflow depends on client-only or demo persistence.
- Cloudflare Queue processes real idempotent communication and Airtable work with bounded retries and durable failure state.
- Resend messages preserve prepared, queued, processing, sent, delivered when evidenced, bounced, failed and cancelled as distinct states.
- Airtable-authoritative workspaces use stable external identifiers, an outbox, webhook reconciliation, visible health, conflict-safe retry and recovery.
- PostHog receives explicit product events without query text, message bodies, tokens, or personal data. Structured Cloudflare logs and Workers Observability provide operational evidence without Sentry.
- Calendar invitations use stable UIDs, increasing sequences, standards-compliant request/cancel bytes and distinct participant-addressed delivery history.
- Every public widget is anonymous, responsive, accessible and generated from current persisted organizer records.

## Exact evidence policy

The committed [production manifest](evidence/production-manifest.json) defines the sanitized schema. The populated final manifest remains in the restricted evidence bundle outside source. With `PROGRAMLOOM_EVIDENCE_MANIFEST` set to that file, the final `npm run verify:evidence -- --final` command must match local `HEAD` to production health and reject stale checklist or release claims.

Email provider acceptance is not described as delivery unless the provider supplies delivery evidence. Performance evidence names its route, production environment, Cloudflare region, device, sample size and measurement method. Gmail and Apple Calendar are the tested calendar clients.

The final evaluator report classifies each failed criterion as a genuine product defect, missing evidence, evaluator navigation failure, unsupported manual environment, or incorrect evaluator inference. Genuine defects and missing evidence must be closed before submission. Full run artifacts, private screenshots, manual checklist, inbox evidence, authentication state and OpenRouter spend ledger remain outside committed source.

## Operating boundaries

- Sentry is not used; structured logs and Cloudflare Workers Observability are the operational source.
- No paid service, resource or plan change is allowed without owner approval. The final evaluator obeys the approved OpenRouter ceiling.

See the [parity map](parity-map.md), [production evidence index](evidence/README.md), [traceability matrix](evaluation-matrix.md), and [operator runbook](runbook.md).

Use the [exact production route and persona map](evaluator-route-map.md) to avoid event, role, or fixture ambiguity. On macOS, open search with **Command+K**.
