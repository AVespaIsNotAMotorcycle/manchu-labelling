/**
 * Prints each user's hidden check results in each script class. Users are not told these yet.
 *
 * Usage: npm run check-results -w server
 */

import mongoose from "mongoose";

import { checkResults, summarizeChecks } from "../checks.ts";
import { connectDatabase } from "../db.ts";
import { User } from "../models/users.ts";

async function main(): Promise<void> {
  await connectDatabase();
  const summaries = summarizeChecks(await checkResults());
  const users = await User.find({}, "email").lean();
  const emails = new Map(users.map(({ _id, email }) => [String(_id), email]));
  const rows = [...summaries.entries()].map(([key, summary]) => {
    const [user, scriptClass] = key.split(":");
    return { user: emails.get(user as string) ?? user, scriptClass, ...summary };
  });
  if (rows.length === 0) console.log("No labels on hidden checks yet");
  else console.table(rows);
  await mongoose.disconnect();
}

await main();
