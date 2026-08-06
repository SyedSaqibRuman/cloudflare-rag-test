// --------------------------
// CREDENTIAL SERVICE
// The single owner of credential encryption/decryption/rotation/verification
// logic for the MySQL platform layer. No SQL, no network — plain functions
// over the stored blob format: encrypted_credentials is a JSON object whose
// values are individually AES-256-GCM blobs ("gcm:<iv>:<tag>:<data>", via
// config/encryption.js). Live provider probes are injected by the caller
// (see gateway-router.js), keeping this module unit-testable.
// --------------------------
import { encryptSecret, decryptSecret, hasEncryptionKey } from "../../config/encryption.js";

export const ENCRYPTION_VERSION = 1;

/**
 * Encrypt a plaintext credential object (e.g. { api_key, account_id }) into
 * the stored blob. Non-secret fields (region, endpoint, ...) may be passed
 * with `encrypted: false` and are stored as plain JSON values.
 *
 * @param {Object<string,string>} fields   plaintext values
 * @param {Object<string,boolean>} [encryptMap] per-field encryption flags
 * @returns {{ blob: string, version: number }}
 */
export function encryptCredential(fields, encryptMap = {}) {
  const blob = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    blob[key] = encryptMap[key] === false ? String(value) : encryptSecret(String(value));
  }
  return { blob: JSON.stringify(blob), version: ENCRYPTION_VERSION };
}

/**
 * Decrypt a stored blob back to a plaintext credential object. Values without
 * the "gcm:" prefix pass through (legacy/plaintext fields).
 * @param {string} blob
 * @returns {Object<string,string>}
 */
export function decryptCredential(blob) {
  let parsed;
  try {
    parsed = JSON.parse(blob);
  } catch {
    throw new Error("Malformed encrypted_credentials (expected a JSON object)");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Malformed encrypted_credentials (expected a JSON object)");
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    out[key] = decryptSecret(String(value));
  }
  return out;
}

/**
 * Re-encrypt a credential with new field values, reusing existing values for
 * fields not provided. Returns the new blob + the bumped version.
 * @param {Object<string,string>} existing  current plaintext fields
 * @param {Object<string,string>} updates   fields to replace
 * @param {Object<string,boolean>} [encryptMap]
 */
export function rotateCredential(existing, updates = {}, encryptMap = {}) {
  const merged = { ...existing, ...updates };
  return encryptCredential(merged, encryptMap);
}

/**
 * Validate plaintext fields against the provider's auth schema.
 * @param {Object<string,string>} fields
 * @param {Array} authSchema  rows from ProviderRepository.authForm()
 * @returns {{ ok: boolean, errors: Object<string,string> }}
 */
export function validateFieldsAgainstSchema(fields, authSchema) {
  const errors = {};
  const byName = new Map(authSchema.map((f) => [f.field_name, f]));
  for (const field of authSchema) {
    const value = fields[field.field_name];
    if (field.is_required && (value === undefined || value === null || value === "")) {
      errors[field.field_name] = `${field.field_label} is required.`;
      continue;
    }
    if (value === undefined || value === null || value === "") continue;
    if (field.validation_regex && !new RegExp(field.validation_regex).test(String(value))) {
      errors[field.field_name] = `${field.field_label} does not match the expected format for this provider.`;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Format-level verification only: checks required fields + format regexes.
 * Returns the decrypted fields plus a status. Live connectivity probing is
 * done separately by the caller via `probe`.
 *
 * @returns {{ status: 'success'|'failed', fields: Object<string,string>, error: string|null }}
 */
export function verifyCredential(blob, authSchema) {
  let fields;
  try {
    fields = decryptCredential(blob);
  } catch (err) {
    return { status: "failed", fields: null, error: err.message };
  }
  const { ok, errors } = validateFieldsAgainstSchema(fields, authSchema);
  if (!ok) {
    return { status: "failed", fields, error: Object.values(errors).join(" ") };
  }
  if (!hasEncryptionKey()) {
    return {
      status: "success",
      fields,
      error: null,
      warning: "APP_ENCRYPTION_KEY is unset — credentials are stored in plaintext.",
    };
  }
  return { status: "success", fields, error: null };
}

/** Map of field_name → is_encrypted for a provider's auth schema rows. */
export function buildEncryptMap(authSchema) {
  const map = {};
  for (const f of authSchema) map[f.field_name] = Boolean(f.is_encrypted);
  return map;
}
