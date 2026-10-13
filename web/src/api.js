const BASE = "";

// Admin-protected API surface — these paths carry the admin session token and
// trigger the login page when the server rejects them with 401. /ask paths are
// deliberately excluded: they use per-company x-api-key auth instead.
const AUTH_PATHS = ["/cloudflare", "/gateway", "/auth", "/logs"];
import { getToken, onUnauthorized } from "./auth";
import { applyAskFrame } from "./ask-stream-contract.js";
import { pushToast } from "./toast-store";

// Mutations auto-toast: success uses the server's message field when present,
// failures toast the error text — so EVERY action in the portal gets visible
// feedback even where a page forgot to notify(). Callers that render richer
// inline feedback (banners, forms) pass { silent: true } and keep doing their
// own UX. GETs never toast (polling would spam).
const SILENT = new WeakSet();
const SILENT_ERRORS = new WeakSet();
export function silentRequest(promiseOrFn) {
  const p = typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn;
  SILENT.add(p);
  return p;
}

function authHeaders(path) {
  const t = getToken();
  if (!t) return {};
  if (!AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return {};
  return { Authorization: `Bearer ${t}` };
}

export async function api(path, { method = "GET", body, company, headers = {}, query, toast, silent, silentError } = {}) {
  const h = { ...headers, ...authHeaders(path) };
  if (company) h["x-company-name"] = company;
  if (body !== undefined) h["Content-Type"] = "application/json";

  // Build URL with query params
  let url = `${BASE}${path}`;
  if (query && typeof query === "object") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const str = qs.toString();
    if (str) url += `?${str}`;
  }

  let res;
  const promise = fetch(url, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (silent) SILENT.add(promise); // per-call opt-out — caller owns ALL feedback
  if (silentError) SILENT_ERRORS.add(promise); // suppress ONLY the error toast — caller renders errors inline (success toast still fires)
  try {
    res = await promise;
  } catch {
    // Network-level failure on a mutation → toast it too (the page's own
    // catch still runs for inline handling).
    if (
      method !== "GET" &&
      !SILENT.has(promise) &&
      AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
    ) {
      pushToast("Cannot reach the API server.", "red");
    }
    throw new Error("Cannot reach the API server.");
  }

  const text = await res.text();
  let data = { raw: text };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    if (res.status === 401 && AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
      onUnauthorized();
    }
    const msg =
      data?.error ||
      (Array.isArray(data?.errors) && data.errors.join(", ")) ||
      data?.message ||
      `Request failed (HTTP ${res.status})`;
    // Auto-toast mutation failures (not polling GETs, not opted-out calls,
    // not /ask paths which surface errors in the chat UI, not 401 which is
    // handled by the login redirect).
    if (
      method !== "GET" &&
      res.status !== 401 &&
      !SILENT.has(promise) &&
      !SILENT_ERRORS.has(promise) &&
      AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
    ) {
      pushToast(msg, "red");
    }
    const err = new Error(msg);
    // Structured verdicts from the server (e.g. the KB embedding probe) ride
    // on the thrown error so pages can decode them into richer UI.
    if (data?.probe) err.probe = data.probe;
    throw err;
  }

  // Auto-toast mutation successes that carry a server message. Errors always
  // toast (they were already emitted above). Pages that notify() their own
  // (richer) success phrasing pass { toast: false } to skip ONLY the success
  // toast — error toasts still fire for them.
  if (
    method !== "GET" &&
    data?.message &&
    toast !== false &&
    !SILENT.has(promise) &&
    AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
  ) {
    pushToast(data.message, "green");
  }
  return data;
}

