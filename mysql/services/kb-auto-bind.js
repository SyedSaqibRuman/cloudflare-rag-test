// --------------------------
// KB AUTO-BIND (create-time healing).
// When an admin provisions a vector_index resource under a vector-capable
// provider, company KBs whose Vector Store binding is BROKEN should start
// using it automatically — no manual wizard trip required.
//
// "Broken" means one of:
//   • vector_resource_id IS NULL                  (never bound)
//   • the bound resource no longer exists         (deleted)
//   • the bound resource is inactive              (soft-disabled)
//   • the bound resource's provider is NOT
//     vector-capable (e.g. an R2 row mis-typed
//     as vector_index — the testing-kb papercut)
//
// Healthy bindings are NEVER touched (even if a "better" default appears).
// NOTE: kb.vector_external_id (the KB_SELECT join alias for the bound
// resource's external_resource_id) is DERIVED data, not a KB-owned input —
// it automatically follows whichever resource the KB points at, so it must
// NOT exclude a KB from rebinding (it was never set independently).
//
// Service is dependency-injected so tests can run it with fakes — no MySQL,
// no flags. Production wiring passes the real repositories.
// --------------------------

import { isVectorCapableProvider } from "../../shared/vector-capability.js";

/**
 * Compute which KBs of a company should be rebound to a newly created
 * vector-capable resource. Pure — no I/O.
 *
 * @param {Array<Object>} kbs            company KB rows (kb_key, vector_resource_id,
 *                                       vector_external_id, vector_resource_* join cols optional)
 * @param {Map<number, Object>} resourcesById  ALL company resources keyed by id
 *                                       (rows carry provider_key, resource_type, is_active)
 * @param {Object} newResource           the freshly created resource row
 * @returns {{ eligible: Array<Object>, reasons: Object<string, string> }}
 *         eligible: KB rows to rebind; reasons: kb_key → why
 */
export function selectRebindCandidates(kbs, resourcesById, newResource) {
  const eligible = [];
  const reasons = {};

  for (const kb of kbs) {
    const boundId = kb.vector_resource_id;

    if (boundId == null) {
      eligible.push(kb);
      reasons[kb.kb_key] = "no vector store bound";
      continue;
    }
    // Never rebind a KB that already points at this very resource.
    if (Number(boundId) === Number(newResource.id)) continue;

    const bound = resourcesById.get(Number(boundId));
    if (!bound) {
      eligible.push(kb);
      reasons[kb.kb_key] = `bound resource #${boundId} no longer exists`;
      continue;
    }
    if (bound.is_active === false || bound.is_active === 0) {
      eligible.push(kb);
      reasons[kb.kb_key] = `bound resource #${boundId} (${bound.resource_key}) is inactive`;
      continue;
    }
    if (!isVectorCapableProvider(bound.provider_key)) {
      eligible.push(kb);
      reasons[kb.kb_key] = `bound resource #${boundId} (${bound.resource_key}) belongs to non-vector provider '${bound.provider_key}'`;
      continue;
    }
    // Healthy vector binding — leave it alone.
  }

  return { eligible, reasons };
}

/**
 * Rebind eligible KBs to the new resource, audit each rebind, and flip any
 * KB that was sitting in `error` (e.g. KB_VECTOR_NOT_CONFIGURED) back to
 * `active` so the UI reflects the healed state.
 *
 * @param {Object} deps
 * @param {Object} deps.kbRepo        KbRepository ({ listByCompany, update, setStatus })
 * @param {Object} deps.resourceRepo  ResourceRepository ({ listByCompany, findById })
 * @param {Object} deps.auditRepo     AuditRepository ({ log }) — optional
 * @param {Object} company            company row (id, company_key)
 * @param {Object} newResource        freshly created resource row (id, resource_type, resource_key, provider_key, is_active)
 * @param {Object} [actor]            { actorType, actorId } for the audit trail
 * @returns {Promise<Array<{ kb_key: string, reason: string }>>} rebound KBs
 */
export async function autoBindVectorResource({ kbRepo, resourceRepo, auditRepo, company, newResource, actor }) {
  // Only vector indexes under vector-capable providers participate.
  // (!newResource covers repos whose findById can't resolve the fresh row —
  // create-time rebind simply doesn't happen in that environment.)
  if (!newResource || newResource.resource_type !== "vector_index") return [];
  if (!isVectorCapableProvider(newResource.provider_key)) return [];
  if (newResource.is_active === false || newResource.is_active === 0) return [];

  const kbs = await kbRepo.listByCompany(company.id, { includeInactive: true });
  const companyResources = await resourceRepo.listByCompany(company.id);
  const resourcesById = new Map(companyResources.map((r) => [Number(r.id), r]));

  const { eligible, reasons } = selectRebindCandidates(kbs, resourcesById, newResource);

  const rebound = [];
  for (const kb of eligible) {
    await kbRepo.update(kb.id, { vectorResourceId: newResource.id });
    // Healing a broken binding clears a stale error state (if any).
    if (kb.status === "error") {
      await kbRepo.setStatus(kb.id, "active");
    }
    if (auditRepo?.log) {
      await auditRepo.log({
        companyId: company.id,
        ...actor,
        action: "kb.vector.autobound",
        entityType: "knowledge_base",
        entityId: kb.id,
        beforeState: { vector_resource_id: kb.vector_resource_id ?? null },
        afterState: { vector_resource_id: newResource.id },
        reason: `auto-bind: ${reasons[kb.kb_key]}`,
      }).catch(() => {}); // audit must never break the create path
    }
    rebound.push({ kb_key: kb.kb_key, reason: reasons[kb.kb_key] });
  }
  return rebound;
}
