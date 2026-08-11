import type { Env } from "../env";
import { database } from "./authz";

export async function cleanupEphemeralWorkspaceState(env: Env) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const db = database(env);
  const results = await db.batch([
    db
      .prepare("DELETE FROM submission_bulk_previews WHERE expires_at<?")
      .bind(cutoff),
    db.prepare(
      "DELETE FROM api_idempotency_records WHERE expires_at<CURRENT_TIMESTAMP",
    ),
    db.prepare(
      "DELETE FROM api_download_grants WHERE expires_at<CURRENT_TIMESTAMP",
    ),
    db.prepare(
      "DELETE FROM api_rate_limits WHERE window_start<datetime('now','-2 days')",
    ),
    db.prepare(
      "DELETE FROM oauth_authorization_codes WHERE expires_at<datetime('now','-1 day')",
    ),
    db.prepare(
      "DELETE FROM api_usage_events WHERE created_at<datetime('now','-90 days')",
    ),
    db.prepare(
      `DELETE FROM api_webhook_deliveries WHERE
       (status='delivered' AND created_at<datetime('now','-30 days')) OR
       (status IN ('failed','cancelled') AND created_at<datetime('now','-90 days'))`,
    ),
  ]);
  return results.reduce((count, result) => count + result.meta.changes, 0);
}
