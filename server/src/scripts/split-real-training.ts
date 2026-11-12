/**
 * Moves quiz images from before the quiz had phases into a phase. Real Manchu images were all printed,
 * and the only real images that were not Manchu were crops from a manuscript.
 *
 * Usage: npm run split-real-training -w server
 *
 * Running it again changes nothing. Answers are append-only and keep saying "real", and they do not
 * count towards any phase.
 */

import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { TrainingItem } from "../models/training.ts";

// The raw collection is used because "real" is no longer a kind that the model accepts.
export async function splitRealTraining(): Promise<{ printed: number; manuscript: number }> {
  const printed = await TrainingItem.collection.updateMany(
    { kind: "real", category: "manchu" },
    { $set: { kind: "printed" } },
  );
  const manuscript = await TrainingItem.collection.updateMany(
    { kind: "real", category: { $ne: "manchu" } },
    { $set: { kind: "manuscript" } },
  );
  return { printed: printed.modifiedCount, manuscript: manuscript.modifiedCount };
}

async function main(): Promise<void> {
  await connectDatabase();
  const { printed, manuscript } = await splitRealTraining();
  console.log(`Moved ${printed} images to printed and ${manuscript} to manuscript`);
  await mongoose.disconnect();
}

if (process.argv[1] === import.meta.filename) await main();
