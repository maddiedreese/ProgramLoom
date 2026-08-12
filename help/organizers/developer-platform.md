---
title: API tokens and webhooks
description: Create scoped API tokens and signed webhooks without exposing private event data.
---

# API tokens and webhooks

Organization owners can connect approved tools with restricted API tokens and signed webhooks.

## API tokens

Choose the minimum required scopes and, when available, restrict the token to selected events. A token is shown once. Revoked, expired, or insufficiently scoped tokens cannot access protected records.

## Webhooks

Create a webhook for selected record changes, store its signing secret securely, and inspect delivery history before retrying a failure. Retries preserve the same event identity so consumers can process them idempotently.

Never put tokens, signing secrets, private portal links, sensitive merge values, or personal data in URLs.

## What to read next

- [Connect other tools](/organizers/integrations)
- [Account and organization settings](/organizers/settings)
