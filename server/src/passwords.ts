import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

import { passwordProblems } from "@manchu-labelling/passwords";

/** OWASP's recommended scrypt settings. */
const COST = 2 ** 17;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 256 * 1024 * 1024;

/**
 * Each hash takes about 128 MB and a worker thread, so only a few run at once and a short queue waits.
 * Beyond that, requests are turned away rather than delaying everything else on the server.
 */
const MAX_CONCURRENT_HASHES = 2;
const MAX_WAITING_HASHES = 20;

export class HashingBusyError extends Error {
  constructor() {
    super("Too many people are signing in. Please try again in a moment.");
  }
}

let running = 0;
const waiting: (() => void)[] = [];

async function withHashSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENT_HASHES) {
    running += 1;
  } else {
    if (waiting.length >= MAX_WAITING_HASHES) throw new HashingBusyError();
    // A finishing hash hands its slot straight to the next in line, so the count never goes over.
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return withHashSlot(
    () =>
      new Promise((resolve, reject) => {
        scrypt(password, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
      }),
  );
}

/** Keeps the settings in the result so that they can be raised later. */
async function hash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const options = { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAX_MEMORY };
  const key = await derive(password, salt, options);
  return ["scrypt", COST, BLOCK_SIZE, PARALLELIZATION, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Every new password passes through here, so the rules cannot be skipped by a new route. */
export async function hashPassword(password: string): Promise<string> {
  const problems = passwordProblems(password);
  if (problems.length > 0) throw new Error(`Password needs ${problems.join(", ")}`);
  return hash(password);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, cost, blockSize, parallelization, salt, key] = stored.split("$");
  const expected = Buffer.from(key ?? "", "base64");
  const actual = await derive(password, Buffer.from(salt ?? "", "base64"), {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelization),
    maxmem: MAX_MEMORY,
  });
  return timingSafeEqual(actual, expected);
}

/** Checked when an email is unknown, so that login takes the same time either way. */
export const DECOY_HASH = await hash(randomBytes(32).toString("hex"));
