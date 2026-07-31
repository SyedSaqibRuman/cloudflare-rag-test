# Architecture

## Overview

```
User Question
      ↓
Intent Detection (fast path / greeting / blocked)
      ↓
Query Rewriting (configurable LLM — standalone query)
      ↓
Embedding Generation (configurable model)
      ↓
Vector Search (Cloudflare Vectorize)
      ↓
Hybrid Scoring (85% vector + 15% keyword)
      ↓
Deduplication
      ↓
Reranking (configurable reranker model)
      ↓
Chunk Retrieval (Cloudflare R2)
      ↓
Context Building (max 4000 chars)
      ↓
LLM Response (configurable LLM)
      ↓
Final Answer
```

---

## RAG Pipeline

### How It Works

1. **Intent Detection** — Greetings, identity queries, and blocked patterns return instant static responses without hitting the RAG pipeline.

2. **Query Rewriting** — Follow-up questions are rewritten into standalone search queries using the configured small LLM (default: `llama-3.2-3b-instruct`) to improve retrieval quality.

3. **Embedding** — The question is embedded using the configured embedding model (default: `bge-base-en-v1.5`, 768 dimensions).

4. **Vector Search** — Top 10 nearest neighbors are retrieved from Cloudflare Vectorize.

5. **Hybrid Scoring** — Results are scored with 85% vector similarity + 15% keyword overlap.

6. **Deduplication** — Duplicate results (same post/page) are merged, keeping the highest score.

7. **Reranking** — Top 10 candidates are reranked using the configured reranker model (default: `bge-reranker-base`) for precision.

8. **Chunk Retrieval** — Final top 5 chunks are fetched from R2 storage.

9. **Context Building** — Chunks are assembled into a context string (max 4000 chars) with source labels.

10. **LLM Generation** — The configured LLM (default: `llama-3.1-8b-instruct-fp8`) generates the final answer with the context.

### Default Models

| Role | Model | Dimensions | Configurable |
|------|-------|------------|--------------|
| Embeddings | `@cf/baai/bge-base-en-v1.5` | 768 | Yes — `EMBEDDING_MODEL` |
| Reranking | `@cf/baai/bge-reranker-base` | — | Yes — `RERANKING_MODEL` |
| Response Generation | `@cf/meta/llama-3.1-8b-instruct-fp8` | — | Yes — `LLM_MODEL` |
| Query Rewriting | `@cf/meta/llama-3.2-3b-instruct` | — | Yes — `SMALL_LLM` |

All models can be changed at runtime via the Cloudflare API. See [Model Configuration](./api/config.md#model-configuration).

### Caching

- In-memory cache with 60-minute TTL
- Max 200 entries with FIFO eviction
- Cache key: MD5 of `companyName:rewrittenQuestion` (company-scoped)
- Cached responses include `"cached": true` flag

---

## CORS

Allowed origins are restricted to:

- `https://dev.popularcert.com`
- `https://popularcert.com`
- `https://crm.popularcert.com`
- `http://localhost:3000`
- `http://localhost:5173`

---

## Rate Limiting

The API has three tiers of rate limiting to protect against abuse and control AI API costs:

| Tier | Routes | Default Limit | Env Var |
|------|--------|---------------|---------|
| Global | All routes except `GET /` | 100 req/min | `RATE_LIMIT_GLOBAL` |
| AI | `POST /ask`, `POST /ask-stream` | 20 req/min | `RATE_LIMIT_AI` |
| Cloudflare | All `/cloudflare/*` routes | 30 req/min | `RATE_LIMIT_ADMIN` |

- Limits are per-IP address (uses the `trust proxy` setting for accurate client IP behind reverse proxies)
- Rate-limited requests receive a `429 Too Many Requests` response with a descriptive error message
- Standard `RateLimit-*` headers are returned with every response
- All limits are configurable via environment variables; omit the variable to use defaults

---

## Logging

- In development (`NODE_ENV !== 'production'`), verbose debug logs are printed to the console
- In production, debug logs are suppressed for cleaner output
- File logs are always written to `logs/` regardless of environment
