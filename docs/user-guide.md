# ProgramLoom user guide

ProgramLoom shows organizers exactly what is blocking their program, gives them the tools to resolve it, and carries every accepted proposal safely through communication, onboarding, scheduling, publication, and follow-up.

This guide is for a first-time organizer, reviewer, or speaker. It explains the product in the order people normally use it; no event-operations background is assumed.

## The basic idea

An **organization** is the team that owns events. An **event** is one conference, meetup, workshop program, or community call for proposals. A **proposal** is an idea submitted through a CFP form. Once accepted, that proposal connects to durable **speaker**, **session**, **onboarding**, **content**, **communication**, and **calendar** records.

The **Control Room** is the organizer’s home for an event. It answers “What is keeping this program from being ready?” Blocking work appears before warnings and informational work. Each item links to the record or filtered workspace that resolves it. When the underlying work is resolved, the item disappears after live refresh or an explicit refresh.

## Roles and where they start

- **Organization owners and admins** can create events, manage team access, integrations, developer access, and every program workflow.
- **Reviewers** enter their assigned event’s review queue. Blind rounds hide submitter identity and private fields.
- **Speakers** enter their event’s speaker portal to update their profile, complete tasks, upload files, read resources, and follow file feedback.
- **Attendees** use anonymous public widgets. They do not need a ProgramLoom account.

Invitations grant only the selected role and event. Server-side authorization and organization/event boundaries apply to every request; hiding a control in the interface is never the security boundary.

## 1. Create an event

From **Events**, choose **Create event**. You can start from a maintained conference, meetup, workshop-program, or community-CFP template; use a template saved by your organization; or duplicate an existing event.

Before creation, ProgramLoom previews which configuration domains will copy. Forms, review design, onboarding tasks, resources, communication templates, rooms, tracks, formats, content settings, widgets, routing rules, and CRM defaults are selectable. Proposals, people, private notes, files, reviews, decisions, messages, calendars, audits, provider history, integration IDs, and secrets do not copy by default. Relative deadlines move with the new dates; deadlines that cannot be translated safely are called out before creation.

## 2. Build and publish the call for proposals

Open **Call for proposals** in the event navigation. A CFP form contains sections and fields. Built-in fields cover the proposal and its people; custom fields can be text, long text, number, email, URL, choice, multiple choice, checkbox, date, or file. Conditional rules show a field only when earlier answers require it.

Set opening, closing, and edit deadlines; draft behavior; limits; and the confirmation message. Use the anonymous preview to read the form as a submitter, then choose **Publish CFP**. The public CFP directory lists open published forms.

Submitters may save drafts when enabled. A final submission creates durable records and a real confirmation message; it is not a browser-only receipt.

## 3. Find and organize proposals

Open **Submissions**. The submission workspace supports:

- built-in and custom-field columns;
- sorting by proposal fields, review progress, aggregate score, decisions, and timestamps;
- combined filters for form, status, track, format, submitter, reviewer, round, completion, score, decision, notification state, tags, dates, and custom fields;
- search across titles, abstracts, people, organizations, and configured searchable fields;
- personal and organization-shared saved views;
- URL-addressable safe filter and sort state;
- paginated large-result selection;
- reviewed bulk assignment, tagging, decision staging, communication, export, and workflow changes;
- CSV and XLSX export that neutralizes spreadsheet formula injection.

**Save view** preserves the current layout and filters. A changed marker tells you when the workspace no longer matches the saved version. Selecting the entire filtered result set requires a separate confirmation because it can include rows outside the current page.

## 4. Route and review proposals

Open **Reviews → Automatic reviewer routing** to build event-level routing rules in plain language. Conditions may use CFP form, track, format, tag, or custom CFP answers. Groups support AND/OR logic, and lower priority numbers run first. A rule chooses a review round and its eligible reviewer pool, sets the number of reviewers, optionally excludes reviewers, applies tags, and assigns an operational owner.

The current-proposal preview shows the winning rule and eligible reviewers before anything changes. Warnings identify unmatched proposals, overlapping rules, and contradictions. Choose **Run routing** to apply rules to existing proposals. New submitted proposals route automatically. Reruns are idempotent and never duplicate assignments. Capacity, explicit exclusions, conflicts, recusals, and self-review boundaries are checked before assignment.

