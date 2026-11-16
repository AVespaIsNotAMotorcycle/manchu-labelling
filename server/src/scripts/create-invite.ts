/**
 * Prints a link that lets someone register. The link works once, for 14 days.
 *
 * Usage: npm run create-invite -w server -- [--email person@example.com] [--role labeler|reviewer|admin]
 *
 * APP_ORIGIN sets the start of the link, such as https://labels.example.org.
 */

import { parseArgs } from "node:util";

import mongoose from "mongoose";

import { createInvite, inviteUrl } from "../accounts.ts";
import { connectDatabase } from "../db.ts";
import { ROLES, type Role } from "../models/users.ts";

const { values } = parseArgs({ options: { email: { type: "string" }, role: { type: "string" }, note: { type: "string" } } });
if (values.role && !ROLES.includes(values.role as Role)) throw new Error(`The role must be one of ${ROLES.join(", ")}`);

await connectDatabase();
const { token, invite } = await createInvite({ email: values.email, role: values.role as Role | undefined, note: values.note });
console.log(inviteUrl(process.env.APP_ORIGIN ?? "http://localhost:5173", token));
console.log(`Expires ${invite.expiresAt.toISOString()}${invite.email ? `, for ${invite.email}` : ""}, role ${invite.role}`);
await mongoose.disconnect();
