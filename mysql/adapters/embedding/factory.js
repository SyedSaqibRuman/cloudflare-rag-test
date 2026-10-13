// --------------------------
// EMBEDDING ADAPTER FACTORY
// Creates embedding adapters for CF AI, OpenAI, NVIDIA, etc. based on provider type.
// Each adapter implements: embed(text): Promise<number[]>
// --------------------------

import { CloudflareAIEmbeddingAdapter } from "./cloudflare-ai.js";
import { OpenAIEmbeddingAdapter } from "./openai.js";
import { OpenRouterEmbeddingAdapter } from "./openrouter.js";

export function createEmbeddingAdapter(providerKey, credentials, modelKey) {
  switch (providerKey) {
    case "cloudflare":
      return new CloudflareAIEmbeddingAdapter(credentials, modelKey);

    case "openai":
      return new OpenAIEmbeddingAdapter(credentials, modelKey);

    case "openrouter":
      return new OpenRouterEmbeddingAdapter(credentials, modelKey);

    case "nvidia":
      return new OpenAIEmbeddingAdapter(credentials, modelKey, "nvidia");

    case "anthropic":
      return new OpenAIEmbeddingAdapter(credentials, modelKey, "anthropic"); // Uses OpenAI-compatible endpoint

    default:
      throw new Error(`Unsupported embedding provider: ${providerKey}`);
  }
}