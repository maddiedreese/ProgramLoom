# Connect other tools

ProgramLoom works on its own. Connections let your team keep selected business records in Airtable, deliver email, understand broad product usage, or build approved integrations.

## Airtable

An organization can use Airtable as the source of truth for supported business records. **Integration status** shows pending work, failures, and conflicts. A healthy connection shows zero pending, zero failed, and zero open conflicts.

If synchronization fails, unaffected event work remains available. Open the failure, correct the connection or conflicting data, then choose **Recover integration** or the provided retry action. Recovery should reconcile the same records rather than create duplicates.

## Email delivery

ProgramLoom sends event email through the organization's configured delivery service. The Communications outbox remains the place to understand prepared, queued, sent, delivered, bounced, failed, and cancelled records.

## Product usage

When product analytics is enabled, ProgramLoom records privacy-conscious events such as opening search or selecting a result. Search text, private message content, and sensitive personal data are not intentionally sent as analytics properties.

## API tokens and webhooks

Organization owners can create restricted API tokens for approved tools. A token is shown once, can be limited to selected events and permissions, and can hide personal information. Revoke or rotate it immediately when access should end.

Webhooks notify another approved system when selected records change. Each subscription has a signing secret and delivery history, including retry controls. Technical implementers can open the developer reference from API settings.

Never paste a token, private portal link, or webhook secret into a shared note or support message.
