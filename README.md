# ProgramLoom

ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.

The **Control Room** shows what is keeping the program from being ready and takes the organizer directly to the work that resolves it.

- Marketing: [programloom.com](https://programloom.com)
- Application: [app.programloom.com](https://app.programloom.com)
- Help center: [programloom.com/help](https://programloom.com/help/)
- Public CFP directory: [app.programloom.com/cfp](https://app.programloom.com/cfp)

![ProgramLoom Control Room showing an event team's next actions](public/programloom-control-room.jpg)

## What you can do with ProgramLoom

ProgramLoom keeps one proposal connected through the full event journey:

1. **Collect ideas.** Publish a clear call for proposals with the questions, tracks, and session formats your event needs.
2. **Coordinate reviews.** Route proposals to eligible reviewers, collect consistent scorecards, and monitor unfinished work.
3. **Make careful decisions.** Record an intended acceptance, waitlist, or rejection without emailing anyone yet.
4. **Send the right message.** Preview the real recipients and rendered decision message before it enters the delivery queue.
5. **Prepare speakers.** Invite accepted speakers to a private portal, collect profiles and headshots, and track onboarding tasks.
6. **Collect session content.** Request slides and other files, keep version history and comments, and approve public content.
7. **Build the schedule.** Place sessions into rooms and times, resolve speaker or room conflicts, and keep calendar invitations current.
8. **Publish for attendees.** Share an accessible agenda, session directory, speaker directory, gallery, and personal itinerary.

At every stage, the Control Room turns the event's saved state into an understandable next-action list.

## A safer way to communicate decisions

**Stage decision** and **Send decision** are separate actions.

Staging records what the team intends to do. It sends no message. An organizer then opens **Communications**, checks the recipient list and message preview, and chooses **Send decision** when everything is ready.

## Who ProgramLoom is for

- **Organizers** see the complete event workflow and readiness state.
- **Reviewers** see only the proposals and scorecards assigned to them.
- **Speakers** see their own profile, sessions, tasks, files, resources, and feedback.
- **Attendees** use the public schedule and itinerary without creating an account.

New to the product? Start with [Create your first event](https://programloom.com/help/getting-started), or choose a guide for [organizers](https://programloom.com/help/organizers/control-room), [reviewers](https://programloom.com/help/reviewers), [speakers](https://programloom.com/help/speakers), or [attendees](https://programloom.com/help/attendees).

## Open source and self-hostable

ProgramLoom is licensed under the [GNU Affero General Public License v3.0](LICENSE), and its [source code is available on GitHub](https://github.com/maddiedreese/SaaS). The production application uses Cloudflare Workers, D1, R2, and Queues, with Resend for transactional email and optional Airtable and PostHog connections.

The product is designed so required event workflows use real saved records, real file storage, real background jobs, and server-side permissions. It does not depend on browser-only demo state.

## Run ProgramLoom locally

You need Node.js 22 or newer and a Cloudflare account for the Worker-backed features.

```bash
npm install
cp .env.example .env.local
npm run db:migrate:local
npm run dev
```

The public help center runs separately during documentation editing:

```bash
npm run docs:dev
```

Do not commit environment files, authentication state, private links, provider payloads, or production evidence.

### Environment variables

Start from `.env.example`; it contains names and safe local defaults, never secret values. Configure `APP_BASE_URL`, `APP_DOMAIN`, `EMAIL_FROM`, and `EMAIL_REPLY_TO` for the public application. PostHog and Turnstile public keys are optional client configuration. Keep `SESSION_SECRET`, `ENCRYPTION_KEY`, `DEVELOPER_SECRET_KEY`, Airtable credentials, Resend credentials, and `TURNSTILE_SECRET_KEY` server-only in `.dev.vars` locally or encrypted Worker secrets in production.

## Verify a change

```bash
npm run typecheck
npm run test
npm run build
npm run test:e2e:public
npm run test:e2e:help
```

The complete `npm run check` command also validates the sanitized production-evidence schema. Authenticated browser tests require ignored storage-state and event configuration described in [the contributor runbook](docs/runbook.md).

## Deploy

Apply additive database migrations before deploying the matching source commit:

```bash
npm run check
npm run db:migrate:remote
RELEASE_COMMIT="$(git rev-parse HEAD)" npm run deploy
```

After deployment, verify production health, authenticated desktop and mobile workflows, public views, message and integration queues, and the exact deployed source identity.

## Technical reference

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Airtable synchronization](docs/airtable.md)
- [Developer platform](docs/developer-platform.md)
- [Operations and recovery](docs/runbook.md)
- [Capability map](docs/parity-map.md)

## License

Copyright 2026 ProgramLoom contributors. Licensed under the [GNU Affero General Public License v3.0 only](LICENSE).
