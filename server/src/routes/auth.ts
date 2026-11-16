import { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";

import {
  AccountError,
  deleteAccount,
  normalizeEmail,
  register,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "../accounts.ts";
import { alert } from "../alerts.ts";
import { currentUser, hasTwoFactor, requireUser, type UserRecord } from "../auth.ts";
import type { Mailer } from "../mail.ts";
import { User } from "../models/users.ts";
import { DECOY_HASH, hashPassword, PasswordRejected, verifyPassword } from "../passwords.ts";
import { decryptSecret, encryptSecret, hashToken } from "../tokens.ts";
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from "../totp.ts";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
/** How long a user has to give a two-factor code after their password. */
const PENDING_LOGIN_MS = 5 * 60 * 1000;
const TOO_MANY = "Too many attempts. Please try again later.";

export interface AuthOptions {
  /** Login attempts allowed per address in 15 minutes. */
  loginAttempts: number;
  /** Failed logins allowed per account in an hour, from any address. */
  accountAttempts: number;
  /** Makes a store for a limiter. Without one, counts are kept in memory. */
  rateLimitStore?: (prefix: string) => Store;
  mailer: Mailer;
  /** The address links in emails point to. Derived from the request if unset. */
  appUrl?: string;
  /** Whether reviewers and admins must turn on two-factor authentication. */
  requireTwoFactorForStaff: boolean;
}

export function createAuthRouter(options: AuthOptions): Router {
  const authRouter = Router();
  const appUrl = (request: Request) => options.appUrl ?? `${request.protocol}://${request.get("Host")}`;

  function limiter(
    name: string,
    settings: { windowMs: number; limit: number; key?: (request: Request) => string; failuresOnly?: boolean },
  ) {
    return rateLimit({
      windowMs: settings.windowMs,
      limit: settings.limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skipSuccessfulRequests: settings.failuresOnly ?? false,
      ...(settings.key ? { keyGenerator: settings.key } : {}),
      store: options.rateLimitStore?.(name),
      handler: (request, response, _next, limitOptions) => {
        alert(`${name}.limited`, {
          address: request.ip,
          ...(request.body?.email ? { email: normalizeEmail(request.body.email) } : {}),
        });
        response.status(limitOptions.statusCode).json({ error: TOO_MANY });
      },
    });
  }

  const byAddress = limiter("login-address", { windowMs: LOGIN_WINDOW_MS, limit: options.loginAttempts });
  /** For other account actions that check a password or a token, so they cannot be used to guess. */
  const accountActions = limiter("account-address", { windowMs: LOGIN_WINDOW_MS, limit: 30 });
  // Counts only failures, so that an attacker spreading guesses across addresses is still stopped.
  const byAccount = limiter("login-account", {
    windowMs: ACCOUNT_WINDOW_MS,
    limit: options.accountAttempts,
    failuresOnly: true,
    key: (request) => `account:${normalizeEmail(request.body?.email)}`,
  });
  // Someone who already has the password gets 10 guesses an hour at a six-digit code, about one chance
  // in 1,400 a day, and reaching the limit raises an alert.
  const twoFactorByAccount = limiter("two-factor", {
    windowMs: ACCOUNT_WINDOW_MS,
    limit: 10,
    failuresOnly: true,
    key: (request) =>
      `user:${request.session.pendingUserId ?? request.session.userId ?? ipKeyGenerator(request.ip ?? "")}`,
  });
  // Emails cost money and can annoy people, so each address and each email gets a few an hour.
  const emailsByAddress = limiter("email-address", { windowMs: ACCOUNT_WINDOW_MS, limit: 10 });
  const emailsByAccount = limiter("email-account", {
    windowMs: ACCOUNT_WINDOW_MS,
    limit: 3,
    key: (request) => `email:${normalizeEmail(request.body?.email)}`,
  });

  function describe(user: UserRecord) {
    const staff = user.role === "reviewer" || user.role === "admin";
    return {
      email: user.email,
      role: user.role,
      licenseAccepted: Boolean(user.labelsLicenseAcceptedAt),
      twoFactor: hasTwoFactor(user),
      twoFactorRequired: staff && options.requireTwoFactorForStaff && !hasTwoFactor(user),
    };
  }

  /** A new session ID on login stops an attacker from fixing a session in advance. */
  async function startSession(request: Request, user: UserRecord) {
    await new Promise<void>((resolve, reject) =>
      request.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    request.session.userId = String(user._id);
    request.session.authenticatedAt = Date.now();
  }

  /** Runs an account action, turning problems the user can fix into a 400 with their message. */
  async function attempt(response: Response, action: () => Promise<void>, status = 204) {
    try {
      await action();
    } catch (error) {
      if (!(error instanceof AccountError || error instanceof PasswordRejected)) throw error;
      response.status(400).json({ error: error.message });
      return;
    }
    if (!response.headersSent) response.status(status).end();
  }

  /** Checks a two-factor code or an unused recovery code, using each only once. */
  async function checkSecondFactor(user: UserRecord, code: unknown): Promise<boolean> {
    if (typeof code !== "string" || !user.twoFactor?.secret) return false;
    const step = verifyTotp(decryptSecret(user.twoFactor.secret), code, user.twoFactor.lastStep ?? -1);
    if (step !== null) {
      // Saving the step only if it is newer stops the same code working twice, even at the same moment.
      const saved = await User.updateOne(
        { _id: user._id, $or: [{ "twoFactor.lastStep": { $lt: step } }, { "twoFactor.lastStep": { $exists: false } }] },
        { $set: { "twoFactor.lastStep": step } },
      );
      return saved.modifiedCount === 1;
    }
    const hashed = hashToken(normalizeRecoveryCode(code));
    const used = await User.updateOne(
      { _id: user._id, "twoFactor.recoveryCodes": hashed },
      { $pull: { "twoFactor.recoveryCodes": hashed } },
    );
    if (used.modifiedCount === 1) alert("two_factor.recovery_code_used", { user: String(user._id) });
    return used.modifiedCount === 1;
  }

  async function passwordMatches(user: UserRecord, password: unknown): Promise<boolean> {
    const record = await User.findById(user._id).select("+passwordHash").lean();
    return typeof password === "string" && Boolean(record) && verifyPassword(password, record?.passwordHash ?? DECOY_HASH);
  }

  authRouter.post("/login", byAddress, byAccount, async (request, response) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      response.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await User.findOne({ email: normalizeEmail(email) }).select("+passwordHash +twoFactor");
    const matches = await verifyPassword(password, user?.passwordHash ?? DECOY_HASH);
    if (!user || !matches || user.deletedAt) {
      response.status(401).json({ error: "Incorrect email or password" });
      return;
    }
    if (user.pendingVerification) {
      response.status(403).json({ error: "Please confirm your email address first", code: "unverified" });
      return;
    }
    if (hasTwoFactor(user)) {
      await new Promise<void>((resolve, reject) =>
        request.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
      request.session.pendingUserId = String(user._id);
      request.session.pendingAt = Date.now();
      response.json({ twoFactor: true });
      return;
    }
    await startSession(request, user);
    response.json(describe(user));
  });

  authRouter.post("/login/two-factor", twoFactorByAccount, async (request, response) => {
    const { pendingUserId, pendingAt } = request.session;
    if (!pendingUserId || !pendingAt || Date.now() - pendingAt > PENDING_LOGIN_MS) {
      response.status(401).json({ error: "Please log in again" });
      return;
    }
    const user = await User.findById(pendingUserId).select("+twoFactor");
    if (!user || user.deletedAt || !(await checkSecondFactor(user, request.body?.code))) {
      response.status(401).json({ error: "That code is not right" });
      return;
    }
    await startSession(request, user);
    response.json(describe(user));
  });

  authRouter.post("/logout", (request, response, next) => {
    request.session.destroy((error) => {
      if (error) next(error);
      else response.clearCookie("connect.sid").status(204).end();
    });
  });

  authRouter.get("/me", requireUser, (_request, response) => {
    response.json(describe(currentUser(response)));
  });

  authRouter.post("/accept-license", requireUser, async (_request, response) => {
    const user = currentUser(response);
    user.labelsLicenseAcceptedAt ??= new Date();
    await user.save();
    response.json(describe(user));
  });

  authRouter.post("/register", emailsByAddress, async (request, response) => {
    const { invite, email, password } = request.body ?? {};
    await attempt(
      response,
      () => register({ invite, email, password, mailer: options.mailer, appUrl: appUrl(request) }),
      202,
    );
  });

  authRouter.post("/verify-email", accountActions, async (request, response) => {
    await attempt(response, () => verifyEmail(request.body?.token));
  });

  authRouter.post("/resend-verification", emailsByAddress, emailsByAccount, async (request, response) => {
    await resendVerification(request.body?.email, options.mailer, appUrl(request));
    response.status(204).end();
  });

  authRouter.post("/forgot-password", emailsByAddress, emailsByAccount, async (request, response) => {
    await requestPasswordReset(request.body?.email, options.mailer, appUrl(request));
    response.status(204).end();
  });

  authRouter.post("/reset-password", accountActions, async (request, response) => {
    await attempt(response, () => resetPassword(request.body?.token, request.body?.password));
  });

  authRouter.post("/change-password", requireUser, accountActions, async (request, response) => {
    const user = currentUser(response);
    const { current, password } = request.body ?? {};
    if (!(await passwordMatches(user, current))) {
      response.status(400).json({ error: "Your current password is not right" });
      return;
    }
    if (typeof password !== "string") {
      response.status(400).json({ error: "Please choose a new password" });
      return;
    }
    await attempt(response, async () => {
      const passwordHash = await hashPassword(password);
      await User.updateOne({ _id: user._id }, { passwordHash, passwordChangedAt: new Date() });
      // Other sessions end, and this one carries on with a new ID.
      await startSession(request, user);
    });
  });

  authRouter.post("/delete-account", requireUser, accountActions, async (request, response) => {
    const user = currentUser(response);
    if (!(await passwordMatches(user, request.body?.password))) {
      response.status(400).json({ error: "Your password is not right" });
      return;
    }
    await deleteAccount(user._id);
    alert("account.deleted", { user: String(user._id) });
    request.session.destroy(() => response.clearCookie("connect.sid").status(204).end());
  });

  /** Starts two-factor setup. The secret only takes effect once the user confirms it with a code. */
  authRouter.post("/two-factor/setup", requireUser, accountActions, async (request, response) => {
    const user = currentUser(response);
    if (hasTwoFactor(user)) {
      response.status(409).json({ error: "Two-factor authentication is already on" });
      return;
    }
    if (!(await passwordMatches(user, request.body?.password))) {
      response.status(400).json({ error: "Your password is not right" });
      return;
    }
    const secret = newTotpSecret();
    await User.updateOne({ _id: user._id }, { "twoFactor.pendingSecret": encryptSecret(secret) });
    response.json({ secret, uri: otpauthUri(secret, user.email) });
  });

  authRouter.post("/two-factor/enable", requireUser, twoFactorByAccount, async (request, response) => {
    const user = currentUser(response);
    const pending = user.twoFactor?.pendingSecret;
    const code = request.body?.code;
    const step = pending && typeof code === "string" ? verifyTotp(decryptSecret(pending), code) : null;
    if (hasTwoFactor(user) || !pending || step === null) {
      response.status(400).json({ error: "That code is not right. Check the time on your device and try again." });
      return;
    }
    const recoveryCodes = newRecoveryCodes();
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "twoFactor.secret": pending,
          "twoFactor.enabledAt": new Date(),
          "twoFactor.lastStep": step,
          "twoFactor.recoveryCodes": recoveryCodes.map((recovery) => hashToken(normalizeRecoveryCode(recovery))),
        },
        $unset: { "twoFactor.pendingSecret": "" },
      },
    );
    alert("two_factor.enabled", { user: String(user._id) });
    response.json({ recoveryCodes });
  });

  authRouter.post("/two-factor/disable", requireUser, twoFactorByAccount, async (request, response) => {
    const user = currentUser(response);
    const { password, code } = request.body ?? {};
    if (!hasTwoFactor(user) || !(await passwordMatches(user, password)) || !(await checkSecondFactor(user, code))) {
      response.status(400).json({ error: "Your password or code is not right" });
      return;
    }
    await User.updateOne({ _id: user._id }, { $unset: { twoFactor: "" } });
    alert("two_factor.disabled", { user: String(user._id) });
    response.status(204).end();
  });

  authRouter.post("/two-factor/recovery-codes", requireUser, accountActions, async (request, response) => {
    const user = currentUser(response);
    if (!hasTwoFactor(user) || !(await passwordMatches(user, request.body?.password))) {
      response.status(400).json({ error: "Your password is not right" });
      return;
    }
    const recoveryCodes = newRecoveryCodes();
    await User.updateOne(
      { _id: user._id },
      { "twoFactor.recoveryCodes": recoveryCodes.map((recovery) => hashToken(normalizeRecoveryCode(recovery))) },
    );
    response.json({ recoveryCodes });
  });

  return authRouter;
}
