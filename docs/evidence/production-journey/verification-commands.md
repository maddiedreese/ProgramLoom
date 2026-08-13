# Sanitized verification command ledger

Verified on 2026-08-12 (America/Los_Angeles). Exit statuses are the process exit codes observed for the locked runtime source. Provider secrets, browser storage, raw logs, and one-time invitation links are excluded.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run check` | 0 | Typecheck, 61 unit/integration files with 237/237 tests, production build, 218-file terminology scan, and draft evidence schema all passed. |
| `npm run verify:summit -- --remote` | 0 | Every retained ProgramLoom Summit 2027 record threshold and reserved-record invariant passed; 0 forbidden public titles. |
| `npm run db:migrate:remote` | 0 | Remote D1 reported no migrations to apply through migration 0027. |
| `curl --fail --silent --show-error https://app.programloom.com/api/health` | 0 | Health reported final source `42e313534f855a6b5e2f88c932393e6cdf5895c7` and Worker `e5a081f1-2864-4445-9524-981f64f98e06`. |
| `npm run check` (walkthrough hero release) | 0 | Typecheck, 61 unit/integration files with 237/237 tests, production builds, terminology, and evidence schema passed after the README and hero additions. |
| `npx playwright test e2e/visual.spec.ts --grep 'marketing visual baseline'` | 0 | 4/4 local desktop, laptop, tablet, and mobile marketing checks passed after the approved walkthrough-video baselines were made metadata-stable. |
| `PROGRAMLOOM_E2E_URL=https://app.programloom.com PROGRAMLOOM_E2E_EXTERNAL_SERVER=1 npx playwright test e2e/visual.spec.ts --grep 'marketing visual baseline'` | 0 | 4/4 production desktop, laptop, tablet, and mobile checks passed against final source `42e313534f855a6b5e2f88c932393e6cdf5895c7`. |
| `curl --head https://programloom.com/programloom-walkthrough.mp4` | 0 | The same-origin walkthrough asset returned HTTP 200 with `Content-Type: video/mp4`; browser coverage loaded its 266.48-second metadata before visual comparison. |
| `PROGRAMLOOM_E2E_URL=https://app.programloom.com PROGRAMLOOM_E2E_EXTERNAL_SERVER=1 PROGRAMLOOM_E2E_WIDGET_KEYS=<five published keys> npx playwright test e2e/public.spec.ts` | 0 | 77 passed; 3 viewport-inapplicable mobile-navigation cases skipped; all five production widgets covered at four viewports. |
| `PROGRAMLOOM_HELP_E2E_URL=https://programloom.com npx playwright test --config=playwright.help.config.ts` | 0 | 132 passed; crawler found no broken links, unexpected redirects, 404s, or incomplete canonical/title/description metadata. |
| `PROGRAMLOOM_E2E_URL=https://app.programloom.com PROGRAMLOOM_E2E_EVENT_ID=<isolated archived event> PROGRAMLOOM_E2E_STORAGE_STATE=<private organizer state> PROGRAMLOOM_E2E_WIDGET_KEYS=<five published keys> npx playwright test e2e/visual.spec.ts` | 0 | 92/92 organizer, public, and widget comparisons passed at the four required viewport sizes; all baselines were manually reviewed. |
| `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilities. |
| `gitleaks detect --source . --no-banner --redact --exit-code 1` | 0 | 150 commits and approximately 3.74 MB scanned; no leaks found. |
| `git clone --no-hardlinks <workspace> /private/tmp/programloom-final-mbUuz6/repo` | 0 | New checkout resolved to source `12097c7e34c56d919c12ef15c98487d134645513`. |
| `npm install` (new checkout) | 0 | 334 packages installed; audit reported 0 vulnerabilities. |
| `cp .env.example .env.local` (new checkout) | 0 | Documented non-secret environment template copied without adding provider values. |
| `npm run db:migrate:local` (new checkout) | 0 | All 27 migrations applied to a fresh local D1 database. The first sandboxed attempt could not bind localhost (`EPERM`); the authorized localhost rerun passed and is the recorded gate. |
| `npm run typecheck` (new checkout) | 0 | TypeScript project references passed. |
| `npm run test` (new checkout) | 0 | 61 files and 237/237 tests passed. |
| `npm run build` (new checkout) | 0 | Worker, client, and help-center production builds passed. |
| `npm run test:e2e:public` (new checkout) | 0 | 65 passed; 3 viewport-inapplicable cases and 12 production-widget cases skipped locally. Those 12 required widget cases passed separately against production at all four viewports. |
| `npm run test:e2e:help` (new checkout) | 0 | Build plus 132/132 help browser and crawler tests passed. |
| `npm run check` (new checkout) | 0 | Typecheck, 237 tests, production builds, terminology, and evidence schema all passed again. |
| Continuous production lifecycle walkthrough | 0 | One uninterrupted 1440×900 recording completed all prescribed steps 1–30 using a newly created isolated event, normally authorized organizer/reviewer/speaker personas, five live widgets, and a disposable cancellation record. The temporary event was archived after capture. |
| `gh release create programloom-final-walkthrough-2026-08-12 …` | 0 | The sanitized 4:26 WebM (23,039,600 bytes) was published against deployed source `12097c7e34c56d919c12ef15c98487d134645513`; the public release page returned HTTP 200 without redirect. |
| `npm run verify:summit -- --remote` (post-walkthrough) | 0 | The retained Summit remained unchanged after temporary-event archival: all 33 record/state checks passed and forbidden public titles remained 0. |
| `npm run verify:consistency` | 0 | Final production identity, evidence files, canonical URLs, public links, walkthrough link, test totals, and paid-evaluator not-run status all reconciled. |

The paid evaluator remains unrun. Gmail and Apple Calendar are the tested manual calendar environments.