export async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Login failed (HTTP ${res.status})`);
  return data;
}

export async function health() {
  return api("/_health");
}

export async function listLogs() {
  return api("/logs");
}export async function readLog(name, tail = 2000) {
  return api(`/logs/${encodeURIComponent(name)}?tail=${tail}`);
}

// Clear a single log file (name) or all of them (no name).
export async function clearLog(name) {
  return api(`/logs${name ? `/${encodeURIComponent(name)}` : ""}`, { method: "DELETE" });
}

// Trigger a browser download of a log file (single file or the /logs/export
// bundle). Done with a raw fetch so the admin token header is attached.
async function downloadFile(path, fallbackName) {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders(path) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Download failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadLog(name) {
  return downloadFile(`/logs/${encodeURIComponent(name)}/download`, name);
}

export function downloadAllLogs() {
  return downloadFile("/logs/export", `all-logs-${new Date().toISOString().slice(0, 10)}.txt`);
}

// Fire-and-forget: record a UI toast into logs/UI.logs on the server. Never
// throws — toast logging must not disturb the actual toast UX.
export function logUiToast(message, tone = "green") {
  if (!message) return;
  api("/logs/ui", { method: "POST", body: { message, tone } }).catch(() => {});
}

export async function askStream({ question, history, company, apiKey, assistantKey, onToken, onStart, onPossibleQuestions, onError, signal }) {
  const res = await fetch(`${BASE}/ask-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(company ? { "x-company-name": company } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({ question, history, assistantKey }),
    signal,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data?.error || data?.message || msg;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  if (!res.body) throw new Error("No response stream received.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          applyAskFrame(JSON.parse(payload), { onToken, onStart, onPossibleQuestions, onError });
        } catch {
          /* ignore partial frames */
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ask suggestions — per-company starter questions (best-effort; Test AI page)
// ---------------------------------------------------------------------------
export async function getAskSuggestions(company, apiKey) {
  return api("/ask/suggestions", {
    company,
    headers: apiKey ? { "x-api-key": apiKey } : {},
  }).then((d) => (Array.isArray(d?.questions) ? d.questions : []));
}

// ---------------------------------------------------------------------------
// AI Gateway — provider catalog (global, no x-company-name needed)
// ---------------------------------------------------------------------------
export async function listProviders({ page, perPage } = {}) {
  return api("/gateway/providers", { query: { page, perPage } }).then((d) => ({
    items: d.providers,
    pagination: d.pagination,
  }));
}

export async function getProvider(key) {
  return api(`/gateway/providers/${encodeURIComponent(key)}`).then((d) => d.provider);
}

export const createProvider = (body) =>
  api("/gateway/providers", { method: "POST", body });

export const updateProvider = (key, body) =>
  api(`/gateway/providers/${encodeURIComponent(key)}`, { method: "PUT", body });

export const deleteProvider = (key, force = false) =>
  api(`/gateway/providers/${encodeURIComponent(key)}${force ? "?force=true" : ""}`, { method: "DELETE" });

export const listEndpoints = (provider, { page, perPage } = {}) =>
  api("/gateway/endpoints", { query: { provider, page, perPage } }).then((d) => ({
    items: d.endpoints,
    pagination: d.pagination,
  }));

export const createEndpoint = (body) => api("/gateway/endpoints", { method: "POST", body });

export const updateEndpoint = (id, body) => api(`/gateway/endpoints/${id}`, { method: "PUT", body });

export const deleteEndpoint = (id) => api(`/gateway/endpoints/${id}`, { method: "DELETE" });

export const listPricing = (modelId, provider, { page, perPage } = {}) => {
  return api("/gateway/pricing", { query: { modelId, provider, page, perPage } }).then((d) => ({
    items: d.pricing,
    pagination: d.pagination,
  }));
};

export const createPricing = (body) => api("/gateway/pricing", { method: "POST", body });

export const updatePricing = (id, body) => api(`/gateway/pricing/${id}`, { method: "PUT", body });

export const deletePricing = (id) => api(`/gateway/pricing/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// AI Gateway — tenant credentials (per-company, encrypted at rest)
// ---------------------------------------------------------------------------
export const listGatewayCompanies = ({ page, perPage } = {}) =>
  api("/gateway/companies", { query: { page, perPage } }).then((d) => ({
    items: d.companies,
    pagination: d.pagination,
  }));

export const getGatewayCompany = (key) =>
  api(`/gateway/companies/${encodeURIComponent(key)}`).then((d) => d.company);

export const createEnvironment = (companyKey, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/environments`, { method: "POST", body });

export const updateEnvironment = (companyKey, envKey, body) =>
  api(
    `/gateway/companies/${encodeURIComponent(companyKey)}/environments/${encodeURIComponent(envKey)}`,
    { method: "PUT", body }
  );

export const deleteEnvironment = (companyKey, envKey) =>
  api(
    `/gateway/companies/${encodeURIComponent(companyKey)}/environments/${encodeURIComponent(envKey)}`,
    { method: "DELETE" }
  );

export const importProviderDefinition = (definition, { replaceChildren = false } = {}) =>
  api("/gateway/providers/import", {
    method: "POST",
    body: { definition, replaceChildren },
  });

export const getAuthForm = (providerKey) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/auth-form`).then((d) => d.fields);

export const listCredentials = (companyKey) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/credentials`).then((d) => d.credentials);

export const testCredentialConnection = (companyKey, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/connections/test`, {
    method: "POST",
    body,
  });

export const testCredentialsBatch = (companyKey, body) =>
  api("/gateway/credentials/test-batch", {
    method: "POST",
    body: { ...body, companyKey },
  });

export const createCredential = (companyKey, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/credentials`, { method: "POST", body });

export const updateCredential = (id, body) =>
  api(`/gateway/credentials/${id}`, { method: "PUT", body });

export const verifyCredential = (id) => api(`/gateway/credentials/${id}/verify`, { method: "POST" });

export const rotateCredential = (id, body) =>
  api(`/gateway/credentials/${id}/rotate`, { method: "POST", body });

export const deleteCredential = (id) => api(`/gateway/credentials/${id}`, { method: "DELETE" });

export const listProviderModels = (providerKey) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models`).then((d) => d.models);

export const fetchProviderModels = (providerKey, companyKey) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models/fetch`, {
    method: "POST",
    body: { companyKey },
  });

