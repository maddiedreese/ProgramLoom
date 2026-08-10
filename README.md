# ProgramLoom

ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.

- Marketing: [programloom.com](https://programloom.com)
- Application: [app.programloom.com](https://app.programloom.com)
- Public CFP directory: [app.programloom.com/cfp](https://app.programloom.com/cfp)
- Source: [github.com/maddiedreese/SaaS](https://github.com/maddiedreese/SaaS)

The Control Room is the operational center. Its live, prioritized records connect directly to submissions, review assignments, decisions, delivery failures, speaker access, onboarding, content approval, agenda placement, scheduling conflicts, Queue work, and Airtable recovery.

## Complete lifecycle

1. Create an event from a maintained starter or organization template.
2. Customize and publish a conditional CFP; contributors can save, submit, and update real persisted proposals.
3. Find proposals in configurable, saved submission views; assign reviewers and complete multi-round scorecards.
4. Stage a decision without sending it, preview its real recipients, then deliver it through the Communications Center.
5. Continue automatically with speaker access, onboarding tasks, files, content review, notifications, audit history, and communication history.
6. Approve and schedule sessions, resolve room/speaker conflicts, and maintain stable-UID calendar requests, updates, cancellations, and explicit reschedules.
7. Publish the agenda to five anonymous, responsive attendee widgets and use organizer-wide search to find every linked record.
8. Monitor the remaining work in the Control Room until the program is clear.

## Architecture

The React application and Hono API run together on a Cloudflare Worker. D1 stores tenant identity, authorization, workflow, audit, communication, calendar, notification, and integration state. R2 stores immutable private file versions and generated exports. Queue provides durable, idempotent delivery and Airtable synchronization. Resend supplies transactional delivery, Airtable can be the authoritative business-record store, and PostHog receives only explicit privacy-bounded product events. Operational errors remain in structured Cloudflare logs and Workers Observability; Sentry is intentionally not used.

See [architecture](docs/architecture.md), [data model](docs/data-model.md), [Airtable design](docs/airtable.md), and the [operator runbook](docs/runbook.md).

## Local setup

Node.js 22 or newer is required.

```bash
npm install
cp .env.example .env.local
npm run db:migrate:local
npm run dev
```

Never commit `.env.local`, `.dev.vars`, authentication state, private links, provider payloads, or evaluator inbox evidence.

## Verification

```bash
npm run check
npm run test:e2e:public
npm run verify:evidence
```

Authenticated production Playwright requires ignored values for `PROGRAMLOOM_E2E_URL`, `PROGRAMLOOM_E2E_STORAGE_STATE`, and `PROGRAMLOOM_E2E_EVENT_ID`; then run `npm run test:e2e`. CRM and content protocols are available as `npm run smoke:crm` and `npm run smoke:content`.

The [parity and evidence map](docs/parity-map.md) links required capabilities to production routes and automated tests. The [production evidence index](docs/evidence/README.md) defines what may be claimed, where nonsensitive proof lives, and how the restricted final release manifest is verified without committing private evaluator state.

## Deployment

```bash
npm run check
npm run db:migrate:remote
npm run deploy
```

Deploy the committed release and supply its full Git commit as the Worker `RELEASE_COMMIT` variable. Record the returned Worker version, verify `/api/health`, run the production Playwright gate, and require Airtable to settle at zero pending work, zero failures, and zero open conflicts. Full recovery and secret-handling procedures are in the [runbook](docs/runbook.md).

## Evaluator walkthrough

Follow the uninterrupted lifecycle in [submission.md](docs/submission.md): template → CFP → proposal → saved view → review → staged decision → delivery → speaker onboarding → content → Control Room → schedule/calendar → conflict resolution → publish all five widgets → Command+K search → Airtable health → disposable cancellation → clear Control Room.

## Honest limitations and waivers

- Outlook calendar behavior is explicitly waived and untested because no account is available. Gmail and Apple Calendar are the only calendar clients eligible for final claims.
- GitHub hosts the source because the Forge alpha was full.
- Accelevents is excluded because the required access is paid.
- No Sentry integration is present; Cloudflare structured observability is the operational source.
- AI/evaluator usage is constrained by the account owner's approved OpenRouter ceiling. No paid plan or resource may be enabled without approval.

## License

Copyright 2026 ProgramLoom contributors. Licensed under the [GNU Affero General Public License v3.0 only](LICENSE).
