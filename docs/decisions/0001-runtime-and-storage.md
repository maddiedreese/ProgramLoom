# ADR 0001: Cloudflare runtime with selectable Airtable authority

- Status: accepted
- Date: 2026-08-09

## Decision

ProgramLoom runs on Cloudflare Workers with D1, R2, Queues, Workers AI, and Turnstile. Each organization selects native D1 storage or an Airtable-authoritative mode. In Airtable mode, D1 remains responsible for identity, authorization, audit history, durable outbox state, and query indexes; organizer-editable event records are reconciled against a dedicated Airtable base.

## Rationale

The runtime stays inside Cloudflare's free tier for the intended competition and early-product load. The explicit storage mode makes Airtable a real source of truth rather than a cosmetic export, without forcing every public registrant to provide Airtable credentials.

## Consequences

- Every business write needs a stable external ID and idempotency key.
- UI must expose pending, failed, and conflicting sync states.
- Authorization never depends on editable Airtable cells.
- Sync credentials are encrypted and scoped to one organization.
- No paid Cloudflare or Airtable feature may be enabled without approval.
