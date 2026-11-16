/**
 * Moves manuscript hidden checks into the quiz, so that its manuscript phase has Manchu words.
 *
 * Usage: npm run move-checks-to-quiz -w server -- --count 100 [--dry-run]
 *
 * `--count` is the total that should be in the quiz, so running it again only moves the difference.
 * Words are chosen at random from active Manchu checks in manuscript volumes that nobody has been given
 * or labelled, since a word whose answer the quiz shows can never be a fair check. Each moved check is
 * kept with the state `quiz`, so it is never handed out or graded as a check again, and releases leave
 * it out. The quiz image is a copy of the crop under a new random name, so its address says nothing
 * about the crop.
 */

import { randomInt, randomUUID } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { manchuToAbkai } from "@manchu-labelling/script";
import mongoose, { type Types } from "mongoose";

import { connectDatabase } from "../db.ts";
import { WordImage, WordInstance } from "../models/crops.ts";
import { Dispute } from "../models/disputes.ts";
import { Annotation, Assignment, KnownLabel } from "../models/labels.ts";
import { Page, Volume } from "../models/sources.ts";
import { TrainingItem } from "../models/training.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

/** Shuffles with a cryptographic random source, so the choice cannot be predicted. */
function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [items[index], items[other]] = [items[other] as T, items[index] as T];
  }
  return items;
}

/** The quiz's source line, in the same form as the other manuscript quiz images. */
function sourceFor(volume: { title: string; rights?: { attribution?: string | null; permanentLink?: string | null } | null }, origin: string) {
  const reading = origin.split(", confirmed")[0];
  return `${volume.rights?.attribution} (${volume.title}), ${volume.rights?.permanentLink}, public domain; reading from ${reading}, confirmed against the scan`;
}

export async function moveChecksToQuiz(options: { count: number; storageDirectory: string; dryRun?: boolean }) {
  const already = await KnownLabel.countDocuments({ state: "quiz" });
  const wanted = Math.max(0, options.count - already);

  const volumes = await Volume.find({ production: "manuscript" }).lean();
  const volumeById = new Map(volumes.map((volume) => [String(volume._id), volume]));
  const pages = await Page.find({ volume: { $in: volumes.map(({ _id }) => _id) } }, "volume").lean();
  const volumeOfPage = new Map(pages.map(({ _id, volume }) => [String(_id), String(volume)]));
  const crops = await WordImage.find({ page: { $in: pages.map(({ _id }) => _id) } }, "_id").lean();

  const known = await KnownLabel.find({
    state: "active",
    category: "manchu",
    wordImage: { $in: crops.map(({ _id }) => _id) },
  }).lean();
  const ids = known.map(({ wordImage }) => wordImage);
  const [labelled, assigned, disputed, usable] = await Promise.all([
    Annotation.distinct("wordImage", { wordImage: { $in: ids } }),
    Assignment.distinct("wordImage", { wordImage: { $in: ids } }),
    Dispute.distinct("wordImage", { wordImage: { $in: ids } }),
    WordInstance.distinct("canonicalCrop", { canonicalCrop: { $in: ids }, retired: { $ne: true } }),
  ]);
  const seen = new Set([...labelled, ...assigned, ...disputed].map(String));
  const usableIds = new Set(usable.map(String));
  const eligible = known.filter(({ wordImage }) => !seen.has(String(wordImage)) && usableIds.has(String(wordImage)));
  const chosen = shuffle([...eligible]).slice(0, wanted);
  const summary = { already, eligible: eligible.length, moved: chosen.length, remainingChecks: known.length - chosen.length };
  if (options.dryRun || chosen.length === 0) return summary;

  const images = await WordImage.find({ _id: { $in: chosen.map(({ wordImage }) => wordImage) } }).lean();
  const imageById = new Map(images.map((image) => [String(image._id), image]));
  for (const answer of chosen) {
    const crop = imageById.get(String(answer.wordImage));
    const volume = volumeById.get(volumeOfPage.get(String(crop?.page)) ?? "");
    if (!crop || !volume || !answer.manchu) throw new Error(`Missing crop, volume, or answer for ${answer.wordImage}`);
    const imageKey = `${randomUUID()}${extname(crop.imageKey)}`;
    await copyFile(join(options.storageDirectory, crop.imageKey), join(options.storageDirectory, imageKey));
    const item = await TrainingItem.create({
      scriptClass: volume.script,
      kind: "manuscript",
      category: "manchu",
      manchu: answer.manchu,
      abkai: manchuToAbkai(answer.manchu).text,
      imageKey,
      source: sourceFor(volume, answer.origin),
    });
    // Only an active check moves, so that a check changed in the meantime is left alone.
    const moved = await KnownLabel.updateOne(
      { _id: answer._id as Types.ObjectId, state: "active" },
      { state: "quiz", quizItem: item._id },
    );
    if (moved.modifiedCount !== 1) await TrainingItem.updateOne({ _id: item._id }, { active: false });
  }
  return summary;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { count: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1) throw new Error("Usage: move-checks-to-quiz --count <number> [--dry-run]");
  await connectDatabase();
  const summary = await moveChecksToQuiz({
    count,
    dryRun: values["dry-run"],
    storageDirectory: process.env.STORAGE_DIRECTORY ?? resolve(ROOT, "data/storage"),
  });
  console.log(`${values["dry-run"] ? "Would move" : "Moved"} ${summary.moved} checks to the quiz.`, summary);
  await mongoose.disconnect();
}

if (process.argv[1] === import.meta.filename) await main();
