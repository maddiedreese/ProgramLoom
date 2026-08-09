# Airtable authority

ProgramLoom can use a dedicated Airtable base as the organizer-editable source of truth while D1 retains identities, permissions, audit history, synchronization state, and query indexes.

`npm run airtable:provision` creates ten namespaced `PL …` tables idempotently. It never deletes or modifies unrelated tables. Every table has a stable `ProgramLoom ID`; synchronization uses that ID rather than mutable names or row positions.

Provisioned domains are organizations, events, CFP forms, submissions, speakers, reviews, speaker tasks, agenda items, CRM contacts, and pipeline cards. JSON columns preserve flexible form answers and integration metadata until strongly typed Airtable columns are explicitly configured.
