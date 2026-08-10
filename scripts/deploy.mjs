import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const workspace = resolve(fileURLToPath(new URL("../", import.meta.url)));
const releaseCommit = process.env.RELEASE_COMMIT ?? "";

if (!/^[0-9a-f]{40}$/.test(releaseCommit))
  throw new Error(
    "RELEASE_COMMIT must be the exact 40-character lowercase Git commit being deployed.",
  );

execFileSync("npm", ["run", "build"], {
  cwd: workspace,
  stdio: "inherit",
  env: process.env,
});
execFileSync(
  resolve(workspace, "node_modules/.bin/wrangler"),
  ["deploy", "--var", `RELEASE_COMMIT:${releaseCommit}`],
  {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler.log" },
  },
);
