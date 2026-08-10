const encoder = new TextEncoder();

export async function verifyResendWebhook(
  secret: string,
  headers: { id: string; timestamp: string; signature: string },
  body: string,
  now = Date.now(),
) {
  const timestamp = Number(headers.timestamp);
  if (!headers.id || !Number.isFinite(timestamp)) return false;
  if (Math.abs(now / 1000 - timestamp) > 5 * 60) return false;
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(rawSecret), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.slice().buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${headers.id}.${headers.timestamp}.${body}`),
    ),
  );
  const expected = btoa(String.fromCharCode(...digest));
  return headers.signature
    .split(" ")
    .map((part) => part.trim())
    .some((part) => {
      const [version, signature] = part.split(",", 2);
      return version === "v1" && signature
        ? timingSafeEqual(signature, expected)
        : false;
    });
}

function timingSafeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1)
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}
