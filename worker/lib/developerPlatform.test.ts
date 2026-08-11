import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  decryptDeveloperSecret,
  encryptDeveloperSecret,
  requestHash,
  signWebhook,
} from "./developerPlatform";

describe("developer platform cryptography", () => {
  it("encrypts webhook secrets at rest with authenticated encryption", async () => {
    const env = { DEVELOPER_SECRET_KEY: "test-key-material" } as Env;
    const ciphertext = await encryptDeveloperSecret(env, "whsec_private");

    expect(ciphertext).not.toContain("whsec_private");
    await expect(decryptDeveloperSecret(env, ciphertext)).resolves.toBe(
      "whsec_private",
    );
    await expect(
      decryptDeveloperSecret(
        { DEVELOPER_SECRET_KEY: "different-key" } as Env,
        ciphertext,
      ),
    ).rejects.toBeTruthy();
  });

  it("signs the timestamp and exact body deterministically", async () => {
    const first = await signWebhook("secret", "1700000000", '{"id":"1"}');
    const replay = await signWebhook("secret", "1700000000", '{"id":"1"}');
    const changed = await signWebhook("secret", "1700000001", '{"id":"1"}');

    expect(first).toBe(replay);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("binds idempotency records to the complete request body", async () => {
    await expect(
      requestHash({ title: "Safe systems", eventId: "e1" }),
    ).resolves.toBe(
      await requestHash({ title: "Safe systems", eventId: "e1" }),
    );
    await expect(
      requestHash({ title: "Changed", eventId: "e1" }),
    ).resolves.not.toBe(
      await requestHash({ title: "Safe systems", eventId: "e1" }),
    );
  });
});
