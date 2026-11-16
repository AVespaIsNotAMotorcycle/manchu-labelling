import { randomInt } from "node:crypto";

import { UNREADABLE } from "@manchu-labelling/script";
import type { Types } from "mongoose";

import { passesCheck, scriptClassOfImages } from "./checks.ts";
import { loadTrust } from "./consensus.ts";
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
  createdAt?: Date;
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

/** The latest decision on each image, keyed by image ID. */
async function latestDecisions(images?: readonly Types.ObjectId[]) {
  const decisions = await HeldBackReview.find(images ? { wordImage: { $in: images } } : {})
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  return new Map(decisions.map((decision) => [String(decision.wordImage), decision]));
}

/** Held-back images whose labelers agree, and which no reviewer has decided on, oldest word first. */
export async function agreementsToReview(limit = 50): Promise<Agreement[]> {
  const crops = (await WordInstance.distinct("canonicalCrop", {
    heldBack: true,
    retired: { $ne: true },
  })) as Types.ObjectId[];
  const [known, decided] = await Promise.all([
    KnownLabel.distinct("wordImage", { wordImage: { $in: crops } }),
    latestDecisions(crops),
  ]);
  const reviewed = [...decided.values()].filter(({ decision }) => decision !== "undo");
  const done = new Set([...known.map(String), ...reviewed.map(({ wordImage }) => String(wordImage))]);
  const open = crops.filter((crop) => !done.has(String(crop)));
  const [labels, trust, scriptOf] = await Promise.all([
    Annotation.find({ wordImage: { $in: open } }, "wordImage user category transcription confidence createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    loadTrust(),
    scriptClassOfImages(open),
  ]);

  // Each user's latest label counts, so a correction replaces what it corrects.
  const latest = new Map<string, Map<string, LatestLabel>>();
  for (const label of labels) {
    const image = String(label.wordImage);
    if (!latest.has(image)) latest.set(image, new Map());
    latest.get(image)?.set(String(label.user), label);
  }
  const agreements: Agreement[] = [];
  for (const crop of open) {
    // Only labels from users who were trusted when they made them count towards the agreement.
    const scriptClass = scriptOf.get(String(crop)) ?? "unknown";
    const trusted = [...(latest.get(String(crop))?.values() ?? [])].filter((label) =>
      trust.isTrusted(label.user, scriptClass, label.createdAt as Date),
    );
    const answer = agreedAnswer(trusted);
    if (answer) agreements.push({ wordImage: crop, ...answer });
    if (agreements.length >= limit) break;
  }
  return agreements;
}

/**
 * Records a reviewer's decision. The answer must still be the one the admin saw, since a labeler may have
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
      origin: `Held-back word: ${labelers.length} labelers agreed (${labelers.join(", ")}), confirmed by reviewer ${reviewer}`,
    });
  }
  await HeldBackReview.create({ wordImage, reviewer, decision, category, manchu, labelers });
}

/** The latest yes or no decisions that can still be undone, newest first. */
export async function undoableDecisions(limit = 50) {
  const latest = [...(await latestDecisions()).values()].filter(({ decision }) => decision !== "undo");
  return latest.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

/**
 * Undoes the latest decision on an image with a later record. Undoing a yes withdraws the known label,
 * so grades against it stop counting. Undoing a no sends the image back for review.
 */
export async function undoDecision(wordImage: Types.ObjectId, reviewer: Types.ObjectId): Promise<void> {
  const latest = (await latestDecisions([wordImage])).get(String(wordImage));
  if (!latest || latest.decision === "undo") throw new Error("There is no decision to undo on this image");
  if (latest.decision === "yes") {
    await KnownLabel.updateOne({ wordImage }, { state: "withdrawn" });
  }
  await HeldBackReview.create({
    wordImage,
    reviewer,
    decision: "undo",
    undoes: latest._id,
    category: latest.category,
    manchu: latest.manchu,
    labelers: latest.labelers,
  });
}
