// --------------------------
// EMBEDDING MODEL PROBE (bind-time validation)
// Root cause of the "KB accepted a dead embedding model" papercut: saveKb/
// updateKb only checked that the model ROW exists (resolveEmbeddingProvider) —
// nothing ever called the provider's embeddings endpoint, and the ingest-time
// adapter resolver swallows resolution failures. Result: a KB bound to NVIDIA
// nemotron-3-embed-1b 404'd on every embed call while ingestion silently fell
// back to CF embeddings.
//
// probeEmbeddingModel performs ONE live test embed through the same resolution
// the ingest path uses (model → provider → company credential → adapter) and
// returns a structured verdict. Wired into saveKb/updateKb so a dead binding
// is rejected AT BIND TIME with a clear message instead of discovered from a
// failed ingest or a KB-detail warning card.
//
// Transient-failure stance: network errors (ECONNREFUSED, DNS, timeouts) and
// 5xx are DOWN, not DEAD — the bind is allowed (fail-open) because a provider
// outage must not brick KB configuration; the per-run fallback counters +
// KB-detail warning card cover the runtime signal. A definitive 4xx (404 model
// gone, 401/403 bad key, 400 bad request) is a real misconfiguration → rejected.
// --------------------------

import { resolveEmbeddingModel } from "./provider-connection-resolver.js";
import { CredentialRepository } from "../repositories.js";
import { decryptCredential } from "./credential-service.js";
import { normalizeCredential } from "../../ingest/resolve.js";
import { createEmbeddingAdapter } from "../adapters/embedding/factory.js";

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_TEXT = "embed-model-probe";

/**
 * @param {Object} opts
 * @param {number} opts.companyId      owning company (credential lookup)
 * @param {number} opts.embeddingModelId  provider_models.id
 * @param {Object} [deps]              test seams
 * @param {Function} [deps.resolveModel]     default resolveEmbeddingModel
 * @param {Function} [deps.findCredential]   default first active credential for provider
 * @param {Function} [deps.createAdapter]    default createEmbeddingAdapter
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, detail?: string,
 *                     providerKey?: string, modelKey?: string, dims?: number, ms?: number }>}
 */
export async function probeEmbeddingModel(opts, deps = {}) {
  const { companyId, embeddingModelId } = opts;
  if (!embeddingModelId) return { ok: true, skipped: true, reason: "no-model" };

  const resolveModel = deps.resolveModel || resolveEmbeddingModel;
  const findCredential = deps.findCredential || defaultFindCredential;

  let modelInfo;
  try {
    modelInfo = await resolveModel(embeddingModelId);
  } catch (err) {
    // Unknown model/provider row — a hard data error the UI shouldn't allow.
    return { ok: false, reason: "unresolvable", detail: String(err?.message || err) };
  }

  // No credential for the provider → the ingest path would run with empty
  // credentials and every call would 401. Reject with a clear fix message.
  // (Checked BEFORE adapter construction: the adapter needs decrypted fields.)
  const cred = await findCredential(companyId, modelInfo.provider.id).catch(() => null);
  if (!cred) {
    return {
      ok: false,
      reason: "no-credential",
      providerKey: modelInfo.providerKey,
      modelKey: modelInfo.modelKey,
      detail: `no active '${modelInfo.providerKey}' credential for this company — add the connection on the AI Providers page first`,
    };
  }

  // Adapter factory support check — an unsupported provider can never embed.
  let adapter;
  try {
    const decrypted = normalizeCredential(safeDecrypt(cred));
    adapter = (deps.createAdapter || createEmbeddingAdapter)(
      modelInfo.providerKey,
      decrypted,
      modelInfo.modelKey
    );
  } catch (err) {
    return {
      ok: false,
      reason: "adapter",
      providerKey: modelInfo.providerKey,
      modelKey: modelInfo.modelKey,
      detail: String(err?.message || err),
    };
  }

  const start = Date.now();
  try {
    const vector = await embedWithTimeout(adapter, PROBE_TEXT, PROBE_TIMEOUT_MS);
    const dims = Array.isArray(vector) ? vector.length : 0;
    if (!dims) {
      return {
        ok: false,
        reason: "bad-response",
        providerKey: modelInfo.providerKey,
        modelKey: modelInfo.modelKey,
        detail: "embeddings endpoint returned no vector",
      };
    }
    return {
      ok: true,
      providerKey: modelInfo.providerKey,
      modelKey: modelInfo.modelKey,
      dims,
      ms: Date.now() - start,
    };
  } catch (err) {
    const msg = String(err?.message || err);
    let status = err?.statusCode ?? err?.status ?? null;
    // Adapters embed the status in the message ("...(404): ...") — extract it
    // so the verdict stays precise (http-404, not probe-failed).
    if (typeof status !== "number") {
      const m = msg.match(/\((\d{3})\)/);
      if (m) status = Number(m[1]);
    }
    // Definitive provider rejection (4xx) → dead binding, reject the save.
    // 5xx / network errors → transient outage, allow the bind (fail-open).
    const definitive = typeof status === "number" && status >= 400 && status < 500;
    if (!definitive && /timeout|abort|network|econn|enotfound|dns|socket/i.test(msg)) {
      return {
        ok: true,
        skipped: true,
        reason: "transient",
        providerKey: modelInfo.providerKey,
        modelKey: modelInfo.modelKey,
        detail: msg.slice(0, 200),
      };
    }
    if (!definitive && /\(5\d\d\)/.test(msg)) {
      return {
        ok: true,
        skipped: true,
        reason: "provider-outage",
        providerKey: modelInfo.providerKey,
        modelKey: modelInfo.modelKey,
        detail: msg.slice(0, 200),
      };
    }
    return {
      ok: false,
      reason: typeof status === "number" ? `http-${status}` : "probe-failed",
      providerKey: modelInfo.providerKey,
      modelKey: modelInfo.modelKey,
      detail: msg.slice(0, 300),
    };
  }
}

async function defaultFindCredential(companyId, providerId) {
  const creds = await CredentialRepository.listByCompany(companyId, {
    includeStored: true,
    includeInactive: false,
  });
  return creds.find((c) => c.provider_id === providerId) || null;
}

/**
 * Decrypt a credential row's encrypted blob. Rows without a stored blob (or a
 * malformed one) degrade to {} — the probe's live embed call will surface a
 * 401 as a definitive rejection, which is the truthful verdict anyway.
 */
function safeDecrypt(cred) {
  if (!cred?.encrypted_credentials) return {};
  try {
    return decryptCredential(cred.encrypted_credentials);
  } catch {
    return {};
  }
}

/**
 * Run the probe embed under a hard deadline: an AbortController aborts the
 * underlying request at `ms` (the adapters thread `signal` into fetch / the CF
 * SDK), and the timer is unref'd + cleared so the probe never keeps the event
 * loop alive after it settles.
 */
async function embedWithTimeout(adapter, text, ms) {
  const controller = new AbortController();
  let timer = null;
  try {
    timer = setTimeout(() => controller.abort(), ms);
    timer.unref?.();
    return await adapter.embed(text, { signal: controller.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
