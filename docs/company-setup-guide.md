# Company Setup Guide — End to End

How to take a company from "nothing" to "answering questions" on the PopularCert RAG API: create the tenant, wire credentials, provision a vector store + storage, build a knowledge base, ingest content, give it an assistant persona, and expose it through the `/ask` API.

Two things to know before you start:

- **Blank slate by design.** Nothing is seeded from `.env`. Every company starts with default models and *empty credentials* — you enter everything through the admin portal.
- **Where things live.** Company config (models, prompts, resource bindings, ask API key) lives in the per-company config store. Credentials and infrastructure resources live in the MySQL gateway (Providers page). The `rag-sync` bridge mirrors Cloudflare/R2/Neo4j credentials from gateway connections into the config store automatically, so you type them once.

Admin portal: `http://localhost:3000` (or your deployment URL). Log in via Clerk or env credentials (`.env` `ADMIN_USERNAME`/`ADMIN_PASSWORD`). All API examples below assume `BASE=http://localhost:3000` and a session token in `$TOKEN` (portal handles this for you; for curl use `Authorization: Bearer $TOKEN` or `x-auth-token: $TOKEN`, plus `x-company-name: <company>` on RAG routes).

---

## 0. Prerequisites (one-time, operator-side)

1. **Server deps + MySQL**: `npm install`, then set in `.env`:
   `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`, `CONFIG_STORE=mysql`, `APP_ENCRYPTION_KEY` (generate: `openssl rand -hex 32` — required for credential encryption), admin login (`CLERK_SECRET_KEY` **or** `ADMIN_USERNAME`/`ADMIN_PASSWORD` + `ADMIN_SECRET`).
2. **Apply migrations**: `node mysql/migrate.js`
3. **Build the portal**: `cd web && npm install && npm run build` (the server only serves the dashboard if `web/dist` exists).
4. **Start**: `node app.js` → check `GET /_health` reports `mysql: ok`.

---

## 1. Create the company

**Portal:** Companies page → **Add Company** → name (lowercase `[a-z0-9-]`, 3–63 chars, e.g. `acme-cert`).

**API:** `POST /cloudflare/companies` with `{ "name": "acme-cert" }`.

The company is created with defaults:

| Key | Default |
|---|---|
| `EMBEDDING_MODEL` | `@cf/baai/bge-base-en-v1.5` (768 dims) |
| `LLM_MODEL` | `@cf/meta/llama-3.1-8b-instruct-fp8` |
| `SMALL_LLM` | `@cf/meta/llama-3.2-3b-instruct` |
| `RERANKING_MODEL` | `@cf/baai/bge-reranker-base` |
| `AI_PROVIDER` | `cloudflare` |
| URLs / `CONSULTANT_NAME` / `SYSTEM_PROMPT` | Popularcert template (edit per company) |

> Changing `EMBEDDING_MODEL` later auto-sets `EMBEDDING_DIMENSIONS` — but if the vector index is already populated you must re-ingest (dimension mismatch breaks upserts). Decide the embedding model **before** provisioning the index.

**Optional now, do it in step 6 otherwise:** update the URLs (`BASE_URL`, `CONTACT_US_URL`, `LOCATIONS_URL`, `SERVICES_URL`), `COMPANY_NAME`, `CONSULTANT_NAME`, and the `SYSTEM_PROMPT` — Config page, or `PUT /cloudflare/companies/<name>`. Prompts support `{{VARIABLE}}` templating (`{{CONSULTANT_NAME}}`, `{{COMPANY_NAME}}`, `{{CONTACT_US_URL}}`, …).

---

## 2. Connect credentials (Providers page)

One connection per provider, entered once and mirrored where needed. On the provider's card → **Connect / Add Connection**:

### Cloudflare (required — embeddings, LLM, Vectorize, R2)
Fields: `api_token`, `account_id`. Needs permissions for Workers AI, Vectorize, and R2 (unless you split connections — see below). On save, `rag-sync` mirrors `api_token → CLOUDFLARE_API_TOKEN`, `account_id → CLOUDFLARE_ACCOUNT_ID` into the company config. A live token-verify probe runs via the **Verify** action.

> The Cloudflare family is split by service (`cloudflare`, `cloudflare_worker_ai`, `cloudflare_vectorize`, `cloudflare_r2`, `cloudflare_d1`). You can keep one umbrella connection or separate accounts per service — the more specific connection wins for each resource type.

