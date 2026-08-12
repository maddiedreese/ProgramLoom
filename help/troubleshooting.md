---
title: Troubleshooting
description: Resolve common ProgramLoom questions about messages, public sessions, schedules, uploads, and integrations.
---

# Troubleshooting

## A staged decision did not send an email

That is expected. **Stage decision** records an intended outcome and sends nothing. Open **Communications**, choose the decision recipients, preview the rendered message, then choose **Send decision**.

## A message failed

Open the message in **Communications** and read the failure reason. Correct the address, template, domain, or provider problem, then choose **Retry delivery** when it is available. Retrying a message does not intentionally create a duplicate send.

## An accepted session is not public

Check these items in order:

1. Is the session content approved?
2. Does the session have a date, time, and room?
3. Is the agenda item approved for publication?
4. Has the latest agenda change been published?

The Control Room should link to the missing requirement.

## A session will not move

The target room may already be occupied, or a speaker may already have another session at that time. ProgramLoom does not partially save an invalid move. Read the conflict, choose a different room or time, or use **Schedule with form** for an exact placement.

## A speaker cannot see the right work

Confirm that the speaker accepted the invitation with the same email address connected to the event. Then check that the proposal, session, tasks, and file requests are assigned to that speaker rather than a duplicate contact.

## A file upload was rejected

Open the request and check its allowed file types and size. Make sure you are uploading to the correct request. If a valid file still fails, keep the filename and visible error message and contact the organizer.

## The Control Room count does not look right

Choose **Refresh**, then open the category and compare its list with the underlying records. Resolved work may need a saved status change, approval, published agenda update, or completed delivery before it clears.

## Airtable is not up to date

Open **Integration status**. Read the pending, failed, and conflict counts. After correcting credentials or the Airtable structure, choose **Recover integration**. A healthy state shows zero pending, zero failed, and zero open conflicts.

## I cannot find a record

Use the visible search control. On macOS, press **Command+K**. On Windows or Linux, press **Control+K**. Search results respect your role, so a record you are not allowed to access will not appear.
