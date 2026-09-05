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
    this.cf = new Cloudflare({ apiToken: this.apiToken, accountId: this.accountId });
  }

  async embed(text) {
    if (!this.modelKey.startsWith("@cf/")) {
      this.modelKey = `@cf/${this.modelKey}`;
    }

    const response = await this.cf.ai.run(this.modelKey, {
      account_id: this.accountId,
      text: text,
    });

    // CF SDK returns { data: [{shape, data}], shape, pooling, usage }
    // Extract the raw embedding array for the first (and only) input text
    const first = response.data?.[0];
    return first?.data || first || response.data;
  }
}