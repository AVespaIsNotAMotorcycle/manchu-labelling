import { resolve } from "node:path";

import MongoStore from "connect-mongo";
import mongoose from "mongoose";

import { createApp } from "./app.ts";
import { connectDatabase } from "./db.ts";

const port = Number(process.env.PORT ?? 3001);
const production = process.env.NODE_ENV === "production";

/** The development value is fixed so that restarting the server does not log everyone out. */
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (production) throw new Error("SESSION_SECRET must be set in production");
  return "development-only-session-secret";
}

await connectDatabase();
await mongoose.connection.syncIndexes();

createApp({
  sessionSecret: sessionSecret(),
  secureCookies: production,
  sessionStore: MongoStore.create({
    client: mongoose.connection.getClient() as never,
    collectionName: "sessions",
  }),
  storageDirectory: resolve(import.meta.dirname, "../../data/storage"),
}).listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
