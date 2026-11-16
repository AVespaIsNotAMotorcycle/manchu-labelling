/**
 * Changes a user's role.
 *
 * Usage: npm run set-role -w server -- person@example.com reviewer
 *
 * Roles are `labeler`, `reviewer`, and `admin`. Reviewers settle labels and disputes, and confirm
 * held-back answers. Admins can also rule on crops.
 */

import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { ROLES, User } from "../models/users.ts";

const [email, role] = process.argv.slice(2);
if (!email || !ROLES.includes(role as (typeof ROLES)[number])) {
  throw new Error(`Usage: set-role <email> <${ROLES.join(" | ")}>`);
}

await connectDatabase();
const result = await User.updateOne({ email: email.trim().toLowerCase() }, { role });
console.log(result.matchedCount === 1 ? `${email} is now ${role}` : `No user with the email ${email}`);
await mongoose.disconnect();
