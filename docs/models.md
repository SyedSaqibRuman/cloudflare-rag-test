# Models

## Default Models

| Role | Model | Dimensions | Configurable |
|------|-------|------------|--------------|
| Embeddings | `@cf/baai/bge-base-en-v1.5` | 768 | Yes — `EMBEDDING_MODEL` |
| Reranking | `@cf/baai/bge-reranker-base` | — | Yes — `RERANKING_MODEL` |
| Response Generation | `@cf/meta/llama-3.1-8b-instruct-fp8` | — | Yes — `LLM_MODEL` |
| Query Rewriting | `@cf/meta/llama-3.2-3b-instruct` | — | Yes — `SMALL_LLM` |

All models can be changed at runtime via the Cloudflare API. See [Model Configuration](./api/config.md#model-configuration).

---

## Embedding Models

| Model ID | Dimensions | Use Case |
|----------|------------|----------|
| `@cf/baai/bge-base-en-v1.5` | 768 | Default — balanced accuracy and speed |
| `@cf/baai/bge-large-en-v1.5` | 1024 | Higher accuracy, slower |
| `@cf/baai/bge-small-en-v1.5` | 384 | Faster, lower accuracy |
| `@cf/baai/bge-m3` | 1024 | Multilingual support |
| `@cf/llmware/bge-small-en-v1.5` | 384 | Lightweight alternative |

> **Note:** Changing the embedding model updates `EMBEDDING_DIMENSIONS` automatically. Existing vectors must be re-indexed if dimensions change.

---

## LLM Models (Response Generation)

| Model ID | Parameters | Use Case |
|----------|------------|----------|
| `@cf/meta/llama-3.1-8b-instruct-fp8` | 8B | Default — fast, good quality |
| `@cf/meta/llama-3.3-70b-instruct-fp8` | 70B | Highest quality, slower |
| `@cf/meta/llama-3.2-3b-instruct` | 3B | Lightweight, fast |
| `@cf/meta/llama-3.1-70b-instruct` | 70B | High quality (non-quantized) |
| `@cf/meta/llama-3.1-8b-instruct` | 8B | Non-quantized variant |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 17B | Latest generation |

---

## Small LLM Models (Query Rewriting)

| Model ID | Parameters | Use Case |
|----------|------------|----------|
| `@cf/meta/llama-3.2-3b-instruct` | 3B | Default — lightweight rewrite |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | 8B | More capable rewrite |
| `@cf/meta/llama-3.2-1b-instruct` | 1B | Minimal resource usage |

---

## Reranking Models

| Model ID | Use Case |
|----------|----------|
| `@cf/baai/bge-reranker-base` | Default — balanced reranking |
| `@cf/baai/bge-reranker-large` | Higher accuracy reranking |

---

## Runtime Configuration

Models can be changed at runtime via the Cloudflare API without restarting the server. Each company has its own model configuration:

```bash
# Update a single model
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-company-name: popularcert" \
  -d '{"key": "LLM_MODEL", "value": "@cf/meta/llama-3.3-70b-instruct-fp8"}'

# Update multiple models at once
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-company-name: popularcert" \
  -d '{"models": {"LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8", "EMBEDDING_MODEL": "@cf/baai/bge-m3"}}'
```

Changes are persisted to `runtime-config.json` on disk and survive server restarts. Use `POST /cloudflare/config/reset` to revert to environment defaults.
