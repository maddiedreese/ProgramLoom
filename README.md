# ProgramLoom

ProgramLoom is an open-source event program workspace connecting calls for proposals, review, speakers, content, scheduling, and public publishing.

## Status

Production alpha for the Kill My SaaS competition. The live service is available at [programloom.com](https://programloom.com) with the organizer application at [app.programloom.com](https://app.programloom.com).

ProgramLoom currently includes configurable CFPs, multi-round human and AI-assisted review, scoped speaker/reviewer portals, speaker onboarding and content collection, immutable R2 file versions, comments and approvals, latest-only ZIP distribution, conflict-aware agenda scheduling, five public widget types, a cross-event speaker CRM, Airtable-authoritative workspaces, Resend transactional email, PostHog product analytics, and Cloudflare structured observability.

## Local development

Requires Node.js 22+ and a Cloudflare account for deployed infrastructure.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Never commit `.env.local` or `.dev.vars`. See `docs/architecture.md` for the system design, `docs/runbook.md` for production operation and evaluator procedures, and `SECURITY.md` for vulnerability reporting.

Production secrets are uploaded individually with `zsh scripts/push-cloudflare-secrets.zsh`; the script validates presence and never prints values.

## Quality checks

```bash
npm run check
npm run smoke:crm
npm run smoke:content
```

## License

Copyright 2026 ProgramLoom contributors. Licensed under the GNU Affero General Public License v3.0 only.
