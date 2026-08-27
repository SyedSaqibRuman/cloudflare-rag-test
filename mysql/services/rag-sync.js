// --------------------------
// RAG-SYNC — gateway credentials/resources → RAG config store
// The RAG pipeline (resolveCreds) reads its Cloudflare/R2/Neo4j credentials
// from the per-company config store (company_config / db/<company>.db) — a
// SEPARATE store from the gateway's encrypted_credentials. This module bridges
// the two: when a connection (or resource) is saved on the Providers page, its
// fields are mapped to the RAG credential keys and written through the single
// config write path (updateCompany), so the user enters credentials once and
// /ask, ingest, Vectorize, R2 and GraphRAG see them automatically. Writes are
// best-effort: a failed sync never fails the gateway write that triggered it.
// --------------------------
import { updateCompany } from "../../config/index.js";
import { CompanyRepository, CredentialRepository, ResourceRepository } from "../repositories.js";
import { decryptCredential } from "./credential-service.js";

/**
 * Map of gateway auth-form field_name → RAG config credential key.
 * Only fields the RAG pipeline actually consumes are mapped:
 *   client.js  → CLOUDFLARE_API_TOKEN (+ ACCOUNT_ID + R2 keys for S3)
 *   vectorize.js / r2.js / cloudflare_ai.js → CLOUDFLARE_ACCOUNT_ID
 * R2_TOKEN_VALUE / R2_JURISDICTION_END_POINT are not consumed at runtime and
 * have no gateway field source, so they are left out of the sync (still
 * settable via the API directly).
 */
const FIELD_TO_RAG_KEY = {
  api_token: "CLOUDFLARE_API_TOKEN",
  account_id: "CLOUDFLARE_ACCOUNT_ID",
  access_key_id: "R2_ACCESS_KEY_ID",
  secret_access_key: "R2_SECRET_ACCESS_KEY",
};

// Neo4j auth-schema field names (provider_key 'neo4j'): uri/username/password.
const NEO4J_FIELD_TO_RAG_KEY = {
  uri: "NEO4J_URI",
  username: "NEO4J_USERNAME",
  password: "NEO4J_PASSWORD",
};

/** Gateway connection fields → RAG config patch (empty values dropped). */
export function ragPatchFor(fields, { providerKey = null } = {}) {
  const patch = {};
  // Cloudflare-family fields are keyed by name and apply to any provider that
  // carries them; neo4j fields only map when the connection IS the neo4j
  // provider (other providers may reuse 'username'/'password' field names).
  const map = providerKey === "neo4j" ? { ...FIELD_TO_RAG_KEY, ...NEO4J_FIELD_TO_RAG_KEY } : FIELD_TO_RAG_KEY;
  for (const [field, ragKey] of Object.entries(map)) {
    const value = fields?.[field];
    if (value && String(value).trim()) patch[ragKey] = String(value).trim();
  }
  return patch;
}

/**
 * RAG config patch for a provisioned resource: the neo4j graph_database
 * resource's config.database_name → NEO4J_DATABASE. Other resource types map
 * nothing (their configs aren't consumed by the RAG pipeline).
 */
export function ragPatchForResource({ resourceType, config }) {
  if (resourceType !== "graph_database") return {};
  const database = config?.database_name;
  return database && String(database).trim() ? { NEO4J_DATABASE: String(database).trim() } : {};
}

/**
 * Mirror a resource's RAG-relevant config into the config store (e.g. the
 * neo4j graph_database database_name → NEO4J_DATABASE). Called after a
 * resource is created, updated, or deleted (delete passes the removed row).
 */
export async function syncRagResource(companyKey, { resourceType, config }) {
  await applyRagPatch(companyKey, ragPatchForResource({ resourceType, config }));
}

/**
 * Clear a deleted resource's RAG keys (only if no other resource provides
 * them — e.g. deleting the only neo4j graph_database clears NEO4J_DATABASE).
 * @param {number} companyId
 * @param {object} removed — the deleted resource row { resource_type, config }
 */
