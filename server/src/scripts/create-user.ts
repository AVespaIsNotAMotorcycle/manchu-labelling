/**
 * Creates a test account. Registration is deliberately not open to the public yet.
 *
 * Usage: npm run create-user -w server -- person@example.com [--admin | --reviewer]
 *
 * The password is prompted for, so that it stays out of shell history. Automated jobs with no
 * terminal can set USER_PASSWORD instead.
 */

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";

import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { User } from "../models/users.ts";
import { hashPassword } from "../passwords.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    admin: { type: "boolean", default: false },
    reviewer: { type: "boolean", default: false },
  },
});
const [email] = positionals;
if (!email || (values.admin && values.reviewer)) {
  throw new Error("Usage: create-user <email> [--admin | --reviewer]");
}

/** Reads a line without echoing it, because readline's output goes nowhere. */
async function askHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  const hidden = new Writable({ write: (_chunk, _encoding, done) => done() });
  const reader = createInterface({ input: stdin, output: hidden, terminal: true });
  reader.on("SIGINT", () => {
    reader.close();
    stdout.write("\n");
    process.exit(130);
  });
  const answer = await reader.question("");
  reader.close();
  stdout.write("\n");
  return answer;
}

async function readPassword(): Promise<string> {
  if (process.env.USER_PASSWORD !== undefined) return process.env.USER_PASSWORD;
  if (!stdin.isTTY) throw new Error("Run this in a terminal, or set USER_PASSWORD");
  const password = await askHidden("Password: ");
  if (password !== (await askHidden("Repeat password: "))) {
    throw new Error("The passwords do not match");
  }
  return password;
}

const passwordHash = await hashPassword(await readPassword());

await connectDatabase();
await User.create({
  email,
  passwordHash,
  role: values.admin ? "admin" : values.reviewer ? "reviewer" : "labeler",
});
console.log(`Created ${email}`);
await mongoose.disconnect();
