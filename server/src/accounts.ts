import { randomBytes } from "node:crypto";

import type { Types } from "mongoose";

import type { Mailer } from "./mail.ts";
import { EmailToken, Invite, User, type Role } from "./models/users.ts";
import { hashPassword } from "./passwords.ts";
import { hashToken, newToken } from "./tokens.ts";

type Id = Types.ObjectId;

/** An account problem whose message can be shown to the user. */
export class AccountError extends Error {}

const INVITE_DAYS = 14;
const VERIFY_HOURS = 48;
const RESET_MINUTES = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (email: unknown) => (typeof email === "string" ? email.trim().toLowerCase() : "");

const later = (milliseconds: number) => new Date(Date.now() + milliseconds);

/**
 * Sends an email without waiting for it, so that a response takes the same time whether or not an
 * email went out. Otherwise the timing would show whether an account exists.
 */
function sendInBackground(mailer: Mailer, message: Parameters<Mailer>[0]): void {
  mailer(message).catch((error: unknown) => console.error("Could not send an email", error));
}

export async function createInvite(options: {
  createdBy?: Id;
  email?: string;
  role?: Role;
  note?: string;
  days?: number;
}) {
  const email = options.email ? normalizeEmail(options.email) : undefined;
  if (email && !EMAIL.test(email)) throw new AccountError("That email address does not look right");
  const { token, hash } = newToken();
  const invite = await Invite.create({
    tokenHash: hash,
    createdBy: options.createdBy,
    email,
    role: options.role ?? "labeler",
    note: options.note,
    expiresAt: later((options.days ?? INVITE_DAYS) * 24 * 60 * 60 * 1000),
  });
  return { token, invite };
}

export const inviteUrl = (appUrl: string, token: string) => `${appUrl}/register?invite=${token}`;

async function sendLink(
  mailer: Mailer,
  user: { _id: Id; email: string },
  purpose: "verify" | "reset",
  appUrl: string,
) {
  const { token, hash } = newToken();
  const lifetime = purpose === "verify" ? VERIFY_HOURS * 60 * 60 * 1000 : RESET_MINUTES * 60 * 1000;
  await EmailToken.create({ user: user._id, purpose, tokenHash: hash, expiresAt: later(lifetime) });
  if (purpose === "verify") {
    sendInBackground(mailer, {
      to: user.email,
      subject: "Confirm your email for Manchu Labelling",
      text: `Please confirm your email address by opening this link within ${VERIFY_HOURS} hours:\n\n${appUrl}/verify-email?token=${token}\n\nIf you did not register, you can ignore this email.`,
    });
  } else {
    sendInBackground(mailer, {
      to: user.email,
      subject: "Reset your Manchu Labelling password",
      text: `Someone asked to reset the password for this account. To choose a new password, open this link within ${RESET_MINUTES} minutes:\n\n${appUrl}/reset-password?token=${token}\n\nIf it was not you, you can ignore this email, and your password will not change.`,
    });
  }
}

/**
 * Registers a user with an invite. The account cannot log in until its email is confirmed. If the email
 * already has an account, nothing is created and the owner of that email is told instead, so the
 * response never reveals who has an account.
 */
export async function register(options: {
  invite: unknown;
  email: unknown;
  password: unknown;
  mailer: Mailer;
  appUrl: string;
}): Promise<void> {
  const email = normalizeEmail(options.email);
  if (typeof options.invite !== "string" || !options.invite) {
    throw new AccountError("This invite link is not valid");
  }
  if (!EMAIL.test(email) || email.length > 254) throw new AccountError("That email address does not look right");
  if (typeof options.password !== "string") throw new AccountError("Please choose a password");

  const invite = await Invite.findOne({ tokenHash: hashToken(options.invite) });
  if (!invite || invite.usedAt || invite.expiresAt <= new Date()) {
    throw new AccountError("This invite link has expired or been used. Please ask for a new one.");
  }
  if (invite.email && invite.email !== email) {
    throw new AccountError("This invite is for a different email address");
  }
  const passwordHash = await hashPassword(options.password);

  const existing = await User.findOne({ email });
  if (existing) {
    sendInBackground(options.mailer, {
      to: email,
      subject: "Someone tried to register with your email",
      text: `Someone tried to register for Manchu Labelling with this email address, which already has an account. If it was you, log in instead, or reset your password at ${options.appUrl}/forgot-password.`,
    });
    return;
  }

  const claimed = await Invite.updateOne(
    { _id: invite._id, usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } },
  );
  if (claimed.modifiedCount !== 1) throw new AccountError("This invite link has already been used");
  const user = await User.create({ email, passwordHash, role: invite.role, pendingVerification: true });
  await Invite.updateOne({ _id: invite._id }, { usedBy: user._id });
  await sendLink(options.mailer, user, "verify", options.appUrl);
}

