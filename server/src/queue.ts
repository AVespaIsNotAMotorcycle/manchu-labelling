import { instancesUnderReview } from "./crop-reviews.ts";
import { WordImage, WordInstance } from "./models/crops.ts";
import { Annotation, Assignment } from "./models/labels.ts";
import { Page, Volume, type ScriptClass } from "./models/sources.ts";
import type { Types } from "mongoose";

/** Each image needs this many independent labels before it leaves the queue. */
const LABELS_PER_IMAGE = 2;

/**
 * Picks a random image that this user has not seen and that still needs labels. Order is random so that
 * labelers cannot rely on the neighbouring words in a text. A user only sees script classes they have
 * qualified for. Hidden checks will be mixed in here.
 */
export async function pickNextImage(user: Types.ObjectId, scriptClasses: readonly ScriptClass[]) {
  const volumes = await Volume.find({ script: { $in: [...scriptClasses] } }, "_id").lean();
  const pages = await Page.distinct("_id", { volume: { $in: volumes.map(({ _id }) => _id) } });
  const [underReview, seen, finished] = await Promise.all([
    instancesUnderReview(),
    Assignment.distinct("wordImage", { user }),
    Annotation.aggregate<{ _id: Types.ObjectId }>([
      { $group: { _id: "$wordImage", users: { $addToSet: "$user" } } },
      { $match: { [`users.${LABELS_PER_IMAGE - 1}`]: { $exists: true } } },
      { $project: { _id: 1 } },
    ]),
  ]);

  const canonical = await WordInstance.distinct("canonicalCrop", {
    retired: { $ne: true },
    _id: { $nin: underReview },
  });
  const excluded = new Set([...seen, ...finished.map(({ _id }) => _id)].map(String));
  const available = canonical.filter((crop) => !excluded.has(String(crop)));

  const [image] = await WordImage.aggregate<{ _id: Types.ObjectId }>([
    { $match: { _id: { $in: available }, columnType: "manchu", page: { $in: pages } } },
    { $sample: { size: 1 } },
    { $project: { _id: 1 } },
  ]);
  return image?._id ?? null;
}
