# ProgramLoom developer platform

ProgramLoom’s developer platform lets an organization connect its event program to trusted internal tools without exposing organizer-only application APIs. Start with the public, versioned reference at [app.programloom.com/developers](https://app.programloom.com/developers); its OpenAPI document and downloadable collection are generated from the supported `/api/v1` contract.

## Create a restricted token

Organization owners and admins open **Workspace → Developer settings → API tokens** and choose **Create API token**. Give the token a purpose-specific name, choose the smallest scopes it needs, restrict it to selected events when possible, keep **Hide PII** enabled unless personal data is required, and set an expiration for temporary access.

The complete token is shown once. ProgramLoom stores only its SHA-256 hash. Put the value in a secret manager or an ignored environment file; never place it in source, a URL, analytics, or ordinary logs. Editing scopes, event restrictions, expiration, or PII behavior does not reveal the value again. Rotation replaces it immediately, and revocation is immediate.

```bash
curl --get 'https://app.programloom.com/api/v1/sessions' \
  --header "x-access-token: $PROGRAMLOOM_TOKEN" \
  --data-urlencode 'eventId=YOUR_EVENT_ID' \
  --data-urlencode 'limit=25'
```

Every collection is paginated with a default of 25 and maximum of 100. Responses include a request ID; retain it when reporting an operational problem. Rate-limit headers describe the current token window, and an exhausted window returns `429`.

## Safe writes

Create and bulk operations require a unique `Idempotency-Key`. Repeating the same key and payload returns the original result instead of creating a duplicate. Reusing the key with a different payload returns a conflict.

Updates return an `ETag`. Send that value in `If-Match`; a stale value returns `412` instead of overwriting another change.

```bash
curl --request POST 'https://app.programloom.com/api/v1/sessions' \
  --header "x-access-token: $PROGRAMLOOM_TOKEN" \
  --header 'content-type: application/json' \
  --header "idempotency-key: $REQUEST_ID" \
  --data '{
    "eventId": "YOUR_EVENT_ID",
    "title": "Reliable event integrations",
    "description": "A production session created through the supported API.",
    "durationMinutes": 45
  }'
```

Sessions and contacts use recoverable soft deletion and explicit restore operations. Agenda-draft operations require `write:agenda`; published agenda reads remain separate. Short-lived file download links are authorized for the requesting token and expire automatically. Private communications, provider history, personal logistics, and fields outside the token’s access are not returned.

## Scopes and privacy

Read scopes cover events, sessions, speakers, contacts, submissions, agenda, and content. Write scopes cover sessions, contacts, events, metadata, fields, and agenda. Event restrictions and organization ownership are applied at the database query boundary before serialization. **Hide PII** removes contact details and private custom-field values even when a broad read scope would otherwise permit the record.

Token usage records contain the token ID, method, route template, result, duration, request ID, and affected entity—not the token, query contents, returned PII, or response body. Developer-setting analytics contain only bounded action metadata.

## Signed webhooks

Open **Developer settings → Webhooks** to create a subscription. Choose an HTTPS endpoint and optional event/entity filters. The signing secret is shown once and stored encrypted by ProgramLoom.

Each Queue-backed delivery contains a stable delivery ID, event ID, entity type, stable entity ID, action, source sequence, and timestamp. Verify the signature against the exact request bytes before parsing. Store the delivery ID so retries can be deduplicated, and ignore a source sequence older than the latest applied state.

Delivery history shows attempts, response status, next retry, and failure reason. ProgramLoom retries with bounded exponential backoff. After fixing an endpoint, choose **Retry delivery**. Disabling a subscription stops new deliveries; rotating a secret requires updating the receiver before traffic resumes.

## OAuth, MCP, and structured query

OAuth 2.1 clients use authorization code with PKCE S256. Public clients do not receive a client secret; confidential clients receive it once. Redirect URIs are exact HTTPS values, refresh tokens rotate, and revocation invalidates issued access.

Remote MCP and the read-only structured query endpoint reuse the same token scopes, event restrictions, PII masking, rate limits, auditing, and tenant boundaries as REST. Natural-language text is not an authorization mechanism: a request can return only records the underlying credential may read.

## Versioning and support

`/api/v1` is the stable major version. Backward-compatible fields and endpoints may be added within v1. Breaking changes require a new major version, a published changelog entry, and a documented deprecation period. Follow the public [changelog](https://app.programloom.com/api/v1/changelog), use the [OpenAPI document](https://app.programloom.com/api/v1/openapi.json), or import the [API collection](https://app.programloom.com/api/v1/collection.json).

For a clean-checkout integration example, copy `.env.example` to an ignored local file, set a restricted `PROGRAMLOOM_TOKEN` and event ID, and adapt the cURL, JavaScript, or Python examples in the public guide. Never use production credentials in committed tests.
