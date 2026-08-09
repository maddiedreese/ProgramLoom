# Data model

The initial migration deliberately models the complete product lifecycle so later modules share identities and handoffs instead of duplicating records.

```mermaid
flowchart LR
  CFP["CFP form"] --> SUB["Submission"]
  SUB --> REV["Review rounds"]
  REV --> DEC["Decision"]
  DEC --> SPK["Speaker profile"]
  SPK --> CNT["Content and tasks"]
  CNT --> AG["Agenda item"]
  AG --> PUB["Public widgets"]
  CRM["Cross-event CRM"] --> SPK
  AIR["Airtable authority"] <--> OUT["Idempotent sync outbox"]
  OUT <--> SUB
  OUT <--> SPK
  OUT <--> CRM
```

Organization and event IDs are carried through every sensitive record. Queries must begin from a verified membership scope. Public views are generated from approved read models rather than exposing organizer tables.
