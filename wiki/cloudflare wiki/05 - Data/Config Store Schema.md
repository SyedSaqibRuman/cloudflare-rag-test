---
type: data
status: active
area: data
tags: [config, keys]
related:
  - "[[Multi-Tenancy & Company Config]]"
---

# Config Store Schema

The per-company key/value contract (identical in SQLite `config` table and MySQL `company_config` rows).

## Key groups (`config/schema.js`)

| Group | Keys |
|---|---|
| MODELS | `EMBEDDING_MODEL`, `LLM_MODEL`, `SMALL_LLM`, `RERANKING_MODEL` (+`AI_PROVIDER`) |
| DIMENSION | `EMBEDDING_DIMENSIONS` (auto-follows embedding model map) |
| URLS/GENERAL | `BASE_URL`, `CONTACT_US_URL`, `LOCATIONS_URL`, `SERVICES_URL`, `CONSULTANT_NAME`, `COMPANY_NAME` |
| PROMPT | `SYSTEM_PROMPT` with `{{VARIABLE}}` templating |
| STORAGE | `VECTOR_INDEX`, `R2_BUCKET_NAME` |
| ASSISTANT | `ASSISTANT_KEY` |
| CREDENTIALS (encrypted) | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN_VALUE`, `R2_JURISDICTION_END_POINT`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` |
| SECRET | `API_KEY` |

## Model allow-lists

- Embeddings: bge base/large/small, bge-m3, llmware small, coding-gemma → dims {768,1024,384,1024,384}
- LLM: llama 3.1/3.3/4-scout family incl fp8 variants
- SMALL_LLM: llama 3.2-1b/3b, 3.1-8b-fp8
- Rerank: bge-reranker base/large

Portal consumes the same arrays via re-export ([[Frontend Dependencies]]).

## Storage encoding rules

Value = JSON string; sensitive set = CREDENTIAL_KEYS+SECRET_KEYS individually encrypted `gcm:<iv>:<tag>:<data>` before stringify (`config/codec.js`) — byte-comparable across backends. Plaintext only in memory.

## Notable defaults (DEFAULT_COMPANY)

BASE_URL popularcert.com (+ contact/locations/services paths), consultant "Sarah", models bge-base-768 / llama-3.1-8b-fp8 / llama-3.2-3b / reranker-base, AI_PROVIDER cloudflare, empty VECTOR_INDEX/R2_BUCKET_NAME, and the full retail-flavored SYSTEM_PROMPT template embedded in schema.js (the only place it lives).

## Rounding out validation rules

Unknown keys rejected; company/resource names 3–63 `/^[a-z0-9-]+$/`; model swaps auto-cascade dimensions; empty-string values clear keys on update path.

Where writes happen: [[Configuration]] page + [[Multi-Tenancy & Company Config]] guarantees.