export async function clearRagResource(companyId, removed) {
  const removedKeys = Object.keys(ragPatchForResource(removed));
  if (!removedKeys.length) return;
  const company = await CompanyRepository.findById(companyId);
  if (!company) return;
  const rows = await ResourceRepository.listByCompany(companyId);
  const stillProvided = new Set();
  for (const row of rows) {
    for (const key of Object.keys(ragPatchForResource(row))) stillProvided.add(key);
  }
  const clear = {};
  for (const key of removedKeys) if (!stillProvided.has(key)) clear[key] = "";
  await applyRagPatch(company.company_key, clear);
}

async function applyRagPatch(companyKey, patch) {
  if (!Object.keys(patch).length) return;
  const result = await updateCompany(companyKey, patch);
  if (result.error) {
    console.warn(`⚠️ RAG credential sync skipped for '${companyKey}': ${result.error}`);
  }
}

/**
 * Merge a connection's mapped fields into the company's RAG config store.
 * Called after a connection is created, updated, or rotated.
 * @param {string} companyKey — RAG company name (== gateway company_key)
 * @param {Object<string,string>} fields — the connection's plaintext fields
 * @param {object} [opts] — { providerKey } to scope field-name mapping
 */
export async function syncRagCredentials(companyKey, fields, opts = {}) {
  await applyRagPatch(companyKey, ragPatchFor(fields, opts));
}

/**
 * Clear a deleted connection's mapped RAG keys — but only the ones no other
 * remaining connection of the company still provides (e.g. deleting the
 * cloudflare connection must not wipe api_token/account_id that cloudflare_r2
 * still carries).
 * @param {number} companyId — gateway companies.id of the deleted credential
 * @param {Object<string,string>} removedFields — the deleted credential's fields
 * @param {object} [opts] — { providerKey } of the deleted credential
 */
export async function clearRagCredentials(companyId, removedFields, opts = {}) {
  const removedKeys = Object.keys(ragPatchFor(removedFields, opts));
  if (!removedKeys.length) return;

  const company = await CompanyRepository.findById(companyId);
  if (!company) return;

  // Which mapped keys do the company's remaining credentials still provide?
  const rows = await CredentialRepository.listByCompany(companyId, {
    includeStored: true,
    includeInactive: true,
  });
  const stillProvided = new Set();
  for (const row of rows) {
    try {
      for (const key of Object.keys(ragPatchFor(decryptCredential(row.encrypted_credentials), { providerKey: row.provider_key }))) {
        stillProvided.add(key);
      }
    } catch {
      /* malformed blob — ignore */
    }
  }

  const clear = {};
  for (const key of removedKeys) {
    if (!stillProvided.has(key)) clear[key] = "";
  }
  await applyRagPatch(company.company_key, clear);
}

/**
 * Recompute a company's RAG credentials from ALL its gateway connections and
 * resources. Used to backfill companies whose connections were saved before
 * the sync existed (and for tests). Idempotent: later per-connection syncs
 * keep the same merged state.
 * @returns {Promise<{ syncedKeys: string[] } | { error: string }>}
 */
export async function backfillRagCredentials(companyKey) {
  const company = await CompanyRepository.findByKey(companyKey);
  if (!company) return { error: `Gateway company '${companyKey}' not found.` };

  const rows = await CredentialRepository.listByCompany(company.id, {
    includeStored: true,
    includeInactive: true,
  });
  const patch = {};
  for (const row of rows) {
    try {
      Object.assign(patch, ragPatchFor(decryptCredential(row.encrypted_credentials), { providerKey: row.provider_key }));
    } catch {
      /* malformed blob — skip */
    }
  }

  // Resources contribute RAG keys too (graph_database → NEO4J_DATABASE).
  const resources = await ResourceRepository.listByCompany(company.id);
  for (const row of resources) {
    Object.assign(patch, ragPatchForResource(row));
  }

  await applyRagPatch(companyKey, patch);
  return { syncedKeys: Object.keys(patch) };
}
