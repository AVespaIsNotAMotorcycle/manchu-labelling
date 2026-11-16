import { createHash, createHmac } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { manchuToAbkai, manchuToMollendorff } from "@manchu-labelling/script";
import type { Types } from "mongoose";

import { LABELS_BEFORE_REVIEW, LABELS_FOR_HELD_BACK, loadTrust, MAX_LABELERS, settleImages } from "./consensus.ts";
import { instancesUnderReview } from "./crop-reviews.ts";
import { dataCard, licenseText, type CardData } from "./data-card.ts";
import { HOLD_BACK_RATE } from "./held-back.ts";
import { WordImage, WordInstance } from "./models/crops.ts";
import { Annotation, KnownLabel, LabelReview } from "./models/labels.ts";
import { Release } from "./models/releases.ts";
import { Page, Volume } from "./models/sources.ts";
import { User } from "./models/users.ts";
import { EARLY_CHECK_RATE, EARLY_IMAGES, LATER_CHECK_RATE } from "./queue.ts";
import { FAILED_CHECKS_TO_LOSE, STREAK } from "./training.ts";
import { TRUST_MINIMUM_SAMPLE, TRUST_THRESHOLD, TRUST_WINDOW } from "./trust.ts";

type Id = Types.ObjectId;

export class ReleaseError extends Error {}

export interface ReleaseOptions {
  version: string;
  outDir: string;
  storageDirectory: string;
  /** The server secret that turns user IDs into annotator IDs. It must stay the same across releases. */
  secret: string;
  /** Only release volumes with this license, to make a separate package. */
  license?: string;
  commit?: string;
}

/** Final label statuses, as published. */
export type PublishedStatus = "known" | "reviewed" | "agreed" | "single" | "unsettled";

/** An annotator's ID in releases: a keyed hash, so it is stable across releases but reveals nothing. */
export function annotatorId(secret: string, user: Id | string): string {
  return `a${createHmac("sha256", secret).update(String(user)).digest("hex").slice(0, 16)}`;
}

const text = (manchu?: string | null) =>
  manchu
    ? { manchu, abkai: manchuToAbkai(manchu).text, mollendorff: manchuToMollendorff(manchu).text }
    : undefined;

const jsonl = (rows: readonly object[]) => rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");

