import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { verifyAirtableWebhook } from "./airtable";

describe("Airtable webhook verification", () => {
  it("accepts the matching Airtable HMAC and rejects altered payloads", async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const encodedSecret = btoa(String.fromCharCode(...secret));
    const body = JSON.stringify({ base: { id: "appProgramLoom" } });
    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    );
    const mac = `hmac-sha256=${[...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
    const env = { AIRTABLE_WEBHOOK_MAC_SECRET: encodedSecret } as Env;

    await expect(verifyAirtableWebhook(env, body, mac)).resolves.toBe(true);
    await expect(verifyAirtableWebhook(env, `${body} `, mac)).resolves.toBe(
      false,
    );
    await expect(verifyAirtableWebhook(env, body, undefined)).resolves.toBe(
      false,
    );
  });
});
