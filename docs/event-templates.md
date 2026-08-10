# Event duplication and reusable templates

ProgramLoom can create a draft event from a prior event in the same organization, a versioned organization template, or one of four maintained starters: conference, meetup, workshop program, and community CFP. Owners and admins are the only roles allowed to list, preview, save, edit, delete, or materialize templates.

## Organizer workflow

From the organization dashboard, choose a source and the configuration domains to copy. Enter the new name, optional slug, dates, timezone, venue, and website, then select **Preview event copy**. The preview is mandatory and shows record counts, translated deadlines, warnings, and the fixed list of excluded private and historical domains. A changed field invalidates the preview and requires a new one. Select **Confirm and create draft** only after reviewing it.

Use **Save as template** on an event card to create a reusable organization snapshot. The snapshot is versioned and preserves its source-event provenance. Renaming or updating template metadata records before/after audit state.

## Copy boundary

Selectable domains are CFP forms/sections/fields/options/conditions; review rounds and scorecards; onboarding tasks and file requests; resources; communication templates and reminder rules; rooms, tracks, locations, and formats; content workflow settings; widgets/themes; and CRM handoff/routing defaults. Every copied primary key and public widget key is regenerated.

ProgramLoom never copies submissions, reviews, scores, decisions, speakers, CRM contacts, private notes, logistics, uploaded files, deliveries, provider history, calendar records, audit history, Airtable external IDs, credentials, or secrets. New events always begin in `draft`; source publication state is deliberately not inherited.

Deadlines are translated by their offset from the source event start. Invalid source dates are left unset and surfaced as preview warnings. Creation uses a durable operation record. If any copy step fails, the target event is cascade-deleted before the operation is marked failed, leaving no partial event while preserving non-sensitive recovery evidence.

## Operations and evidence

Structured failure logs contain request, organization, and operation correlation identifiers, but no template body or personal data. Material configuration mutations are audited. In Airtable-authoritative organizations, events, templates, event program settings, copied CFP forms, and copied form fields enter the normal conflict-safe outbox using new external identifiers.

Verification should cover all four starters, an organization template, and a same-organization event duplicate; translated and invalid deadlines; exact configuration counts; absence of every excluded domain; owner/admin access; reviewer/speaker denial; cross-organization denial; slug collision; cleanup after forced failure; keyboard/mobile preview and confirmation; and Airtable reconciliation.
