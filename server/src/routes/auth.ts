import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import { currentUser, requireUser } from "../auth.ts";
import { User } from "../models/users.ts";
import { DECOY_HASH, verifyPassword } from "../passwords.ts";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function describe(user: ReturnType<typeof currentUser>) {
  return {
    email: user.email,
    role: user.role,
    licenseAccepted: Boolean(user.labelsLicenseAcceptedAt),
  };
}

export function createAuthRouter(loginAttempts: number): Router {
  const authRouter = Router();

  /** There is deliberately no registration route. Accounts are created with the `create-user` script. */
  authRouter.post(
    "/login",
    rateLimit({
      windowMs: LOGIN_WINDOW_MS,
      limit: loginAttempts,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
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
