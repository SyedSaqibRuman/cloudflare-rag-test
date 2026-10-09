// --------------------------
// SHARED ROUTE HELPERS
// Extracted from kbs.js + assistants.js + other route files to eliminate
// duplicated actor construction, company/KB/credential lookups, and
// running-job lookup patterns.
// --------------------------
import { CompanyRepository, KbRepository, CredentialRepository } from "../repositories.js";
import { getRunningJobs } from "../../cron/index.js";
import { NotFoundError, ConflictError } from "../../shared/errors.js";

/**
 * Build the audit actor object from an Express request.
 * Used by every write endpoint (create/update/delete) across all gateway
 * sub-routers — prevents the 3-field object from being copy-pasted per route.
 *
 * @param {import("express").Request} req
 * @returns {{ actorType: string, actorId: string|null, actorIp: string|null }}
 */
export function actorFromReq(req) {
  return {
    actorType: "admin",
    actorId: req.auth?.user || null,
    actorIp: req.ip,
  };
}

/**
 * Strip the webhook secret from a KB row before it reaches an API response,
 * replacing it with a boolean presence flag — secrets are write-only over the
 * wire (same invariant as the ask API key). The stored value is untouched;
 * internal consumers (ingest/webhooks.js) read it via the repository directly.
 *
 * @param {Object|null} kb  KB row (mapped via mapRow)
 * @returns {Object|null}   Redacted copy safe for JSON responses
 */
export function redactKb(kb) {
  if (!kb) return kb;
  const { webhook_secret, ...rest } = kb;
  return { ...rest, has_webhook_secret: Boolean(webhook_secret) };
}

/**
 * Look up a KB by key for the current company, throwing NotFoundError when
 * missing. Eliminates the repeated `findByKey + 404 JSON` pattern that
 * appeared 9 times across kbs.js.
 *
 * @param {number} companyId
 * @param {string} kbKey
 * @returns {Promise<Object>}  The KB row (mapped via mapRow).
 * @throws {NotFoundError}  When the KB does not exist.
 */
export async function requireKb(companyId, kbKey) {
  const kb = await KbRepository.findByKey(companyId, kbKey);
  if (!kb) throw new NotFoundError(`Knowledge base '${kbKey}' not found.`);
  return kb;
}

/**
 * Find a running ingest job for a specific KB. The `getRunningJobs().find()`
 * pattern with the triple condition (jobId + companyName + kbKey) was
 * duplicated 3 times in kbs.js.
 *
 * @param {string} companyKey
 * @param {string} kbKey
 * @returns {Object|null}  The running job entry, or null.
 */
export function findRunningIngestJob(companyKey, kbKey) {
  return (
    getRunningJobs().find(
      (j) =>
        j.jobId === "ingest" &&
        j.companyName === companyKey &&
        j.kbKey === kbKey &&
        j.status === "running"
    ) || null
  );
}

/**
 * Find a PAUSED (suspended) ingest job for a company + KB, if any.
 * @param {string} companyKey
 * @param {string} kbKey
 * @returns {Object|null}  The suspended job entry, or null.
 */
export function findPausedIngestJob(companyKey, kbKey) {
  return (
    getRunningJobs().find(
      (j) =>
        j.jobId === "ingest" &&
        j.companyName === companyKey &&
        j.kbKey === kbKey &&
        j.status === "suspended"
    ) || null
  );
}

// --------------------------
// COMPANY LOOKUP
// Every company-scoped route (companies, credentials, resources,
// cloudflare-resources, ingestion) repeats the same findByKey + 404
// pattern. This helper throws NotFoundError when the company doesn't
// exist, so `wrap()` returns a consistent { success:false, error } JSON.
// --------------------------

/**
 * Look up a gateway company by key, throwing NotFoundError when missing.
 * Eliminates the repeated `CompanyRepository.findByKey() + 404 JSON`
 * pattern that appeared 11+ times across gateway sub-routers.
 *
 * @param {string} companyKey
 * @returns {Promise<Object>}  The company row.
 * @throws {NotFoundError}  When the company does not exist.
 */
export async function requireCompany(companyKey) {
  const company = await CompanyRepository.findByKey(companyKey);
  if (!company) throw new NotFoundError(`Company '${companyKey}' not found.`);
  return company;
}

// --------------------------
// CREDENTIAL LOOKUP
// The `CredentialRepository.findWithEncrypted() + 404 JSON` pattern
// appeared 6+ times in credentials.js.
// --------------------------

/**
 * Look up a credential by ID (including encrypted blob), throwing
 * NotFoundError when missing. Used by verify, rotate, update, delete
 * endpoints in credentials.js.
 *
 * @param {number|string} id
 * @returns {Promise<Object>}  The credential row with encrypted_credentials.
 * @throws {NotFoundError}  When the credential does not exist.
 */
export async function requireCredential(id) {
  const row = await CredentialRepository.findWithEncrypted(id);
  if (!row) throw new NotFoundError("Credential not found.");
  return row;
}

// --------------------------
// RESOURCE → KB BINDING GUARD
// A provider_resource can be bound to knowledge bases (vector_resource_id /
// graph_resource_id / storage_resource_id). Deleting the row underneath a
// bound KB leaves a stale pointer: ingest dies with "Vector store is not
// configured" (bug fixed Sep 2026 — KB 'java-textbook' pointed at a
// soft-deleted Qdrant resource) and retrieval silently loses the KB. Every
// delete path that removes a resource row (or the live store behind one)
// calls assertResourceNotKbBound FIRST and gets a 409 naming the KBs instead
// of a latent breakage.
// --------------------------

/**
 * Throw a 409 when a live KB still binds the given resource, listing the
 * blocking KBs in the message so the admin can re-point or delete them first.
 * @param {Object} resource   provider_resources row (mapRow shape — needs id,
 *                            resource_key / resource_name).
 * @param {string} [label]    Human label for the resource ("Qdrant Collection",
 *                            "Resource", …) used in the error message.
 * @returns {Promise<Array>}  The binding KB rows (empty when unbound).
 * @throws {ConflictError}    When at least one active KB binds the resource.
 */
export async function assertResourceNotKbBound(resource, label = "Resource") {
  const kbs = await KbRepository.listByResource(resource.id);
  if (!kbs.length) return [];
  const name = resource.resource_name || resource.resource_key || `#${resource.id}`;
  const detail = kbs
    .map((k) => `'${k.kb_key}' (as ${k.vector_resource_id === Number(resource.id) ? "vector" : k.graph_resource_id === Number(resource.id) ? "graph" : "storage"} resource)`)
    .join(", ");
  throw new ConflictError(
    `${label} '${name}' is used by knowledge base(s): ${detail}. Re-point or delete the KB(s) before deleting this resource.`
  );
}
