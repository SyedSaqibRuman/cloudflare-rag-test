// --------------------------
// VECTOR ADAPTER FACTORY
// Creates vector store adapters for Vectorize, Pinecone, etc. based on provider type.
// Each adapter implements: ensureIndex(), upsert(chunks)
// --------------------------

import { CloudflareVectorAdapter } from "./cloudflare-vectorize.js";

export function createVectorAdapter(providerKey, credentials, opts = {}) {
  switch (providerKey) {
    case "cloudflare":
      return new CloudflareVectorAdapter(credentials, opts);

    // pinecone: new PineconeAdapter(credentials, opts)
    // weaviate: new WeaviateAdapter(credentials, opts)
    default:
      throw new Error(`Unsupported vector provider: ${providerKey}`);
  }
}