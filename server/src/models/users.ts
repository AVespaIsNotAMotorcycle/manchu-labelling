import { model, Schema } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /** Never returned by queries unless asked for by name. */
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["labeler", "reviewer", "admin"], default: "labeler" },
    /** When the user accepted the CC BY 4.0 license for their labels. */
    labelsLicenseAcceptedAt: Date,
    /** Set only if the user opts in to being credited, and never linked to annotator IDs in releases. */
    creditName: String,
  },
  { timestamps: true },
);

export const User = model("User", userSchema);
