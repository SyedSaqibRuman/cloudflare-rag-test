import crypto from "node:crypto";
import { CREDENTIAL_KEYS } from "./schema.js";
import { getCompanyConfig } from "./store.js";

export { CREDENTIAL_KEYS };

/**
 * Generate a new per-company API key (shown to the admin once).
 */
export function generateApiKey() {
  return `pk_${crypto.randomBytes(24).toString("base64url")}`;
}

export function resolveCreds(companyName) {
  const config = getCompanyConfig(companyName);

  if (!config) {
    throw new Error(`Company '${companyName}' not found`);
  }

  const resolved = {};

  for (const key of CREDENTIAL_KEYS) {
    resolved[key] = config[key] || "";
  }

  return resolved;
}
