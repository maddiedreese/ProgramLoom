# ProgramLoom parity and evidence map

The product promise is operational: ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.

Routes use `{eventId}` for the selected authorized event. Every listed production surface is reachable from visible product navigation; undocumented URLs are not required.

| Required capability                       | Primary production surface                   | Core evidence and tests                                                                                                                                                                |
| ----------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organizer Control Room                    | `/app/events/{eventId}/control-room`         | Live bounded projections in `worker/routes/control-room.ts`; category, authorization, role-isolation, filtering, resolution, empty/loading/error, responsive and Playwright coverage   |
| Configurable submission workspace         | `/app/events/{eventId}/submissions`          | Custom columns/filters, personal/shared saved views, URL state, bounded pagination, full-filter bulk confirmation, safe CSV/XLSX, audit tests and production Playwright                |
| Unified Communications Center             | `/app/events/{eventId}/communications`       | Template preview/test/send/schedule, Queue delivery, monotonic provider lifecycle, retry/idempotency, role/event isolation and controlled-inbox evidence                               |
| Complete calendar lifecycle               | `/app/events/{eventId}/calendar`             | Stable UID, incrementing sequence, `REQUEST`/`CANCEL`, explicit post-cancellation reschedule, delivery history, authorization tests, Gmail and Apple Calendar evidence; Outlook waived |
| Event duplication and templates           | Dashboard event creation and template studio | Starter and organization templates, selective preview/exclusions, deadline translation, provenance, atomic cleanup and cross-organization tests                                        |
| Organizer-wide search and command palette | Visible Search control or macOS `Command+K`  | Bounded server-side ranking, role/blind-review filtering, safe quick actions, keyboard/mobile/latency tests and privacy-bounded PostHog evidence                                       |
| In-app notification center                | Global notification bell and center          | Durable read state/preferences, recipient scoping, coalescing, cleanup, action links, domain integration, audit/logging, keyboard/mobile tests                                         |

## Extended product capabilities

| Capability | Primary production surface | Core evidence and tests |
| --- | --- | --- |
| Category-based reviewer routing | `/app/events/{eventId}/reviews` → **Automatic reviewer routing** | Plain-language AND/OR rules over form, track, format, tags, and custom fields; deterministic preview/diagnostics; capacity/conflict/recusal-safe idempotent execution; Control Room warning, audit, Airtable, duplication, unit/API/authorization/browser coverage |
| Multi-view agenda builder | `/app/events/{eventId}/agenda` | List, Day, Week, Track, and Room projections; pointer/touch drag, keyboard-equivalent scheduling, URL state, conflict-safe transactional preview, calendar/publication consequences, responsive and large-program coverage |
| Public developer platform | `/app/settings` and public `/developers` | One-time hash-only tokens, scopes/event restrictions/PII masking, `/api/v1`, OpenAPI, REST/query/MCP, OAuth 2.1 PKCE, signed Queue-backed webhooks, rate limits, idempotency, concurrency, usage/audit records, desktop/mobile production smoke tests |
| Safe resource embeds | Speaker resources and organization embed-domain settings | Exact HTTPS allowlist, client/server sanitization, publish preview and removal explanations, restrictive iframe policy, malicious-markup and mobile tests |

## Evaluator-facing closure

| Requirement                  | Product or evidence location                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Judge-first entry points     | Shared event lifecycle navigation, explicit mutation labels, role-specific dashboard destinations, direct empty-state/next-action links                     |
| Five public attendee widgets | Anonymous sessions, speakers, agenda, itinerary, and gallery routes generated from `/app/events/{eventId}/widgets`; JSON, XML and ICS feeds                 |
| One coherent narrative       | Marketing hero, dashboard, Control Room, README, this map, submission copy, and walkthrough                                                                 |
| Exact claim integrity        | `docs/evidence/production-manifest.json` plus `npm run verify:evidence -- --final`                                                                          |
| Reliability proof            | Communications, Queue, webhook, Airtable, calendar and asset-rollover tests indexed in `docs/evidence/README.md`                                            |
| Buyer-grade data             | The isolated production-readiness event and disposable failure/cancellation records documented in the private final evidence bundle                         |
| Full evaluator closure       | Ordered final run with optional criteria, persona/event state preservation, classified failures, manual checklist and OpenRouter ledger kept outside source |

## Cross-cutting gates

All material mutations require server-side authorization, tenant/event isolation, durable audits, structured correlation IDs, privacy-conscious analytics, additive indexed D1 migrations, conflict-safe Airtable identity, accessible responsive states, and unit/API/Playwright coverage. The final release is not claimable until `npm run check`, production desktop/mobile Playwright, the final evidence verifier, production smoke probes, and feasible manual inbox/calendar/integration protocols pass.
