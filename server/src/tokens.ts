import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** A random token for a link, and the hash that is stored instead of it. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The key that encrypts secrets at rest, such as two-factor secrets. Required in production. */
function secretsKey(): Buffer {
  const key = process.env.SECRETS_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("SECRETS_KEY must be set in production");
    return createHash("sha256").update("development-only-secrets-key").digest();
  }
  return createHash("sha256").update(key).digest();
}

/** Encrypts with AES-256-GCM. The result holds the nonce and tag, so it can be stored as one string. */
export function encryptSecret(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretsKey(), nonce);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, nonce, tag, data] = stored.split(".");
  if (version !== "v1" || !nonce || !tag || !data) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", secretsKey(), Buffer.from(nonce, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
