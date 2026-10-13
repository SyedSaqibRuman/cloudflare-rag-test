// --------------------------
// CLOUDFLARE AI EMBEDDING ADAPTER
// Adapts Cloudflare Workers AI embedding API for the ingestion pipeline.
// --------------------------

import { Cloudflare } from "cloudflare";

export class CloudflareAIEmbeddingAdapter {
  constructor(credentials, modelKey) {
    // Accept camelCase and snake_case credential forms (api_token/account_id
    // are the stored auth-schema field names).
    this.accountId = credentials.accountId || credentials.account_id || "";
    this.apiToken = credentials.apiToken || credentials.api_token || "";
    this.modelKey = modelKey;
    this.cf = new Cloudflare({ apiToken: this.apiToken, accountId: this.accountId });
  }

  /**
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [opts]  abort support so callers can
   *        enforce deadlines (the bind-time probe aborts its 15s timeout)
   */
  async embed(text, opts = {}) {
    if (!this.modelKey.startsWith("@cf/")) {
      this.modelKey = `@cf/${this.modelKey}`;
    }

    const response = await this.cf.ai.run(
      this.modelKey,
      {
        account_id: this.accountId,
        text: text,
      },
      opts.signal ? { signal: opts.signal } : undefined
    );

    // CF SDK returns { data: [{shape, data}], shape, pooling, usage }
    // Extract the raw embedding array for the first (and only) input text
    const first = response.data?.[0];
    return first?.data || first || response.data;
  }
}