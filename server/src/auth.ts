import type { NextFunction, Request, Response } from "express";

import { User } from "./models/users.ts";

declare module "express-session" {
  interface SessionData {
    userId: string;
    /** When the user finished logging in, in milliseconds. Sessions older than a password change end. */
    authenticatedAt: number;
    /** A user who gave the right password and still has to give a two-factor code. */
    pendingUserId: string;
    pendingAt: number;
  }
}

export type UserRecord = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

function loadUser(id: string | undefined) {
  return id ? User.findById(id).select("+twoFactor") : null;
}

export function currentUser(response: Response): UserRecord {
  return response.locals.user as UserRecord;
}

/** Whether the user has turned on two-factor authentication. */
export const hasTwoFactor = (user: UserRecord) => Boolean(user.twoFactor?.enabledAt);

/**
 * Loads the logged-in user. A session ends if the account was deleted, or if its password changed after
 * the session logged in, so that a reset signs out everyone who had the old password.
 */
export async function requireUser(request: Request, response: Response, next: NextFunction) {
  const user = await loadUser(request.session.userId);
  const changed = user?.passwordChangedAt?.getTime();
  const stale = changed !== undefined && (request.session.authenticatedAt ?? 0) < changed;
  if (!user || user.deletedAt || stale) {
    if (user) await new Promise<void>((resolve) => request.session.destroy(() => resolve()));
    response.status(401).json({ error: "Please log in" });
    return;
  }
  response.locals.user = user;
  next();
}

export function requireLicense(_request: Request, response: Response, next: NextFunction) {
  if (!currentUser(response).labelsLicenseAcceptedAt) {
    response.status(403).json({ error: "Please accept the license for your labels" });
    return;
  }
  next();
}

/** Reviewers and admins must use two-factor authentication where the app requires it. */
function needsTwoFactor(request: Request, response: Response): boolean {
  if (!request.app.locals.requireTwoFactorForStaff || hasTwoFactor(currentUser(response))) return false;
  response.status(403).json({
    error: "Please turn on two-factor authentication in your account settings to use these tools",
    code: "two_factor_required",
  });
  return true;
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (currentUser(response).role !== "admin") {
    response.status(403).json({ error: "Admins only" });
    return;
  }
  if (needsTwoFactor(request, response)) return;
  next();
}

/** Reviewers settle disagreements and disputes. Admins can do everything reviewers can. */
export function requireReviewer(request: Request, response: Response, next: NextFunction) {
  const { role } = currentUser(response);
  if (role !== "reviewer" && role !== "admin") {
    response.status(403).json({ error: "Reviewers only" });
    return;
  }
  if (needsTwoFactor(request, response)) return;
  next();
}
