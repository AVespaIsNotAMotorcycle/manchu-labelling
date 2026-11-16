import { manchuToAbkai } from "@manchu-labelling/script";
import { Types } from "mongoose";

import { canSettle, settleImages, type LatestLabel } from "./consensus.ts";
import type { ParsedAnswer } from "./label-input.ts";
import { WordInstance } from "./models/crops.ts";
import { KnownLabel, LabelReview } from "./models/labels.ts";
import { instancesUnderReview } from "./crop-reviews.ts";

type Id = Types.ObjectId;

export class ReviewError extends Error {}

export interface Reading {
  category: string;
  manchu?: string;
  abkai?: string;
  /** Labelers who gave this reading. */
  count: number;
  /** Of those, how many were unsure or left a letter unreadable. */
  unsure: number;
}

/** The readings given for an image, without names, most common first. */
export function groupReadings(labels: readonly LatestLabel[]): Reading[] {
  const groups = new Map<string, Reading>();
  for (const label of labels) {
    const manchu = label.category === "manchu" ? label.transcription?.manchu : undefined;
    const key = `${label.category}:${manchu ?? ""}`;
    const reading = groups.get(key) ?? {
      category: label.category,
      ...(manchu ? { manchu, abkai: manchuToAbkai(manchu).text } : {}),
      count: 0,
      unsure: 0,
    };
    reading.count += 1;
    reading.unsure += canSettle(label) ? 0 : 1;
    groups.set(key, reading);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * Images whose labels did not settle them, for a reviewer. Hidden checks are left out, since their
 * answers are known, and so are images the reviewer labelled themselves.
 */
export async function imagesForReview(reviewer: Id, limit = 50) {
  const settlements = await settleImages();
  const waiting = [...settlements].filter(([, { status }]) => status === "needs_review");
  const ids = waiting.map(([id]) => new Types.ObjectId(id));
  const underReview = await instancesUnderReview();
  const [known, usable] = await Promise.all([
    KnownLabel.distinct("wordImage", { wordImage: { $in: ids }, state: { $ne: "withdrawn" } }),
    // Retired words and words with competing crops are not reviewed until an admin rules on them.
    WordInstance.distinct("canonicalCrop", {
      canonicalCrop: { $in: ids },
      retired: { $ne: true },
      _id: { $nin: underReview },
    }),
  ]);
  const usableIds = new Set(usable.map(String));
  const knownIds = new Set(known.map(String));
  return waiting
    .filter(
      ([id, { labels }]) =>
        usableIds.has(id) && !knownIds.has(id) && !labels.some(({ user }) => user.equals(reviewer)),
    )
    .slice(0, limit)
    .map(([id, { labels }]) => ({ wordImage: new Types.ObjectId(id), readings: groupReadings(labels) }));
}

/** Records a reviewer's final answer for an image that is waiting for review. */
export async function reviewLabels(wordImage: Id, reviewer: Id, answer: ParsedAnswer): Promise<void> {
  const settlement = (await settleImages({ images: [wordImage] })).get(String(wordImage));
  if (settlement?.status !== "needs_review") throw new ReviewError("This image is not waiting for review");
  if (settlement.labels.some(({ user }) => user.equals(reviewer))) {
    throw new ReviewError("You cannot review an image you labelled");
  }
  await LabelReview.create({ wordImage, reviewer, category: answer.category, transcription: answer.transcription });
}
