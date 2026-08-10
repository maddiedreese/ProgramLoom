# ProgramLoom operator runbook

This runbook covers the production service at `programloom.com` and `app.programloom.com`. Actions that can create a charge require account-owner approval before execution.

## Production inventory

- Cloudflare Worker `programloom` serves both domains and the API.
- D1 database `programloom-production` stores identity, authorization, audits, workflow state, and Airtable sync state.
- R2 bucket `programloom-files` stores private uploads and generated archives.
- Queue `programloom-jobs` processes the durable Airtable outbox and reconciliation work.
- Workers AI supplies advisory review and content assistance. Human confirmation remains required.
- Turnstile protects anonymous authentication, CFP, and speaker-interest writes.
- Resend sends from `ProgramLoom <notifications@mail.programloom.com>`.
- Airtable base `apppAC5fPzvR1bwdm` contains the seventeen `PL` business-data tables for Airtable-authoritative workspaces.
- PostHog receives explicit product events only. Operational errors stay in structured Cloudflare logs and Workers Observability.

## Local verification

1. Use Node.js 22 or newer and copy `.env.example` to the ignored `.env.local`.
2. Install locked dependencies with `npm install`.
3. Apply local migrations with `npm run db:migrate:local`.
4. Start the local Worker and client with `npm run dev`.
5. Run `npm run check`, `npm run smoke:crm`, and `npm run smoke:content` before deployment.
6. Run `npm run test:e2e:public` for anonymous desktop/mobile accessibility coverage. For the authenticated gate, set `PROGRAMLOOM_E2E_URL`, `PROGRAMLOOM_E2E_STORAGE_STATE`, and `PROGRAMLOOM_E2E_EVENT_ID` to an ignored disposable organizer state and event, then run `npm run test:e2e`.

Never print or commit environment values. `.env.local`, `.dev.vars`, evaluator authentication states, and generated magic links are secrets.

## Deployment

1. Confirm `git status` contains only the intended release.
2. Run `npm run check`.
3. Apply additive production migrations with `npm run db:migrate:remote` and retain the command result.
4. Upload changed secrets individually with `zsh scripts/push-cloudflare-secrets.zsh`. The script skips absent keys and never prints values. Rotate `RESEND_WEBHOOK_SECRET` directly from the Resend webhook into the Cloudflare encrypted Worker secret; the bulk helper intentionally excludes it to prevent stale replacement.
5. Run `npm run deploy` and record the returned Worker version ID.
6. Verify `https://app.programloom.com/api/health`, both HTML domains, authenticated boundaries, and any changed workflow.
7. Confirm the Airtable integration screen shows no pending jobs, failures, or open conflicts after any Airtable-authoritative mutation.

## Observability and incident response

Every request receives an `x-request-id`; unexpected request, queue, cron, and integration errors are structured JSON with an operation and request/job identifier. Use Cloudflare Workers Observability to filter by service, operation, level, request ID, message ID, or time window. Product analytics in PostHog are not an error-monitoring source.

For an incident:

1. Confirm scope through `/api/health`, Cloudflare status, recent deployments, Queue state, D1 metrics, and structured logs.
2. Stop repeated damage before recovery: pause the affected public workflow in ProgramLoom, revoke an invitation/share link, or disable the relevant Worker trigger in Cloudflare. Do not delete records as a first response.
3. Preserve request IDs, timestamps, affected organization/event IDs, and provider response IDs without copying tokens or private content into tickets.
4. If a release caused the incident, use Cloudflare deployment history to restore the last known-good Worker version. Additive migrations are forward-fixed; do not run destructive rollback SQL.
5. Replay safe work through the integration recovery action. Failed Airtable jobs use bounded retries and visible conflicts; do not create duplicate provider records manually.
6. Verify the repaired path with the least-privileged relevant persona, then document cause, impact, and prevention.

## Backups and recovery

D1 and R2 are the durable application stores; Airtable is authoritative only for an organization that explicitly selected that mode. Before a risky migration or bulk operation, export D1 with Wrangler and preserve the migration/version metadata in a restricted location. R2 objects are immutable by version in ProgramLoom; avoid deleting source objects while an event is active. Test recovery against a non-production database/bucket before relying on it.

## Airtable operations

Run `npm run airtable:provision` only against the dedicated ProgramLoom base. `npm run airtable:webhook` rotates/configures the filtered HMAC webhook and deploys its generated secrets. Never enumerate or modify unrelated bases. Normal writes enter the D1 outbox, move through Queue, and receive stable external IDs; webhook pulls are coalesced and tenancy-row deletion becomes a visible conflict instead of deleting the workspace.

Speaker-task external IDs are composite (`task ID:speaker ID`). A retrying conflict must remain open until the Queue worker records a successful provider write; the API retry action only requeues it. Confirm recovery by checking the external-record mapping, the resolved conflict timestamp, the `integration.recovered` notification, and zero pending/failed/conflict counts. Never mark a conflict resolved before the provider attempt succeeds.

