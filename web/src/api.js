const BASE = "";

// Admin-protected API surface — these paths carry the admin session token and
// trigger the login page when the server rejects them with 401. /ask paths are
// deliberately excluded: they use per-company x-api-key auth instead.
const AUTH_PATHS = ["/cloudflare", "/gateway", "/auth", "/logs"];
import { getToken, onUnauthorized } from "./auth";

function authHeaders(path) {
  const t = getToken();
  if (!t) return {};
  if (!AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return {};
  return { Authorization: `Bearer ${t}` };
}

export async function api(path, { method = "GET", body, company, headers = {} } = {}) {
  const h = { ...headers, ...authHeaders(path) };
  if (company) h["x-company-name"] = company;
  if (body !== undefined) h["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
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
    throw new Error(msg);
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

export async function askStream({ question, history, company, apiKey, onToken, onError, signal }) {
  const res = await fetch(`${BASE}/ask-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(company ? { "x-company-name": company } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({ question, history }),
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
          const parsed = JSON.parse(payload);
          if (parsed.token) onToken(parsed.token);
          else if (parsed.error) onError(parsed.error);
        } catch {
          /* ignore partial frames */
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AI Gateway — provider catalog (global, no x-company-name needed)
// ---------------------------------------------------------------------------
export async function listProviders() {
  return api("/gateway/providers").then((d) => d.providers);
}

export async function getProvider(key) {
  return api(`/gateway/providers/${encodeURIComponent(key)}`).then((d) => d.provider);
}

export const deleteProvider = (key, force = false) =>
  api(`/gateway/providers/${encodeURIComponent(key)}${force ? "?force=true" : ""}`, { method: "DELETE" });

export const listEndpoints = (provider) =>
  api(`/gateway/endpoints${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`).then(
    (d) => d.endpoints
  );

export const createEndpoint = (body) => api("/gateway/endpoints", { method: "POST", body });

export const updateEndpoint = (id, body) => api(`/gateway/endpoints/${id}`, { method: "PUT", body });

export const deleteEndpoint = (id) => api(`/gateway/endpoints/${id}`, { method: "DELETE" });

export const listPricing = (modelId, provider) => {
  const params = new URLSearchParams();
  if (modelId) params.set("modelId", modelId);
  if (provider) params.set("provider", provider);
  const qs = params.toString();
  return api(`/gateway/pricing${qs ? `?${qs}` : ""}`).then((d) => d.pricing);
};

export const createPricing = (body) => api("/gateway/pricing", { method: "POST", body });

export const updatePricing = (id, body) => api(`/gateway/pricing/${id}`, { method: "PUT", body });

export const deletePricing = (id) => api(`/gateway/pricing/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// AI Gateway — tenant credentials (per-company, encrypted at rest)
// ---------------------------------------------------------------------------
export const listGatewayCompanies = () => api("/gateway/companies").then((d) => d.companies);

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

export const createProviderModel = (providerKey, body) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models`, { method: "POST", body });

export const updateProviderModel = (providerKey, id, body) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models/${id}`, { method: "PUT", body });

export const deleteProviderModel = (providerKey, id) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/models/${id}`, { method: "DELETE" });

export const getResourceTemplates = (providerKey) =>
  api(`/gateway/providers/${encodeURIComponent(providerKey)}/resources`).then((d) => d.templates || []);

export const listCredentialModels = (id) =>
  api(`/gateway/credentials/${id}/models`).then((d) => d.models);

export const grantModelAccess = (id, body) =>
  api(`/gateway/credentials/${id}/models`, { method: "POST", body });

// ---------------------------------------------------------------------------
// AI Gateway — knowledge bases (per-company, x-company-name scoped)
// ---------------------------------------------------------------------------
export const listKbs = (company) => api("/gateway/kbs", { company }).then((d) => d.kbs);

export const createKb = (body, company) => api("/gateway/kbs", { method: "POST", body, company });

export const getKb = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}`, { company }).then((d) => d.kb);

export const updateKb = (key, body, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}`, { method: "PUT", body, company });

export const deleteKb = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}`, { method: "DELETE", company });

export const ingestKb = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/ingest`, { method: "POST", company });

export const kbStatus = (key, company) =>
  api(`/gateway/kbs/${encodeURIComponent(key)}/status`, { company }).then((d) => d.status);

export const getKbOptions = (company) =>
  api("/gateway/kbs/options", { company }).then((d) => d.options);

// ---------------------------------------------------------------------------
// AI Gateway — tenant resources (provider_resources, owned by a credential)
// ---------------------------------------------------------------------------
export const listCompanyResources = (companyKey, type) =>
  api(
    `/gateway/companies/${encodeURIComponent(companyKey)}/resources${type ? `?type=${encodeURIComponent(type)}` : ""}`
  ).then((d) => d.resources);

export const createResource = (companyKey, body) =>
  api(`/gateway/companies/${encodeURIComponent(companyKey)}/resources`, { method: "POST", body });

export const updateResource = (id, body) =>
  api(`/gateway/resources/${id}`, { method: "PUT", body });

export const deleteResource = (id) => api(`/gateway/resources/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// AI Gateway — assistants (per-company, x-company-name scoped)
// ---------------------------------------------------------------------------
export const listAssistants = (company) =>
  api("/gateway/assistants", { company }).then((d) => d.assistants);

export const createAssistant = (body, company) =>
  api("/gateway/assistants", { method: "POST", body, company });

export const getAssistant = (key, company) =>
  api(`/gateway/assistants/${encodeURIComponent(key)}`, { company }).then((d) => d.assistant);

export const updateAssistant = (key, body, company) =>
  api(`/gateway/assistants/${encodeURIComponent(key)}`, { method: "PUT", body, company });

export const deleteAssistant = (key, company) =>
  api(`/gateway/assistants/${encodeURIComponent(key)}`, { method: "DELETE", company });