export const createProviderModel = (providerKey, body) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models`, { method: "POST", body });

export const updateProviderModel = (providerKey, id, body) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models/${id}`, { method: "PUT", body });

export const deleteProviderModel = (providerKey, id) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models/${id}`, { method: "DELETE" });

export const deleteAllProviderModels = (providerKey) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models`, { method: "DELETE" });

export const getResourceTemplates = (providerKey) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/resources`).then((d) => d.templates || []);

export const listCredentialModels = (id) =>
  api(`/gateway/credentials/${id}/models`).then((d) => d.models);

export const grantModelAccess = (id, body) =>
  api(`/gateway/credentials/${id}/models`, { method: "POST", body });

export const bulkSetModelAccess = (body) =>
  api("/gateway/credentials/model-access/bulk", { method: "POST", body });

// ---------------------------------------------------------------------------
// Setup checkpoints — company configuration progress (sequential stepper)
// ---------------------------------------------------------------------------
export const getSetupStatus = (company) =>
  api("/cloudflare/setup-status", { company }).then((d) => ({
    complete: !!d.complete,
    doneCount: d.doneCount ?? 0,
    total: d.total ?? 0,
    next: d.next || null,
    steps: d.steps || [],
  }));

// ---------------------------------------------------------------------------
// AI Gateway — knowledge bases (per-company, x-company-name scoped)
// ---------------------------------------------------------------------------
export const listKbs = (company, { page, perPage } = {}) =>
  api("/gateway/kbs", { company, query: { page, perPage } }).then((d) => ({
    items: d.kbs,
    pagination: d.pagination,
  }));

export const createKb = (body, company, opts = {}) =>
  api("/gateway/kbs", { method: "POST", body, company, silentError: opts.silentError });

export const getKb = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}`, { company }).then((d) => d.kb);

export const updateKb = (key, body, company, opts = {}) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}`, { method: "PUT", body, company, silentError: opts.silentError });

export const deleteKb = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}`, { method: "DELETE", company });

/** Delete a KB's entities + relationships from the Neo4j knowledge graph. */
export const clearKbGraph = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/graph`, { method: "DELETE", company });

export const ingestKb = (key, company, scope) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/ingest`, {
    method: "POST",
    company,
    body: scope ? { scope } : undefined,
  });

export const kbStatus = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/status`, { company }).then((d) => d.status);

/** KB health: flags KBs whose last ingest predates their index's created_on (stale-index detection). */
export const kbHealth = (company) =>
  api("/gateway/kbs/health", { company });

/** Sitemap discovery preview for a website URL (KB wizard, spec §30). */
export const discoverWebsite = (company, websiteUrl) =>
  api("/gateway/kbs/discover-website", { method: "POST", company, body: { websiteUrl } });

export const listSourcePages = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/source-pages`, { company }).then((d) => d.pages || []);

