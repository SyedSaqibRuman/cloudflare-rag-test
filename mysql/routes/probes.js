// --------------------------
// LIVE PROBES (verify + connections/test endpoints)
// Hand-written probes override the generic schema-driven probe per
// provider_key. Probe signature: async (fields) =>
//   { ok, latencyMs?, error?, warning? }
//   - ok:      connectivity/auth succeeded
//   - warning: ok but with a caveat (9Router "soft fail", e.g. quota spent)
// --------------------------

/** Pull a human-readable message out of a provider's JSON error body. */
export function parseProviderErrorMessage(bodyText, fallback) {
  if (!bodyText) return fallback;
  try {
    const parsed = JSON.parse(bodyText);
    const message =
      parsed?.error?.message || parsed?.message || parsed?.error || parsed?.errors?.[0]?.message;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message) return JSON.stringify(message);
  } catch {
    /* not JSON — fall through to raw text */
  }
  return bodyText.trim() || fallback;
}

/**
 * Classify an HTTP status into ok / hard-fail, 9Router-style.
 * - acceptStatuses: statuses that prove auth even though they aren't 2xx
 *   (e.g. a 400 from a deliberately invalid probe body).
 * - softFailMessages: per-status warnings that keep the connection ok but
 *   surface a caveat (e.g. a 402 spending-limit on a subscription provider).
 */
export function classifyStatus(status, { acceptStatuses = [], softFailMessages = {} } = {}) {
  const accepted = (status >= 200 && status < 300) || acceptStatuses.includes(status);
  if (!accepted) {
    if (status === 401) return { ok: false, error: "Token invalid or revoked." };
    if (status === 403) return { ok: false, error: "Access denied." };
    return { ok: false, error: `API returned HTTP ${status}.` };
  }
  const warning = softFailMessages[status];
  return warning ? { ok: true, warning } : { ok: true };
}

/** Shared fetch wrapper: measures latency, classifies the status, parses the
 *  provider's error body into a readable message. */
async function probeEndpoint(url, { method = "GET", headers = {}, body, acceptStatuses, softFailMessages } = {}) {
  const start = Date.now();
  let res;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}`, latencyMs: Date.now() - start };
  }
  const latencyMs = Date.now() - start;
  const bodyText = res.ok ? "" : await res.text().catch(() => "");
  const classified = classifyStatus(res.status, { acceptStatuses, softFailMessages });
  if (!classified.ok) {
    return { ok: false, error: parseProviderErrorMessage(bodyText, classified.error), latencyMs };
  }
  return { ok: true, latencyMs, warning: classified.warning };
}

/**
 * Cloudflare family probe — one token verify covers every CF-based provider
 * (Worker AI, Vectorize, R2, D1 all authenticate with the same API token).
 * Body-aware: the verify endpoint reports invalid tokens with
 * `{ success: false, errors: [...] }` on a 200, so ok requires success:true.
 */
const probeCloudflareToken = async (fields) => {
  const token = fields.api_token || fields.api_key;
  if (!token) return { ok: false, error: "Cloudflare API token missing." };
  const start = Date.now();
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const latencyMs = Date.now() - start;
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.success !== true) {
      return {
        ok: false,
        error: parseProviderErrorMessage(JSON.stringify(body || {}), `Cloudflare returned HTTP ${res.status}.`),
        latencyMs,
      };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
};

// --------------------------
// NEO4J PROBE
// --------------------------

/**
 * Live bolt handshake for the neo4j provider. Proves URI/auth are valid — not
 * just field format.
 *
 * The connectivity check ALWAYS runs against the `system` database (it exists
 * on every Neo4j instance, Aura + self-managed), so a correct
 * URI/username/password passes regardless of the app database's name — the old
 * default of `neo4j` failed on instances whose DB isn't named `neo4j` (e.g.
 * Aura's `b9b3f090`). When a database name is known (the verify routes inject
 * the company's graph_database resource name), the probe additionally verifies
 * that database exists via SHOW DATABASES.
 *
 * `driverFactory` is a test seam — default lazy-imports neo4j-driver; tests
 * inject a fake driver (no network, no dependency install).
 * @param {object} fields { uri, username, password, database? }
 * @param {Function} [driverFactory] async (uri, username, password) => driver
 * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
 */
export async function probeNeo4j(fields, driverFactory = null) {
  const { uri, username, password, database } = fields || {};
  if (!uri || !username || !password) {
    return { ok: false, error: "Neo4j URI, username and password are required." };
  }
  const start = Date.now();
  try {
    const driver = driverFactory
      ? await driverFactory(uri, username, password)
      : await (async () => {
          const neo4j = await import("neo4j-driver");
          return neo4j.default.driver(uri, neo4j.default.auth.basic(username, password));
        })();
    try {
      // SHOW DATABASES is the one command valid on the `system` database on
      // every Neo4j (Aura + self-managed) — it doubles as the connectivity
      // check AND the database-existence check. RETURN 1 only works on a user
      // database, so it can't be used here (the system DB rejects it).
      const sys = driver.session({ database: "system", defaultAccessMode: "READ" });
      let names;
      try {
        const r = await sys.run("SHOW DATABASES");
        names = r.records.map((rec) => String(rec.get("name")));
      } finally {
        await sys.close();
      }

      if (database && String(database).trim() && String(database).trim() !== "system") {
        if (!names.includes(String(database).trim())) {
          return {
            ok: false,
            error: `Neo4j connection failed: database '${database}' does not exist (available: ${names.join(", ") || "none"}).`,
            latencyMs: Date.now() - start,
          };
        }
      }

      return { ok: true, latencyMs: Date.now() - start };
    } finally {
      await driver.close();
    }
  } catch (err) {
    return { ok: false, error: `Neo4j connection failed: ${err.message}`, latencyMs: Date.now() - start };
  }
}

// --------------------------
// HAND-WRITTEN PROBES
// Keyed by provider_key; checked BEFORE the generic schema-driven probe.
// --------------------------
export const PROBES = {
  cloudflare: probeCloudflareToken,
  cloudflare_worker_ai: probeCloudflareToken,
  cloudflare_vectorize: probeCloudflareToken,
  cloudflare_r2: probeCloudflareToken,
  cloudflare_d1: probeCloudflareToken,
  openai: async (fields) => {
    if (!fields.api_key) return { ok: false, error: "OpenAI API key missing." };
    return probeEndpoint("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${fields.api_key}` },
    });
  },
  neo4j: (fields) => probeNeo4j(fields),
  anthropic: async (fields) => {
    if (!fields.api_key) return { ok: false, error: "Anthropic API key missing." };
    // Minimal max_tokens:1 POST — a 400 (bad body) or 429 (rate-limited) still
    // proves the key works; only 401/403 mean the key itself is bad.
    return probeEndpoint("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": fields.api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
      acceptStatuses: [400, 429],
    });
  },
};

