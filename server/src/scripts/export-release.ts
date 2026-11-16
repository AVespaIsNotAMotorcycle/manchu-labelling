/**
 * Writes a release of the dataset to a new folder and records it.
 *
 * Usage: ANNOTATOR_ID_SECRET=... npm run export-release -w server -- 0.1.0 [--out <folder>] [--license <name>]
 *
 * The folder defaults to data/releases/<version>. ANNOTATOR_ID_SECRET turns user IDs into annotator
 * IDs, and must stay the same for every release so that IDs match across them. Keep it secret.
 * Only volumes whose rights are cleared and that have a split are included (see set-volume).
 * Afterwards, upload the folder and record its DOI with set-release-doi.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { exportRelease, ReleaseError } from "../release.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

function currentCommit(): string | undefined {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
    return dirty ? `${commit}-dirty` : commit;
  } catch {
    return undefined;
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, license: { type: "string" } },
});
const [version] = positionals;
if (!version) throw new Error("Usage: export-release <version> [--out <folder>] [--license <name>]");
const secret = process.env.ANNOTATOR_ID_SECRET;
if (!secret) throw new Error("Set ANNOTATOR_ID_SECRET, and keep it the same for every release");

await connectDatabase();
try {
  const outDir = resolve(values.out ?? resolve(ROOT, "data/releases", version));
  const counts = await exportRelease({
    version,
    outDir,
    secret,
    license: values.license,
    commit: currentCommit(),
    storageDirectory: process.env.STORAGE_DIRECTORY ?? resolve(ROOT, "data/storage"),
  });
  console.log(`Wrote release ${version} to ${outDir}`);
  console.log(JSON.stringify(counts, null, 2));
} catch (error) {
  if (!(error instanceof ReleaseError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
