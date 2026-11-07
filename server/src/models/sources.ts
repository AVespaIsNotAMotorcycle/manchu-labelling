import { model, Schema, type InferSchemaType } from "mongoose";

export const PRODUCTION_TYPES = ["woodblock", "movable_type", "manuscript", "other"] as const;
export const SCRIPT_TYPES = ["regular", "running", "memorial", "seal", "other"] as const;
export type ScriptClass = (typeof SCRIPT_TYPES)[number];

export function isScriptClass(value: unknown): value is ScriptClass {
  return (SCRIPT_TYPES as readonly unknown[]).includes(value);
}

const volumeSchema = new Schema(
  {
    /** The source's own identifier, such as Harvard's URN. */
    sourceId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    date: String,
    manifestUrl: { type: String, required: true },
    production: { type: String, enum: PRODUCTION_TYPES, required: true },
    script: { type: String, enum: SCRIPT_TYPES, required: true },
    rights: {
      /** Exports only include volumes marked `cleared`. */
      status: { type: String, enum: ["unreviewed", "cleared", "excluded"], default: "unreviewed" },
      statement: { type: String, required: true },
      attribution: { type: String, required: true },
      permanentLink: { type: String, required: true },
    },
  },
  { timestamps: true },
);

const pageSchema = new Schema({
  volume: { type: Schema.Types.ObjectId, ref: "Volume", required: true },
  index: { type: Number, required: true },
  canvasId: { type: String, required: true },
  imageServiceUrl: { type: String, required: true },
  imageKey: { type: String, required: true, unique: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
});
pageSchema.index({ volume: 1, index: 1 }, { unique: true });

export const Volume = model("Volume", volumeSchema);
export const Page = model("Page", pageSchema);
export type VolumeRecord = InferSchemaType<typeof volumeSchema>;
