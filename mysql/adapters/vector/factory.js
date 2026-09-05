// --------------------------
// VECTOR ADAPTER FACTORY
// Creates vector store adapters for Vectorize, Pinecone, Qdrant, Weaviate
// based on provider type. Each adapter implements:
//   ensureIndex(), upsert(chunks), query(vector, topK), countVectors()
// --------------------------

import { CloudflareVectorAdapter } from "./cloudflare-vectorize.js";
import { PineconeAdapter } from "./pinecone.js";
import { QdrantAdapter } from "./qdrant.js";
import { WeaviateAdapter } from "./weaviate.js";

/**
 * Create a vector adapter for the given provider.
 * @param {string} providerKey  e.g. "cloudflare", "pinecone", "qdrant", "weaviate"
 * @param {Object} credentials  Decrypted credential fields + companyName
 * @param {Object} [opts]       { embeddingAdapter } — injected for delegation
 * @returns {Object}            Adapter with ensureIndex/upsert/query/countVectors
 */
export function createVectorAdapter(providerKey, credentials, opts = {}) {
  switch (providerKey) {
    case "cloudflare":
      return new CloudflareVectorAdapter(credentials, opts);
    case "pinecone":
      return new PineconeAdapter(credentials, opts);
    case "qdrant":
      return new QdrantAdapter(credentials, opts);
    case "weaviate":
      return new WeaviateAdapter(credentials, opts);
    default:
      throw new Error(`Unsupported vector provider: ${providerKey}`);
  }
}