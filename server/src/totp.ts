import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Time-based one-time passwords (RFC 6238), as used by authenticator apps: SHA-1, 6 digits, 30 seconds. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Codes from one step either side are accepted, to allow for clocks that are slightly out. */
const DRIFT = 1;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const stepAt = (time: number) => Math.floor(time / 1000 / STEP_SECONDS);

/**
 * Returns the time step a code belongs to, if it is valid now and newer than the last step used, so
 * that a code cannot be replayed. Otherwise null.
 */
export function verifyTotp(secret: string, code: string, lastStep = -1, now = Date.now()): number | null {
  const given = Buffer.from(code.replace(/\s/g, ""));
  if (!/^\d{6}$/.test(given.toString())) return null;
  const current = stepAt(now);
  for (let step = current - DRIFT; step <= current + DRIFT; step += 1) {
    if (step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), given)) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "Manchu Labelling"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params}`;
}

/** Ten recovery codes, such as `k3m9q-2hx7p`, each usable once instead of an app code. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const code = base32Encode(randomBytes(7)).toLowerCase().slice(0, 10);
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.trim().toLowerCase().replace(/[^a-z2-7]/g, "");
