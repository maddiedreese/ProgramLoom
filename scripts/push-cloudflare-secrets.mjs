import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";

loadEnvFile(".env.local");

const secretNames = [
  "AIRTABLE_ACCESS_TOKEN",
  "AIRTABLE_BASE_ID",
  "DEVELOPER_SECRET_KEY",
  "ENCRYPTION_KEY",
  "POSTHOG_KEY",
  "RESEND_API_KEY",
  "SESSION_SECRET",
  "TURNSTILE_SECRET_KEY",
];

// RESEND_WEBHOOK_SECRET is endpoint-specific and is rotated directly between
// Resend and Cloudflare. Keeping it out of this bulk helper prevents an older
// local value from replacing the active endpoint secret.
let uploaded = 0;
for (const secretName of secretNames) {
  const secretValue = process.env[secretName];
  if (!secretValue) {
    console.error(`Skipping unset value: ${secretName}`);
    continue;
  }
  const result = spawnSync(
    "npx",
    ["wrangler", "secret", "put", secretName],
    { input: secretValue, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Cloudflare rejected ${secretName}.`);
  uploaded += 1;
}

console.log(`Uploaded ${uploaded} ProgramLoom secrets without printing their values.`);
