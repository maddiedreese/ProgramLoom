# In-app notifications

ProgramLoom keeps operational updates in D1 so unread state, coalescing, and preferences follow a user across browsers and devices. The global bell polls every twenty seconds, announces count changes through a polite live region, and opens a paginated, keyboard-accessible panel with event, category, severity, and read-state filters.

## Events and recipients

The center covers proposal creation/update/withdrawal, completed reviews and reviewer conflicts/recusals, decisions awaiting communication, accepted speaker invitations, speaker profile changes, completed/overdue tasks, uploaded/replaced/commented/returned files, approved/returned session content, agenda conflicts/publication, delivery failures, exhausted Queue work, Airtable failures/conflicts, and integration recovery.

Organizer operational updates fan out to the authorized organization owners and admins. Speaker-facing content, file, task, and agenda updates target only the linked speaker user. Every notification is scoped by organization and, where applicable, event. APIs select only `recipient_user_id = current user`; preference writes independently revalidate organization or event access.

Repeated events use a stable coalescing key. The existing row increments its occurrence count, receives the newest severity/body/link, becomes unread, and moves to the newest occurrence time. A source mutation and its notification insert share a D1 batch where practical, so the product never reports success with a missing required notification.

## Preferences and email

Each category has in-app and email controls at organization or event scope; an event value overrides the organization default. In-app defaults on and email defaults off. Notifications are always durably created for authorized recipients, then channel preferences determine visibility and delivery. This allows an email-only preference without creating a fake in-app record or losing auditability.

Opt-in email fan-out prepares a deterministic `notification-email/<notification id>` communication message and a unique channel-delivery row. It uses the existing communication outbox, operational job, Cloudflare Queue, Resend provider state, idempotency protection, attempts, and structured correlation fields. A duplicate scheduler run cannot create a second provider message. Normal logs contain IDs, counts, and error codes—not recipient data, notification text, or message bodies.

## Retention and recovery

Active notifications remain for 180 days unless an earlier expiry applies. The daily scheduled job archives them, then permanently removes records that have remained archived for another 30 days. Related optional-channel rows cascade with the notification. The cleanup logs only archived/deleted counts.

Queue or provider failure leaves the prepared communication recoverable in the Communications Center. Notification-email delivery state becomes failed and can be re-prepared by the bounded dispatcher. A failure does not pretend that email was sent and does not remove the in-app update.

## Verification

Run `npm run seed:notifications` against local D1 to restore one natural persisted example of every required type. Verify the 22 rows, all twelve categories, five blocking rows, read/unread persistence, mark-all behavior, event/category/severity filters, direct links, coalescing, preference scope and audit history. Then exercise representative real domain mutations; seeded rows are evidence fixtures, not substitutes for the integrated mutation paths.
