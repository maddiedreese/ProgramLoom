import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import {
  database,
  HttpError,
  requireOrganizationRole,
  requireUser,
} from "../lib/authz";
import { randomToken, sha256 } from "../lib/crypto";
import { developerScopes, type DeveloperScope } from "../lib/developerPlatform";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const authorizeSchema = z.object({
  clientId: z.string().min(10).max(200),
  redirectUri: z.url(),
  scope: z.string().trim().min(1).max(1000),
  state: z.string().max(500),
  codeChallenge: z.string().min(43).max(128),
  codeChallengeMethod: z.literal("S256"),
  eventIds: z.array(z.uuid()).max(100).default([]),
  approve: z.boolean(),
});

function parseScopes(value: string): DeveloperScope[] {
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (
    !scopes.length ||
    scopes.some((scope) => !developerScopes.includes(scope as DeveloperScope))
  )
    throw new HttpError(
      400,
      "invalid_scope",
      "One or more requested scopes are not supported.",
    );
  return scopes as DeveloperScope[];
}

export async function pkceS256Challenge(verifier: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function clientForAuthorization(
  db: D1Database,
  clientId: string,
  redirectUri: string,
  requestedScopes: DeveloperScope[],
) {
  const client = await db
    .prepare(
      `SELECT id,organization_id organizationId,name,redirect_uris_json redirectUrisJson,
       scopes_json scopesJson,client_secret_hash clientSecretHash FROM oauth_clients
       WHERE id=? AND revoked_at IS NULL`,
    )
    .bind(clientId)
    .first<Record<string, unknown>>();
  if (!client)
    throw new HttpError(400, "invalid_client", "OAuth client not found.");
  const redirectUris = JSON.parse(String(client.redirectUrisJson)) as string[];
  if (!redirectUris.includes(redirectUri))
    throw new HttpError(
      400,
      "invalid_redirect_uri",
      "The redirect URI is not registered for this client.",
    );
  const allowedScopes = JSON.parse(String(client.scopesJson)) as string[];
  if (requestedScopes.some((scope) => !allowedScopes.includes(scope)))
    throw new HttpError(
      400,
      "invalid_scope",
      "The client is not allowed to request one or more scopes.",
    );
  return client;
}

export function oauthMetadata(env: Env) {
  return {
    issuer: env.APP_URL,
    authorization_endpoint: `${env.APP_URL}/oauth/authorize`,
    token_endpoint: `${env.APP_URL}/api/oauth/token`,
    revocation_endpoint: `${env.APP_URL}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: developerScopes,
  };
}

router.get("/discovery", (context) => context.json(oauthMetadata(context.env)));

router.get("/authorize", async (context) => {
  const user = await requireUser(context);
  const clientId = context.req.query("client_id") ?? "";
  const redirectUri = context.req.query("redirect_uri") ?? "";
  const responseType = context.req.query("response_type");
  const method = context.req.query("code_challenge_method");
  const challenge = context.req.query("code_challenge") ?? "";
  const state = context.req.query("state") ?? "";
  if (responseType !== "code" || method !== "S256" || challenge.length < 43)
    throw new HttpError(
      400,
      "invalid_request",
      "OAuth 2.1 requires response_type=code and PKCE S256.",
    );
  const scopes = parseScopes(context.req.query("scope") ?? "");
  const client = await clientForAuthorization(
    database(context.env),
    clientId,
    redirectUri,
    scopes,
  );
  const membership = await requireOrganizationRole(
    context,
    String(client.organizationId),
    ["owner", "admin", "member"],
  );
  if (
    membership.role === "member" &&
    scopes.some((scope) => scope.startsWith("write:"))
  )
    throw new HttpError(
      403,
      "write_consent_requires_admin",
      "Only an organization owner or admin may authorize write access.",
    );
  const events = await database(context.env)
    .prepare(
      "SELECT id,name FROM events WHERE organization_id=? ORDER BY starts_at DESC LIMIT 100",
    )
    .bind(client.organizationId)
    .all();
  return context.json({
    user: { name: user.name, email: user.email },
    client: { id: client.id, name: client.name },
    organizationId: client.organizationId,
    redirectUri,
    scopes,
    state,
    codeChallenge: challenge,
    codeChallengeMethod: method,
    events: events.results,
  });
});

router.post(
  "/authorize",
  zValidator("json", authorizeSchema),
  async (context) => {
    const user = await requireUser(context);
    const input = context.req.valid("json");
    const scopes = parseScopes(input.scope);
    const db = database(context.env);
    const client = await clientForAuthorization(
      db,
      input.clientId,
      input.redirectUri,
      scopes,
    );
    const membership = await requireOrganizationRole(
      context,
      String(client.organizationId),
      ["owner", "admin", "member"],
    );
    if (
      membership.role === "member" &&
      scopes.some((scope) => scope.startsWith("write:"))
    )
      throw new HttpError(
        403,
        "write_consent_requires_admin",
        "Only an organization owner or admin may authorize write access.",
      );
    if (input.eventIds.length) {
      const events = await db
        .prepare(
          `SELECT id FROM events WHERE organization_id=? AND id IN (${input.eventIds.map(() => "?").join(",")})`,
        )
        .bind(client.organizationId, ...input.eventIds)
        .all();
      if (events.results.length !== new Set(input.eventIds).size)
        throw new HttpError(
          400,
          "invalid_event_restriction",
          "Choose events from the authorized organization.",
        );
    }
    const redirect = new URL(input.redirectUri);
    redirect.searchParams.set("state", input.state);
    if (!input.approve) {
      redirect.searchParams.set("error", "access_denied");
      return context.json({ redirect: redirect.toString() });
    }
    const code = `pl_code_${randomToken(32)}`;
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          `INSERT INTO oauth_authorization_codes
           (id,code_hash,client_id,user_id,organization_id,redirect_uri,scopes_json,event_ids_json,code_challenge,expires_at)
           VALUES(?,?,?,?,?,?,?,?,?,datetime('now','+10 minutes'))`,
        )
        .bind(
          id,
          await sha256(code),
          input.clientId,
          user.id,
          client.organizationId,
          input.redirectUri,
          JSON.stringify(scopes),
          JSON.stringify(input.eventIds),
          input.codeChallenge,
        ),
      auditStatement(db, {
        organizationId: String(client.organizationId),
        actorUserId: user.id,
        action: "oauth.authorization_approved",
        entityType: "oauth_client",
        entityId: input.clientId,
        after: { scopes, eventIds: input.eventIds },
        requestId: context.get("requestId"),
      }),
    ]);
    redirect.searchParams.set("code", code);
    return context.json({ redirect: redirect.toString() });
  },
);

async function verifyClientSecret(
  client: Record<string, unknown>,
  supplied: unknown,
) {
  if (!client.clientSecretHash) return;
  if (!supplied || (await sha256(String(supplied))) !== client.clientSecretHash)
    throw new HttpError(401, "invalid_client", "Client authentication failed.");
}

async function issueOAuthTokens(
  db: D1Database,
  input: {
    clientId: string;
    userId: string;
    organizationId: string;
    scopes: DeveloperScope[];
    eventIds: string[];
  },
) {
  const accessToken = `pl_oauth_${randomToken(32)}`;
  const refreshToken = `pl_refresh_${randomToken(40)}`;
  const apiTokenId = crypto.randomUUID();
  const refreshId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO api_tokens
         (id,organization_id,name,token_prefix,token_hash,scopes_json,event_ids_json,hide_pii,expires_at,created_by)
         VALUES(?,?,?,?,?,?,?,?,datetime('now','+1 hour'),?)`,
      )
      .bind(
        apiTokenId,
        input.organizationId,
        `OAuth: ${input.clientId}`,
        accessToken.slice(0, 16),
        await sha256(accessToken),
        JSON.stringify(input.scopes),
        JSON.stringify(input.eventIds),
        1,
        input.userId,
      ),
    db
      .prepare(
        `INSERT INTO oauth_refresh_tokens
         (id,token_hash,api_token_id,client_id,user_id,organization_id,scopes_json,event_ids_json,expires_at)
         VALUES(?,?,?,?,?,?,?,?,datetime('now','+30 days'))`,
      )
      .bind(
        refreshId,
        await sha256(refreshToken),
        apiTokenId,
        input.clientId,
        input.userId,
        input.organizationId,
        JSON.stringify(input.scopes),
        JSON.stringify(input.eventIds),
      ),
  ]);
  return { accessToken, refreshToken, apiTokenId, refreshId };
}

