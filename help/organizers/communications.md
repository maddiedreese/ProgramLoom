# Send and track messages

The **Communications** workspace is the event's shared outbox. Use it for proposal confirmations, reviewer invitations, decisions, speaker reminders, schedule notices, calendar invitations, and organizer-written messages.

## Before you send

1. Choose the kind of message.
2. Review the subject and message template.
3. Use **Preview recipients** to see exactly who will receive it.
4. Preview a real recipient to confirm that names, event details, and private portal links appear correctly.
5. Send a test to an organizer when you want one final inbox check.
6. Choose the clearly labeled send action.

ProgramLoom warns you about missing information or unsupported placeholders before a message is queued.

## Understand message status

- **Prepared** means the message record exists but has not entered the delivery queue.
- **Queued** means ProgramLoom accepted the send request.
- **Processing** means a delivery job is working on it.
- **Sent** means the email provider accepted it.
- **Delivered** appears only when the provider confirms delivery.
- **Bounced** means the recipient's mail system rejected it.
- **Failed** means delivery could not be completed.
- **Cancelled** means it was stopped before completion.

The outbox shows attempts, dates, and failure reasons. A retryable failure has a visible **Retry delivery** action. Retrying the same message does not intentionally create a second email.

## Find a speaker's message history

Open the speaker record and choose its communication timeline. This shows the same durable records as the event outbox, narrowed to that person.

## Schedule a message

Choose a future send time in the event's timezone. The message stays visible in the outbox and can be cancelled before processing begins.

Calendar invitations, updates, and cancellations use this same delivery history. The calendar record also keeps its stable identity and sequence history. [Learn about scheduling and calendar updates](/organizers/schedule).
