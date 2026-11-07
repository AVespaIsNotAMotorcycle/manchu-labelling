import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

import { passwordProblems } from "@manchu-labelling/passwords";

/** OWASP's recommended scrypt settings. */
const COST = 2 ** 17;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
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
