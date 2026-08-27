// --------------------------
// CLOUDFLARE AI EMBEDDING ADAPTER
// Adapts Cloudflare Workers AI embedding API for the ingestion pipeline.
// --------------------------

import { Cloudflare } from "cloudflare";

export class CloudflareAIEmbeddingAdapter {
  constructor(credentials, modelKey) {
    this.accountId = credentials.accountId;
    this.apiToken = credentials.apiToken;
    this.modelKey = modelKey;
    this.cf = new Cloudflare({ apiToken: this.apiToken });
  }

  async embed(text) {
    if (!this.modelKey.startsWith("@cf/")) {
      this.modelKey = `@cf/${this.modelKey}`;
    }

    const response = await this.cf.ai.run(this.modelKey, {
      text: text,
    });

    return response.data;
  }
}