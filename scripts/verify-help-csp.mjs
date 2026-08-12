import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(
  resolve(root, "dist/client/help/index.html"),
  "utf8",
);
const worker = await readFile(resolve(root, "worker/index.ts"), "utf8");
const inlineScripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter(Boolean);

if (!inlineScripts.length)
  throw new Error(
    "The help build did not contain the expected startup scripts.",
  );

for (const script of inlineScripts) {
  const hash = createHash("sha256").update(script).digest("base64");
  if (!worker.includes(`sha256-${hash}`))
    throw new Error(
      `The help center emitted an inline script that is missing from the Content Security Policy: sha256-${hash}`,
    );
}

console.log(`Verified ${inlineScripts.length} help-center CSP hashes.`);
