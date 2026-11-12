import { randomInt } from "node:crypto";

import { UNREADABLE } from "@manchu-labelling/script";
import type { Types } from "mongoose";

import { passesCheck } from "./checks.ts";
import { WordInstance } from "./models/crops.ts";
import { Annotation, HeldBackReview, KnownLabel, type Category } from "./models/labels.ts";

/** The share of words held back from releases, to become hidden checks. */
export const HOLD_BACK_RATE = 0.15;

/**
 * Chooses whether a new word is held back. It uses a cryptographic random source, since a choice that
 * could be predicted from anything a user sees would reveal future checks.
 */
export function chooseHeldBack(random: () => number = () => randomInt(1_000_000) / 1_000_000): boolean {
  return random() < HOLD_BACK_RATE;
}

/** Labels that must all agree before a held-back image's answer goes to an admin. */
export const LABELERS_TO_AGREE = 3;

export interface Agreement {
  wordImage: Types.ObjectId;
  category: Category;
  manchu?: string;
  labelers: Types.ObjectId[];
}

interface LatestLabel {
  user: Types.ObjectId;
  category: Category;
  transcription?: { manchu: string } | null;
  confidence?: { category?: string | null; transcription?: string | null } | null;
}

/**
 * The answer that every labeler gave, if at least 3 labelled the image, all of them exactly agree on the
 * category and letters, nobody marked themselves unsure, and no letter is unreadable. Otherwise null.
 */
export function agreedAnswer(labels: readonly LatestLabel[]): Omit<Agreement, "wordImage"> | null {
  if (labels.length < LABELERS_TO_AGREE) return null;
  const [first] = labels as [LatestLabel];
  const manchu = first.category === "manchu" ? first.transcription?.manchu : undefined;
  if (first.category === "manchu" && (!manchu || manchu.includes(UNREADABLE))) return null;
  for (const label of labels) {
    if (label.confidence?.category === "unconfident") return null;
    if (first.category === "manchu" && label.confidence?.transcription === "unconfident") return null;
    if (!passesCheck({ category: first.category, manchu }, label)) return null;
  }
  return { category: first.category, manchu, labelers: labels.map(({ user }) => user) };
}

/** Held-back images whose labelers agree, and which no admin has reviewed yet, oldest word first. */
export async function agreementsToReview(limit = 50): Promise<Agreement[]> {
  const crops = (await WordInstance.distinct("canonicalCrop", {
    heldBack: true,
    retired: { $ne: true },
  })) as Types.ObjectId[];
  const [known, reviewed] = await Promise.all([
    KnownLabel.distinct("wordImage", { wordImage: { $in: crops } }),
    HeldBackReview.distinct("wordImage", { wordImage: { $in: crops } }),
  ]);
  const done = new Set([...known, ...reviewed].map(String));
  const open = crops.filter((crop) => !done.has(String(crop)));
  const labels = await Annotation.find(
    { wordImage: { $in: open } },
    "wordImage user category transcription confidence",
  )
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  // Each user's latest label counts, so a correction replaces what it corrects.
  const latest = new Map<string, Map<string, LatestLabel>>();
  for (const label of labels) {
    const image = String(label.wordImage);
    if (!latest.has(image)) latest.set(image, new Map());
    latest.get(image)?.set(String(label.user), label);
  }
  const agreements: Agreement[] = [];
  for (const crop of open) {
    const answer = agreedAnswer([...(latest.get(String(crop))?.values() ?? [])]);
    if (answer) agreements.push({ wordImage: crop, ...answer });
    if (agreements.length >= limit) break;
  }
  return agreements;
}

/**
 * Records an admin's decision. The answer must still be the one the admin saw, since a labeler may have
 * corrected their label in the meantime. A yes makes the image an active hidden check.
 */
export async function reviewAgreement(
  wordImage: Types.ObjectId,
  reviewer: Types.ObjectId,
  decision: "yes" | "no",
  seen: { category: string; manchu?: string },
): Promise<void> {
  const [agreement] = (await agreementsToReview(Number.MAX_SAFE_INTEGER)).filter(({ wordImage: id }) =>
    id.equals(wordImage),
  );
  if (!agreement) throw new Error("This image is not waiting for review");
  if (agreement.category !== seen.category || (agreement.manchu ?? undefined) !== (seen.manchu ?? undefined)) {
    throw new Error("The labels changed while you were reviewing. Please look again.");
  }
  const { category, manchu, labelers } = agreement;
  if (decision === "yes") {
    await KnownLabel.create({
      wordImage,
      category,
      manchu,
      origin: `Held-back word: ${labelers.length} labelers agreed (${labelers.join(", ")}), confirmed by admin ${reviewer}`,
    });
  }
  await HeldBackReview.create({ wordImage, reviewer, decision, category, manchu, labelers });
}
