# Production calendar lifecycle evidence

Verified on 2026-08-09 against `app.programloom.com` using the disposable accepted session `Disposable Calendar Lifecycle Verification`.

## Persisted and delivered lifecycle

| Sequence | Method    | Result                                                                        |
| -------: | --------- | ----------------------------------------------------------------------------- |
|        0 | `REQUEST` | Initial invitation delivered for Sep 14, 2027, 11:00–11:30 America/New_York.  |
|        1 | `CANCEL`  | Initial placement cancellation delivered.                                     |
|        2 | `REQUEST` | Explicit reschedule delivered for Sep 15, 2027, 07:00–07:30 America/New_York. |
|        3 | `CANCEL`  | Final cancellation delivered and item removed from public agenda surfaces.    |

All four artifacts use `e41dbde3-731a-4ee9-9943-fd954b49153e@programloom.com`. The production API reported a final calendar state of `cancelled`; every revision and its linked Resend communication reported `delivered`. Ordinary placement after cancellation returned `409 explicit_reschedule_required`; the explicit reschedule transition created sequence 2. Reviewer and speaker cancellation attempts returned `403`.

The main session artifacts separately prove a stable UID across a material time-and-room update: sequence 0 at 07:00–07:45 on the Main stage and sequence 1 at 08:30–09:15 in the Breakout room.

## Client verification

- Gmail parsed the main initial invitation and update as native calendar messages, showing the new time and room. It parsed the disposable cancellation as `Event cancelled` and `Removed from Google Calendar`. Every message exposed the attached `.ics` file and was received in the controlled speaker inbox.
- Apple Calendar imported disposable sequence 0 as one event, applied sequence 2 in place to the new date/time, and applied sequence 3 to that same entry as `Canceled`. The accessibility tree contained exactly one disposable event after each step.
- Outlook remains a required manual evidence step. No Outlook desktop application is installed and the external-browser Outlook session is signed out; no result is claimed.

The sibling `.ics` files are the exact authenticated revision downloads retained from production R2. They preserve CRLF line endings and RFC 5545 folding.
