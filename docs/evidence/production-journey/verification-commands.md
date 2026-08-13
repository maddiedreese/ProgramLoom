# Sanitized verification command ledger

Verified on 2026-08-12 (America/Los_Angeles). Exit statuses are the process exit codes observed for the locked runtime source. Provider secrets, browser storage, raw logs, and one-time invitation links are excluded.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run check` | 0 | Typecheck, 61 unit/integration files with 237/237 tests, production build, 218-file terminology scan, and draft evidence schema all passed. |
| `npm run verify:summit -- --remote` | 0 | Every retained ProgramLoom Summit 2027 record threshold and reserved-record invariant passed; 0 forbidden public titles. |
| `npm run db:migrate:remote` | 0 | Remote D1 reported no migrations to apply through migration 0027. |
| `curl --fail --silent --show-error https://app.programloom.com/api/health` | 0 | Health reported final runtime source `369ee61a61385214266852e4341f4c52220feb3c` and Worker `1a06f233-4195-4ee6-a758-1210b29e8243`. |
| `npm run check` (walkthrough hero release) | 0 | Typecheck, 61 unit/integration files with 237/237 tests, production builds, terminology, and evidence schema passed after the README and hero additions. |
| `npx playwright test e2e/visual.spec.ts --grep 'marketing visual baseline'` | 0 | 4/4 local desktop, laptop, tablet, and mobile marketing checks passed after the approved walkthrough-video baselines were made metadata-stable. |
| `PROGRAMLOOM_E2E_URL=https://app.programloom.com PROGRAMLOOM_E2E_EXTERNAL_SERVER=1 npx playwright test e2e/visual.spec.ts --grep 'marketing visual baseline'` | 0 | 4/4 production desktop, laptop, tablet, and mobile checks passed; the final judge-first surfaces were then manually rechecked at desktop and mobile sizes after deployment. |
| `curl --head https://programloom.com/programloom-walkthrough.mp4` | 0 | The final same-origin walkthrough returned HTTP 200 with `Content-Type: video/mp4`; its silent H.264 stream is 213.08 seconds. |
| `PROGRAMLOOM_E2E_URL=https://programloom.com PROGRAMLOOM_E2E_EXTERNAL_SERVER=1 PROGRAMLOOM_E2E_WIDGET_KEYS=<five published keys> npx playwright test e2e/public.spec.ts` | 0 | 77 passed; 3 viewport-inapplicable mobile-navigation cases skipped; all five production widgets, exact evaluator routes, persona notes, and accessibility checks covered at four viewports. |
| `PROGRAMLOOM_HELP_E2E_URL=https://programloom.com npx playwright test --config=playwright.help.config.ts` | 0 | 132 passed; crawler found no broken links, unexpected redirects, 404s, or incomplete canonical/title/description metadata. |
| `PROGRAMLOOM_E2E_URL=https://app.programloom.com PROGRAMLOOM_E2E_EVENT_ID=<isolated archived event> PROGRAMLOOM_E2E_STORAGE_STATE=<private organizer state> PROGRAMLOOM_E2E_WIDGET_KEYS=<five published keys> npx playwright test e2e/visual.spec.ts` | 0 | 92/92 organizer, public, and widget comparisons passed at the four required viewport sizes; all baselines were manually reviewed. |
| `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilities. |
| `gitleaks detect --source . --no-banner --redact --exit-code 1` | 0 | 160 commits and approximately 3.80 MB scanned; no leaks found. |
| `git clone --no-hardlinks <workspace> /private/tmp/programloom-final-clean-369ee61` | 0 | New checkout resolved to final runtime source `369ee61a61385214266852e4341f4c52220feb3c`. |
| `npm install` (new checkout) | 0 | 334 packages installed; audit reported 0 vulnerabilities. |
| `cp .env.example .env.local` (new checkout) | 0 | Documented non-secret environment template copied without adding provider values. |
| `npm run db:migrate:local` (new checkout) | 0 | Local D1 reported no migrations left to apply. The first sandboxed attempt could not bind localhost (`EPERM`); the authorized localhost rerun passed and is the recorded gate. |
| `npm run typecheck` (new checkout) | 0 | TypeScript project references passed. |
| `npm run test` (new checkout) | 0 | 61 files and 237/237 tests passed. |
| `npm run build` (new checkout) | 0 | Worker, client, and help-center production builds passed. |
| `npm run test:e2e:public` (new checkout) | 0 | 65 passed; 3 viewport-inapplicable cases and 12 production-widget cases skipped locally. Those 12 required widget cases passed separately against production at all four viewports. |
| `npm run test:e2e:help` (new checkout) | 0 | Build plus 132/132 help browser and crawler tests passed. |
| `npm run check` (new checkout) | 0 | Typecheck, 237 tests, production builds, terminology, and evidence schema all passed again. |
| Continuous production lifecycle walkthrough | 0 | One continuous-source 1440×900 recording completed all prescribed steps 1–30 using a newly created isolated event, normally authorized organizer/reviewer/speaker personas, five live widgets, and a disposable cancellation record. The published silent cut is 3:33 and visibly accelerates only the invitation wait at 8×. The temporary event was deleted after media QA, and an exact-ID query returned zero rows. |
| `gh release upload programloom-final-walkthrough-2026-08-12 … --clobber` | 0 | The sanitized 3:33 WebM (16,376,493 bytes; SHA-256 `9e7814f0431551035aa60eca3155cd6d2768e43b9fdcc61677d5f1af26602bd8`) replaced the prior release asset; the public release page returned HTTP 200 without redirect. |
| `npm run verify:summit -- --remote` (post-walkthrough) | 0 | The retained Summit remained active after exact temporary-event deletion: all record/state thresholds passed and forbidden public titles remained 0. |
| `npm run verify:consistency` | 0 | Final production identity, evidence files, canonical URLs, public links, walkthrough link, test totals, and paid-evaluator not-run status all reconciled. |

The paid evaluator remains unrun. Gmail and Apple Calendar are the tested manual calendar environments.
