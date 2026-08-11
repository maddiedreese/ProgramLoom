# ProgramLoom

ProgramLoom is a complete program-operations workspace for conferences, meetups, workshops, and community calls for proposals.

ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.

Use it when a program starts with an open call for ideas and ends with a published agenda. Instead of stitching together forms, spreadsheets, email threads, file requests, and calendar tools, an organizing team can see the whole journey—and the work that still needs attention—in one place.

- Marketing: [programloom.com](https://programloom.com)
- Application: [app.programloom.com](https://app.programloom.com)
- Public CFP directory: [app.programloom.com/cfp](https://app.programloom.com/cfp)
- Source: [github.com/maddiedreese/SaaS](https://github.com/maddiedreese/SaaS)

![ProgramLoom Organizer Control Room showing a clear, live operational program](public/programloom-control-room.jpg)

## How the product fits together

The **Control Room** is the organizer's starting point. It answers one practical question: “What is keeping this program from being ready?” Each live issue links directly to the person, proposal, message, file, or schedule item that needs attention.

ProgramLoom then guides the team through six understandable stages:

1. **Collect proposals.** Create an event from a reusable template, customize its call for proposals (CFP), publish the form, and manage incoming ideas.
2. **Evaluate proposals.** Assign reviewers, collect structured scorecards, and see when a proposal has enough evidence for a decision.
3. **Decide and communicate.** Record an intended outcome, preview the exact recipients and message, and send it from a durable, auditable outbox.
4. **Prepare speakers.** Give accepted speakers portal access, collect profiles and files, track onboarding, and review session content.
5. **Schedule.** Place approved sessions into rooms and times, resolve conflicts, and send calendar invitations that update in place.
6. **Publish.** Release the agenda to five live attendee views, including a searchable schedule, speaker directory, and personal itinerary.

The Control Room stays connected to every stage, so resolved blockers disappear and new delivery, onboarding, content, schedule, or integration problems become visible.

### Staging a decision does not send it

This separation is deliberate. **Stage decision** records what the organizer intends to do and sends nothing. The organizer must then open the **Communications Center**, choose the recipients, inspect the rendered message, and select **Send decision**. This makes it safe to prepare a program before communicating it.

New to program operations? Start with the [complete user guide](docs/user-guide.md). It explains the vocabulary, roles, full lifecycle, public attendee experience, integrations, recovery paths, and common questions without assuming prior product knowledge.

## How it works

The user interface and API run together on a Cloudflare Worker. D1 stores account access and durable workflow state; R2 stores private file versions and generated exports; Cloudflare Queues handles retry-safe email and Airtable synchronization. Resend delivers transactional email, Airtable can remain the authoritative business-record store, and PostHog receives only intentionally limited product events. Structured Cloudflare logs and Workers Observability provide operational diagnosis.

Organization owners can also connect trusted systems through hashed API tokens, signed webhooks, OAuth 2.1, a stable REST API, a bounded query surface, and remote MCP. The public [developer guide](https://app.programloom.com/developers) and repository [developer-platform guide](docs/developer-platform.md) explain scopes, event restrictions, PII masking, pagination, safe writes, webhooks, versioning, and examples.

Technical readers can continue with the [architecture](docs/architecture.md), [data model](docs/data-model.md), [Airtable design](docs/airtable.md), and [operator runbook](docs/runbook.md).

## Local setup

Node.js 22 or newer is required.

```bash
npm install
cp .env.example .env.local
npm run db:migrate:local
npm run dev
```

Never commit `.env.local`, `.dev.vars`, authentication state, private links, provider payloads, or controlled inbox evidence.

## Verification

```bash
npm run check
npm run test:e2e:public
npm run verify:evidence
```

Authenticated production Playwright requires ignored values for `PROGRAMLOOM_E2E_URL`, `PROGRAMLOOM_E2E_STORAGE_STATE`, and `PROGRAMLOOM_E2E_EVENT_ID`; then run `npm run test:e2e`. CRM and content protocols are available as `npm run smoke:crm` and `npm run smoke:content`.

The [capability map](docs/parity-map.md) links product behavior to production routes and automated tests. Release evidence is sanitized; private inbox contents, provider identifiers, authentication state, and sensitive logs remain outside the repository.

## Deployment

```bash
npm run check
npm run db:migrate:remote
RELEASE_COMMIT="$(git rev-parse HEAD)" npm run deploy
```

The deploy script rejects a missing, abbreviated, uppercase, or malformed source commit and binds the validated SHA directly to Wrangler. Record the returned Worker version, verify `/api/health`, run the production Playwright gate, and require Airtable to settle at zero pending work, zero failures, and zero open conflicts. Full recovery and secret-handling procedures are in the [runbook](docs/runbook.md).

## Learn the product

The [user guide](docs/user-guide.md) follows one understandable lifecycle: template → CFP → proposal → saved view → automatic routing → review → staged decision → delivery → speaker onboarding → content → Control Room → schedule and calendar → conflict resolution → five public views → search → integration health → cancellation and recovery.

Inside the deployed product, open [the product guide](https://app.programloom.com/guide) from the marketing site or workspace navigation. Organizers should begin in an event’s **Control Room**; reviewers and speakers land in their role-specific workspaces.

## Honest limitations and waivers

- Outlook calendar behavior is explicitly waived and untested because no account is available. Gmail and Apple Calendar are the only calendar clients eligible for final claims.
- No Sentry integration is present; Cloudflare structured observability is the operational source.
- Optional AI-assisted operations use OpenRouter only when configured. No paid plan or resource should be enabled without the account owner's approval.

## License

Copyright 2026 ProgramLoom contributors. Licensed under the [GNU Affero General Public License v3.0 only](LICENSE).
