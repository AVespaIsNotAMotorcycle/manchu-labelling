import { STORED_MANCHU } from "@manchu-labelling/script";
import { model, Schema } from "mongoose";

import { CATEGORIES } from "./labels.ts";

export const DISPUTE_OUTCOMES = ["upheld", "corrected", "withdrawn"] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

const answerSchema = new Schema(
  {
    category: { type: String, enum: CATEGORIES, required: true },
    abkai: String,
    manchu: { type: String, match: STORED_MANCHU },
  },
  { _id: false },
);

/**
 * A user's challenge to the answer of a past hidden check or a quiz image. The dispute itself never
 * changes. Its resolution is written once, by a reviewer or admin.
 */
const disputeSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  kind: { type: String, enum: ["check", "quiz"], required: true },
  /** The check image, for a check. */
  wordImage: { type: Schema.Types.ObjectId, ref: "WordImage" },
  /** The quiz image, for a quiz answer. */
  trainingItem: { type: Schema.Types.ObjectId, ref: "TrainingItem" },
  /** The answer as the user saw it when they disputed it. */
  answer: { type: answerSchema, required: true },
  /** The reading the user thinks is right. */
  proposed: { type: answerSchema, required: true },
  note: { type: String, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now, immutable: true },
  resolution: {
    type: new Schema(
      {
        /** Quiz disputes can only be upheld or withdrawn, since quiz images are not corrected in place. */
        outcome: { type: String, enum: DISPUTE_OUTCOMES, required: true },
        reviewer: { type: Schema.Types.ObjectId, ref: "User", required: true },
        /** The new answer, for a correction. */
        answer: answerSchema,
        note: { type: String, maxlength: 2000 },
        at: { type: Date, default: Date.now },
      },
      { _id: false },
    ),
  },
});
disputeSchema.index({ "resolution.outcome": 1, createdAt: 1 });

/** Rejects any change except writing the resolution once, so a dispute cannot be rewritten. */
disputeSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Disputes are only changed through resolveDispute");
});

export const Dispute = model("Dispute", disputeSchema);
