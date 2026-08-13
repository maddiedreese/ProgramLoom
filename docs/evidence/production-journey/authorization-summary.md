# Sanitized authorization verification summary

The authorization matrix is enforced at shared boundaries and at record-scoped routes. No cookies, storage states, access tokens, blind-review identities, record names from another tenant, or sensitive error payloads are retained here.

- Every registered session-protected API route is enumerated by the Worker regression and must return 401 before request-body validation when authentication is absent.
- Every registered token-protected `/api/v1` route is enumerated separately and must return 401 before validation when its access token is absent.
- Policy tests cover anonymous and expired sessions; owner/admin access in the correct organization and event; non-enumerating 404 behavior for another organization or event; assigned and unassigned reviewers; and connected and unconnected speakers.
- API-token tests require persisted revoked/expiry predicates and enforce the requested scope with a data-free 403.
- Authenticated browser coverage exercises record-scoped organizer, reviewer, speaker, developer API, cross-event, and missing-record behavior when restricted storage states are supplied.
- Search, public-widget, telemetry, and developer API tests exclude blind-review identity leakage, cross-tenant names, personal analytics properties, and sensitive merge values in URLs.

The production persona entry page links Organizer, Reviewer, and Speaker cards to normal application authentication with a post-authentication return route, and Attendee to the anonymous public program. It creates no public privileged session.

