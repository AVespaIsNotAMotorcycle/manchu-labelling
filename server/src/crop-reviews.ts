import type { Types } from "mongoose";

import { CropReview, WordImage, WordInstance } from "./models/crops.ts";

type Id = Types.ObjectId;

/** Returns the word instances blocked from labelling and release by an open review. */
export async function instancesUnderReview(): Promise<Id[]> {
  return CropReview.distinct("instances", { status: "open" });
}

/** Returns the word instances that a release may include. */
export async function releasableInstances() {
  const blocked = await instancesUnderReview();
  return WordInstance.find({ retired: false, _id: { $nin: blocked } }).lean();
}

/**
 * Applies an admin's ruling. The chosen crop's word keeps that crop, and the other words in the review
 * are retired. Other reviews are closed only if nothing is left to decide: those of retired words, and
 * other duplicate-crop reviews of the chosen word. Its remaining conflicts stay open.
 */
export async function ruleOnReview(reviewId: Id, chosenCrop: Id, admin: Id): Promise<void> {
  const review = await CropReview.findOne({ _id: reviewId, status: "open" });
  if (!review) throw new Error("This review is not open");
  if (!review.crops.some((crop) => crop.equals(chosenCrop))) {
    throw new Error("The chosen crop is not part of this review");
  }
  const crop = await WordImage.findById(chosenCrop);
  if (!crop) throw new Error("The chosen crop does not exist");

  const retired = review.instances.filter((instance) => !instance.equals(crop.instance));
  await WordInstance.updateOne({ _id: crop.instance }, { canonicalCrop: crop._id });
  await WordInstance.updateMany({ _id: { $in: retired } }, { retired: true });

  const decision = { status: "resolved", decidedBy: admin, decidedAt: new Date() };
  await CropReview.updateOne({ _id: review._id }, { ...decision, chosenCrop: crop._id });
  await CropReview.updateMany(
    {
      status: "open",
      _id: { $ne: review._id },
      $or: [
        { instances: { $in: retired } },
        { reason: "same_word", instances: crop.instance },
      ],
    },
    decision,
  );
}
