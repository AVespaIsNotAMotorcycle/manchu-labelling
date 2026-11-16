import { abkaiToManchu, STORED_MANCHU } from "@manchu-labelling/script";
import { model, Schema } from "mongoose";

import { appendOnly } from "./append-only.ts";
import { PRODUCTION_TYPES, SCRIPT_TYPES } from "./sources.ts";

export const CATEGORIES = [
  "manchu",
  "chinese",
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

/**
 * The states of a known label. `active` checks are handed out and graded. `retired` checks are no longer
 * handed out, but earlier grades still count and the answer can be published. `withdrawn` answers were
 * found unreliable, so grades against them no longer count. `quiz` answers were moved into the quiz, so
 * they are never handed out or graded as checks, and releases leave them out. `corrected` is not used: a
 * correction replaces the answer and keeps the old one in `history`.
 */
export const KNOWN_LABEL_STATES = ["active", "retired", "withdrawn", "quiz", "corrected"] as const;

const replacedAnswerSchema = new Schema(
  {
    category: { type: String, enum: CATEGORIES, required: true },
    manchu: { type: String, match: STORED_MANCHU },
    replacedAt: { type: Date, required: true },
    /** The dispute that led to the correction. */
    dispute: { type: Schema.Types.ObjectId, ref: "Dispute" },
  },
  { _id: false },
);

/** Answers to hidden checks. Nothing else in the database may mark an image as a check. */
const knownLabelSchema = new Schema({
  wordImage: { type: Schema.Types.ObjectId, ref: "WordImage", required: true, unique: true },
  category: { type: String, enum: CATEGORIES, required: true },
  manchu: { type: String, match: STORED_MANCHU },
  origin: { type: String, required: true },
  state: { type: String, enum: KNOWN_LABEL_STATES, default: "active" },
  /**
   * When the image became a check. Only labels first made after this are graded against it. Records
   * from before this field use the time in their ID.
   */
  activatedAt: { type: Date, default: Date.now, immutable: true },
  /** The quiz image made from this word, once it moves to the quiz. */
  quizItem: { type: Schema.Types.ObjectId, ref: "TrainingItem" },
  /** Earlier answers, oldest first, kept when a dispute corrects the answer. */
  history: { type: [replacedAnswerSchema], default: undefined },
});

/**
 * A reviewer's decision on a held-back image whose labelers all agreed. A yes also creates its known
 * label. Decisions are never changed: an `undo` is a later record that replaces the one it names. Undoing
 * a yes withdraws the known label, and undoing a no sends the image back for review.
 */
const heldBackReviewSchema = new Schema({
  wordImage: { type: Schema.Types.ObjectId, ref: "WordImage", required: true },
  reviewer: { type: Schema.Types.ObjectId, ref: "User", required: true },
  decision: { type: String, enum: ["yes", "no", "undo"], required: true },
  /** The decision that an undo replaces. */
  undoes: { type: Schema.Types.ObjectId, ref: "HeldBackReview" },
  /** The answer the labelers agreed on, as the reviewer saw it. */
  category: { type: String, enum: CATEGORIES, required: true },
  manchu: { type: String, match: STORED_MANCHU },
  labelers: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
  createdAt: { type: Date, default: Date.now, immutable: true },
});
heldBackReviewSchema.index({ wordImage: 1, createdAt: 1 });
heldBackReviewSchema.plugin(appendOnly);

/**
 * A reviewer's final answer for an image whose labels did not settle it. Reviews are never changed. The
 * latest one for an image counts.
 */
const labelReviewSchema = new Schema({
  wordImage: { type: Schema.Types.ObjectId, ref: "WordImage", required: true, index: true },
  reviewer: { type: Schema.Types.ObjectId, ref: "User", required: true },
  category: { type: String, enum: CATEGORIES, required: true },
  transcription: textSchema,
  createdAt: { type: Date, default: Date.now, immutable: true },
});
labelReviewSchema.pre("validate", function () {
  if (this.category === "manchu" && !this.transcription) {
    this.invalidate("transcription", "A Manchu answer needs a transcription");
  }
  if (this.transcription && abkaiToManchu(this.transcription.abkai).text !== this.transcription.manchu) {
    this.invalidate("transcription", "Manchu text does not match the Abkai");
  }
});
labelReviewSchema.plugin(appendOnly);

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
export const HeldBackReview = model("HeldBackReview", heldBackReviewSchema);
export const LabelReview = model("LabelReview", labelReviewSchema);