router.post("/token", async (context) => {
  const body = await context.req.parseBody();
  const grantType = String(body.grant_type ?? "");
  const db = database(context.env);
  if (grantType === "authorization_code") {
    const clientId = String(body.client_id ?? "");
    const code = String(body.code ?? "");
    const redirectUri = String(body.redirect_uri ?? "");
    const verifier = String(body.code_verifier ?? "");
    if (verifier.length < 43 || verifier.length > 128)
      throw new HttpError(
        400,
        "invalid_grant",
        "A valid PKCE verifier is required.",
      );
    const authorization = await db
      .prepare(
        `SELECT c.id,c.client_id clientId,c.user_id userId,c.organization_id organizationId,
         c.redirect_uri redirectUri,c.scopes_json scopesJson,c.event_ids_json eventIdsJson,
         c.code_challenge codeChallenge,oc.client_secret_hash clientSecretHash
         FROM oauth_authorization_codes c JOIN oauth_clients oc ON oc.id=c.client_id
         WHERE c.code_hash=? AND c.used_at IS NULL AND c.expires_at>CURRENT_TIMESTAMP`,
      )
      .bind(await sha256(code))
      .first<Record<string, unknown>>();
    if (
      !authorization ||
      authorization.clientId !== clientId ||
      authorization.redirectUri !== redirectUri
    )
      throw new HttpError(
        400,
        "invalid_grant",
        "The authorization code is invalid or expired.",
      );
    await verifyClientSecret(authorization, body.client_secret);
    if ((await pkceS256Challenge(verifier)) !== authorization.codeChallenge)
      throw new HttpError(400, "invalid_grant", "PKCE verification failed.");
    const claimed = await db
      .prepare(
        "UPDATE oauth_authorization_codes SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL",
      )
      .bind(authorization.id)
      .run();
    if (!claimed.meta.changes)
      throw new HttpError(
        400,
        "invalid_grant",
        "The authorization code was already exchanged.",
      );
    let tokens;
    try {
      tokens = await issueOAuthTokens(db, {
        clientId,
        userId: String(authorization.userId),
        organizationId: String(authorization.organizationId),
        scopes: JSON.parse(String(authorization.scopesJson)),
        eventIds: JSON.parse(String(authorization.eventIdsJson)),
      });
    } catch (error) {
      await db
        .prepare("UPDATE oauth_authorization_codes SET used_at=NULL WHERE id=?")
        .bind(authorization.id)
        .run();
      throw error;
    }
    return context.json({
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: tokens.refreshToken,
      scope: (JSON.parse(String(authorization.scopesJson)) as string[]).join(
        " ",
      ),
    });
  }
  if (grantType === "refresh_token") {
    const refresh = await db
      .prepare(
        `SELECT r.id,r.api_token_id apiTokenId,r.client_id clientId,r.user_id userId,
         r.organization_id organizationId,r.scopes_json scopesJson,r.event_ids_json eventIdsJson,
         c.client_secret_hash clientSecretHash FROM oauth_refresh_tokens r JOIN oauth_clients c ON c.id=r.client_id
         WHERE r.token_hash=? AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at>CURRENT_TIMESTAMP`,
      )
      .bind(await sha256(String(body.refresh_token ?? "")))
      .first<Record<string, unknown>>();
    if (!refresh || refresh.clientId !== body.client_id)
      throw new HttpError(
        400,
        "invalid_grant",
        "The refresh token is invalid or expired.",
      );
    await verifyClientSecret(refresh, body.client_secret);
    const claimed = await db
      .prepare(
        "UPDATE oauth_refresh_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL",
      )
      .bind(refresh.id)
      .run();
    if (!claimed.meta.changes)
      throw new HttpError(
        400,
        "invalid_grant",
        "The refresh token was already rotated.",
      );
    let tokens;
    try {
      tokens = await issueOAuthTokens(db, {
        clientId: String(refresh.clientId),
        userId: String(refresh.userId),
        organizationId: String(refresh.organizationId),
        scopes: JSON.parse(String(refresh.scopesJson)),
        eventIds: JSON.parse(String(refresh.eventIdsJson)),
      });
      await db.batch([
        db
          .prepare(
            "UPDATE oauth_refresh_tokens SET replaced_by_id=? WHERE id=?",
          )
          .bind(tokens.refreshId, refresh.id),
        db
          .prepare(
            "UPDATE api_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND revoked_at IS NULL",
          )
          .bind(refresh.apiTokenId),
      ]);
    } catch (error) {
      await db
        .prepare("UPDATE oauth_refresh_tokens SET used_at=NULL WHERE id=?")
        .bind(refresh.id)
        .run();
      throw error;
    }
    return context.json({
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: tokens.refreshToken,
      scope: (JSON.parse(String(refresh.scopesJson)) as string[]).join(" "),
    });
  }
  throw new HttpError(
    400,
    "unsupported_grant_type",
    "Use authorization_code or refresh_token.",
  );
});

router.post("/revoke", async (context) => {
  const body = await context.req.parseBody();
  const token = String(body.token ?? "");
  const clientId = String(body.client_id ?? "");
  const client = await database(context.env)
    .prepare(
      "SELECT client_secret_hash clientSecretHash FROM oauth_clients WHERE id=? AND revoked_at IS NULL",
    )
    .bind(clientId)
    .first<Record<string, unknown>>();
  if (!client)
    throw new HttpError(401, "invalid_client", "OAuth client not found.");
  await verifyClientSecret(client, body.client_secret);
  const hash = await sha256(token);
  const db = database(context.env);
  await db.batch([
    db
      .prepare(
        "UPDATE api_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?",
      )
      .bind(hash),
    db
      .prepare(
        "UPDATE oauth_refresh_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=? AND client_id=?",
      )
      .bind(hash, clientId),
  ]);
  return context.json({ revoked: true });
});

export default router;
