// --------------------------
// AT-REST ENCRYPTION FOR COMPANY CREDENTIALS
// Per-company provider credentials (Cloudflare/R2 tokens, per-company ask API
// keys) are encrypted before they hit db/<company>.db using AES-256-GCM with a
// master key from the APP_ENCRYPTION_KEY env var (a platform-level secret —
// never per-company). The decrypted value only exists in memory (runtimeConfig,
// loaded at boot); the SQLite file only ever holds "gcm:<iv>:<tag>:<data>".
// --------------------------
import crypto from "node:crypto";
import { CREDENTIAL_KEYS, SECRET_KEYS } from "./schema.js";

/** Keys whose values are encrypted at rest (provider creds + ask API key). */
export const SENSITIVE_KEYS = [...CREDENTIAL_KEYS, ...SECRET_KEYS];
export const SENSITIVE_KEY_SET = new Set(SENSITIVE_KEYS);

const PREFIX = "gcm:";

/**
 * Master key material. Accepts either a 64-char hex string (openssl rand -hex 32)
 * or any string, which is sha256-derived to 32 bytes.
 */
function getKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function hasEncryptionKey() {
  return !!process.env.APP_ENCRYPTION_KEY;
}

/**
 * Encrypt a secret for storage. Without APP_ENCRYPTION_KEY the value is
 * returned unchanged (backwards compatible with pre-encryption installs).
 * @param {string} plaintext
 * @returns {string} "gcm:<iv>:<tag>:<data>" (base64) or the input unchanged.
 */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || plaintext === "") return plaintext;
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a stored secret. Values without the "gcm:" prefix are legacy
 * plaintext from before encryption was introduced — passed through unchanged.
 * @param {string} stored
 * @returns {string}
 */
export function decryptSecret(stored) {
  if (typeof stored !== "string" || stored === "") return stored;
  if (!stored.startsWith(PREFIX)) return stored;

  const key = getKey();
  if (!key) {
    throw new Error(
      "APP_ENCRYPTION_KEY is required to decrypt stored credentials. Add it to .env (see .env.example)."
    );
  }

  const [iv, tag, data] = stored.slice(PREFIX.length).split(":");
  if (!iv || !tag || !data) {
    throw new Error("Malformed encrypted value (expected gcm:<iv>:<tag>:<data>)");
  }

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch (err) {
    // GCM auth failure = wrong master key or tampered value. Never silently
    // return garbage — the operator must fix the key.
    throw new Error(`Failed to decrypt credential (wrong APP_ENCRYPTION_KEY or tampered value): ${err.message}`);
  }
}
