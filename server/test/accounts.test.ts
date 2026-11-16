import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { createApp } from "../src/app.ts";
import { connectDatabase } from "../src/db.ts";
import type { Message } from "../src/mail.ts";
import { Annotation } from "../src/models/labels.ts";
import { EmailToken, Invite, User, type Role } from "../src/models/users.ts";
import { hashPassword } from "../src/passwords.ts";
import { codeAt, stepAt } from "../src/totp.ts";

const PASSWORD = "Correct horse battery 1";
const NEW_PASSWORD = "Another horse battery 2";

let database: MongoMemoryServer;
let server: Server;
let base: string;
let passwordHash: string;
const sent: Message[] = [];

class Client {
  cookie = "";

  async request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0] as string;
    return response;
  }

  login(email: string, password = PASSWORD) {
    return this.request("/api/auth/login", { email, password });
  }
}

before(async () => {
  database = await MongoMemoryServer.create();
  await connectDatabase(database.getUri());
  passwordHash = await hashPassword(PASSWORD);
  server = createApp({
    sessionSecret: "test",
    secureCookies: false,
    storageDirectory: "/nonexistent",
    loginAttempts: 1000,
    accountAttempts: 1000,
    mailer: async (message) => {
      sent.push(message);
    },
    origin: "http://labels.test",
    requireTwoFactorForStaff: true,
  }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await mongoose.disconnect();
  await database.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await mongoose.connection.syncIndexes();
  sent.length = 0;
});

async function loggedIn(email: string, role: Role = "labeler") {
  await User.create({ email, passwordHash, role, labelsLicenseAcceptedAt: new Date() });
  const client = new Client();
  assert.equal((await client.login(email)).status, 200);
  return client;
}

/** The token from the link in the latest email. */
function linkToken(kind: string): string {
  const message = sent.at(-1);
  const match = message?.text.match(new RegExp(`http://labels\\.test/${kind}\\?(?:token|invite)=([\\w-]+)`));
  assert.ok(match, `No ${kind} link in ${message?.text}`);
  return match[1] as string;
}

async function makeInvite(admin: Client, body: object = {}) {
  const response = await admin.request("/api/admin/invites", body);
  assert.equal(response.status, 201);
  const { url } = await response.json();
  return new URL(url).searchParams.get("invite") as string;
}

test("an invite registers one account, which must confirm its email before logging in", async () => {
  const admin = await loggedIn("admin@example.com", "admin");
  // Admins need two-factor authentication before they can make invites.
  assert.equal((await admin.request("/api/admin/invites", {})).status, 403);
  await User.updateOne({ email: "admin@example.com" }, { "twoFactor.enabledAt": new Date() });
  const invite = await makeInvite(admin, { role: "reviewer" });
  assert.equal(await Invite.countDocuments({ tokenHash: invite }), 0);

  const visitor = new Client();
  const register = (body: object) => visitor.request("/api/auth/register", { invite, ...body });
  assert.equal((await register({ email: "not an email", password: PASSWORD })).status, 400);
  const weak = await register({ email: "new@example.com", password: "weak" });
  assert.equal(weak.status, 400);
  assert.match((await weak.json()).error, /at least 12 characters/);
  assert.equal((await register({ email: "New@Example.com", password: PASSWORD })).status, 202);
  assert.equal((await register({ email: "other@example.com", password: PASSWORD })).status, 400);

  const user = await User.findOne({ email: "new@example.com" }).orFail();
  assert.equal(user.role, "reviewer");
  const login = await visitor.login("new@example.com");
  assert.equal(login.status, 403);
  assert.equal((await login.json()).code, "unverified");

  assert.equal(sent.at(-1)?.to, "new@example.com");
  const token = linkToken("verify-email");
  assert.equal((await visitor.request("/api/auth/verify-email", { token })).status, 204);
  assert.equal((await visitor.request("/api/auth/verify-email", { token })).status, 400);
  assert.equal((await visitor.login("new@example.com")).status, 200);

  const invites = (await (await admin.request("/api/admin/invites")).json()).items;
  assert.equal(invites[0].status, "used");
});

test("an invite can be tied to an email, and registering an existing email tells its owner instead", async () => {
  await User.create({ email: "taken@example.com", passwordHash });
  const { createInvite } = await import("../src/accounts.ts");
  const bound = (await createInvite({ email: "invited@example.com" })).token;
  const visitor = new Client();
  assert.equal((await visitor.request("/api/auth/register", { invite: bound, email: "x@example.com", password: PASSWORD })).status, 400);

  const open = (await createInvite({})).token;
  const response = await visitor.request("/api/auth/register", { invite: open, email: "taken@example.com", password: PASSWORD });
  assert.equal(response.status, 202);
  assert.equal(await User.countDocuments(), 1);
  assert.match(sent.at(-1)?.subject ?? "", /tried to register/);
  // The invite is still unused.
  assert.equal((await Invite.findOne({ email: { $exists: false } }).orFail()).usedAt, undefined);

  const expired = (await createInvite({ days: -1 })).token;
  assert.equal((await visitor.request("/api/auth/register", { invite: expired, email: "y@example.com", password: PASSWORD })).status, 400);
});

test("a password reset link sets a new password once and signs out other sessions", async () => {
  const other = await loggedIn("person@example.com");
  const visitor = new Client();
  assert.equal((await visitor.request("/api/auth/forgot-password", { email: "nobody@example.com" })).status, 204);
  assert.equal(sent.length, 0);
  assert.equal((await visitor.request("/api/auth/forgot-password", { email: "Person@example.com" })).status, 204);
  const token = linkToken("reset-password");

  assert.equal((await visitor.request("/api/auth/reset-password", { token, password: "weak" })).status, 400);
  assert.equal((await visitor.request("/api/auth/reset-password", { token, password: NEW_PASSWORD })).status, 204);
  assert.equal((await visitor.request("/api/auth/reset-password", { token, password: NEW_PASSWORD })).status, 400);

  assert.equal((await other.request("/api/auth/me")).status, 401);
  assert.equal((await visitor.login("person@example.com")).status, 401);
  assert.equal((await visitor.login("person@example.com", NEW_PASSWORD)).status, 200);
  assert.equal(await EmailToken.countDocuments({ usedAt: { $exists: false } }), 0);
});

test("changing a password needs the current one and signs out other sessions", async () => {
  const client = await loggedIn("person@example.com");
  const other = new Client();
  await other.login("person@example.com");
  const change = (current: string, password: string) =>
    client.request("/api/auth/change-password", { current, password });
  assert.equal((await change("wrong", NEW_PASSWORD)).status, 400);
  assert.equal((await change(PASSWORD, "weak")).status, 400);
  assert.equal((await change(PASSWORD, NEW_PASSWORD)).status, 204);
  assert.equal((await client.request("/api/auth/me")).status, 200);
  assert.equal((await other.request("/api/auth/me")).status, 401);
  assert.equal((await new Client().login("person@example.com", NEW_PASSWORD)).status, 200);
});

test("deleting an account removes personal data and keeps labels", async () => {
  const client = await loggedIn("person@example.com");
  const user = await User.findOne({ email: "person@example.com" }).orFail();
  await User.updateOne({ _id: user._id }, { creditName: "Ada" });
  await Annotation.create({ wordImage: new mongoose.Types.ObjectId(), user: user._id, category: "chinese", converterVersion: 1 });

  assert.equal((await client.request("/api/auth/delete-account", { password: "wrong" })).status, 400);
  assert.equal((await client.request("/api/auth/delete-account", { password: PASSWORD })).status, 204);
  assert.equal((await client.request("/api/auth/me")).status, 401);
  assert.equal((await new Client().login("person@example.com")).status, 401);

  const deleted = await User.findById(user._id).select("+passwordHash").lean();
  assert.match(deleted?.email ?? "", /^deleted-.*@deleted\.invalid$/);
  assert.equal(deleted?.creditName, undefined);
  assert.ok(deleted?.deletedAt);
  assert.equal(await Annotation.countDocuments({ user: user._id }), 1);
  // The email can be used again.
  await User.create({ email: "person@example.com", passwordHash });
});

test("two-factor codes are needed after the password, and each code or recovery code works once", async () => {
  const client = await loggedIn("person@example.com");
  assert.equal((await client.request("/api/auth/two-factor/setup", { password: "wrong" })).status, 400);
  const { secret, uri } = await (await client.request("/api/auth/two-factor/setup", { password: PASSWORD })).json();
  assert.match(uri, /^otpauth:\/\/totp\/Manchu%20Labelling%3Aperson%40example\.com\?secret=/);
  assert.equal((await client.request("/api/auth/two-factor/enable", { code: "000000" })).status, 400);

  const now = stepAt(Date.now());
  const enabled = await client.request("/api/auth/two-factor/enable", { code: codeAt(secret, now) });
  assert.equal(enabled.status, 200);
  const { recoveryCodes } = await enabled.json();
  assert.equal(recoveryCodes.length, 10);
  assert.equal((await (await client.request("/api/auth/me")).json()).twoFactor, true);
  const stored = await User.findOne({ email: "person@example.com" }).select("+twoFactor").lean();
  assert.ok(!JSON.stringify(stored).includes(secret));
  assert.ok(!JSON.stringify(stored).includes(recoveryCodes[0]));

  const visitor = new Client();
  assert.deepEqual(await (await visitor.login("person@example.com")).json(), { twoFactor: true });
  assert.equal((await visitor.request("/api/auth/me")).status, 401);
  assert.equal((await visitor.request("/api/auth/login/two-factor", { code: "123456" })).status, 401);
  // The code used to enable two-factor authentication cannot be used again.
  assert.equal((await visitor.request("/api/auth/login/two-factor", { code: codeAt(secret, now) })).status, 401);
  assert.equal((await visitor.request("/api/auth/login/two-factor", { code: codeAt(secret, now + 1) })).status, 200);
  assert.equal((await visitor.request("/api/auth/me")).status, 200);

  const another = new Client();
  await another.login("person@example.com");
  const recovery = recoveryCodes[0].toUpperCase();
  assert.equal((await another.request("/api/auth/login/two-factor", { code: recovery })).status, 200);
  const third = new Client();
  await third.login("person@example.com");
  assert.equal((await third.request("/api/auth/login/two-factor", { code: recovery })).status, 401);

  assert.equal((await client.request("/api/auth/two-factor/disable", { password: PASSWORD, code: "000000" })).status, 400);
  const disable = await client.request("/api/auth/two-factor/disable", { password: PASSWORD, code: recoveryCodes[1] });
  assert.equal(disable.status, 204);
  assert.equal((await new Client().login("person@example.com")).status, 200);
});

test("reviewers must turn on two-factor authentication to use reviewer tools", async () => {
  const reviewer = await loggedIn("reviewer@example.com", "reviewer");
  const me = await (await reviewer.request("/api/auth/me")).json();
  assert.equal(me.twoFactorRequired, true);
  const blocked = await reviewer.request("/api/review/disputes");
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, "two_factor_required");

  const { secret } = await (await reviewer.request("/api/auth/two-factor/setup", { password: PASSWORD })).json();
  await reviewer.request("/api/auth/two-factor/enable", { code: codeAt(secret, stepAt(Date.now())) });
  assert.equal((await reviewer.request("/api/review/disputes")).status, 200);
  assert.equal((await (await reviewer.request("/api/auth/me")).json()).twoFactorRequired, false);
});
