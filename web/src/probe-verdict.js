// --------------------------
// EMBEDDING PROBE VERDICT DECODER (pure ESM — node --test friendly, no JSX)
// The server attaches a structured verdict to the 400 when a KB's bind-time
// embedding probe fails (kb-service probeOrThrow → routes helpers → api.js
// err.probe). This module decodes it into display fields so UI can render an
// actionable banner instead of parsing the prose error message.
// --------------------------

/** Human phrasing per probe rejection reason. Reasons outside this map that
 * match `http-<status>` get the generic HTTP phrasing. */
const PROBE_REASON_LABELS = {
  unresolvable: "The model or its provider row could not be found in the catalog.",
  "no-credential": "No active connection for this provider — add it on the AI Providers page first.",
  adapter: "This provider does not support embedding calls here.",
  "bad-response": "The provider returned an empty or malformed embedding.",
};

/**
 * Map a structured probe verdict to display fields.
 * @param {{ reason?: string, providerKey?: string, modelKey?: string, detail?: string }} [probe]
 * @returns {{ model: string, reason: string, detail: string }}
 */
export function decodeProbeVerdict(probe) {
  const model = [probe?.providerKey, probe?.modelKey].filter(Boolean).join(" / ") || "the selected model";
  const reason =
    PROBE_REASON_LABELS[probe?.reason] ||
    (typeof probe?.reason === "string" && probe.reason.startsWith("http-")
      ? `The provider answered HTTP ${probe.reason.slice(5)} for the test embedding.`
      : "The provider rejected the test embedding.");
  return { model, reason, detail: probe?.detail || "" };
}
