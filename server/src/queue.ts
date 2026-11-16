import { instancesUnderReview } from "./crop-reviews.ts";
import { settleImages } from "./consensus.ts";
import { WordImage, WordInstance } from "./models/crops.ts";
import { Assignment, KnownLabel } from "./models/labels.ts";
import { Page, Volume, type ScriptClass } from "./models/sources.ts";
import type { Types } from "mongoose";

type Id = Types.ObjectId;

/** Images a user labels before the check rate drops, so that trust has a sample early on. */
const EARLY_IMAGES = 100;
const EARLY_CHECK_RATE = 0.2;
const LATER_CHECK_RATE = 0.08;

/** The share of a user's next images that are hidden checks, given how many they have labelled. */
export function checkRate(labelled: number): number {
  return labelled < EARLY_IMAGES ? EARLY_CHECK_RATE : LATER_CHECK_RATE;
}

async function sampleImage(candidates: readonly Id[], pages: readonly Id[]): Promise<Id | null> {
  const [image] = await WordImage.aggregate<{ _id: Id }>([
    { $match: { _id: { $in: candidates }, columnType: "manchu", page: { $in: pages } } },
    { $sample: { size: 1 } },
    { $project: { _id: 1 } },
  ]);
  return image?._id ?? null;
}

/**
 * Picks a random image that this user has not seen. Order is random so that labelers cannot rely on the
 * neighbouring words in a text. A user only sees script classes they have qualified for.
 *
 * Hidden checks are mixed in at `checkRate`. A check must pass the same rules as any other image, and is
 * only given while ordinary images remain, so that nothing a user can see sets checks apart.
 */
export async function pickNextImage(
  user: Id,
  scriptClasses: readonly ScriptClass[],
  random = Math.random,
) {
  const volumes = await Volume.find({ script: { $in: [...scriptClasses] } }, "_id").lean();
  const pages = (await Page.distinct("_id", { volume: { $in: volumes.map(({ _id }) => _id) } })) as Id[];
  const [underReview, seen, labelled, known, settlements] = await Promise.all([
    instancesUnderReview(),
    Assignment.distinct("wordImage", { user }),
    Assignment.countDocuments({ user, submittedAt: { $ne: null } }),
    KnownLabel.find({}, "wordImage state").lean(),
    settleImages(),
  ]);
  // An image leaves the queue once its labels settle it, it waits for a reviewer, or it has enough.
  const finished = [...settlements].filter(([, { wantsLabel }]) => !wantsLabel).map(([id]) => id);

  const eligible = (await WordInstance.distinct("canonicalCrop", {
    retired: { $ne: true },
    _id: { $nin: underReview },
  })) as Id[];
  const seenIds = new Set(seen.map(String));
  // Images with a known answer never need ordinary labels.
  const excluded = new Set(
    [...seen, ...finished, ...known.map(({ wordImage }) => wordImage)].map(String),
  );

  const activeChecks = new Set(
    known.filter(({ state }) => state === "active").map(({ wordImage }) => String(wordImage)),
  );
  // Both are always looked up, so that a check takes no longer to hand out than an ordinary image.
  const [ordinary, check] = await Promise.all([
    sampleImage(
      eligible.filter((crop) => !excluded.has(String(crop))),
      pages,
    ),
    sampleImage(
      eligible.filter((crop) => activeChecks.has(String(crop)) && !seenIds.has(String(crop))),
      pages,
    ),
  ]);
  if (!ordinary) return null;
  if (random() >= checkRate(labelled)) return ordinary;
  return check ?? ordinary;
}