export const getKbProgress = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/ingest-progress`, { company });

/** Stop a running ingest job (abort at the next loop boundary). */
export const stopIngestJob = (company, kbKey) =>
  api("/cloudflare/job/stop", { method: "POST", body: { jobId: "ingest", companyName: company, kbKey } });

/** Pause a running ingest job — suspends at the next document boundary. */
export const pauseIngestJob = (company, kbKey) =>
  api("/cloudflare/job/pause", { method: "POST", body: { jobId: "ingest", companyName: company, kbKey } });

/** Resume a paused ingest job (fresh run; completed docs are skipped). */
export const resumeIngestJob = (company, kbKey) =>
  api("/cloudflare/job/resume", { method: "POST", body: { jobId: "ingest", companyName: company, kbKey } });

export const getKbOptions = (company) => api("/gateway/kbs/options", { company }).then((d) => d.options);

export const exportKbs = (keys, company) =>
  api("/gateway/kbs/export", { method: "POST", body: { keys }, company });

export const importKbs = (items, company, overwrite = false) =>
  api("/gateway/kbs/import", { method: "POST", body: { items, overwrite }, company });

/** Upload files to a KB for ingestion. Uses FormData (not JSON).
 * @param {string} key
 * @param {File[]} files
 * @param {string} company
 * @param {Object} [opts]
 * @param {function} [opts.onProgress]  Called with { loaded, total, percent } during upload
 * @returns {Promise<Object>}
 */
export function uploadKbDocuments(key, files, company, opts = {}) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/gateway/kbs/${encodeURIComponent(key)}/documents`);

    const t = getToken();
    if (t) xhr.setRequestHeader("Authorization", `Bearer ${t}`);
    if (company) xhr.setRequestHeader("x-company-name", company);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) {
        opts.onProgress({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100) });
      }
    };

    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { data = { raw: xhr.responseText }; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Upload failed (HTTP ${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(formData);
  });
}

/** Remove uploaded files from a KB. */
export const clearKbDocuments = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/documents`, { method: "DELETE", company });

/** List processed documents from the ingestion registry. */
export const listKbDocuments = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/documents`, { company });

/** Preview one ingested document (assembled from its stored R2 chunks).
 *  Returns { title, url, content, chunkCount, truncated, storagePrefix }. */
export const previewIngestedDocument = (key, docKey, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/documents/preview/${encodeURIComponent(docKey)}`, { company });

/** Fetch a single uploaded file for inline preview.
 *  Returns either:
 *   - { kind: "docx-text", text, name } for .docx
 *   - { kind: "blob", blob, mime, name } for everything else
 *
 *  Always uses the authenticated /gateway path so the admin token gets
 *  attached. For DOCX we do a second fetch to obtain a downloadable blob.
 */
export async function previewKbDocument(key, fileId, company) {
  const path = `/gateway/kbs/${encodeURIComponent(key)}/documents/${encodeURIComponent(fileId)}`;
  const h = { ...authHeaders(path), "x-company-name": company };
  const res = await fetch(`${BASE}${path}`, { headers: h });
  if (!res.ok) {
    const text = await res.text();
    let msg = `Request failed (HTTP ${res.status})`;
    try { msg = JSON.parse(text).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    // DOCX path — server returned extracted text + the original blob
    // (read it for the download button).
    const data = await res.json();
    if (data.kind === "docx-text") {
      const blobRes = await fetch(`${BASE}${path}`, { headers: h });
      const blob = await blobRes.blob();
      return { kind: "docx-text", text: data.text, blob, name: data.name };
    }
    throw new Error("Unexpected preview response.");
  }
  const blob = await res.blob();
  return { kind: "blob", blob, mime: ct, name: fileId };
}

/** Delete a single uploaded file from a KB. */
export const deleteKbDocument = (key, fileId, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/documents/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    company,
  });

// ---------------------------------------------------------------------------
// KB Custom Q&A — direct answers that override the RAG pipeline
// ---------------------------------------------------------------------------
export const listKbQa = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/qa`, { company }).then((d) => d.entries || []);

export const addKbQa = (key, entry, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/qa`, { method: "POST", body: entry, company });

export const updateKbQa = (key, entryId, updates, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/qa/${encodeURIComponent(entryId)}`, {
    method: "PUT", body: updates, company,
  });

export const deleteKbQa = (key, entryId, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/qa/${encodeURIComponent(entryId)}`, {
    method: "DELETE", company,
  });

export const matchKbQa = (key, question, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/qa/match`, {
    method: "POST", body: { question }, company,
  });

