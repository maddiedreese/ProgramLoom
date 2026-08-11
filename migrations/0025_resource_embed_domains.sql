PRAGMA foreign_keys = ON;

CREATE TABLE organization_embed_domains (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL COLLATE NOCASE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, domain)
);

CREATE INDEX idx_organization_embed_domains_org
  ON organization_embed_domains(organization_id,domain);