## Calendar lifecycle operations

Use the session cancellation action when an invitation is no longer valid. It records agenda cancellation, removes the item from public widgets, stores a higher-sequence `CANCEL` revision, and queues the participant-addressed message. Ordinary placement changes are rejected while cancelled. To restore a cancelled session, use the explicit reschedule action; confirm the same UID, a higher sequence, a new `REQUEST`, and renewed public visibility only after publication. Calendar resend, update, cancellation, and reschedule actions are organizer/admin-only and must be verified in the Communications outbox before retrying.

For evidence, retain the downloaded bytes for the initial `REQUEST`, a material update, and final `CANCEL`. Verify identical UID, strictly increasing sequence, correct method, organizer/attendee/timezone fields, and provider delivery attempts. Test imports in Gmail, Outlook, and Apple Calendar with a disposable session; remove the disposable calendar item after evidence is recorded.

## Control Room operations

Open an event's Control Room first during program-readiness or integration triage. Blocking items sort before warnings and informational drafts; overdue items sort first within a severity. Counts are derived live and should reconcile with the linked filtered records. Assign an owner for coordination, then resolve the underlying workflow rather than trying to hide an item. Only new-submission triage, review conflicts, recorded schedule conflicts, and integration acknowledgement have direct safe resolution controls.

If a category fails while others remain available, retain the request ID and inspect Cloudflare logs before retrying. Queue, Airtable, delivery, and integration records should be repaired or safely retried from their owning workspace. Never delete operational history to clear a count. After recovery, explicitly refresh and verify the count and linked records agree.

## Evaluator procedure

The authoritative upstream kit is `swyx/killmysaas-evals` at the commit recorded in `docs/evaluation-matrix.md`.

1. Configure the production URL and distinct organizer, speaker, and reviewer inbox aliases in the evaluator’s ignored `evalconfig.json`.
2. Save each authenticated persona in the evaluator’s ignored `.auth` directory. Do not commit or print session cookies.
3. Run its free browser smoke and `--dry-run --include-optional` first.
4. With explicit approval for the OpenRouter spend ceiling, run all areas in order with optional scope included through the approved OpenRouter provider adaptation. Preserve the run directory and use resume rather than restarting an interrupted run.
5. Complete the generated manual checklist with real mailbox, ICS/calendar, ZIP, and second-account evidence; then finalize the report.
6. Record only nonsensitive results and artifact paths in the evaluation matrix. Revoke evaluator sessions after submission.

## Event template recovery

Event creation from reusable configuration is synchronous and records an `event_creation_operations` row. A successful operation links the new event and source provenance. A failed operation must have a null target event, a failure code, and no event with its `creation_operation_id`; this proves cleanup completed. Investigate the correlated `event_templates` structured log, fix the configuration or service problem, and create again from a fresh preview. Never manually reuse copied external IDs.

## Organizer search operations

The command palette is available from every authenticated route through the visible Search control or Command/Ctrl+K. Search logs contain the request ID, caller ID, authorized event count, result count, query length, and duration; they intentionally omit the query and result contents. PostHog records palette opening, selected entity type/rank bucket, and quick-action identifier only.

If search is slow, filter Cloudflare Observability on `service=organizer_search` and compare duration with the caller's authorized-event count. Requests cap input at 100 characters, event scope at 100, organization scope at 50, entity candidates at bounded windows, and the final response at 50. Do not add query text to logs while diagnosing. A recent destination that is no longer authorized disappears automatically because every read resolves the source record again.

## Notification operations

The bell count is a global unread count; panel filters report their own matching count without changing the bell. A twenty-second client refresh picks up domain changes, read state, and coalesced occurrences. If the API partially fails, the current application page remains usable and the panel exposes a retryable error rather than clearing stored work.

Scheduled work creates overdue-task notifications, dispatches explicitly enabled notification emails, and performs daily 180-day archive/30-day deletion cleanup. Filter Cloudflare logs by `service=notifications` and `operation=email_dispatch` or `retention_cleanup`. Logs must not include recipient addresses, titles, bodies, preference values tied to a person, or action URLs.

For an email-channel incident, inspect `notification_channel_deliveries`, the linked Communications outbox record, operational job, provider attempt, and correlation ID. Do not insert a second message manually: the deterministic notification idempotency key makes the normal dispatcher/retry path safe. In-app delivery remains independent of email provider state.

Resend lifecycle callbacks must be signed, deduplicated by provider event ID, and monotonic: late `email.sent` retries cannot downgrade `delivered`, `bounced`, `failed`, or `cancelled` records. After rotating a webhook secret, send a controlled test message and require the outbox detail to contain both provider lifecycle events and a final `delivered` state. A provider dashboard success alone is insufficient evidence.
