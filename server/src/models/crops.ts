import { model, Schema } from "mongoose";

import { appendOnly } from "./append-only.ts";

const segmentationRunSchema = new Schema({
  volume: { type: Schema.Types.ObjectId, ref: "Volume", required: true },
  /** The pipeline commit, so that any crop can be traced to the code that made it. */
  pipelineCommit: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
});
segmentationRunSchema.plugin(appendOnly);

/**
 * One physical word on a page. Crops of the same word share an instance, and the instance names the one
 * crop to use. Exports read instances, so a word can only be published once.
 */
const wordInstanceSchema = new Schema({
  page: { type: Schema.Types.ObjectId, ref: "Page", required: true, index: true },
  canonicalCrop: { type: Schema.Types.ObjectId, ref: "WordImage", required: true },
  /** Set when an admin rules that this instance should not be used, such as a merged crop. */
  retired: { type: Boolean, default: false },
});

const boxSchema = new Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false },
);

/** A crop. Crops never change: new segmentation adds new crops, so labels always match their image. */
const wordImageSchema = new Schema({
  run: { type: Schema.Types.ObjectId, ref: "SegmentationRun", required: true, index: true },
  page: { type: Schema.Types.ObjectId, ref: "Page", required: true, index: true },
  instance: { type: Schema.Types.ObjectId, ref: "WordInstance", required: true, index: true },
  box: { type: boxSchema, required: true },
  side: { type: String, enum: ["left", "right"], required: true },
  column: { type: Number, required: true },
  word: { type: Number, required: true },
  columnType: { type: String, enum: ["manchu", "chinese"], required: true },
  /** A random key, so that storage paths reveal nothing about the image. */
  imageKey: { type: String, required: true, unique: true },
  /** Set when this crop was split from a merged one. */
  splitFrom: { type: Schema.Types.ObjectId, ref: "WordImage" },
});
wordImageSchema.plugin(appendOnly);

/**
 * Competing crops awaiting an admin's ruling. While a review is open, its word instances cannot be
 * labelled or released.
 */
const cropReviewSchema = new Schema({
  /** `same_word`: two crops of one word. `conflict`: crops that overlap too much to both be kept. */
  reason: { type: String, enum: ["same_word", "conflict"], required: true },
  instances: [{ type: Schema.Types.ObjectId, ref: "WordInstance", required: true }],
  crops: [{ type: Schema.Types.ObjectId, ref: "WordImage", required: true }],
  status: { type: String, enum: ["open", "resolved"], default: "open", index: true },
  chosenCrop: { type: Schema.Types.ObjectId, ref: "WordImage" },
  decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
  decidedAt: Date,
  createdAt: { type: Date, default: Date.now, immutable: true },
});

export const SegmentationRun = model("SegmentationRun", segmentationRunSchema);
export const WordInstance = model("WordInstance", wordInstanceSchema);
export const WordImage = model("WordImage", wordImageSchema);
export const CropReview = model("CropReview", cropReviewSchema);
