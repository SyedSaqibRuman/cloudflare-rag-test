// --------------------------
// OPENAI EMBEDDING ADAPTER
// Adapts OpenAI-compatible embedding API (OpenAI, NVIDIA, Anthropic) for the
// ingestion pipeline. Uses node-fetch — no extra dependency (OpenAI's
// embeddings endpoint is a single POST).
// --------------------------

import fetch from "node-fetch";

const BASE_URLS = {
  openai: "https://api.openai.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

export class OpenAIEmbeddingAdapter {
  constructor(credentials, modelKey, providerKey = "openai") {
    this.modelKey = modelKey;
    this.apiKey = credentials.apiKey;
    this.baseURL = BASE_URLS[providerKey] || BASE_URLS.openai;
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