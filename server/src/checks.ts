import type { Types } from "mongoose";

import { WordImage } from "./models/crops.ts";
import { Annotation, KnownLabel } from "./models/labels.ts";
import { Page, Volume } from "./models/sources.ts";

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
  /** When the user first labelled the image. */
  at: Date;
}

/**
 * Grades every label on an image with a known answer, oldest first. Each user's latest label on an image
 * is graded, so a correction counts. Results are worked out from history each time and never stored,
 * because a known answer can itself be corrected.
 */
export async function checkResults(): Promise<CheckResult[]> {
  const known = await KnownLabel.find({}, "wordImage category manchu").lean();
  const answers = new Map(known.map((answer) => [String(answer.wordImage), answer]));
  const imageIds = known.map(({ wordImage }) => wordImage);

  const [labels, images] = await Promise.all([
    Annotation.find({ wordImage: { $in: imageIds } }, "wordImage user category transcription createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    WordImage.find({ _id: { $in: imageIds } }, "page").lean(),
  ]);
  const pages = await Page.find({ _id: { $in: images.map(({ page }) => page) } }, "volume").lean();
  const volumes = await Volume.find({ _id: { $in: pages.map(({ volume }) => volume) } }, "script").lean();
  const scriptOfVolume = new Map(volumes.map(({ _id, script }) => [String(_id), script]));
  const volumeOfPage = new Map(pages.map(({ _id, volume }) => [String(_id), String(volume)]));
  const scriptOfImage = new Map(
    images.map(({ _id, page }) => [
      String(_id),
      scriptOfVolume.get(volumeOfPage.get(String(page)) ?? "") ?? "unknown",
    ]),
  );

  const first = new Map<string, Date>();
  const latest = new Map<string, (typeof labels)[number]>();
  for (const label of labels) {
    const key = `${label.user}:${label.wordImage}`;
    if (!first.has(key)) first.set(key, label.createdAt);
    latest.set(key, label);
  }

  return [...latest.entries()]
    .map(([key, label]) => ({
      user: label.user,
      wordImage: label.wordImage,
      scriptClass: scriptOfImage.get(String(label.wordImage)) ?? "unknown",
      passed: passesCheck(answers.get(String(label.wordImage)) as Answer, label),
      at: first.get(key) as Date,
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface CheckSummary {
  answered: number;
  passed: number;
  /** Failed checks since the last pass. */
  failedInARow: number;
}

/** Summarises results for each user and script class, keyed as `user:scriptClass`. */
export function summarizeChecks(results: readonly CheckResult[]): Map<string, CheckSummary> {
  const summaries = new Map<string, CheckSummary>();
  for (const { user, scriptClass, passed } of results) {
    const key = `${user}:${scriptClass}`;
    const summary = summaries.get(key) ?? { answered: 0, passed: 0, failedInARow: 0 };
    summary.answered += 1;
    summary.passed += passed ? 1 : 0;
    summary.failedInARow = passed ? 0 : summary.failedInARow + 1;
    summaries.set(key, summary);
  }
  return summaries;
}
