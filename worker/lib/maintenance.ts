import type { Env } from "../env";
import { database } from "./authz";

export async function cleanupEphemeralWorkspaceState(env: Env) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const result = await database(env)
    .prepare("DELETE FROM submission_bulk_previews WHERE expires_at<?")
    .bind(cutoff)
    .run();
  return result.meta.changes;
}