/** Marks a link's token as used, once, if it is still valid. */
async function useToken(token: unknown, purpose: "verify" | "reset") {
  if (typeof token !== "string" || !token) return null;
  return EmailToken.findOneAndUpdate(
    { tokenHash: hashToken(token), purpose, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
}

export async function verifyEmail(token: unknown): Promise<void> {
  const record = await useToken(token, "verify");
  if (!record) throw new AccountError("This link has expired or been used. Log in to get a new one.");
  await User.updateOne({ _id: record.user }, { $unset: { pendingVerification: "" } });
}

/** Sends a new confirmation link. Says nothing about whether the account exists. */
export async function resendVerification(email: unknown, mailer: Mailer, appUrl: string): Promise<void> {
  const user = await User.findOne({
    email: normalizeEmail(email),
    pendingVerification: true,
    deletedAt: { $exists: false },
  });
  if (user) await sendLink(mailer, user, "verify", appUrl);
}

/** Emails a reset link if the account exists. The response is the same either way. */
export async function requestPasswordReset(email: unknown, mailer: Mailer, appUrl: string): Promise<void> {
  const user = await User.findOne({ email: normalizeEmail(email), deletedAt: { $exists: false } });
  if (user) await sendLink(mailer, user, "reset", appUrl);
}

/**
 * Sets a new password from a reset link, signs out every session, and confirms the email, since the
 * link proves the user can read it. Other reset links for the account stop working.
 */
export async function resetPassword(token: unknown, password: unknown): Promise<void> {
  if (typeof password !== "string") throw new AccountError("Please choose a password");
  if (typeof token !== "string" || !token) throw new AccountError("This link has expired or been used");
  // The password is checked before the link is used up, so that a rejected password can be retried.
  const pending = await EmailToken.exists({
    tokenHash: hashToken(token),
    purpose: "reset",
    usedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!pending) throw new AccountError("This link has expired or been used. Please ask for a new one.");
  const passwordHash = await hashPassword(password);
  const record = await useToken(token, "reset");
  if (!record) throw new AccountError("This link has expired or been used. Please ask for a new one.");
  await User.updateOne(
    { _id: record.user },
    { $set: { passwordHash, passwordChangedAt: new Date() }, $unset: { pendingVerification: "" } },
  );
  await EmailToken.updateMany(
    { user: record.user, purpose: "reset", usedAt: { $exists: false } },
    { usedAt: new Date() },
  );
}

/**
 * Deletes an account's personal data: its email, password, credit name, and two-factor secrets. Its
 * labels, disputes, and other records stay, linked only to the account's ID, since labels are already
 * licensed CC BY 4.0. Every session is signed out.
 */
export async function deleteAccount(user: Id): Promise<void> {
  const now = new Date();
  // Not a valid hash, so no password can ever match it.
  const unusable = ["deleted", randomBytes(16).toString("hex")].join(":");
  await User.updateOne(
    { _id: user },
    {
      $set: {
        email: `deleted-${user}@deleted.invalid`,
        passwordHash: unusable,
        deletedAt: now,
        passwordChangedAt: now,
        role: "labeler",
      },
      $unset: { creditName: "", twoFactor: "", pendingVerification: "" },
    },
  );
  await EmailToken.deleteMany({ user });
}
