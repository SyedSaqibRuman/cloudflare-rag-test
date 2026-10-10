// --------------------------
// SHARED — company-default KB binding resolution.
// Single source of truth for matching the company config's VECTOR_INDEX /
// R2_BUCKET_NAME against provisioned provider_resources rows. Used by BOTH:
//   • the server — mysql/services/kb-service.js applyDefaultResourceBindings
//     (auto-binds a KB saved with "Company default (config)")
//   • the admin portal — web/src/components/kb-modal.jsx review step (amber
//     hint when a company default cannot be resolved to a resource)
// A config value matches a resource by resource_key OR external_resource_id
// (both are user-visible identifiers for the same infrastructure).
// Pure ESM, no node_modules deps — node --test can import it directly.
// --------------------------

import { isVectorCapableProvider } from "./vector-capability.js";

/**
 * Find the resource a company-default name resolves to.
 * @param {Array<Object>} resources  company resource rows (registry and/or
 *        live — live rows carry { name } as their identifier)
 * @param {string} name              config value to resolve
 * @param {string} resourceType      "vector_index" | "object_bucket"
 * @param {Object} [opts]
 * @param {boolean} [opts.requireVectorCapable]  skip rows whose provider cannot
 *        serve vectors (used for the Vector Store binding)
 * @returns {Object|null} the matching row or null
 */
export function findDefaultBinding(resources, name, resourceType, opts = {}) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  for (const r of resources || []) {
    if (r.resource_type && resourceType && r.resource_type !== resourceType) continue;
    // Live Cloudflare rows ({ name }) are matched too — the config selector
    // writes raw account resource names when no registry row exists.
    const identifier = r.resource_key || r.name;
    const external = r.external_resource_id || r.name;
    if (identifier !== trimmed && external !== trimmed) continue;
    if (r.is_active !== undefined && r.is_active !== null && Number(r.is_active) !== 1) continue;
    if (opts.requireVectorCapable && !isVectorCapableProvider(r.provider_key)) continue;
    return r;
  }
  return null;
}

/**
 * Evaluate both company defaults at once — the shape the wizard's review step
 * consumes. Pure, no I/O.
 *
 * @param {Object} params
 * @param {Array<Object>} params.resources  all company resource rows
 * @param {string} [params.vectorDefault]   config VECTOR_INDEX
 * @param {string} [params.storageDefault]  config R2_BUCKET_NAME
 * @param {boolean} [params.hasVectorBinding]  the KB carries an explicit vector binding
 * @param {boolean} [params.hasStorageBinding] the KB carries an explicit storage binding
 * @returns {{
 *   vector: { needed: boolean, resolved: boolean, name: string, resource: Object|null, reason: string },
 *   storage: { needed: boolean, resolved: boolean, name: string, resource: Object|null, reason: string },
 * }}
 */
export function evaluateDefaultBindings({ resources, vectorDefault, storageDefault, hasVectorBinding = false, hasStorageBinding = false }) {
  const vName = String(vectorDefault || "").trim();
  const sName = String(storageDefault || "").trim();

  const vNeeded = !hasVectorBinding && Boolean(vName);
  const vResource = vNeeded ? findDefaultBinding(resources, vName, "vector_index", { requireVectorCapable: true }) : null;
  const vReason = !vNeeded
    ? ""
    : !vResource
      ? `Config Vector Index "${vName}" doesn't match any provisioned vector resource — ingest will fail until the KB is bound explicitly.`
      : "";

  const sNeeded = !hasStorageBinding && Boolean(sName);
  const sResource = sNeeded ? findDefaultBinding(resources, sName, "object_bucket") : null;
  const sReason = !sNeeded
    ? ""
    : !sResource
      ? `Config Storage Bucket "${sName}" doesn't match any provisioned storage resource — ingest will fail until the KB is bound explicitly.`
      : "";

  return {
    vector: { needed: vNeeded, resolved: Boolean(vResource), name: vName, resource: vResource, reason: vReason },
    storage: { needed: sNeeded, resolved: Boolean(sResource), name: sName, resource: sResource, reason: sReason },
  };
}