Review rounds define dates, blind-review behavior, reviewer pools, capacities, and weighted scorecard criteria. **Assign reviewers** remains available for an explicit manual assignment. Reviewers open **Your review queue**, record scores and comments, disclose a conflict or recuse when necessary, and choose **Complete review**. Organizers see both aggregate and individual evidence.

## 5. Stage a decision, then communicate it

These are intentionally separate actions:

- **Stage decision** records the intended acceptance, waitlist, or rejection. It sends nothing.
- **Send decision** happens only in the **Communications Center**, after an organizer previews the real recipients and rendered message.

The Communications Center manages confirmations, reminders, reviewer invitations, change requests, decisions, speaker invitations, onboarding and content reminders, scheduling notices, calendar messages, speaker messages, and CRM outreach. Event templates support subject, rich HTML, plain text, documented merge fields, a real-recipient preview, and an authorized test send.

Recipient filters and a recipient preview precede individual, bulk, or scheduled delivery. Queue-backed jobs use idempotency keys and duplicate-send protection. The outbox distinguishes **prepared**, **queued**, **processing**, **sent**, **delivered**, **bounced**, **failed**, and **cancelled**. “Sent” means the provider accepted the message; “delivered” is used only when the provider supplies delivery evidence. Retryable failures expose **Retry delivery** and retain attempts, timestamps, failure reason, provider correlation, and audit history.

An accepted, communicated proposal creates or connects the speaker, session, portal access, onboarding tasks, notification, communication timeline, audit history, and calendar-ready program records.

## 6. Prepare speakers and session content

Open **Speakers** to see portal access and onboarding progress. Organizers can add a speaker from the CRM, invite portal access, create tasks, request files, and publish speaker resources. Speakers update their biography, company, job title, pronouns, social links, logistics, and persisted headshot.

File requests accept versioned uploads. Organizers can approve a file, request changes, and add comments. The speaker sees current status, version history, and feedback in the portal. Content approval is separate from agenda publication; an unapproved session stays off public surfaces.

Resource pages allow safe headings, links, lists, code, and approved HTTPS embeds. Organization admins manage an exact-domain allowlist. YouTube, Vimeo, and Google Docs are included by default. Every resource must pass a speaker-facing safety preview before save. Scripts, event handlers, forms, popups, unsafe URLs, and top-level navigation are removed, and ProgramLoom explains what changed.

## 7. Build the agenda and maintain calendars

Open **Agenda**. The builder offers **List**, **Day**, **Week**, **Track**, and **Room** views; the selected view, date, and filters are safe URL state. Unscheduled sessions remain visible beside every view.

In Day view, drag a session to a room and time. Move an existing card the same way. Touch and pointer interaction are supported, and every session also has a fully equivalent **Schedule with form** keyboard path. A material move opens a preview explaining calendar and publication consequences. Invalid conflicts do not partially move a session.

Track-colored cards show time, room, format, track, and speaker context. ProgramLoom detects room and speaker overlaps. Resolve the underlying placement and use **Resolve conflict** when the schedule is valid.

Participant calendar invitations are durable records:

- the first placement creates a stable UID;
- a material title, description, time, timezone, room, location, speaker, or event change keeps the UID and increments `SEQUENCE`;
- removal, cancellation, withdrawal, or explicit cancellation sends a standards-compliant cancellation;
- rescheduling after cancellation is an explicit action that safely restores the same calendar identity;
- public itinerary ICS is separate from participant-addressed invitations.

Use **Send calendar invitation** when the schedule is ready. Calendar delivery appears in the Communications Center with its real provider status.

## 8. Publish the agenda and attendee widgets

Choose **Publish agenda** only after content approval and conflict review. Widget configuration changes propagate live without regenerating an embed.

The five anonymous attendee surfaces are:

1. **Session directory** — searchable session cards with description, event-local date/time, room, format, track, and complete speaker context.
2. **Speaker directory** — deterministic surname ordering, persisted headshots or accessible fallbacks, biography, role, company, and linked sessions.
3. **Speaker gallery** — a visual, responsive speaker view with the same durable profiles.
4. **Agenda** — multi-day, filterable schedule with complete session detail and explicit Close/Back controls.
5. **Personal itinerary** — visible Add/Remove controls, browser reload persistence, filtering, and ICS export.

Direct and iframe views use the same published organizer records. JSON, XML, and ICS feeds are available where configured. Result counts update with search and filtering, and date navigation changes both the selected day and displayed content.

## 9. Use the Control Room, search, and notifications

Return to **Control Room** whenever you need the next action. It tracks proposal, routing, review, conflict, decision, delivery, portal, onboarding, file, content, agenda, queue, Airtable, and scheduled-integration work. Filters cover event, track, owner, status, deadline, and severity where relevant. Results use deterministic priority and age ordering.

Open global search from the visible control or press **Command+K** on macOS (**Control+K** elsewhere). Search covers events, forms, proposals, sessions, speakers, contacts, reviewers, tasks, files, resources, saved views, and communications. Results respect role, tenant, blind-review, and private-field boundaries. Quick actions open an explicit workflow or confirmation; consequential work never runs invisibly.

The notification bell stores actionable server-side notifications across browsers. Filter by event, category, severity, or read state; mark one or all read; and open the affected record directly. Preferences control in-app and eligible email channels. Repeated events coalesce rather than creating noise.

## 10. CRM, Airtable, analytics, and developer access

The **Speaker CRM** stores organization contacts, custom fields, tags, outreach history, and event handoffs. Adding a CRM contact to an event creates an event roster connection without duplicating the person.

Organizations using Airtable can keep business records in their authoritative base. ProgramLoom uses stable external IDs, a durable outbox, bounded retries, webhook/poll reconciliation, and explicit conflict records. **Integration status** shows pending, failed, and open-conflict counts. Use **Recover integration** after fixing credentials or schema; healthy final state is zero pending, zero failed, and zero open conflicts.

PostHog receives deliberately limited events such as feature use and result selection; search text, private record contents, tokens, and personal data are not analytics properties. Normal structured Cloudflare logs contain correlation IDs and operational metadata, not message bodies, tokens, or personal data.

Organization owners and admins open **Developer settings** to create hashed, one-time-reveal API tokens, signed webhooks, and OAuth 2.1 clients. The stable `/api/v1` REST API uses `x-access-token`, granular scopes, event restrictions, PII masking, bounded pagination, rate limits, idempotency keys, optimistic concurrency, short-lived file downloads, and structured errors. Continue with the public [developer reference](https://app.programloom.com/developers) or the repository [developer-platform guide](developer-platform.md).

## Common status questions

### Why is an accepted session not public?

Check content approval, agenda placement, agenda item status, and whether the current agenda has been published. The Control Room links to whichever prerequisite is missing.

### Why did a staged decision send no email?

That is expected. Open the Communications Center, select the decision recipients, preview the rendered message, and choose **Send decision**.

### Why was a reviewer skipped?

Routing skips reviewers who are at capacity, excluded by the rule, recused, in an unresolved conflict, or would review their own proposal. The routing run and audit history record the reason.

### Why did a drag not move the session?

An invalid drop is transactional: nothing moves when the room or a speaker conflicts. Read the announced conflict, change the target, or use **Schedule with form** for an exact keyboard-operable placement.

### What should I do after a failed delivery or integration?

Open the linked Control Room item. Read the durable failure reason, correct the underlying problem, then use **Retry delivery** or **Recover integration**. The retry is idempotent and retains its history.

## Glossary

- **CFP:** call for proposals; the public form used to collect program ideas.
- **Proposal/submission:** the submitted idea before or during evaluation.
- **Decision staging:** recording the intended outcome without sending it.
- **Session:** the accepted program content connected to speakers and agenda state.
- **Placement:** the room and time assigned to a session.
- **Portal:** the authenticated speaker workspace for onboarding and content.
- **Public widget:** an anonymous attendee surface driven by the published agenda.
- **Control Room blocker:** persisted work that prevents program readiness.
- **Audit event:** a durable before/after record of a material mutation.
