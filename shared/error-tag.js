// --------------------------
// SHARED — provider error → 9Router diagnosis tag.
// Single source of truth imported by BOTH the backend
// (mysql/routes/credentials.js → diagnoseError) and the admin portal
// (web/src/pages/catalog/utils.js → errorTag alias). Mirrors 9Router's
// getErrorCode() + getConnectionErrorTag() exactly:
//   1. a 4xx/5xx code in the message becomes the LITERAL tag (401/403 → AUTH)
//      — 9Router's /\b([45]\d{2})\b/ extraction, e.g. "429", "500", "502".
//   2. per-provider error vocabulary — the tokens each provider's API emits
//      (OpenAI error.code, Anthropic error.type, Gemini status, Cloudflare
//      auth codes) map to the 9Router runtime buckets (auth_missing → AUTH,
//      upstream_rate_limited → 429, upstream_unavailable → 5XX).
//   3. generic message patterns, then ERR.
// Pure ESM, no node_modules deps — node --test can import it directly.
// --------------------------

// Provider families share OpenAI-style error tokens (error.code / error.type).
const OPENAI_VOCAB = [
  ["invalid_api_key", "AUTH"],
  ["insufficient_quota", "429"],
  ["rate_limit_exceeded", "429"],
  ["server_error", "5XX"],
  ["internal_error", "5XX"],
];

const ANTHROPIC_VOCAB = [
  ["authentication_error", "AUTH"],
  ["permission_error", "AUTH"],
  ["rate_limit_error", "429"],
  ["overloaded_error", "429"],
  ["api_error", "5XX"],
];

const GEMINI_VOCAB = [
  ["unauthenticated", "AUTH"],
  ["permission_denied", "AUTH"],
  ["resource_exhausted", "429"],
  ["deadline_exceeded", "5XX"],
];

// Cloudflare's token-verify endpoint reports invalid tokens as numeric codes
// (9109 = Invalid API Token; 10000/10001 = auth token missing/invalid).
const CLOUDFLARE_VOCAB = [
  ["9109", "AUTH"],
  ["10000", "AUTH"],
  ["10001", "AUTH"],
];

function providerVocab(providerKey) {
  const k = String(providerKey || "").toLowerCase();
  if (k.startsWith("cloudflare")) return CLOUDFLARE_VOCAB;
  if (k === "anthropic" || k === "minimax" || k === "glm" || k === "kimi" || k === "glm-cn" || k === "minimax-cn")
    return ANTHROPIC_VOCAB;
  if (k === "gemini" || k === "gemini-cli" || k === "antigravity") return GEMINI_VOCAB;
  return OPENAI_VOCAB; // default for the OpenAI-style catalog majority
}

/**
 * Short failure tag for the Test Results modal + provider cards. providerKey
 * selects the per-provider vocabulary; the algorithm otherwise matches
 * 9Router's getConnectionErrorTag (literal 4xx/5xx codes, 401/403 → AUTH,
 * then message patterns → RUNTIME/AUTH, else ERR).
 * @param {string|null} message
 * @param {string} [providerKey]
 * @returns {string|null}
 */
export function diagnoseError(message, providerKey) {
  if (!message) return null;
  const raw = String(message);

  // 9Router getErrorCode: the first 4xx/5xx in the message is the tag.
  const code = raw.match(/\b([45]\d{2})\b/)?.[1] || null;
  if (code) {
    return code === "401" || code === "403" ? "AUTH" : code;
  }

  // Per-provider vocabulary (provider's own error type/code/status tokens).
  const vocab = providerVocab(providerKey);
  const low = raw.toLowerCase();
  if (vocab) {
    for (const [token, tag] of vocab) {
      if (low.includes(token)) return tag;
    }
  }

  // Generic patterns (9Router's RUNTIME/AUTH plus the NET bucket the runtime
  // classifies as network_error, and rate-limit wording without a code).
  if (/runtime|not runnable|not installed/.test(low)) return "RUNTIME";
  if (/invalid api (key|token)|api key|x-api-key|token invalid|revoked|unauthorized|access denied|authentication|permission denied/.test(low))
    return "AUTH";
  if (/rate limit|too many requests|quota|overloaded/.test(low)) return "429";
  if (/server error|internal server|bad gateway|service unavailable/.test(low)) return "5XX";
  if (/econnreset|socket hang up|network error|fetch failed|enotfound|etimedout|econnrefused|unreachable/.test(low))
    return "NET";
  return "ERR";
}
