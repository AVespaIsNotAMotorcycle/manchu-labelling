import express, { type NextFunction, type Request, type Response } from "express";
import session, { type Store } from "express-session";

import { requireUser } from "./auth.ts";
import { adminRouter } from "./routes/admin.ts";
import { createAuthRouter } from "./routes/auth.ts";
import { labellingRouter } from "./routes/labelling.ts";

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LOGIN_ATTEMPTS = 10;
const IMAGE_KEY = /^[0-9a-f-]{36}\.jpg$/;

export interface AppOptions {
  sessionSecret: string;
  /** Requires HTTPS for session cookies. On outside of local development. */
  secureCookies: boolean;
  sessionStore?: Store;
  storageDirectory: string;
  /** Login attempts allowed per address in 15 minutes. */
  loginAttempts?: number;
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  if (options.secureCookies) app.set("trust proxy", 1);
  app.use(express.json());
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
  app.use("/api/auth", createAuthRouter(options.loginAttempts ?? DEFAULT_LOGIN_ATTEMPTS));
  app.use("/api/labelling", labellingRouter);
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
    console.error(error);
    response.status(500).json({ error: "Something went wrong" });
  });

  return app;
}
