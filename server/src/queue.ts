import { instancesUnderReview } from "./crop-reviews.ts";
import { WordImage, WordInstance } from "./models/crops.ts";
import { Annotation, Assignment } from "./models/labels.ts";
import type { Types } from "mongoose";

/** Each image needs this many independent labels before it leaves the queue. */
const LABELS_PER_IMAGE = 2;

/**
 * Picks a random image that this user has not seen and that still needs labels. Order is random so that
 * labelers cannot rely on the neighbouring words in a text. Hidden checks will be mixed in here.
 */
export async function pickNextImage(user: Types.ObjectId) {
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
    retired: false,
    _id: { $nin: underReview },
  });
  const excluded = new Set([...seen, ...finished.map(({ _id }) => _id)].map(String));
  const available = canonical.filter((crop) => !excluded.has(String(crop)));

  const [image] = await WordImage.aggregate<{ _id: Types.ObjectId }>([
    { $match: { _id: { $in: available }, columnType: "manchu" } },
    { $sample: { size: 1 } },
    { $project: { _id: 1 } },
  ]);
  return image?._id ?? null;
}
