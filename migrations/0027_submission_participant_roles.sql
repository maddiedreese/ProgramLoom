-- Keep persisted submission participant roles aligned with the public CFP API.
-- SQLite requires rebuilding the table to expand a CHECK constraint.
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE submission_people_next (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary','coauthor','moderator','presenter','panelist','discussant')),
  organization TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

INSERT INTO submission_people_next
  (id,submission_id,user_id,email,name,role,organization,position)
SELECT id,submission_id,user_id,email,name,role,organization,position
FROM submission_people;

DROP TABLE submission_people;
ALTER TABLE submission_people_next RENAME TO submission_people;