### Qdrant / Pinecone / Weaviate (only if not using Cloudflare Vectorize)
- **Qdrant**: `url` (e.g. `https://xyz.eu-central-1.aws.cloud.qdrant.io`), `api_key`
- **Pinecone**: `api_key` (+ index host comes from the index config)
- **Weaviate**: `url`, `api_key`

These power the KB vector store when the company doesn't use Vectorize. Live create/list/delete of stores appears on the provider detail page once a connection is active.

### R2 standalone (only if your object storage account differs)
`access_key_id`, `secret_access_key` (mirrored to `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`). If the umbrella Cloudflare connection already carries R2 access, skip this.

### Neo4j (optional — GraphRAG)
`uri`, `username`, `password`. Only needed if you plan knowledge-graph-enhanced retrieval; you'll also bind a graph database resource in step 3 or an assistant's graph setting in step 6.

**Verify** each connection after saving (the card shows active/inactive; requests without a valid connection fail with a clear 404 pointing here).

---

## 3. Provision the vector index + object storage

The KB needs two bound resources: a **vector index** and an **object bucket**.

**Portal:** Companies page → select company → *Cloudflare Resources* card (Vectorize/R2) and the provider cards (Qdrant/Pinecone/Weaviate). Or bring an existing store — the generic Resources card can register any existing index/bucket so KBs can bind it.

### Option A — Cloudflare Vectorize (default path)
1. **Create index** (or register an existing one): name `[a-z0-9-]`, **dimensions must equal `EMBEDDING_DIMENSIONS`** (768 for the default `bge-base-en-v1.5`), metric `cosine`.
2. **Create an R2 bucket** for chunk storage (any `[a-z0-9-]` name, e.g. `acme-cert-kb`).


### Option B — Qdrant / Pinecone / Weaviate
On the provider's detail page → **Create** (e.g. Qdrant: collection name `java-textbook`, dimensions `768`, distance `Cosine`). The live store is created via the provider API **and** registered for KB binding in one step. Pinecone carries dimensions/metric/cloud/region; Weaviate carries the vectorizer choice.

> **Deletion guard:** a resource still bound to a knowledge base cannot be deleted — the API returns **409** listing the KBs (`Resource 'x' is used by knowledge base(s): 'kb-key' (as vector resource). Re-point or delete the KB(s) first.`). Unbind or delete the KB first.

**API equivalents** (company-scoped, admin token):
```
POST   /gateway/companies/<key>/cloudflare/resources/vector_index   { "name": "...", "config": { "dimensions": 768, "metric": "cosine" } }
POST   /gateway/companies/<key>/cloudflare/resources/object_bucket  { "name": "..." }
POST   /gateway/companies/<key>/vector/resources/qdrant             { "name": "my-collection", "config": { "dimensions": 768, "distance": "Cosine" } }
POST   /gateway/companies/<key>/vector/resources/pinecone           { "name": "my-index", "config": { "dimensions": 768, "metric": "cosine", "cloud": "aws", "region": "us-east-1" } }
GET    /gateway/companies/<key>/resources                           (registry list)
DELETE /gateway/resources/:id                                       (409 when KB-bound)
```

---

## 4. Create the knowledge base

**Portal:** Knowledge Bases page → **New KB**:

| Setting | Guidance |
|---|---|
| `kb_key` | `[a-z0-9-]`, unique per company (e.g. `company-docs`) |
| Embedding model | Usually company default; per-KB override allowed (dimensions must match the index!) |
| Vector resource | The index from step 3 |
| Storage resource | The bucket from step 3 |
| Chunk size / overlap | Defaults 512 / 50 — bigger chunks = fewer, coarser retrievals |
| Retrieval top-k / score threshold | 10 / 0.70 defaults |
| GraphRAG | Off unless you configured Neo4j + a graph resource |

**Source type** (choose one per KB):
- **WordPress** — `{ base_url, post_types }`; syncs `/wp-json/wp/v2/pages|posts`
- **File Upload** — upload PDF / DOCX / TXT / MD / HTML files (max 10 MB each, 20 per request)
- **URL / Sitemap** — list of page URLs or a sitemap to crawl
- **Custom REST API** — JSON endpoint config for API-driven content

**API:** `POST /gateway/kbs` `{ kb_key, kb_name, vector_resource_id, storage_resource_id, source_type, source_config, ... }` then `PUT /gateway/kbs/<key>/sources` to change sources later.

---

## 5. Ingest content

**Portal:** KB detail → **Ingest** (mode `all`) or per-document controls.

