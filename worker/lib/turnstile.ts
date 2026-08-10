import type { Env } from "../env";

export async function verifyTurnstile(env: Env, token: string | undefined, remoteIp: string | undefined): Promise<boolean> {
  if (env.APP_ENV !== "production" && !env.TURNSTILE_SECRET_KEY) return true;
  if (!env.TURNSTILE_SECRET_KEY || !token) return false;

  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}
