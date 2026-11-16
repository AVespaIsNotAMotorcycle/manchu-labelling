import { resolve } from "node:path";

import MongoStore from "connect-mongo";
import mongoose from "mongoose";

import { createApp } from "./app.ts";
import { connectDatabase } from "./db.ts";
import { createMailer, sendAlertsBy } from "./mail.ts";

const port = Number(process.env.PORT ?? 3001);
const production = process.env.NODE_ENV === "production";

/** The development value is fixed so that restarting the server does not log everyone out. */
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (production) throw new Error("SESSION_SECRET must be set in production");
  return "development-only-session-secret";
}

if (production) {
  for (const name of ["APP_ORIGIN", "SECRETS_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} must be set in production`);
  }
}

const mailer = createMailer();
sendAlertsBy(mailer);

await connectDatabase();
await mongoose.connection.syncIndexes();

createApp({
  sessionSecret: sessionSecret(),
  secureCookies: production,
  persistentRateLimits: true,
  mailer,
  requireTwoFactorForStaff: production || process.env.REQUIRE_TWO_FACTOR === "true",
  origin: process.env.APP_ORIGIN,
  sessionStore: MongoStore.create({
    client: mongoose.connection.getClient() as never,
    collectionName: "sessions",
  }),
  storageDirectory: process.env.STORAGE_DIRECTORY ?? resolve(import.meta.dirname, "../../data/storage"),
}).listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
