import type { NextFunction, Request, Response } from "express";

import { User } from "./models/users.ts";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

export type UserRecord = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

function loadUser(id: string | undefined) {
  return id ? User.findById(id) : null;
}

export function currentUser(response: Response): UserRecord {
  return response.locals.user as UserRecord;
}

export async function requireUser(request: Request, response: Response, next: NextFunction) {
  const user = await loadUser(request.session.userId);
  if (!user) {
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

export function requireAdmin(_request: Request, response: Response, next: NextFunction) {
  if (currentUser(response).role !== "admin") {
    response.status(403).json({ error: "Admins only" });
    return;
  }
  next();
}
