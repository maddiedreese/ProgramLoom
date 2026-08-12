# Production evidence index

This index separates verifiable product evidence from restricted production state. No committed artifact may contain session cookies, tokens, private inbox bodies, personal data, provider secrets, or authenticated URLs.

The committed `production-manifest.json` is a sanitized draft that becomes the final release summary after deployment. `npm run verify:consistency` requires its source commit to match both local `HEAD` and production health, verifies the Worker version, checks public links and evidence files, rejects stale test and Control Room counts, and confirms the paid evaluator remains unrun.

Control Room evidence must reconcile the displayed total to the persisted category counts. A clear event records zero. A deliberately seeded evidence event may retain documented blockers so every category remains independently testable; in that case the restricted manifest records the exact nonzero total and a plain-language explanation instead of falsely describing the room as clear.

| Area           | Nonsensitive committed evidence                                               | Restricted final evidence kept outside source                                       |
| -------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Communications | Idempotency, monotonic webhook, retry, authorization and structured-log tests | Controlled inbox receipt, provider state transitions, failure/retry screenshots     |
| Calendar       | Sanitized ICS bytes under `production-journey/calendar/`                      | Gmail and Apple Calendar captures; Outlook waiver record                            |
| Airtable       | Sync/reconciliation tests and architecture/runbook                            | Final zero pending/failed/conflict response and base captures                       |
| R2/content     | Fictional headshot, sanitized product captures, file/version tests            | Authenticated byte/download and private upload traces                               |
| PostHog        | Privacy-bounded capture code/tests                                            | Ingestion receipt and project capture without user/query data                       |
| Authorization  | API negative tests and production Playwright                                  | Ignored persona storage states and cross-tenant probe details                       |
| Accessibility  | axe/keyboard/mobile Playwright definitions                                    | Final desktop/tablet/mobile reports and captures                                    |
| Performance    | Bounded-query/load tests                                                      | Route, production environment, region, device, sample size and method report        |
| Recovery       | Queue, webhook, calendar, Airtable and stale-asset tests                      | Correlated production audit/notification/log excerpts with sensitive fields removed |
| Walkthrough    | Sanitized continuous walkthrough link and release identity                    | Raw recording project and controlled browser authentication                         |

## Claim rules

- Prepared, queued, processing, sent, delivered, bounced, failed and cancelled are distinct communication states. A provider acceptance is not called delivery.
- Calendar client claims name only Gmail and Apple Calendar. Outlook is explicitly waived and untested.
- Historical Worker identifiers in the traceability matrix describe past evidence only. The manifest is the sole current-release identifier.
- Counts must be captured from or reconciled against the same production state described by the evidence timestamp.
- Performance results must include route, environment, region, device, sample size and measurement method.
- Harness failures remain labeled as such; genuine product findings stay open until fixed and rerun.
