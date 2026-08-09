import { zValidator } from "@hono/zod-validator";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { randomToken, sha256 } from "../lib/crypto";
import { sendMagicLink } from "../lib/email";
import { verifyTurnstile } from "../lib/turnstile";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const requestSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  name: z.string().trim().min(2).max(120).optional(),
  mode: z.enum(["login", "register"]),
  turnstileToken: z.string().optional(),
});

router.post("/request", zValidator("json", requestSchema), async (context) => {
  const db = requireDatabase(context.env);
  const input = context.req.valid("json");
  const turnstileValid = await verifyTurnstile(context.env, input.turnstileToken, context.req.header("cf-connecting-ip"));
  if (!turnstileValid) return context.json({ error: { code: "challenge_failed", message: "Please complete the security check." } }, 400);

  const existing = await db.prepare("SELECT id, name FROM users WHERE email = ? COLLATE NOCASE").bind(input.email).first<{ id: string; name: string }>();
  if (input.mode === "register" && existing) {
    return context.json({ error: { code: "account_exists", message: "An account already exists for this email. Sign in instead." } }, 409);
  }

  // Login requests intentionally return the same response for unknown addresses.
  if (input.mode === "login" && !existing) return context.json({ ok: true, message: "If an account exists, a secure link is on its way." });
  if (input.mode === "register" && !input.name) return context.json({ error: { code: "name_required", message: "Enter your full name." } }, 400);

  const rawToken = randomToken();
  const tokenHash = await sha256(rawToken);
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const purpose = input.mode;

  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE email = ? COLLATE NOCASE AND purpose = ? AND consumed_at IS NULL").bind(input.email, purpose),
    db.prepare("INSERT INTO auth_challenges (id, email, purpose, token_hash, redirect_path, expires_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(challengeId, input.email, purpose, tokenHash, "/app", expiresAt, JSON.stringify({ name: input.name })),
  ]);

  const magicLink = `${context.env.APP_URL}/api/auth/verify?token=${encodeURIComponent(rawToken)}`;
  try {
    await sendMagicLink(context.env, { email: input.email, name: input.name ?? existing?.name, magicLink, purpose });
  } catch (error) {
    await db.prepare("DELETE FROM auth_challenges WHERE id = ?").bind(challengeId).run();
    throw error;
  }

  return context.json({ ok: true, message: "Check your inbox for a secure link. It expires in 15 minutes." });
});

router.get("/verify", async (context) => {
  const db = requireDatabase(context.env);
  const rawToken = context.req.query("token");
  if (!rawToken) return context.redirect(`${context.env.APP_URL}/login?error=invalid_link`);
  const tokenHash = await sha256(rawToken);
  const challenge = await db.prepare(
    "SELECT id, email, purpose, redirect_path, expires_at, consumed_at, metadata_json FROM auth_challenges WHERE token_hash = ?",
  ).bind(tokenHash).first<{ id: string; email: string; purpose: string; redirect_path: string; expires_at: string; consumed_at: string | null; metadata_json: string }>();

  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
    return context.redirect(`${context.env.APP_URL}/login?error=expired_link`);
  }

  let user = await db.prepare("SELECT id, email, name FROM users WHERE email = ? COLLATE NOCASE").bind(challenge.email).first<{ id: string; email: string; name: string }>();
  if (!user && challenge.purpose === "register") {
    const metadata = JSON.parse(challenge.metadata_json) as { name?: string };
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO users (id, email, name, email_verified_at) VALUES (?, ?, ?, ?)")
      .bind(id, challenge.email, metadata.name ?? challenge.email.split("@")[0], new Date().toISOString()).run();
    user = { id, email: challenge.email, name: metadata.name ?? challenge.email.split("@")[0] };
  }
  if (!user) return context.redirect(`${context.env.APP_URL}/login?error=invalid_link`);

  const sessionToken = randomToken();
  const sessionHash = await sha256(sessionToken);
  const sessionId = crypto.randomUUID();
  const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  await db.batch([
    db.prepare("UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").bind(new Date().toISOString(), challenge.id),
    db.prepare("INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)").bind(sessionId, user.id, sessionHash, sessionExpires.toISOString()),
  ]);

  setCookie(context, "programloom_session", sessionToken, {
    httpOnly: true,
    secure: context.env.APP_ENV === "production",
    sameSite: "Lax",
    path: "/",
    expires: sessionExpires,
  });
  return context.redirect(`${context.env.APP_URL}${challenge.redirect_path}`);
});

router.get("/session", async (context) => {
  const db = requireDatabase(context.env);
  const token = getCookie(context, "programloom_session");
  if (!token) return context.json({ user: null });
  const tokenHash = await sha256(token);
  const user = await db.prepare(
    `SELECT u.id, u.email, u.name
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  ).bind(tokenHash, new Date().toISOString()).first<{ id: string; email: string; name: string }>();
  return context.json({ user: user ?? null });
});

router.post("/logout", async (context) => {
  const db = requireDatabase(context.env);
  const token = getCookie(context, "programloom_session");
  if (token) await db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), await sha256(token)).run();
  deleteCookie(context, "programloom_session", { path: "/" });
  return context.json({ ok: true });
});

function requireDatabase(env: Env): D1Database {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  return env.DB;
}

export default router;
