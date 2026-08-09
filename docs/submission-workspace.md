# Configurable submission workspace

The event submission workspace is an organizer-only, server-authorized view over persisted CFP records. It replaces the former client-filtered queue with bounded D1 queries, durable personal and organization views, confirmed bulk workflows, and safe spreadsheet exports.

## Data and isolation

- Every endpoint resolves the current authenticated organizer through the event and organization membership graph. An inaccessible event returns `404`; reviewer and speaker roles receive `403`.
- Queries require an event identifier, cap page size at 100, and use event-leading indexes. A complete filtered bulk selection is resolved again immediately before execution; changed result sets invalidate the preview.
- Custom filters resolve field identifiers through the event’s CFP forms before using their field keys. Export columns receive the same event validation.
- Saved views store presentation and query configuration, never search text. Personal views are visible only to their owner; organization views are visible to authorized organizers. Material view changes and bulk actions write audit records.

## Bulk safety

Bulk operations follow a two-step preview and confirmation protocol. Preview records expire after 15 minutes, bind to the requesting user and event, record the matched count and sample, and can be consumed only once. Status and decision changes reject mixed selections containing final records or records already in the requested state. Decision staging also writes per-submission decision history.

Communication actions hand off the same server-side selection to the Unified Communications Center. The center re-resolves eligible recipients, selects only matching submission recipients, and still requires its normal recipient review and confirmation. Export actions stream real CSV or XLSX bytes and consume the preview only after generation.

CSV and XLSX cells are protected against spreadsheet formula injection, including values with leading whitespace. XLSX output is a standards-based OOXML package with inline strings and no macros or external links.

## Operating limits

- Query page: 10–100 rows.
- Selected bulk request: 2,000 submissions.
- Confirmed non-export bulk operation: 2,000 submissions.
- Export: 10,000 submissions per confirmed preview.
- Recipient resolution in the Communications Center remains explicitly previewed; currently eligible recipients are displayed before preparation.

Expired previews can be removed by the existing daily maintenance path. If a bulk preview returns `preview_stale`, refresh the workspace and create a new preview rather than retrying the old identifier.

## Evidence fixture

Run `npm run seed:submission-workspace` against local D1 after migrations and the standard Local Conf seed. It creates 1,200 persisted proposals, primary submitters, varied statuses/formats/custom answers, and a deterministic tag distribution. The script deletes only records with the reserved `workspace-load-` prefix and is repeatable.

Verification should cover combined filtering, custom columns, personal/shared/default view recovery, page and full-filtered bulk selection, CSV/XLSX package inspection, one-time preview consumption, organizer/reviewer/cross-event isolation, and keyboard/mobile behavior.
