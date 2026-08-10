# Organizer search and command palette

ProgramLoom's Search control and Command/Ctrl+K open one accessible palette on every authenticated screen. Search is server-side, tenant-scoped, debounced by 180 ms, and grouped across events, CFP forms, submissions, sessions, speakers, CRM contacts, reviewers, onboarding tasks, files, resources, saved submission views, and communication records.

## Visibility and ranking

- Owners and admins search all supported records in their authorized events and organizations.
- Reviewers can find assigned submissions and published sessions, but not submitter identity, speakers, CRM contacts, other reviewers, private files, or unassigned submissions.
- Speakers can find only their own profile, submissions, sessions, tasks, files, and communications.
- Every optional event or organization scope is verified server-side. An inaccessible scope returns the same not-found response as an absent scope.
- Exact matches rank before label prefixes, word prefixes, contained label matches, context matches, and bounded fuzzy matches. Stable entity type, label, and ID ordering breaks ties.

Search results show record context without exposing private detail and deep-link into the relevant authorized workspace. Selecting a result records a durable recent destination only after the API reauthorizes the exact source record. The list persists across browsers and is capped at twenty entries per user.

## Quick actions

Only owners and admins receive event actions. Create event, create/place a session, open the CFP builder, invite a reviewer, add a speaker, send a reminder, open the content queue, inspect schedule conflicts, and inspect integration status all navigate to their normal workflow. The palette itself never sends, invites, creates, or otherwise performs a consequential mutation. Recipient review and confirmation remain mandatory in the destination workflow.

## Privacy, accessibility, and failure behavior

Search text is never persisted, logged, sent to PostHog, or placed in a recent-destination row. PostHog receives explicit usage events containing only scope presence, entity type, rank bucket, or a fixed quick-action ID. Normal structured logs contain correlation IDs, counts, query length, and duration only.

The modal has a visible pointer control, labelled combobox/listbox semantics, grouped headings, keyboard traversal, Home/End, Enter, Escape, a trapped Tab cycle, restored trigger focus, loading/error/empty states, and a mobile bottom-sheet layout. Failed searches do not remove the current page or execute an action.

## Verification

Run `npm run check`, then verify all twelve entity types with owner/admin, reviewer, and speaker identities. Confirm an exact match precedes prefixes and fuzzy candidates; an unassigned or blind-review identity never appears; a cross-tenant event scope returns 404; empty search exposes only permitted quick actions and reauthorized recents; and each representative action opens a reviewable workflow without changing data. For performance evidence, seed at least 1,000 submissions and record latency plus the bounded response length.
