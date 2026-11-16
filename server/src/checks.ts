import type { Types } from "mongoose";

import { WordImage } from "./models/crops.ts";
import { Annotation, KnownLabel } from "./models/labels.ts";
import { Page, Volume } from "./models/sources.ts";
import { characterAccuracy } from "./trust.ts";

type Id = Types.ObjectId;

interface Answer {
  category: string;
  manchu?: string | null;
}

interface Label {
  category: string;
  transcription?: { manchu: string } | null;
}

/** A check passes only on an exact match: the same category, and for Manchu the same letters. */
export function passesCheck(answer: Answer, label: Label): boolean {
  if (label.category !== answer.category) return false;
  return answer.category !== "manchu" || label.transcription?.manchu === answer.manchu;
}

export interface CheckResult {
  user: Id;
  wordImage: Id;
  scriptClass: string;
  passed: boolean;
  /** Character accuracy, from 0 to 1. */
  accuracy: number;
  /** When the user first labelled the image. */
  at: Date;
  /** The graded label: the user's latest on the image. */
  label: Id;
}

/** The script class of each image, from its volume, keyed by image ID. */
export async function scriptClassOfImages(imageIds: readonly Id[]): Promise<Map<string, string>> {
  const images = await WordImage.find({ _id: { $in: imageIds } }, "page").lean();
  const pages = await Page.find({ _id: { $in: images.map(({ page }) => page) } }, "volume").lean();
  const volumes = await Volume.find({ _id: { $in: pages.map(({ volume }) => volume) } }, "script").lean();
  const scriptOfVolume = new Map(volumes.map(({ _id, script }) => [String(_id), script]));
  const volumeOfPage = new Map(pages.map(({ _id, volume }) => [String(_id), String(volume)]));
  return new Map(
    images.map(({ _id, page }) => [
      String(_id),
      scriptOfVolume.get(volumeOfPage.get(String(page)) ?? "") ?? "unknown",
    ]),
  );
}

/** When a known label became a check. Records from before `activatedAt` use the time in their ID. */
export const activationTime = (known: { _id: Id; activatedAt?: Date | null }): Date =>
  known.activatedAt ?? known._id.getTimestamp();

/**
 * Grades labels on images with a known answer, oldest first. Each user's latest label on an image is
 * graded, so a correction counts. Results are worked out from history each time and never stored,
 * because a known answer can itself be corrected or withdrawn.
 *
 * Withdrawn answers, and answers moved to the quiz, grade nothing. A label is only graded if the user first labelled the image after it
 * became a check, so the labels that agreed on a held-back answer are not graded against it.
 */
export async function checkResults(options: { users?: readonly Id[] } = {}): Promise<CheckResult[]> {
  const known = await KnownLabel.find(
    { state: { $nin: ["withdrawn", "quiz"] } },
    "wordImage category manchu activatedAt",
  ).lean();
  const answers = new Map(known.map((answer) => [String(answer.wordImage), answer]));
  const imageIds = known.map(({ wordImage }) => wordImage);

  const [labels, scriptOfImage] = await Promise.all([
    Annotation.find(
      { wordImage: { $in: imageIds }, ...(options.users ? { user: { $in: options.users } } : {}) },
      "wordImage user category transcription createdAt",
    )
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    scriptClassOfImages(imageIds),
  ]);

  const first = new Map<string, Date>();
  const latest = new Map<string, (typeof labels)[number]>();
  for (const label of labels) {
    const key = `${label.user}:${label.wordImage}`;
    if (!first.has(key)) first.set(key, label.createdAt);
    latest.set(key, label);
  }

  const results: CheckResult[] = [];
  for (const [key, label] of latest) {
    const answer = answers.get(String(label.wordImage));
    const at = first.get(key) as Date;
    if (!answer || at < activationTime(answer)) continue;
    results.push({
      user: label.user,
      wordImage: label.wordImage,
      scriptClass: scriptOfImage.get(String(label.wordImage)) ?? "unknown",
      passed: passesCheck(answer, label),
      accuracy: characterAccuracy(answer, label),
      at,
      label: label._id,
    });
  }
  return results.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface CheckSummary {
  answered: number;
  passed: number;
  /** Mean character accuracy. */
  accuracy: number;
  /** Failed checks since the last pass. */
  failedInARow: number;
}

/** Summarises results for each user and script class, keyed as `user:scriptClass`. */
export function summarizeChecks(results: readonly CheckResult[]): Map<string, CheckSummary> {
  const summaries = new Map<string, CheckSummary & { total: number }>();
  for (const { user, scriptClass, passed, accuracy } of results) {
    const key = `${user}:${scriptClass}`;
    const summary = summaries.get(key) ?? { answered: 0, passed: 0, accuracy: 0, failedInARow: 0, total: 0 };
    summary.answered += 1;
    summary.passed += passed ? 1 : 0;
    summary.total += accuracy;
    summary.accuracy = summary.total / summary.answered;
    summary.failedInARow = passed ? 0 : summary.failedInARow + 1;
    summaries.set(key, summary);
  }
  return new Map(
    [...summaries].map(([key, { total: _total, ...summary }]) => [key, summary]),
  );
}
