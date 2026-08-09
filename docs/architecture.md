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

## Trust boundaries

- Organizer registration is public and protected by verified email and Turnstile.
- Reviewers and speakers enter only through expiring, single-use invitations.
- Session cookies are secure, HTTP-only, same-site, rotated after authentication, and backed by revocable server sessions.
- Uploads use allow-listed types, size limits, randomized keys, and private R2 access through scoped signed routes.
- Resend, Airtable, PostHog, and Sentry secrets exist only in Worker bindings.
- Sensitive fields are excluded from analytics and error payloads.

## Delivery gates

Each evaluator criterion receives an implementation link, automated test or manual protocol, and production evidence in the traceability matrix. A feature is not complete when only its interface exists.
