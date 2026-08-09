-- Only one live operational job may act on a given entity at a time.
CREATE UNIQUE INDEX idx_operational_jobs_active_entity
  ON operational_jobs(job_kind, entity_type, entity_id)
  WHERE entity_id IS NOT NULL AND status IN ('queued','processing','retrying');

