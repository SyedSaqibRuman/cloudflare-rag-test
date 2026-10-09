// --------------------------
// OPENROUTER EMBEDDING ADAPTER
// Adapts OpenRouter embedding API (OpenAI-compatible) for the ingestion pipeline.
// Uses node-fetch — no extra dependency.
// --------------------------

import fetch from "node-fetch";

export class OpenRouterEmbeddingAdapter {
  constructor(credentials, modelKey) {
    this.modelKey = modelKey;
    // Accept camelCase and snake_case credential forms.
    this.apiKey = credentials.apiKey || credentials.api_key || "";
    this.baseURL = "https://openrouter.ai/api/v1";
  }

  /**
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [opts]  abort support so callers can
   *        enforce deadlines (the bind-time probe aborts its 15s timeout)
   */
  async embed(text, opts = {}) {
    const res = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.modelKey, input: text }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Embedding request failed (${res.status}): ${msg.slice(0, 200)}`);
    }

    const json = await res.json();
    if (!json?.data?.[0]?.embedding) {
      throw new Error("Embedding response missing data[0].embedding");
    }
    return json.data[0].embedding;
  }
}