// --------------------------
// DECLARATIVE API-KEY PROBES (9Router testUtils-style)
// Most API-key providers expose a cheap GET /models (or a dedicated key-verify
// endpoint) — one row per provider keeps the tuned endpoints/headers explicit
// instead of relying on the generic probe's heuristics.
// --------------------------

/** Build a probe(fields) that GETs `url` with `header: prefix + key`. */
function makeApiKeyProbe({ url, header = "Authorization", prefix = "Bearer ", keyField = "api_key" }) {
  return async (fields) => {
    const key = fields[keyField];
    if (!key) return { ok: false, error: "API key missing for the connectivity check." };
    return probeEndpoint(url, { headers: { [header]: `${prefix}${key}` } });
  };
}

// Hand-tuned endpoint + header per provider, mirroring 9Router's per-provider
// probe switch. Prefixes differ (Bearer / Token / Key) and some providers have
// dedicated key-verify endpoints (OpenRouter /auth/key).
const API_KEY_PROBE_CONFIG = {
  deepseek: { url: "https://api.deepseek.com/models" },
  groq: { url: "https://api.groq.com/openai/v1/models" },
  mistral: { url: "https://api.mistral.ai/v1/models" },
  xai: { url: "https://api.x.ai/v1/models" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/models" },
  perplexity: { url: "https://api.perplexity.ai/v1/models" },
  together: { url: "https://api.together.xyz/v1/models" },
  fireworks: { url: "https://api.fireworks.ai/inference/v1/models" },
  cerebras: { url: "https://api.cerebras.ai/v1/models" },
  cohere: { url: "https://api.cohere.ai/v1/models" },
  nebius: { url: "https://api.studio.nebius.ai/v1/models" },
  siliconflow: { url: "https://api.siliconflow.com/v1/models" },
  hyperbolic: { url: "https://api.hyperbolic.xyz/v1/models" },
  chutes: { url: "https://llm.chutes.ai/v1/models" },
  openrouter: { url: "https://openrouter.ai/api/v1/auth/key" },
  deepgram: { url: "https://api.deepgram.com/v1/projects", prefix: "Token " },
  "fal-ai": { url: "https://api.fal.ai/v1/models?limit=1", prefix: "Key " },
  assemblyai: { url: "https://api.assemblyai.com/v1/account" },
  ollama: { url: "https://ollama.com/api/tags" },
};
for (const [providerKey, cfg] of Object.entries(API_KEY_PROBE_CONFIG)) {
  PROBES[providerKey] = makeApiKeyProbe(cfg);
}

// Providers that speak the Anthropic wire format for chat (x-api-key +
// anthropic-version + minimal max_tokens:1 POST). A 400/429 proves the key
// works; only 401/403 mean the key is bad.
function makeAnthropicStyleProbe(url) {
  return async (fields) => {
    if (!fields.api_key) return { ok: false, error: "API key missing for the connectivity check." };
    return probeEndpoint(url, {
      method: "POST",
      headers: {
        "x-api-key": fields.api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "placeholder",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
      acceptStatuses: [400, 429],
    });
  };
}
PROBES.minimax = makeAnthropicStyleProbe("https://api.minimax.io/anthropic/v1/messages");
PROBES.glm = makeAnthropicStyleProbe("https://api.z.ai/api/anthropic/v1/messages");
PROBES.kimi = makeAnthropicStyleProbe("https://api.kimi.com/coding/v1/messages");

// Gemini authenticates via a ?key= query parameter — no auth header.
PROBES.gemini = async (fields) => {
  if (!fields.api_key) return { ok: false, error: "Google AI API key missing." };
  return probeEndpoint(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(fields.api_key)}`,
    {}
  );
};

// --------------------------
// GENERIC SCHEMA-DRIVEN PROBE
// The 9Router openai-compatible fallback: any catalog provider that carries a
// default API base URL + auth header + a secret auth field gets a live
// GET {base}/models check without a hand-written probe. Hand-written probes
// above always win.
// --------------------------

/** Pick the auth-form field that carries the secret (password/encrypted;
 *  key/token/secret-named fields win over other secrets). */
export function pickKeyField(authForm) {
  const secrets = authForm.filter((f) => f.is_encrypted || f.field_type === "password");
  if (!secrets.length) return null;
  return secrets.find((f) => /(key|token|secret)/i.test(f.field_name)) || secrets[0];
}

/** OpenAI-style models URL derived from a provider's default API base URL. */
export function genericModelsUrl(base) {
  const b = String(base).trim().replace(/\/+$/, "");
  if (/\/models$/.test(b)) return b;
  if (/(\/v1|\/v1beta|\/v2)$/.test(b)) return `${b}/models`;
  return `${b}/v1/models`;
}

/**
 * Build a probe from catalog metadata alone. Returns null when the provider
 * can't be probed generically: no base URL / header / key field, query-param
 * auth (Gemini's `key=`), non-bearer/auth-type flows (oauth, basic, custom),
 * or non-LLM categories where a /models endpoint doesn't exist.
 */
export function buildGenericProbe(provider) {
  if (!provider) return null;
  const {
    default_api_base_url: base,
    auth_header_name: header,
    auth_type: authType,
    primary_service_category: category,
    authForm = [],
  } = provider;
  if (!base || !header || !authForm.length) return null;
  if (authType === "oauth" || authType === "basic_auth" || authType === "custom") return null;
  if (String(header).trim().toLowerCase() === "key") return null; // query-param auth (Gemini)
  if (category !== "ai") return null; // /models probes only make sense for LLM providers
  const keyField = pickKeyField(authForm);
  if (!keyField) return null;

  const url = genericModelsUrl(base);
  const headerName = String(header).trim();
  const isBearer = headerName.toLowerCase() === "authorization";

  return async (fields) => {
    const key = fields[keyField.field_name];
    if (!key) {
      return { ok: false, error: `${keyField.field_label} is required for the connectivity check.` };
    }
    return probeEndpoint(url, {
      headers: isBearer ? { Authorization: `Bearer ${key}` } : { [headerName]: key },
    });
  };
}

/**
 * Resolve the probe for a provider: hand-written override wins, then the
 * schema-driven generic probe, then null (format-level check only).
 * @param {string} providerKey
 * @param {object} [provider] full registry entry (authForm, base URL, …)
 */
export function getProbe(providerKey, provider) {
  if (PROBES[providerKey]) return PROBES[providerKey];
  return buildGenericProbe(provider);
}
