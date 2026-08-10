# Airtable authority

ProgramLoom can use a dedicated Airtable base as the organizer-editable source of truth while D1 retains identities, permissions, audit history, synchronization state, and query indexes.

`npm run airtable:provision` creates fourteen namespaced `PL …` tables and adds missing ProgramLoom-owned fields idempotently. It never deletes fields or modifies unrelated tables. Every table has a stable `ProgramLoom ID`; synchronization uses that ID rather than mutable names or row positions.

Provisioned domains are organizations, events, event templates, event program settings, CFP forms, form fields, submissions, submission tags, speakers, reviews, review conflicts, speaker tasks, agenda items, schedule conflicts, CRM contacts, CRM field definitions, and pipeline cards. Event projections retain duplication provenance without reusing external IDs. Submission projections include decision state, assigned tag JSON, and flexible answer JSON. Form-field projections include stable keys, options, validation, and the organizer-searchable flag. Control Room ownership, saved views, creation-operation recovery records, audit history, delivery attempts, queue state, and integration credentials remain operational D1 records rather than organizer-editable Airtable rows.

In Airtable-authoritative workspaces, ProgramLoom writes organizer changes through an idempotent D1 outbox and Cloudflare Queue. Airtable client edits trigger an HMAC-authenticated webhook and reconcile the organizer-editable organization, event, CRM-contact, and pipeline domains into D1 read models. Closely spaced webhook pings collapse into one reconciliation; failed writes use durable exponential backoff. This keeps normal operation below Airtable Free's API allowance without a polling loop.

Deleting an authoritative event, CRM contact, or pipeline card in Airtable removes its indexed D1 read model during reconciliation and records an audit event. Removing the workspace's organization row instead creates a visible conflict because authentication and tenancy cannot safely be deleted from an editable spreadsheet row.

Owners and admins see pending records, failed work, conflicts, and last-sync state in the workspace. “Sync now” performs an explicit recovery pass. Authentication, authorization, audit history, and queue state always remain in D1 and cannot be changed through Airtable cells.

Speaker-task assignments use a composite stable identifier containing both the task and speaker IDs. The serializer resolves both source records explicitly; there is no synthetic assignment-row ID. Conflict retry is two-phase: the organizer action requeues the failed outbox record, and only a successful Queue worker write resolves the conflict and emits recovery audit/notification state. This prevents a still-failing provider write from disappearing from operational views.

Production setup is:

1. Run `npm run airtable:provision` to idempotently create any missing `PL …` tables.
2. Deploy the Worker and migration.
3. Run `npm run airtable:webhook` once. It creates the filtered webhook and deploys its path, HMAC, and ID secrets without printing them.

The daily scheduled trigger reads the webhook payload cursor to keep the Airtable webhook active. The ten-minute trigger only drains already-due D1 outbox rows and therefore makes no Airtable calls when there is no work.
