import { getCFClient } from "../client.js";
import { resolveCreds } from "../config/index.js";

// --------------------------
// CLOUDFLARE AI SEAM
// The one module that knows how to reach Workers AI: account id, auth
// header, and URL shape. Callers never build the endpoint or the Bearer
// header themselves — the SDK/REST split is an internal detail.
// --------------------------
const AI_BASE_URL = "https://api.cloudflare.com/client/v4";

/**
 * Non-streaming model call via the Cloudflare SDK.
 * Resolves the SDK result object (e.g. { response } for chat,
 * { score } for reranking).
 * @param {string} companyName — resolves per-company credentials.
 * @param {string} model — Workers AI model id.
 * @param {object} input — model input (messages/text, temperature, ...).
 * @param {object} [opts] — { signal } for client-disconnect abort support.
 */
export async function runCloudflareAI(companyName, model, input, { signal } = {}) {
  const { CLOUDFLARE_ACCOUNT_ID } = resolveCreds(companyName);
  return getCFClient(companyName).ai.run(
    model,
    { account_id: CLOUDFLARE_ACCOUNT_ID, ...input },
    // Third SDK arg = per-request options (verified: Core.RequestOptions.signal).
    signal ? { signal } : undefined
  );
}

/**
 * Raw model call via the REST endpoint. Used for streaming (SSE) and for
 * callers that own their own retry policy (embeddings batching).
 * Returns the fetch Response untouched — the caller decides how to read it.
 * @param {string} companyName — resolves per-company credentials.
 * @param {string} model — Workers AI model id.
 * @param {object} body — JSON body (stream, messages, text, ...).
 * @param {object} [opts] — { signal } for abort support.
 */
export async function fetchCloudflareAI(companyName, model, body, { signal } = {}) {
  const creds = resolveCreds(companyName);
  const url = `${AI_BASE_URL}/accounts/${creds.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;
  return fetch(url, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${creds.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
