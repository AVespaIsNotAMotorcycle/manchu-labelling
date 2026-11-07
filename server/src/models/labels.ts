import { abkaiToManchu, STORED_MANCHU } from "@manchu-labelling/script";
import { model, Schema } from "mongoose";

import { appendOnly } from "./append-only.ts";
import { PRODUCTION_TYPES, SCRIPT_TYPES } from "./sources.ts";

export const CATEGORIES = [
  "manchu",
  "chinese",
  "mongolian",
  "other_script",
  "non_text",
  "illegible",
  "bad_crop",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CONFIDENCE = ["confident", "unconfident"] as const;

const hasValue = (text: string | undefined | null): text is string => Boolean(text);

const textSchema = new Schema(
  {
    /** The Abkai exactly as typed. */
    abkai: { type: String, required: true },
    manchu: {
      type: String,
      required: true,
      match: [STORED_MANCHU, "Stored Manchu must only contain letters and unreadable marks"],
    },
  },
  { _id: false },
);

/**
 * One label from one user. Annotations are never changed: a correction is a new annotation that points to
 * the one it replaces. Trust is not stored here, because it is calculated from history at export.
 */
const annotationSchema = new Schema({
  wordImage: { type: Schema.Types.ObjectId, ref: "WordImage", required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  supersedes: { type: Schema.Types.ObjectId, ref: "Annotation" },
  category: { type: String, enum: CATEGORIES, required: true },
  transcription: textSchema,
  intendedWord: textSchema,
  /** Word-level overrides. When absent, the volume's values apply. */
  production: { type: String, enum: PRODUCTION_TYPES },
  script: { type: String, enum: SCRIPT_TYPES },
  confidence: {
    category: { type: String, enum: CONFIDENCE, default: "confident" },
    transcription: { type: String, enum: CONFIDENCE, default: "confident" },
    style: { type: String, enum: CONFIDENCE, default: "confident" },
  },
  converterVersion: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
});

annotationSchema.pre("validate", function () {
  if (this.category === "manchu" && !this.transcription) {
    this.invalidate("transcription", "A Manchu label needs a transcription");
  }
  for (const field of [this.transcription, this.intendedWord]) {
    if (hasValue(field?.abkai) && abkaiToManchu(field.abkai).text !== field.manchu) {
      this.invalidate("transcription", "Manchu text does not match the Abkai");
    }
  }
});
annotationSchema.plugin(appendOnly);

/** Answers to hidden checks. Nothing else in the database may mark an image as a check. */
const knownLabelSchema = new Schema({
  wordImage: { type: Schema.Types.ObjectId, ref: "WordImage", required: true, unique: true },
  category: { type: String, enum: CATEGORIES, required: true },
  manchu: { type: String, match: STORED_MANCHU },
  origin: { type: String, required: true },
  state: { type: String, enum: ["active", "retired", "corrected"], default: "active" },
});

/** Records that a user was given an image. This must never say whether the image is a check. */
const assignmentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  wordImage: { type: Schema.Types.ObjectId, ref: "WordImage", required: true },
  assignedAt: { type: Date, default: Date.now, immutable: true },
  submittedAt: Date,
});
assignmentSchema.index({ user: 1, wordImage: 1 }, { unique: true });

export const Annotation = model("Annotation", annotationSchema);
export const KnownLabel = model("KnownLabel", knownLabelSchema);
export const Assignment = model("Assignment", assignmentSchema);
