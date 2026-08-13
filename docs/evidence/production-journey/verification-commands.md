# Sanitized verification command ledger

Verified on 2026-08-12 (America/Los_Angeles). Exit statuses are the process exit codes observed for the locked runtime source. Provider secrets, browser storage, raw logs, and one-time invitation links are excluded.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run check` | 0 | Typecheck, 61 unit/integration files with 236/236 tests, production build, 218-file terminology scan, and draft evidence schema all passed. |
| `npm run verify:summit -- --remote` | 0 | Every retained ProgramLoom Summit 2027 record threshold and reserved-record invariant passed; 0 forbidden public titles. |
| `npm run db:migrate:remote` | 0 | Remote D1 reported no migrations to apply through migration 0027. |
| `curl --fail --silent --show-error https://app.programloom.com/api/health` | 0 | Health reported source `95643c1cb2b3da02fd31d1d5eaf64179424e9fdb` and Worker `d69550d9-7b7e-42ec-822c-714c4ae1cac4`. |
| `PROGRAMLOOM_E2E_URL=https://app.programloom.com PROGRAMLOOM_E2E_EXTERNAL_SERVER=1 PROGRAMLOOM_E2E_WIDGET_KEYS=<five published keys> npx playwright test e2e/public.spec.ts` | 0 | 77 passed; 3 viewport-inapplicable mobile-navigation cases skipped; all five production widgets covered at four viewports. |
| `PROGRAMLOOM_HELP_E2E_URL=https://programloom.com npx playwright test --config=playwright.help.config.ts` | 0 | 132 passed; crawler found no broken links, unexpected redirects, 404s, or incomplete canonical/title/description metadata. |
| `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilities. |
| `gitleaks detect --source . --no-banner --redact --exit-code 1` | 0 | 150 commits and approximately 3.74 MB scanned; no leaks found. |
| `git clone --no-local <workspace> /private/tmp/programloom-final-gqk6O1/repo` | 0 | New checkout resolved to the locked source commit. |
| `npm install` (new checkout) | 0 | 334 packages installed; audit reported 0 vulnerabilities. |
| `cp .env.example .env.local` (new checkout) | 0 | Documented non-secret environment template copied without adding provider values. |
| `npm run db:migrate:local` (new checkout) | 0 | All 27 migrations applied to a fresh local D1 database. The first sandboxed attempt could not bind localhost (`EPERM`); the authorized localhost rerun passed and is the recorded gate. |
| `npm run typecheck` (new checkout) | 0 | TypeScript project references passed. |
| `npm run test` (new checkout) | 0 | 61 files and 236/236 tests passed. |
| `npm run build` (new checkout) | 0 | Worker, client, and help-center production builds passed. |
| `npm run test:e2e:public` (new checkout) | 0 | 65 passed; 3 viewport-inapplicable cases and 12 production-widget cases skipped locally. Those 12 required widget cases passed separately against production at all four viewports. |
| `npm run test:e2e:help` (new checkout) | 0 | Build plus 132/132 help browser and crawler tests passed. |
| `npm run check` (new checkout) | 0 | Typecheck, 236 tests, production builds, terminology, and evidence schema all passed again. |

The final ledger will add authenticated lifecycle smoke, walkthrough publication, and the final consistency verifier. The paid evaluator remains unrun.
