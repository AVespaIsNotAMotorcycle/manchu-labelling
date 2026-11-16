import { Router } from "express";
import { rateLimit, type Store } from "express-rate-limit";

import { alert } from "../alerts.ts";

import { currentUser, requireUser } from "../auth.ts";
import { User } from "../models/users.ts";
import { DECOY_HASH, verifyPassword } from "../passwords.ts";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

function describe(user: ReturnType<typeof currentUser>) {
  return {
    email: user.email,
    role: user.role,
    licenseAccepted: Boolean(user.labelsLicenseAcceptedAt),
  };
}

export interface AuthOptions {
  /** Login attempts allowed per address in 15 minutes. */
  loginAttempts: number;
  /** Failed logins allowed per account in an hour, from any address. */
  accountAttempts: number;
  /** Makes a store for a limiter. Without one, counts are kept in memory. */
  rateLimitStore?: (prefix: string) => Store;
}

const normalizeEmail = (email: unknown) => (typeof email === "string" ? email.trim().toLowerCase() : "");

export function createAuthRouter(options: AuthOptions): Router {
  const authRouter = Router();

  const byAddress = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: options.loginAttempts,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: options.rateLimitStore?.("login-address"),
    handler: (request, response, _next, limitOptions) => {
      alert("login.address_limited", { address: request.ip });
      response.status(limitOptions.statusCode).json({ error: "Too many attempts. Please try again later." });
    },
  });
  // Counts only failures, so that an attacker spreading guesses across addresses is still stopped.
  const byAccount = rateLimit({
    windowMs: ACCOUNT_WINDOW_MS,
    limit: options.accountAttempts,
    standardHeaders: false,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (request) => `account:${normalizeEmail(request.body?.email)}`,
    store: options.rateLimitStore?.("login-account"),
    handler: (request, response, _next, limitOptions) => {
      alert("login.account_limited", { email: normalizeEmail(request.body?.email), address: request.ip });
      response.status(limitOptions.statusCode).json({ error: "Too many attempts. Please try again later." });
    },
  });

  /** There is deliberately no registration route. Accounts are created with the `create-user` script. */
  authRouter.post(
    "/login",
    byAddress,
    byAccount,
    async (request, response) => {
      const { email, password } = request.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        response.status(400).json({ error: "Email and password are required" });
        return;
      }

      const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+passwordHash");
      const matches = await verifyPassword(password, user?.passwordHash ?? DECOY_HASH);
      if (!user || !matches) {
        response.status(401).json({ error: "Incorrect email or password" });
        return;
      }

      // A new session ID on login stops an attacker from fixing a session in advance.
      await new Promise<void>((resolve, reject) =>
        request.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
      request.session.userId = String(user._id);
      response.json(describe(user));
    },
  );

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

  return authRouter;
}
