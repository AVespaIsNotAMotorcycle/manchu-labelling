import { UNREADABLE } from "@manchu-labelling/script";
import { Types } from "mongoose";

import { checkResults, scriptClassOfImages } from "./checks.ts";
import { WordInstance } from "./models/crops.ts";
import { Annotation, LabelReview } from "./models/labels.ts";
import { TrustIndex } from "./trust.ts";

type Id = Types.ObjectId;

/**
 * Where an image stands. `single` has one label that counts, `pending` has two that do not settle it,
 * `agreed` has two matching labels that can settle it, `needs_review` has three or more that do not,
 * and `reviewed` has a reviewer's answer.
 */
export type Status = "unlabelled" | "single" | "pending" | "agreed" | "needs_review" | "reviewed";

/** Labels needed before an image goes to a reviewer, when they do not settle it. */
export const LABELS_BEFORE_REVIEW = 3;
/** Held-back images need this many labels, since their answers may become hidden checks. */
export const LABELS_FOR_HELD_BACK = 3;
/**
 * The most labelers an image is given to, so that labels from users who are not trusted cannot keep it
 * in the queue forever.
 */
export const MAX_LABELERS = 6;

export interface LatestLabel {
  user: Id;
  category: string;
  transcription?: { manchu: string; abkai?: string } | null;
  production?: string | null;
  script?: string | null;
  confidence?: { category?: string | null; transcription?: string | null } | null;
  createdAt: Date;
}

export interface FinalAnswer {
  category: string;
  manchu?: string;
}

export interface Settlement {
  status: Status;
  answer?: FinalAnswer;
  /** Labels from users who were trusted when they made them. */
  counted: number;
  /** All labelers, trusted or not. */
  labelers: number;
  /** Whether the image should be given to another labeler. */
  wantsLabel: boolean;
}

const answerKey = (label: { category: string; transcription?: { manchu: string } | null }) =>
  label.category === "manchu" ? `manchu:${label.transcription?.manchu ?? ""}` : label.category;

/** Whether a label can settle an image: sure of its category and letters, with no unreadable letter. */
export function canSettle(label: LatestLabel): boolean {
  if (label.confidence?.category === "unconfident") return false;
  if (label.category !== "manchu") return true;
  if (label.confidence?.transcription === "unconfident") return false;
  return !(label.transcription?.manchu ?? UNREADABLE).includes(UNREADABLE);
}

/**
 * Settles one image from each user's latest label, given which labels count. Two matching labels that
 * can settle it agree. Otherwise it gets a third label, and then goes to a reviewer. A reviewer's answer
 * is final.
 */
export function settle(
  labels: readonly (LatestLabel & { trusted: boolean })[],
  options: { heldBack?: boolean; review?: FinalAnswer | null } = {},
): Settlement {
  const counted = labels.filter(({ trusted }) => trusted);
  const base = { counted: counted.length, labelers: labels.length };
  if (options.review) return { ...base, status: "reviewed", answer: options.review, wantsLabel: false };

  const groups = new Map<string, LatestLabel[]>();
  for (const label of counted.filter(canSettle)) {
    const key = answerKey(label);
    groups.set(key, [...(groups.get(key) ?? []), label]);
  }
  const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
  const [best, second] = ranked;
  const room = labels.length < MAX_LABELERS;

  if (best && best.length >= 2 && (!second || second.length < best.length)) {
    const [label] = best as [LatestLabel];
    const answer = {
      category: label.category,
      ...(label.category === "manchu" ? { manchu: label.transcription?.manchu } : {}),
    };
    const wantsLabel = Boolean(options.heldBack) && counted.length < LABELS_FOR_HELD_BACK && room;
    return { ...base, status: "agreed", answer, wantsLabel };
  }
  if (counted.length >= LABELS_BEFORE_REVIEW) return { ...base, status: "needs_review", wantsLabel: false };
  const status = counted.length === 0 ? "unlabelled" : counted.length === 1 ? "single" : "pending";
  return { ...base, status, wantsLabel: room };
}

/** Each user's latest label on each image, keyed by image ID. A correction replaces what it corrects. */
export async function latestLabels(images?: readonly Id[]): Promise<Map<string, LatestLabel[]>> {
  const labels = await Annotation.find(
    images ? { wordImage: { $in: images } } : {},
    "wordImage user category transcription production script confidence createdAt",
  )
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const byImage = new Map<string, Map<string, LatestLabel>>();
  for (const label of labels) {
    const image = String(label.wordImage);
    if (!byImage.has(image)) byImage.set(image, new Map());
    byImage.get(image)?.set(String(label.user), label);
  }
  return new Map([...byImage].map(([image, users]) => [image, [...users.values()]]));
}

/** The latest reviewer answer on each image, keyed by image ID. */
export async function latestReviews(images?: readonly Id[]): Promise<Map<string, FinalAnswer>> {
  const reviews = await LabelReview.find(images ? { wordImage: { $in: images } } : {}, "wordImage category transcription")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  return new Map(
    reviews.map(({ wordImage, category, transcription }) => [
      String(wordImage),
      { category, ...(transcription ? { manchu: transcription.manchu } : {}) },
    ]),
  );
}

/** Builds the trust index from every graded check. */
export async function loadTrust(): Promise<TrustIndex> {
  return new TrustIndex(await checkResults());
}

/**
 * Settles images, marking each label with whether its author was trusted in the image's script class
 * when they made it. Pass `images` to settle only some.
 */
export async function settleImages(
  options: { images?: readonly Id[]; trust?: TrustIndex } = {},
): Promise<Map<string, Settlement & { labels: (LatestLabel & { trusted: boolean })[] }>> {
  const [labels, reviews, trust] = await Promise.all([
    latestLabels(options.images),
    latestReviews(options.images),
    options.trust ?? loadTrust(),
  ]);
  const imageIds = [...new Set([...labels.keys(), ...reviews.keys()])];
  const [scriptOf, heldBack] = await Promise.all([
    scriptClassOfImages(imageIds.map((id) => new Types.ObjectId(id))),
    WordInstance.distinct("canonicalCrop", { heldBack: true }),
  ]);
  const held = new Set(heldBack.map(String));
  const result = new Map<string, Settlement & { labels: (LatestLabel & { trusted: boolean })[] }>();
  for (const image of imageIds) {
    const scriptClass = scriptOf.get(image) ?? "unknown";
    const marked = (labels.get(image) ?? []).map((label) => ({
      ...label,
      trusted: trust.isTrusted(label.user, scriptClass, label.createdAt),
    }));
    result.set(image, {
      ...settle(marked, { heldBack: held.has(image), review: reviews.get(image) }),
      labels: marked,
    });
  }
  return result;
}
