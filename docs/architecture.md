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

## Review routing

Automatic reviewer routing is an event-scoped rule engine over persisted CFP data. Ordered rules contain OR-connected groups of AND-connected conditions over form, track, format, tags, and custom-field values. The winning rule selects a review round and its configured pool, assignment count, reviewer exclusions, tags, and optional owner. Preview and execution use the same matcher. Execution is idempotent and applies capacity, recusal, conflict-of-interest, self-review, tenant, event, and blind-review boundaries before inserting assignments. Unmatched proposals and every skip reason remain visible in routing history, audit history, and the Control Room.

## Agenda interaction

List, Day, Week, Track, and Room are different bounded projections of the same `agenda_items` records. Safe URL state stores only view, date, grouping, and filters. Pointer, touch, and keyboard moves all call the same transactional placement endpoint, which validates room and speaker conflicts before any mutation. Material moves disclose publication and participant-calendar effects; a committed move advances the durable calendar lifecycle rather than generating an unrelated invitation.

## Developer platform

The public `/api/v1` contract is deliberately independent of frontend response shapes. Organization API tokens are random, stored only as hashes, revealed once, scoped by capability and optional event allowlist, and PII-masked by default. Every collection is bounded, every mutation rechecks tenant/event ownership at its source query, consequential writes require idempotency keys, and versioned updates require optimistic-concurrency tags. Rate-limit, request, usage, and audit records retain token identity and route templates without retaining token values, query contents, or returned personal data.

OAuth 2.1 clients use authorization code plus PKCE S256 and rotating refresh tokens. Remote MCP and the read-only structured query surface reuse the identical authorization context. Webhook subscriptions keep encrypted per-subscription signing secrets; deliveries are immutable audit-derived events processed by Queue with bounded exponential backoff, stable delivery IDs, monotonic source sequences, manual retry, and failure/recovery notifications. Public OpenAPI, examples, and a downloadable API collection describe the supported version and deprecation policy.

## Resource embed safety

Speaker resource pages are sanitized on the server before persistence and again on render. Approved iframe origins are the built-in reference providers plus an organization-managed exact-domain HTTPS allowlist. Surviving frames receive a restrictive sandbox, lazy loading, no-referrer policy, and responsive sizing. Scripts, handlers, forms, unsafe protocols, popups, and top-level navigation are removed. The organizer must preview the current draft and receives a plain-language explanation of removals before publishing.

## Airtable storage mode

An organization can connect a dedicated Airtable base as its authoritative business-record store. API writes enter a durable D1 outbox, are applied to Airtable with stable external IDs, and are reconciled back into indexed D1 read models. Sync conflicts are visible and resolvable; unrelated bases are never enumerated or modified. Organizations without Airtable use D1-native storage.

## Operational read model

The Organizer Control Room is a live, event-scoped projection rather than a separately maintained issue cache. Bounded indexed queries derive operational categories from submissions, review assignments and conflicts, decisions, communications, speakers, onboarding, files, content, agenda state, Queue jobs, Airtable outbox/conflicts, and integration incidents. D1's compound-query limit is respected by executing small query groups and merging only bounded priority windows in the Worker. Counts are exact; item ordering is deterministic by severity, overdue state, deadline/age, category, and stable record ID.

Issue ownership is the only Control Room-specific durable state. Resolving an item changes its authoritative domain record, so it disappears on the next automatic or explicit refresh. Owner changes and supported resolution actions retain before/after audit history. Review and schedule conflicts also synchronize to Airtable in Airtable-authoritative workspaces; delivery attempts, Queue state, audit history, and Control Room ownership remain operational D1 records.

Reusable event configuration is represented by event-scoped program settings and immutable template snapshots. Materialization regenerates every internal and public identifier and translates deadlines relative to the new event start. A durable creation operation records source, selected domains, warnings, and provenance. Large copies use bounded D1 batches; any failure cascade-removes the new event and its audit rows before the operation is retained as failed. Operational, historical, personal, file, calendar, integration-secret, and external-ID tables are outside the snapshot boundary by construction.

Organizer search is a bounded server-side federation over indexed domain tables, not a replicated global index. The Worker first derives the caller's effective organization and event roles, then runs entity-specific queries that enforce reviewer assignment, speaker identity, publication, blind-review, and private-field boundaries before ranking. Exact, prefix, word-prefix, contained, contextual, and limited fuzzy matches are ordered deterministically. Recent destinations are durable D1 preferences capped at twenty per user and are reauthorized against their source record every time they are read or written.

Notifications are durable per-recipient operational records. Domain mutations fan out only to role-appropriate users and stable coalescing keys prevent repetitive updates from creating noise. Channel preferences are evaluated independently: in-app visibility is enforced by scoped read queries, while email defaults off and is prepared through the existing idempotent communications/Queue pipeline only when explicitly enabled. Personal notification state, preferences, and channel attempts remain in D1 rather than Airtable because they are application operations—not authoritative event business records.

Calendar invitations are durable records linked one-to-one with agenda items. The agenda-item ID supplies the stable iCalendar UID; every material schedule change advances a monotonic sequence and stores the exact generated revision before a Queue-backed communication is prepared. Cancellation marks the agenda item with actor and timestamp, removes it from public read models, sends a `CANCEL` revision, and requires an explicit reschedule transition before another `REQUEST` can be issued. Public itinerary feeds are separately generated, anonymous calendars and never reuse participant-addressed invitation delivery.

## Trust boundaries

- Organizer registration is public and protected by verified email and Turnstile.
- Reviewers and speakers enter only through expiring, single-use invitations.
- Session cookies are secure, HTTP-only, same-site, rotated after authentication, and backed by revocable server sessions.
- Uploads use allow-listed types, size limits, randomized keys, and private R2 access through scoped signed routes.
- Resend and Airtable credentials exist only in Worker bindings. PostHog's write-only project token is intentionally browser-visible; privileged API tokens are never shipped to clients. Operational errors use structured Worker logs and Cloudflare Observability rather than a third-party error collector.
- Sensitive fields are excluded from analytics and error payloads.
- Explicit developer-settings analytics contain only action type, boolean restriction choices, and bounded counts. Token names, URLs, secrets, event IDs, query text, and personal data are excluded.

## Delivery gates

Each evaluator criterion receives an implementation link, automated test or manual protocol, and production evidence in the traceability matrix. A feature is not complete when only its interface exists.
