# ProgramLoom

ProgramLoom is an open-source event program workspace connecting calls for proposals, review, speakers, content, scheduling, and public publishing.

## Status

Active development for the Kill My SaaS competition. The repository is not yet production-ready.

## Local development

Requires Node.js 22+ and a Cloudflare account for deployed infrastructure.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Never commit `.env.local` or `.dev.vars`. See `docs/architecture.md` for the system design and `SECURITY.md` for vulnerability reporting.

Production secrets are uploaded individually with `zsh scripts/push-cloudflare-secrets.zsh`; the script validates presence and never prints values.

## Quality checks

```bash
npm run check
```

## License

Copyright 2026 ProgramLoom contributors. Licensed under the GNU Affero General Public License v3.0 only.