**API:**
```
POST /gateway/kbs/<key>/ingest?company=<key>     { "mode": "all" | "incremental" | "selected" | "limit", "items": [...], "limit": N }
GET  /gateway/kbs/<key>/ingest-progress?company=<key>
```
Runs as a background job (max 6 concurrent, abortable). Pipeline per document: fetch → clean (HTML→Markdown) → chunk (`chunk_size`, filtered <40 chars) → chunk JSON to the storage bucket → embed in batches → upsert vectors → record in the registry (`processed-<company>-<kb>.json`, so unchanged documents are skipped).

**Monitoring:** watch `ingest-progress` (phases: fetching → processing → upserting); server log lines (`✅ Qdrant upserted batch (100)`); on completion the KB row records `last_ingestion_*` stats and `last_error`; optional webhooks (`completed`/`failed`) can notify your systems. Verify a KB's document list via `GET /gateway/kbs/<key>/documents`.

**Sanity check the vector count** before moving on — e.g. Vectorize shows `vectorCount` in the resources card; Qdrant/Pinecone show counts in their dashboards.

> Re-ingest modes: `incremental` only touches changed documents; `all` reprocesses everything (also forced automatically when chunk settings change, via the registry fingerprint). Deleting the registry file forces a full re-ingest too.

---

## 6. Assistant persona (recommended)

Create an assistant to give the company its own persona, model overrides, and per-KB guardrails — **Assistants** page, or `POST /gateway/assistants`:

```json
{
  "assistant_key": "sarah",
  "system_prompt": "You are {{CONSULTANT_NAME}} for {{COMPANY_NAME}} ...",
  "model": "@cf/meta/llama-3.1-8b-instruct-fp8",
  "temperature": 0.4,
  "max_tokens": 1024,
  "kb_key": "company-docs",
  "guardrail_prompt": "...",
  "blocked_topics": ["jokes", "politics"],
  "enable_graph_context": false
}
```

Then select it on the **Config page** (Assistant dropdown → writes `ASSISTANT_KEY` to the company config), or pass `assistantKey` per `/ask` request. `model` accepts only runnable `@cf/`/`@cloudflare/` models; the assistant's primary KB overrides retrieval; guardrail prompt + blocked topics win over company-level fallbacks. Cache keys include the assistant, so switching never serves stale answers.

If you skip this, the company defaults (step 1's `SYSTEM_PROMPT` and model set) drive the pipeline.


---

## 7. Secure & expose the ask API

**Generate a per-company ask API key** (Config page → *Ask API Key*, or `POST /cloudflare/companies/<name>/apikey`). When set:
- `POST /ask` and `POST /ask-stream` require `x-api-key` (or `Authorization: Bearer`)
- Browser clients must come from the company's domain (`<name>.com` + subdomains, `www.` included)
- Companies **without** a key stay open (backwards compatible)

**Test end to end:**
```bash
curl -X POST http://localhost:3000/ask \
  -H 'x-company-name: acme-cert' \
  -H 'x-api-key: <key>' \
  -H 'content-type: application/json' \
  -d '{"question": "How do I get ISO 9001 certified?"}'
```
Streaming variant: same body to `POST /ask-stream`, response is SSE (`data: {"token":"..."}`, `__START_RESPONSE__` sentinel, `data: [DONE]`).

The answer should cite `[Source N]` references pulled from your KB. Rate limits: 20 AI requests/min per IP on ask endpoints, 100/min global — admin routes exempt.

---

## 8. Ongoing operations

- **Scheduled syncs:** Scheduler page — set cron schedules for `ingest` (WordPress/URL sources refresh incrementally) per company; presets available.
- **Config drift:** config is loaded once at boot into memory and written persist-first on every API change — edits through the portal/API are safe; editing the DB under a running server does nothing.
- **Cache:** answers cache 60 min per company + question; `POST /ask/reset` purges one tenant.
- **Diagnostics:** Logs page (request + error logs under `logs/`); `x-error-tag` response header ties an error to the Logs page.
- **Deleting a company** removes its config; KB resources with active bindings are protected by the 409 guard — delete KBs first.

---

## Quick checklist

1. ☐ `.env` + migrations + portal build + server healthy
2. ☐ Create company (lowercase slug)
3. ☐ Cloudflare connection (+ verify)
4. ☐ Vector index (dims = embedding model) + R2 bucket — or Qdrant/Pinecone/Weaviate connection + collection
5. ☐ KB with vector + storage bindings, source configured
6. ☐ Ingest → progress → vector count > 0
7. ☐ Assistant created + selected on Config
8. ☐ Ask API key generated; `/ask` answers with sources
9. ☐ Schedule ingest cron
