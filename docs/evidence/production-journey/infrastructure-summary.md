# Sanitized production infrastructure summary

Verified on 2026-08-12 (America/Los_Angeles). Raw provider logs, object keys, account identifiers, inbox content, and secrets remain outside source control.

- D1: all 27 local migrations applied from a clean checkout; the remote migration command returned “No migrations to apply.” Migration 0027 aligns persisted CFP participant roles with the roles accepted by the public API.
- Queue: zero active pending, processing, or retrying jobs. Terminal evidence histories remain available by design.
- R2: 13 persisted Summit file versions were reconciled. The signed-in file library displayed nine current files, version histories, and a production-backed headshot; its normal authenticated download route returned the stored object.
- Airtable: 0 pending, 0 failed, 0 open conflicts, and 0 open integration incidents.
- Resend: 41 provider-backed messages, 74 delivery events, and provider dashboard delivery/bounce states were present.
- PostHog: the signed-in activity stream received fresh itinerary add/remove events from the final production browser run. An expanded event contained no email property, message body/subject/merge-value property, or sensitive query parameter.
- Cloudflare health returned the exact release commit and Worker version recorded by the final manifest.
