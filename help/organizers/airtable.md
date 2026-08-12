---
title: Airtable synchronization
description: Configure Airtable synchronization, understand health counts, and recover without duplicate records.
---

# Airtable synchronization

An organization may connect Airtable for supported business records. ProgramLoom remains usable when Airtable is unavailable.

## Read synchronization health

Integration status reports pending work, failed work, and open conflicts. Healthy Airtable synchronization is exactly **zero pending, zero failed, and zero open conflicts**.

## Recover safely

Correct the connection or conflicting data, then choose **Recover integration**. Repeated attempts reconcile the same durable records and conflicts; they must not create duplicates. The result links back to integration health so you can confirm all three counts.

Never place provider identifiers, tokens, private base contents, or raw logs in a public issue or repository file.

## What to read next

- [Connect other tools](/organizers/integrations)
- [Troubleshooting](/troubleshooting)
