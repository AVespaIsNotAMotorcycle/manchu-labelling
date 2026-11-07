import { STORED_MANCHU } from "@manchu-labelling/script";
import { model, Schema } from "mongoose";

import { appendOnly } from "./append-only.ts";
import { CATEGORIES } from "./labels.ts";
import { SCRIPT_TYPES } from "./sources.ts";

/** A quiz image. These are separate from hidden checks, and are never used as checks. */
const trainingItemSchema = new Schema({
  scriptClass: { type: String, enum: SCRIPT_TYPES, required: true, index: true },
  kind: { type: String, enum: ["real", "synthetic"], required: true },
  category: { type: String, enum: CATEGORIES, required: true },
  /** The answer, required for Manchu images. */
  abkai: String,
  manchu: { type: String, match: STORED_MANCHU },
  /** A random key, so that storage paths reveal nothing about the image. */
  imageKey: { type: String, required: true, unique: true },
  /** Where the image came from, including any attribution its license requires. */
  source: { type: String, required: true },
  /** Set to false to withdraw an item, such as one found to be wrong. */
  active: { type: Boolean, default: true },
});

/** One answered quiz image. */
const trainingAttemptSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  item: { type: Schema.Types.ObjectId, ref: "TrainingItem", required: true },
  scriptClass: { type: String, enum: SCRIPT_TYPES, required: true },
  kind: { type: String, enum: ["real", "synthetic"], required: true },
  category: { type: String, enum: CATEGORIES, required: true },
  abkai: String,
  manchu: { type: String, match: STORED_MANCHU },
  correct: { type: Boolean, required: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
});
trainingAttemptSchema.index({ user: 1, scriptClass: 1, createdAt: -1 });
trainingAttemptSchema.plugin(appendOnly);

/** The image a user must answer next, so that reloading cannot skip a hard one. */
const trainingStateSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  scriptClass: { type: String, enum: SCRIPT_TYPES, required: true },
  currentItem: { type: Schema.Types.ObjectId, ref: "TrainingItem" },
});
trainingStateSchema.index({ user: 1, scriptClass: 1 }, { unique: true });

/** Permission to label a script class. Hidden checks, not this record, decide if labels count later. */
const qualificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  scriptClass: { type: String, enum: SCRIPT_TYPES, required: true },
  qualifiedAt: { type: Date, default: Date.now, immutable: true },
});
qualificationSchema.index({ user: 1, scriptClass: 1 }, { unique: true });

export const TrainingItem = model("TrainingItem", trainingItemSchema);
export const TrainingAttempt = model("TrainingAttempt", trainingAttemptSchema);
export const TrainingState = model("TrainingState", trainingStateSchema);
export const Qualification = model("Qualification", qualificationSchema);
