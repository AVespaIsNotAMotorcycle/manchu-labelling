import express, { type NextFunction, type Request, type Response } from "express";
import session, { type Store } from "express-session";

import { requireUser } from "./auth.ts";
import { adminRouter } from "./routes/admin.ts";
import { createAuthRouter } from "./routes/auth.ts";
import { labellingRouter } from "./routes/labelling.ts";
import { profileRouter } from "./routes/profile.ts";
import { reviewRouter } from "./routes/review.ts";
import { trainingRouter } from "./routes/training.ts";
import { createMailer, type Mailer } from "./mail.ts";
import { HashingBusyError } from "./passwords.ts";
import { MongoRateLimitStore } from "./rate-limit.ts";
import { requireSameOrigin, securityHeaders } from "./security.ts";

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LOGIN_ATTEMPTS = 10;
const DEFAULT_ACCOUNT_ATTEMPTS = 10;
const IMAGE_KEY = /^[0-9a-f-]{36}\.(jpg|png)$/;

export interface AppOptions {
  sessionSecret: string;
  /** Requires HTTPS for session cookies. On outside of local development. */
  secureCookies: boolean;
  sessionStore?: Store;
  storageDirectory: string;
  /** Login attempts allowed per address in 15 minutes. */
  loginAttempts?: number;
  /** Failed logins allowed per account in an hour. */
  accountAttempts?: number;
  /** Keeps rate limit counts in MongoDB, so that they survive a restart. */
  persistentRateLimits?: boolean;
  /** Sends email. Defaults to SMTP_URL, or the console in development. */
  mailer?: Mailer;
  /** Whether reviewers and admins must turn on two-factor authentication. On in production. */
  requireTwoFactorForStaff?: boolean;
  /** The address users reach the app at, such as https://labels.example.org. Derived from the request if unset. */
  origin?: string;
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  app.locals.requireTwoFactorForStaff = options.requireTwoFactorForStaff ?? false;
  app.locals.origin = options.origin;
  app.disable("x-powered-by");
  if (options.secureCookies) app.set("trust proxy", 1);
  app.use(securityHeaders({ https: options.secureCookies }));
  app.use(requireSameOrigin({ origin: options.origin }));
  app.use(express.json({ limit: "100kb" }));
  app.use(
    session({
      secret: options.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: options.sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookies,
        maxAge: SESSION_MAX_AGE_MS,
      },
    }),
  );

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use(
    "/api/auth",
    createAuthRouter({
      loginAttempts: options.loginAttempts ?? DEFAULT_LOGIN_ATTEMPTS,
      accountAttempts: options.accountAttempts ?? DEFAULT_ACCOUNT_ATTEMPTS,
      rateLimitStore: options.persistentRateLimits ? (prefix) => new MongoRateLimitStore(prefix) : undefined,
      mailer: options.mailer ?? createMailer(),
      appUrl: options.origin,
      requireTwoFactorForStaff: options.requireTwoFactorForStaff ?? false,
    }),
  );
  app.use("/api/labelling", labellingRouter);
  app.use("/api/training", trainingRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/review", reviewRouter);
  app.use("/api/admin", adminRouter);

  app.get("/api/images/:key", requireUser, (request, response) => {
    const { key } = request.params;
    if (typeof key !== "string" || !IMAGE_KEY.test(key)) {
      response.status(404).end();
      return;
    }
    response.sendFile(key, {
      root: options.storageDirectory,
      headers: { "Cache-Control": "private, max-age=86400" },
    });
  });

  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof HashingBusyError) {
      response.status(503).set("Retry-After", "5").json({ error: error.message });
      return;
    }
    if ((error as { type?: string }).type === "entity.too.large") {
      response.status(413).json({ error: "This request is too large" });
      return;
    }
    console.error(error);
    response.status(500).json({ error: "Something went wrong" });
  });

  return app;
}