const NONCOMMERCIAL = /\bNC\b|noncommercial|non-commercial/i;

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** The most common non-empty value, or the fallback. Ties go to the fallback if it is among them. */
function majority(values: readonly (string | null | undefined)[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  const best = Math.max(0, ...counts.values());
  if (best === 0) return fallback;
  const leaders = [...counts].filter(([, count]) => count === best).map(([value]) => value);
  return leaders.includes(fallback) ? fallback : (leaders.sort()[0] as string);
}

/**
 * Writes a release to a new folder and records it. Only volumes with cleared rights are included, and
 * each must have a split. Active checks and held-back words are left out, apart from retired checks.
 * Words with no labels are left out. Trust is worked out now, from history, for every label.
 */
export async function exportRelease(options: ReleaseOptions) {
  const { version, outDir, storageDirectory, secret } = options;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new ReleaseError("The version must look like 1.0.0");
  if (secret.length < 32) throw new ReleaseError("The annotator ID secret must be at least 32 characters");
  if (await Release.exists({ version })) throw new ReleaseError(`Release ${version} already exists`);
  if (await stat(outDir).catch(() => null)) throw new ReleaseError(`${outDir} already exists`);

  const volumes = await Volume.find({
    "rights.status": "cleared",
    ...(options.license ? { "rights.license": options.license } : {}),
  })
    .sort({ sourceId: 1 })
    .lean();
  if (volumes.length === 0) throw new ReleaseError("No volumes with cleared rights match");
  const unsplit = volumes.filter(({ split }) => !split).map(({ sourceId }) => sourceId);
  if (unsplit.length) throw new ReleaseError(`These volumes need a split first: ${unsplit.join(", ")}`);
  const licenses = new Set(volumes.map(({ rights }) => rights?.license ?? "unspecified"));
  if (licenses.size > 1 && [...licenses].some((license) => NONCOMMERCIAL.test(license))) {
    throw new ReleaseError(
      `Noncommercial volumes go in a separate package. Choose one license with --license: ${[...licenses].join(", ")}`,
    );
  }

  const volumeById = new Map(volumes.map((volume) => [String(volume._id), volume]));
  const pages = await Page.find({ volume: { $in: volumes.map(({ _id }) => _id) } }).lean();
  const pageById = new Map(pages.map((page) => [String(page._id), page]));
  const underReview = await instancesUnderReview();
  const instances = await WordInstance.find({
    page: { $in: pages.map(({ _id }) => _id) },
    retired: { $ne: true },
    _id: { $nin: underReview },
  }).lean();
  const crops = await WordImage.find({
    _id: { $in: instances.map(({ canonicalCrop }) => canonicalCrop) },
    columnType: "manchu",
  }).lean();
  const cropById = new Map(crops.map((crop) => [String(crop._id), crop]));
  const cropIds = crops.map(({ _id }) => _id);

  const trust = await loadTrust();
  const [known, settlements, annotations, reviews] = await Promise.all([
    KnownLabel.find({ wordImage: { $in: cropIds } }).lean(),
    settleImages({ images: cropIds, trust }),
    Annotation.find({ wordImage: { $in: cropIds } }).sort({ createdAt: 1, _id: 1 }).lean(),
    LabelReview.find({ wordImage: { $in: cropIds } }).sort({ createdAt: 1, _id: 1 }).lean(),
  ]);
  const knownOf = new Map(known.map((answer) => [String(answer.wordImage), answer]));
  const labelsOf = new Map<string, typeof annotations>();
  for (const annotation of annotations) {
    const key = String(annotation.wordImage);
    labelsOf.set(key, [...(labelsOf.get(key) ?? []), annotation]);
  }
  const reviewerOf = new Map(reviews.map(({ wordImage, reviewer }) => [String(wordImage), reviewer]));

  const excluded = { activeChecks: 0, heldBack: 0, unlabelled: 0, quizImages: 0 };
  const words: Record<string, unknown>[] = [];
  const labels: Record<string, unknown>[] = [];
  const included: { instance: (typeof instances)[number]; crop: (typeof crops)[number] }[] = [];
  const annotators = new Set<string>();

  const ordered = instances
    .map((instance) => ({ instance, crop: cropById.get(String(instance.canonicalCrop)) }))
    .filter((entry): entry is { instance: (typeof instances)[number]; crop: (typeof crops)[number] } =>
      Boolean(entry.crop),
    )
    .sort((a, b) => {
      const pageA = pageById.get(String(a.crop.page));
      const pageB = pageById.get(String(b.crop.page));
      return (
        String(pageA?.volume).localeCompare(String(pageB?.volume)) ||
        (pageA?.index ?? 0) - (pageB?.index ?? 0) ||
        a.crop.side.localeCompare(b.crop.side) ||
        a.crop.column - b.crop.column ||
        a.crop.word - b.crop.word
      );
    });

  for (const { instance, crop } of ordered) {
    const key = String(crop._id);
    const answer = knownOf.get(key);
    // Quiz answers are kept out, so that a release cannot be used to look them up.
    if (answer?.state === "quiz") {
      excluded.quizImages += 1;
      continue;
    }
    const live = answer && answer.state !== "withdrawn" ? answer : undefined;
    if (live?.state === "active") {
      excluded.activeChecks += 1;
      continue;
    }
    if (instance.heldBack && live?.state !== "retired") {
      excluded.heldBack += 1;
      continue;
    }
    const raw = labelsOf.get(key) ?? [];
    if (raw.length === 0 && !live) {
      excluded.unlabelled += 1;
      continue;
    }

    const page = pageById.get(String(crop.page));
    const volume = volumeById.get(String(page?.volume));
    if (!page || !volume) throw new Error(`Missing page or volume for ${crop._id}`);
    const settlement = settlements.get(key);
    const scriptClass = volume.script;

    let status: PublishedStatus;
    let final: { category: string; manchu?: string } | undefined;
    if (live) {
      status = "known";
      final = {
        category: live.category,
        ...(live.category === "manchu" && live.manchu ? { manchu: live.manchu } : {}),
      };
    } else if (settlement?.status === "reviewed" || settlement?.status === "agreed") {
      status = settlement.status;
      final = settlement.answer;
    } else if (settlement?.status === "single") {
      status = "single";
      const label = settlement.labels.find(({ trusted }) => trusted);
      final = label && {
        category: label.category,
        ...(label.category === "manchu" ? { manchu: label.transcription?.manchu } : {}),
      };
    } else {
      status = "unsettled";
    }

    const counted = settlement?.labels.filter(({ trusted }) => trusted) ?? [];
    const id = String(instance._id);
    const file = `images/${id}${extname(crop.imageKey)}`;
    const reviewer = reviewerOf.get(key);
    words.push({
      id,
      file_name: file,
      split: volume.split,
      volume: volume.sourceId,
      page: { index: page.index, canvas: page.canvasId, width: page.width, height: page.height },
      box: crop.box,
      position: { side: crop.side, column: crop.column, word: crop.word },
      final: {
        status,
        ...(final ? { category: final.category, ...text(final.manchu) } : {}),
        ...(status === "known" ? { origin: "expert" } : {}),
        ...(status === "reviewed" && reviewer ? { reviewer: annotatorId(secret, reviewer) } : {}),
      },
      production: majority(counted.map(({ production }) => production), volume.production),
      script: majority(counted.map(({ script }) => script), volume.script),
      labels: raw.length,
      rights: {
        statement: volume.rights?.statement,
        attribution: volume.rights?.attribution,
        link: volume.rights?.permanentLink,
        license: volume.rights?.license,
      },
    });

    const latestOf = new Map(raw.map((label) => [String(label.user), String(label._id)]));
    for (const label of raw) {
      const annotator = annotatorId(secret, label.user);
      annotators.add(String(label.user));
      labels.push({
        id: String(label._id),
        word: id,
        annotator,
        created: label.createdAt.toISOString(),
        latest: latestOf.get(String(label.user)) === String(label._id),
        counted: trust.isTrusted(label.user, scriptClass, label.createdAt),
        category: label.category,
        ...(label.transcription ? { transcription: text(label.transcription.manchu) } : {}),
        ...(label.intendedWord ? { intended: text(label.intendedWord.manchu) } : {}),
        ...(label.production ? { production: label.production } : {}),
        ...(label.script ? { script: label.script } : {}),
        confidence: label.confidence,
        ...(label.supersedes ? { supersedes: String(label.supersedes) } : {}),
      });
    }
    included.push({ instance, crop });
  }

  await mkdir(join(outDir, "images"), { recursive: true });
  for (const { instance, crop } of included) {
    await copyFile(
      join(storageDirectory, crop.imageKey),
      join(outDir, "images", `${instance._id}${extname(crop.imageKey)}`),
    );
  }

  const wordsPerVolume = new Map<string, number>();
  for (const word of words) wordsPerVolume.set(word.volume as string, (wordsPerVolume.get(word.volume as string) ?? 0) + 1);
  const volumeRows = volumes.map((volume) => ({
    id: volume.sourceId,
    title: volume.title,
    date: volume.date,
    manifest: volume.manifestUrl,
    production: volume.production,
    script: volume.script,
    split: volume.split,
    words: wordsPerVolume.get(volume.sourceId) ?? 0,
    rights: {
      statement: volume.rights?.statement,
      attribution: volume.rights?.attribution,
      link: volume.rights?.permanentLink,
      license: volume.rights?.license,
    },
  }));

  const credited = await User.find(
    { _id: { $in: [...annotators] }, creditName: { $exists: true, $nin: [null, ""] } },
    "creditName",
  ).lean();
  const names = [...new Set(credited.map(({ creditName }) => (creditName as string).trim()))].sort((a, b) =>
    a.localeCompare(b),
  );

  const statuses: Record<string, number> = {};
  const splits: Record<string, number> = {};
  const categories: Record<string, number> = {};
  for (const word of words) {
    const final = word.final as { status: string; category?: string };
    statuses[final.status] = (statuses[final.status] ?? 0) + 1;
    splits[word.split as string] = (splits[word.split as string] ?? 0) + 1;
    if (final.category) categories[final.category] = (categories[final.category] ?? 0) + 1;
  }
  const parameters = {
    trust: { window: TRUST_WINDOW, threshold: TRUST_THRESHOLD, minimumSample: TRUST_MINIMUM_SAMPLE },
    consensus: {
      matching: 2,
      labelsBeforeReview: LABELS_BEFORE_REVIEW,
      labelsForHeldBack: LABELS_FOR_HELD_BACK,
      maxLabelers: MAX_LABELERS,
    },
    checks: { earlyRate: EARLY_CHECK_RATE, earlyImages: EARLY_IMAGES, laterRate: LATER_CHECK_RATE },
    qualification: { quizStreak: STREAK, failedChecksToLose: FAILED_CHECKS_TO_LOSE },
    holdBackRate: HOLD_BACK_RATE,
    license: options.license ?? null,
  };
  const counts = {
    words: words.length,
    labels: labels.length,
    annotators: annotators.size,
    statuses,
    splits,
    categories,
    excluded,
  };
  const card: CardData = {
    version,
    date: new Date().toISOString().slice(0, 10),
    commit: options.commit,
    volumes: volumeRows,
    counts,
    parameters,
    credited: names.length,
  };

  await writeFile(join(outDir, "words.jsonl"), jsonl(words));
  await writeFile(join(outDir, "labels.jsonl"), jsonl(labels));
  await writeFile(join(outDir, "volumes.jsonl"), jsonl(volumeRows));
  await writeFile(join(outDir, "README.md"), dataCard(card));
  await writeFile(join(outDir, "LICENSE.md"), licenseText(card));
  await writeFile(
    join(outDir, "CONTRIBUTORS.md"),
    `# Contributors\n\nThese people labelled words in this release and asked to be credited by name. Names are listed\nalphabetically and are not linked to annotator IDs.\n\n${names.map((name) => `- ${name}`).join("\n")}${names.length ? "\n" : "No contributors have asked to be named yet.\n"}`,
  );

  const files = await listFiles(outDir);
  const sums: [string, string][] = [];
  for (const file of files) sums.push([relative(outDir, file), await sha256(file)]);
  const manifest = sums.map(([path, sum]) => `${sum}  ${path}`).join("\n") + "\n";
  await writeFile(join(outDir, "SHA256SUMS"), manifest);

  const checksums = [
    ...sums.filter(([path]) => !path.startsWith("images/")),
    ["SHA256SUMS", createHash("sha256").update(manifest).digest("hex")] as const,
  ].map(([path, sha256]) => ({ path, sha256 }));
  await Release.create({
    version,
    commit: options.commit,
    parameters,
    volumes: volumes.map((volume) => ({
      volume: volume._id,
      sourceId: volume.sourceId,
      split: volume.split,
      license: volume.rights?.license,
      words: wordsPerVolume.get(volume.sourceId) ?? 0,
    })),
    counts,
    checksums,
  });
  return counts;
}
