import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { hashPassword, isBreached, PasswordRejected } from "../src/passwords.ts";

const PASSWORD = "Correct horse battery 1";
const suffix = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase().slice(5);

/** A fake range API that lists the given suffixes, and records what it was asked for. */
function rangeApi(lines: string[], asked: string[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push(String(url));
    assert.equal((init?.headers as Record<string, string>)["Add-Padding"], "true");
    return new Response(lines.join("\r\n"));
  }) as typeof fetch;
}

test("a breached password is refused, sending only the first 5 characters of its hash", async (context) => {
  delete process.env.PWNED_PASSWORDS;
  const asked: string[] = [];
  assert.equal(await isBreached(PASSWORD, rangeApi([`${suffix}:3`, "ABC:1"], asked)), true);
  assert.match(asked[0] ?? "", /\/range\/[0-9A-F]{5}$/);
  assert.doesNotMatch(asked[0] ?? "", new RegExp(suffix));
  assert.equal(await isBreached(PASSWORD, rangeApi([`${suffix}:0`, "ABC:1"])), false);
  await assert.rejects(hashPassword(PASSWORD, rangeApi([`${suffix}:12`])), PasswordRejected);
  assert.match(await hashPassword(PASSWORD, rangeApi([])), /^scrypt\$/);
});

test("the breach check is skipped if the service fails or it is turned off", async () => {
  delete process.env.PWNED_PASSWORDS;
  const failing = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await isBreached(PASSWORD, failing), false);
  } finally {
    console.warn = original;
  }
  process.env.PWNED_PASSWORDS = "off";
  assert.equal(await isBreached(PASSWORD, rangeApi([`${suffix}:3`])), false);
});

test("new passwords must follow the rules", async () => {
  await assert.rejects(hashPassword("short"), /at least 12 characters/);
});
