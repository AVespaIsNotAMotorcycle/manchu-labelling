/**
 * Creates a test account. Registration is deliberately not open to the public yet.
 *
 * Usage: USER_PASSWORD='...' npm run create-user -w server -- person@example.com [--admin]
 */

import { parseArgs } from "node:util";

import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { User } from "../models/users.ts";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../passwords.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { admin: { type: "boolean", default: false } },
});
const [email] = positionals;
const password = process.env.USER_PASSWORD ?? "";
if (!email) throw new Error("Usage: USER_PASSWORD=... create-user <email> [--admin]");
if (password.length < MIN_PASSWORD_LENGTH) {
  throw new Error(`USER_PASSWORD must have at least ${MIN_PASSWORD_LENGTH} characters`);
}

await connectDatabase();
await User.create({
  email,
  passwordHash: await hashPassword(password),
  role: values.admin ? "admin" : "labeler",
});
console.log(`Created ${email}`);
await mongoose.disconnect();