// ---------------------------------------------------------------------------
// AI Gateway — tenant resources (provider_resources, owned by a credential)
// ---------------------------------------------------------------------------
export const listCompanyResources = (companyKey, type) =>
  api(
    `/gateway/companies/${encodeURIComponent(companyKey)}/resources${type ? `?type=${encodeURIComponent(type)}` : ""}`
  ).then((d) => d.resources);

export const createResource = (companyKey, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/resources`, { method: "POST", body });

export const listCloudflareResources = (companyKey, type) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/cloudflare/resources/${encodeURIComponent(type)}`).then(
    (d) => d.resources
  );

export const createCloudflareResource = (companyKey, type, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/cloudflare/resources/${encodeURIComponent(type)}`, {
    method: "POST",
    body,
  });

export const deleteCloudflareResource = (companyKey, type, id) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/cloudflare/resources/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

// Live non-Cloudflare vector stores (Qdrant collections / Pinecone indexes /
// Weaviate classes). Creating one also registers it as a vector_index resource
// so the KB wizard can bind it.
export const listVectorResources = (companyKey, provider) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/vector/resources/${encodeURIComponent(provider)}`).then(
    (d) => d.resources
  );

export const createVectorResource = (companyKey, provider, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/vector/resources/${encodeURIComponent(provider)}`, {
    method: "POST",
    body,
  });

export const deleteVectorResource = (companyKey, provider, name) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/vector/resources/${encodeURIComponent(provider)}/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });

export const updateResource = (id, body) =>
  api(`/gateway/resources/${id}`, { method: "PUT", body });

export const deleteResource = (id) => api(`/gateway/resources/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// AI Gateway — assistants (per-company, x-company-name scoped)
// ---------------------------------------------------------------------------
export const listAssistants = (company, { page, perPage } = {}) =>
  api("/gateway/assistants", { company, query: { page, perPage } }).then((d) => ({
    items: d.assistants,
    pagination: d.pagination,
  }));

export const createAssistant = (body, company, opts = {}) =>
  api("/gateway/assistants", { method: "POST", body, company, ...opts });

export const getAssistant = (key, company) =>
  api(`/gateway/assistants/${encodeURIComponent(key)}`, { company }).then((d) => d.assistant);

export const updateAssistant = (key, body, company, opts = {}) =>
  api(`/gateway/assistants/${encodeURIComponent(key)}`, { method: "PUT", body, company, ...opts });

export const deleteAssistant = (key, company, opts = {}) =>
  api(`/gateway/assistants/${encodeURIComponent(key)}`, { method: "DELETE", company, ...opts });

export const testAssistant = (key, question, company, history = []) =>
  api(`/gateway/assistants/${encodeURIComponent(key)}/test`, {
    method: "POST",
    body: { question, history },
    company,
  });

export const duplicateAssistant = (key, newKey, company, newName, opts = {}) =>
  api(`/gateway/assistants/${encodeURIComponent(key)}/duplicate`, {
    method: "POST",
    body: { newKey, newName },
    company,
    ...opts,
  });

// Execute a chat completion through a stored gateway credential (admin test call).
// body: { credentialId? | providerKey + credentialKey? + environmentKey?,
//         model?, messages: [{ role, content }], options? }
export const executeChat = (companyKey, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/execute/chat`, {
    method: "POST",
    body,
    company: companyKey,
  });

// Batch "Test All" — one minimal chat completion against every catalog model of
// a provider through the company's credential. body: { providerKey, credentialId?,
// category?, modelIds?, concurrency?, timeoutMs? }. Returns { summary, results,
// freeWorkingModels } — dead/404/hung models are flagged per-model.
export const testProviderModels = (companyKey, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/execute/test-models`, {
    method: "POST",
    body,
    company: companyKey,
  });

// "Prune dead models" — run a fresh sweep and delete only the models the
// provider definitively disowns (function-not-found 404s). dryRun (default)
// returns the prune/keep preview; dryRun:false performs the guarded deletes.
export const pruneDeadModels = (companyKey, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/execute/prune-dead-models`, {
    method: "POST",
    body,
    company: companyKey,
  });

// Test a provider credential (admin diagnostics).
export const testProvider = (providerKey, credentialId) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/test`, {
    method: "POST",
    body: { credentialId },
  });

// Conversation reset for one company — clears the server's in-memory answer
// cache so the next question re-runs the full RAG pipeline. Gated like /ask:
// x-company-name + the company's per-company API key.
export async function resetAskCache(company, apiKey) {
  const res = await fetch(`${BASE}/ask/reset`, {
    method: "POST",
    headers: {
      ...(company ? { "x-company-name": company } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* keep default */
  }
  if (!res.ok) throw new Error(data?.error || `Reset failed (HTTP ${res.status})`);
  return data;
}

// Ingestion Pipeline API helpers
/**
 * Start an ingestion job.
 * @param {string} companyName
 * @param {string|null} kbKey
 * @param {Object|null} scope - Ingestion scope spec:
 *   { scope: "all" }                                — all posts + pages
 *   { scope: "limit", limit: 100 }                   — up to N API pages
 *   { scope: "selected", items: [{type,id}, ...] }   — specific WP items
 *   { contentTypes: ["post","page"] }                — filter content types
 */
export const startIngestion = (companyName, kbKey = null, scope = null) => {
  const body = { companyName };
  if (kbKey) body.kbKey = kbKey;
  if (scope) body.scope = scope;
  return api("/gateway/ingest/start", { method: "POST", body });
};

export const getIngestionJobs = () => api("/gateway/ingest/jobs");

export const getIngestionStatus = (companyName) =>
  api(`/gateway/ingest/status/${encodeURIComponent(companyName || "")}`);

export const cancelIngestion = (companyName) =>
  api(`/gateway/ingest/cancel/${encodeURIComponent(companyName || "")}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// AI Gateway — usage (per-company, x-company-name scoped)
// ---------------------------------------------------------------------------
export const getUsageSummary = (company, { from, to } = {}) =>
  api("/gateway/usage/summary", { company, query: { from, to } }).then((d) => d.summary);

export const getUsageAggregate = (company, { from, to, groupBy } = {}) =>
  api("/gateway/usage", { company, query: { from, to, groupBy } }).then((d) => d.data);

export const getUsageTop = (company, limit = 10) =>
  api("/gateway/usage/top", { company, query: { limit } }).then((d) => d.data);

export const getUsageRecent = (company, limit = 20) =>
  api("/gateway/usage/recent", { company, query: { limit } }).then((d) => d.data);

// ---------------------------------------------------------------------------
// Knowledge graph (per-KB, x-company-name scoped — /gateway/knowledge)
// Entities, relationships, claims, conflicts + review queue for the Neo4j
// knowledge layer (Phases 2–5).
// ---------------------------------------------------------------------------
export const listKnowledgeEntities = (key, company, query = {}) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/entities`, { company, query }).then((d) => d.entities || []);

export const getKnowledgeEntity = (key, entityId, company) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/entities/${encodeURIComponent(entityId)}`, { company }).then((d) => d.entity);

export const mergeKnowledgeEntities = (key, keepId, dropId, company) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/entities/merge`, {
    method: "POST", body: { keepId, dropId }, company,
  });

export const listKnowledgeRelationships = (key, company, query = {}) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/relationships`, { company, query }).then((d) => d.relationships || []);

export const listKnowledgeClaims = (key, company, query = {}) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/claims`, { company, query }).then((d) => d.claims || []);

export const updateKnowledgeClaimStatus = (key, claimId, status, company, reason = null) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/claims/${encodeURIComponent(claimId)}/status`, {
    method: "PUT", body: { status, reason }, company,
  });

export const listKnowledgeConflicts = (key, company) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/conflicts`, { company }).then((d) => d.conflicts || []);

export const listKnowledgeReview = (key, company) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/review`, { company }).then((d) => d.review || []);

export const executeKnowledgeTool = (key, tool, args, company) =>
  api(`/gateway/knowledge/kbs/${encodeURIComponent(key)}/tools/execute`, {
    method: "POST", body: { tool, args }, company,
  });

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------
export const bulkDelete = (entity, keys, company) =>
  api("/gateway/bulk/delete", { method: "POST", body: { entity, keys }, company });

export const bulkExport = (entity, keys, company) =>
  api("/gateway/bulk/export", { method: "POST", body: { entity, keys }, company });

export const bulkImport = (entity, items, company, overwrite = false) =>
  api("/gateway/bulk/import", { method: "POST", body: { entity, items, overwrite }, company });
