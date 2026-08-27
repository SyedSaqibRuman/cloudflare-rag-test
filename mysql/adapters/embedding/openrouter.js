// --------------------------
// OPENROUTER EMBEDDING ADAPTER
// Adapts OpenRouter embedding API (OpenAI-compatible) for the ingestion pipeline.
// Uses node-fetch — no extra dependency.
// --------------------------

import fetch from "node-fetch";

export class OpenRouterEmbeddingAdapter {
  constructor(credentials, modelKey) {
    this.modelKey = modelKey;
    this.apiKey = credentials.apiKey;
    this.baseURL = "https://openrouter.ai/api/v1";
  }

  async embed(text) {
    const res = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.modelKey, input: text }),
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