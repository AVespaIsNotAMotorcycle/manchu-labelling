/**
 * Prints each user's hidden check results in each script class, and whether they are trusted now.
 *
 * Usage: npm run check-results -w server
 */

import mongoose from "mongoose";

import { checkResults, summarizeChecks } from "../checks.ts";
import { connectDatabase } from "../db.ts";
import { User } from "../models/users.ts";
import { TrustIndex } from "../trust.ts";

async function main(): Promise<void> {
  await connectDatabase();
  const results = await checkResults();
  const summaries = summarizeChecks(results);
  const trust = new TrustIndex(results);
  const now = new Date();
  const users = await User.find({}, "email").lean();
  const emails = new Map(users.map(({ _id, email }) => [String(_id), email]));
  const rows = [...summaries.entries()].map(([key, summary]) => {
    const [user, scriptClass] = key.split(":");
    return {
      user: emails.get(user as string) ?? user,
      scriptClass,
      ...summary,
      accuracy: Number(summary.accuracy.toFixed(3)),
      trustedNow: trust.isTrusted(user, scriptClass as string, now),
    };
  });
  if (rows.length === 0) console.log("No labels on hidden checks yet");
  else console.table(rows);
  await mongoose.disconnect();
}

await main();
