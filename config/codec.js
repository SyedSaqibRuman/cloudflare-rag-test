// --------------------------
// CONFIG VALUE CODEC
// Shared by both persistence backends (SQLite db/<company>.db and the MySQL
// company_config table). Values are JSON-encoded; sensitive keys (provider
// credentials, ask API key) are additionally encrypted at rest with
// config/encryption.js. Plaintext only ever lives in memory.
// --------------------------
import { SENSITIVE_KEY_SET, encryptSecret, decryptSecret } from "./encryption.js";

/**
 * Encode a config value for storage: sensitive string values are encrypted
 * (gcm: prefix), everything else is stored as-is; the caller JSON-stringifies.
 */
export function encodeStoredValue(key, value) {
  return SENSITIVE_KEY_SET.has(key) && typeof value === "string" ? encryptSecret(value) : value;
}

/**
 * Decode a stored config value: JSON-parse, then decrypt sensitive keys.
 * Throws with context (company name + key) when a credential can't be decrypted.
 */
export function decodeStoredValue(key, stored, companyName) {
  let value;
  try {
    value = JSON.parse(stored);
  } catch {
    value = stored;
  }
  if (SENSITIVE_KEY_SET.has(key) && typeof value === "string") {
    try {
      return decryptSecret(value);
    } catch (err) {
      throw new Error(`Failed to load credentials for company '${companyName}' (${key}): ${err.message}`);
    }
  }
  return value;
}
