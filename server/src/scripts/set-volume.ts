/**
 * Sets a volume's split, license, or rights status, which a release needs.
 *
 * Usage: npm run set-volume -w server -- <sourceId> [--split train|validation|test]
 *          [--license PDM-1.0] [--rights cleared|excluded|unreviewed]
 *
 * Only volumes whose rights are `cleared` are released. A volume's split is fixed once a release has
 * used it, so that a model trained on one release is never tested on its own training data.
 */

import { parseArgs } from "node:util";

import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { Release } from "../models/releases.ts";
import { SPLITS, Volume } from "../models/sources.ts";

const RIGHTS = ["unreviewed", "cleared", "excluded"];

export async function setVolume(
  sourceId: string,
  changes: { split?: string; license?: string; rights?: string },
): Promise<void> {
  if (changes.split && !(SPLITS as readonly string[]).includes(changes.split)) {
    throw new Error(`The split must be one of ${SPLITS.join(", ")}`);
  }
  if (changes.rights && !RIGHTS.includes(changes.rights)) {
    throw new Error(`The rights status must be one of ${RIGHTS.join(", ")}`);
  }
  const volume = await Volume.findOne({ sourceId });
  if (!volume) throw new Error(`No volume ${sourceId}`);
  if (changes.split && volume.split && changes.split !== volume.split) {
    const used = await Release.findOne({ "volumes.volume": volume._id }, "version").lean();
    if (used) throw new Error(`Release ${used.version} used ${sourceId} as ${volume.split}, so it cannot change`);
  }
  await Volume.updateOne(
    { _id: volume._id },
    {
      ...(changes.split ? { split: changes.split } : {}),
      ...(changes.license ? { "rights.license": changes.license } : {}),
      ...(changes.rights ? { "rights.status": changes.rights } : {}),
    },
  );
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { split: { type: "string" }, license: { type: "string" }, rights: { type: "string" } },
  });
  const [sourceId] = positionals;
  if (!sourceId) throw new Error("Usage: set-volume <sourceId> [--split ...] [--license ...] [--rights ...]");
  await connectDatabase();
  await setVolume(sourceId, values);
  const volume = await Volume.findOne({ sourceId }).lean();
  console.log(`${sourceId}: split ${volume?.split ?? "unset"}, license ${volume?.rights?.license ?? "unset"}, rights ${volume?.rights?.status}`);
  await mongoose.disconnect();
}

if (process.argv[1] === import.meta.filename) await main();
