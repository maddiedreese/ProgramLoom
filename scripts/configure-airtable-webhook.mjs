import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const env = await loadLocalEnv();
const token = env.AIRTABLE_ACCESS_TOKEN;
const baseId = env.AIRTABLE_BASE_ID;
if (!token || !baseId)
  throw new Error(
    "AIRTABLE_ACCESS_TOKEN and AIRTABLE_BASE_ID are required in .env.local.",
  );

const pathSecret = randomBytes(32).toString("base64url");
putWorkerSecret("AIRTABLE_WEBHOOK_PATH_SECRET", pathSecret);

const notificationUrl = `https://app.programloom.com/api/integrations/airtable/webhook/${pathSecret}`;
const response = await fetch(
  `https://api.airtable.com/v0/bases/${baseId}/webhooks`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      notificationUrl,
      specification: {
        options: {
          filters: {
            dataTypes: ["tableData"],
            changeTypes: ["add", "update", "remove"],
            // Worker-originated API writes must not echo back into the queue.
            fromSources: ["client"],
          },
        },
      },
    }),
  },
);
if (!response.ok)
  throw new Error(
    `Airtable webhook creation failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
  );
const webhook = await response.json();
if (!webhook.id || !webhook.macSecretBase64)
  throw new Error("Airtable did not return a webhook ID and MAC secret.");

putWorkerSecret("AIRTABLE_WEBHOOK_MAC_SECRET", webhook.macSecretBase64);
putWorkerSecret("AIRTABLE_WEBHOOK_ID", webhook.id);
console.log(
  "Configured the ProgramLoom Airtable webhook and deployed its three Worker secrets without printing secret values.",
);

function putWorkerSecret(name, value) {
  const result = spawnSync("npx", ["wrangler", "secret", "put", name], {
    cwd: new URL("..", import.meta.url),
    input: value,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(
      `Could not deploy ${name}: ${(result.stderr || result.stdout).slice(0, 500)}`,
    );
  console.log(`Deployed ${name}.`);
}

async function loadLocalEnv() {
  const source = await readFile(
    new URL("../.env.local", import.meta.url),
    "utf8",
  );
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        return [line.slice(0, index), value];
      }),
  );
}
