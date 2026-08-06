const BASE = "";

// Admin-protected API surface — these paths carry the admin session token and
// trigger the login page when the server rejects them with 401. /ask paths are
// deliberately excluded: they use per-company x-api-key auth instead.
const AUTH_PATHS = ["/cloudflare", "/auth", "/logs"];
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
}

export async function readLog(name, tail = 2000) {
  return api(`/logs/${encodeURIComponent(name)}?tail=${tail}`);
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
