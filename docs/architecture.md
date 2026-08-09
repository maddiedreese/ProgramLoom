# ProgramLoom architecture

## Principles

1. Every workflow is real and reload-persistent; seeded data accelerates evaluation but never replaces general functionality.
2. Authorization is enforced at the API and query layers with organization and event scope.
3. External side effects use idempotency keys and an outbox so retries cannot duplicate emails, sync writes, or reminders.
4. Public widgets are anonymous read models containing only explicitly approved fields.
5. Accessibility, auditability, and fast feedback are product behavior, not release polish.

## Runtime

- React and Vite provide the organizer, reviewer, speaker, CRM, and public interfaces.
- A Hono Cloudflare Worker exposes versioned APIs, feeds, webhook receivers, and widget data.
- D1 stores identity, tenancy, permissions, audit history, synchronization metadata, and native-mode records.
- R2 stores headshots, requested files, slide versions, and generated export archives.
- Queues and scheduled workers deliver email, reminders, exports, analytics jobs, and Airtable synchronization.
- Workers AI supplies explainable review assistance and schedule suggestions. AI output is never an unreviewable final decision.

## Airtable storage mode

An organization can connect a dedicated Airtable base as its authoritative business-record store. API writes enter a durable D1 outbox, are applied to Airtable with stable external IDs, and are reconciled back into indexed D1 read models. Sync conflicts are visible and resolvable; unrelated bases are never enumerated or modified. Organizations without Airtable use D1-native storage.

## Operational read model

The Organizer Control Room is a live, event-scoped projection rather than a separately maintained issue cache. Bounded indexed queries derive operational categories from submissions, review assignments and conflicts, decisions, communications, speakers, onboarding, files, content, agenda state, Queue jobs, Airtable outbox/conflicts, and integration incidents. D1's compound-query limit is respected by executing small query groups and merging only bounded priority windows in the Worker. Counts are exact; item ordering is deterministic by severity, overdue state, deadline/age, category, and stable record ID.

Issue ownership is the only Control Room-specific durable state. Resolving an item changes its authoritative domain record, so it disappears on the next automatic or explicit refresh. Owner changes and supported resolution actions retain before/after audit history. Review and schedule conflicts also synchronize to Airtable in Airtable-authoritative workspaces; delivery attempts, Queue state, audit history, and Control Room ownership remain operational D1 records.

Reusable event configuration is represented by event-scoped program settings and immutable template snapshots. Materialization regenerates every internal and public identifier and translates deadlines relative to the new event start. A durable creation operation records source, selected domains, warnings, and provenance. Large copies use bounded D1 batches; any failure cascade-removes the new event and its audit rows before the operation is retained as failed. Operational, historical, personal, file, calendar, integration-secret, and external-ID tables are outside the snapshot boundary by construction.

## Trust boundaries

- Organizer registration is public and protected by verified email and Turnstile.
- Reviewers and speakers enter only through expiring, single-use invitations.
- Session cookies are secure, HTTP-only, same-site, rotated after authentication, and backed by revocable server sessions.
- Uploads use allow-listed types, size limits, randomized keys, and private R2 access through scoped signed routes.
- Resend and Airtable credentials exist only in Worker bindings. PostHog's write-only project token is intentionally browser-visible; privileged API tokens are never shipped to clients. Operational errors use structured Worker logs and Cloudflare Observability rather than a third-party error collector.
- Sensitive fields are excluded from analytics and error payloads.

## Delivery gates

Each evaluator criterion receives an implementation link, automated test or manual protocol, and production evidence in the traceability matrix. A feature is not complete when only its interface exists.
