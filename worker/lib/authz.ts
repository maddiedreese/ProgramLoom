import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../env";
import { sha256 } from "./crypto";

export type AuthenticatedUser = { id: string; email: string; name: string };
export type OrganizationRole = "owner" | "admin" | "member";
export type EventRole = "owner" | "admin" | "reviewer" | "speaker";

type AppContext = Context<{ Bindings: Env; Variables: { requestId: string } }>;

export class HttpError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409 | 503, public readonly code: string, message: string) {
    super(message);
  }
}

export function database(env: Env): D1Database {
  if (!env.DB) throw new HttpError(503, "database_unavailable", "The database is temporarily unavailable.");
  return env.DB;
}

export async function requireUser(context: AppContext): Promise<AuthenticatedUser> {
  const token = getCookie(context, "programloom_session");
  if (!token) throw new HttpError(401, "authentication_required", "Sign in to continue.");
  const user = await database(context.env).prepare(
    `SELECT u.id, u.email, u.name
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  ).bind(await sha256(token), new Date().toISOString()).first<AuthenticatedUser>();
  if (!user) throw new HttpError(401, "session_expired", "Your session has expired. Sign in again.");
  return user;
}

export async function requireOrganizationRole(
  context: AppContext,
  organizationId: string,
  allowed: OrganizationRole[],
): Promise<{ user: AuthenticatedUser; role: OrganizationRole }> {
  const user = await requireUser(context);
  const membership = await database(context.env).prepare(
    "SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ?",
  ).bind(organizationId, user.id).first<{ role: OrganizationRole }>();
  if (!membership) throw new HttpError(404, "organization_not_found", "Organization not found.");
  if (!allowed.includes(membership.role)) throw new HttpError(403, "permission_denied", "You do not have permission to do that.");
  return { user, role: membership.role };
}

export async function requireEventRole(
  context: AppContext,
  eventId: string,
  allowed: EventRole[],
): Promise<{ user: AuthenticatedUser; role: EventRole; organizationId: string }> {
  const user = await requireUser(context);
  const membership = await database(context.env).prepare(
    `SELECT e.organization_id AS organizationId,
            CASE
              WHEN om.role = 'owner' THEN 'owner'
              WHEN om.role = 'admin' THEN 'admin'
              ELSE em.role
            END AS role
     FROM events e
     LEFT JOIN organization_members om ON om.organization_id = e.organization_id AND om.user_id = ?
     LEFT JOIN event_members em ON em.event_id = e.id AND em.user_id = ?
     WHERE e.id = ? AND (om.role IN ('owner', 'admin') OR em.role IS NOT NULL)
     ORDER BY CASE WHEN om.role IN ('owner', 'admin') THEN 0 ELSE 1 END
     LIMIT 1`,
  ).bind(user.id, user.id, eventId).first<{ organizationId: string; role: EventRole }>();
  if (!membership) throw new HttpError(404, "event_not_found", "Event not found.");
  if (!allowed.includes(membership.role)) throw new HttpError(403, "permission_denied", "You do not have permission to do that.");
  return { user, role: membership.role, organizationId: membership.organizationId };
}

export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
