import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const chunksDirectory = new URL(
  "../dist/client/help/assets/chunks/",
  import.meta.url,
);
const entries = await readdir(chunksDirectory);
const generatedIndexes = entries.filter(
  (entry) => entry.startsWith("@localSearchIndex") && entry.endsWith(".js"),
);

if (generatedIndexes.length !== 1) {
  throw new Error(
    `Expected one generated help search index, found ${generatedIndexes.length}.`,
  );
}

const originalName = generatedIndexes[0];
const publicName = originalName.slice(1);
await rename(
  new URL(originalName, chunksDirectory),
  new URL(publicName, chunksDirectory),
);

let replacementCount = 0;
for (const entry of entries) {
  if (!entry.endsWith(".js") || entry === originalName) continue;
  const file = join(fileURLToPath(chunksDirectory), entry);
  const source = await readFile(file, "utf8");
  const normalized = source.replaceAll(originalName, publicName);
  if (normalized === source) continue;
  replacementCount += 1;
  await writeFile(file, normalized);
}

if (replacementCount < 1) {
  throw new Error("The generated help search index had no import reference.");
}

console.log(`Normalized the help search index for Cloudflare Assets.`);
