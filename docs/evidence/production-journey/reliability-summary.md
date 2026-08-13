# Sanitized production reliability summary

Verified against ProgramLoom Summit 2027 on 2026-08-12 (America/Los_Angeles). The authoritative source commit and Worker version belong in `production-manifest.json`; provider identifiers, recipient addresses, message bodies, tokens, and raw logs are intentionally excluded.

## Communications and Queue

- Production contained 41 provider-backed messages and 74 persisted delivery events.
- Aggregate reconciliation found zero duplicate communication idempotency keys.
- One controlled retry chain persisted a failed first attempt followed by a delivered later attempt. No message/attempt-number collisions were present.
- Fifty-three event messages shared a structured correlation identifier with a persisted audit event.
- Queue state contained no active pending, processing, or retrying jobs. Retained terminal histories were 41 succeeded, 15 cancelled, and 14 exhausted records so the failure and recovery interfaces remain demonstrable.
- The signed-in Resend delivery surface showed delivered and bounced lifecycle records. Private recipient and provider fields were not copied into this repository.
- Unit coverage verifies duplicate suppression after terminal delivery, one durable message for repeated enqueue requests, monotonic provider-webhook transitions, safe retry state, and independent failure containment.

## Calendar

- Production contained 14 calendar records: 13 active and one cancelled, with sequences spanning 0 through 3.
- Thirty revisions were retained: 27 `METHOD:REQUEST` and three `METHOD:CANCEL`.
- Eleven records had more than one revision while retaining one stable UID.
- The committed sanitized ICS series proves stable UID plus increasing sequence for updates, cancellation with `METHOD:CANCEL`, explicit rescheduling after cancellation, and a later cancellation.

## Airtable and recovery isolation

- Signed-in organizer health and direct aggregate reconciliation both reported zero pending, zero failed, and zero open Airtable conflicts.
- No integration incident remained open.
- Unit coverage verifies deterministic outbox idempotency, conflict compaction, safe repeated failure, and recovery without duplicate external records.
- Production application, public widget, help, and analytics checks remained operational while terminal Queue and communication-failure histories were retained.

## Static assets

- A deliberately stale versioned asset returned HTTP 404, `text/plain`, and `cache-control: no-cache, no-store, must-revalidate`; it did not return application HTML.
- Browser recovery and conditional-304 regression coverage passed, and the complete production browser suite loaded the post-deployment asset generation without a blank page.

