/**
 * Chooses the held-back words for volumes imported before words were held back at import.
 *
 * Usage: npm run hold-back -w server
 *
 * Only words with no choice yet are changed, so running it again does nothing. Each word is held back
 * at random with the same rate as at import, and the choice never looks at labels.
 */

import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { chooseHeldBack } from "../held-back.ts";
import { WordInstance } from "../models/crops.ts";

export async function holdBackUnchosen(random?: () => number): Promise<{ chosen: number; heldBack: number }> {
  const ids = await WordInstance.distinct("_id", { heldBack: { $exists: false } });
  const held: unknown[] = [];
  const kept: unknown[] = [];
  for (const id of ids) (chooseHeldBack(random) ? held : kept).push(id);
  await WordInstance.updateMany({ _id: { $in: held }, heldBack: { $exists: false } }, { heldBack: true });
  await WordInstance.updateMany({ _id: { $in: kept }, heldBack: { $exists: false } }, { heldBack: false });
  return { chosen: ids.length, heldBack: held.length };
}

async function main(): Promise<void> {
  await connectDatabase();
  const { chosen, heldBack } = await holdBackUnchosen();
  const total = await WordInstance.countDocuments({ heldBack: true });
  console.log(`Chose for ${chosen} words: ${heldBack} held back. ${total} words are held back in all.`);
  await mongoose.disconnect();
}

if (process.argv[1] === import.meta.filename) await main();
