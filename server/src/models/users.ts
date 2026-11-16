import { model, Schema } from "mongoose";

export const ROLES = ["labeler", "reviewer", "admin"] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /** Never returned by queries unless asked for by name. */
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "labeler" },
    /** When the user accepted the CC BY 4.0 license for their labels. */
    labelsLicenseAcceptedAt: Date,
    /** Set only if the user opts in to being credited, and never linked to annotator IDs in releases. */
    creditName: String,
    /** Set when a user registers, and cleared once they confirm their email. */
    pendingVerification: Boolean,
    /** Sessions that logged in before this are signed out. */
    passwordChangedAt: Date,
    /** Set when the account is deleted. Its email, password, and name are gone, and its labels stay. */
    deletedAt: Date,
    /** Two-factor authentication. Secrets are encrypted, and recovery codes are hashed. */
    twoFactor: {
      type: new Schema(
        {
          secret: String,
          /** A secret waiting for the user to confirm with a code. */
          pendingSecret: String,
          enabledAt: Date,
          /** The last time step used, so that a code cannot be used twice. */
          lastStep: Number,
          recoveryCodes: [String],
        },
        { _id: false },
      ),
      select: false,
    },
  },
  { timestamps: true },
);

export const User = model("User", userSchema);

/**
 * An invitation to register. Only its hash is stored, so the database cannot be used to register. An
 * invite can be tied to one email address.
 */
const inviteSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  email: { type: String, lowercase: true, trim: true },
  role: { type: String, enum: ROLES, default: "labeler" },
  note: String,
  createdAt: { type: Date, default: Date.now, immutable: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
  usedBy: { type: Schema.Types.ObjectId, ref: "User" },
});

export const Invite = model("Invite", inviteSchema);

/** A one-time link sent by email, to confirm an address or reset a password. Only its hash is stored. */
const emailTokenSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  purpose: { type: String, enum: ["verify", "reset"], required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
});
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const EmailToken = model("EmailToken", emailTokenSchema);
