import { describe, expect, it } from "vitest";
import { verifyResendWebhook } from "./resendWebhook";

describe("Resend webhook verification", () => {
  it("accepts a current valid signature and rejects tampering", async () => {
    const secretBytes = new TextEncoder().encode("test-signing-secret");
    const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`;
    const id = "msg_test";
    const timestamp = "1700000000";
    const body = '{"type":"email.delivered"}';
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes.slice().buffer as ArrayBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${id}.${timestamp}.${body}`),
      ),
    );
    const signature = `v1,${btoa(String.fromCharCode(...digest))}`;
    const headers = { id, timestamp, signature };
    expect(
      await verifyResendWebhook(secret, headers, body, 1_700_000_000_000),
    ).toBe(true);
    expect(
      await verifyResendWebhook(secret, headers, `${body}x`, 1_700_000_000_000),
    ).toBe(false);
  });
});
