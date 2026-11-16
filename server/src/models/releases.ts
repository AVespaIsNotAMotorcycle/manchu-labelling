import { model, Schema } from "mongoose";

import { appendOnly } from "./append-only.ts";

/**
 * A published version of the dataset. Releases never change, apart from recording the DOI once the
 * owner has uploaded the files. The volumes record each one's split, which is then fixed.
 */
const releaseSchema = new Schema({
  version: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
  /** The commit of this repository that made the release. */
  commit: String,
  /** The rules and thresholds used, such as trust settings. */
  parameters: { type: Schema.Types.Mixed, required: true },
  volumes: [
    {
      _id: false,
      volume: { type: Schema.Types.ObjectId, ref: "Volume", required: true },
      sourceId: { type: String, required: true },
      split: { type: String, required: true },
      license: String,
      words: { type: Number, required: true },
    },
  ],
  counts: { type: Schema.Types.Mixed, required: true },
  /** SHA-256 of each file in the release apart from images, which are covered by SHA256SUMS. */
  checksums: [
    {
      _id: false,
      path: { type: String, required: true },
      sha256: { type: String, required: true },
    },
  ],
});
releaseSchema.plugin(appendOnly);

/** The DOI is recorded once, after upload, as a separate record so that releases stay append-only. */
const releaseDoiSchema = new Schema({
  version: { type: String, required: true, unique: true },
  doi: { type: String, required: true },
  url: String,
  createdAt: { type: Date, default: Date.now, immutable: true },
});
releaseDoiSchema.plugin(appendOnly);

/** Which words each release published, so that the app can tell published words from the rest. */
const releasedWordSchema = new Schema({
  version: { type: String, required: true },
  instance: { type: Schema.Types.ObjectId, ref: "WordInstance", required: true, index: true },
});
releasedWordSchema.index({ version: 1, instance: 1 }, { unique: true });
releasedWordSchema.plugin(appendOnly);

export const Release = model("Release", releaseSchema);
export const ReleasedWord = model("ReleasedWord", releasedWordSchema);
export const ReleaseDoi = model("ReleaseDoi", releaseDoiSchema);
