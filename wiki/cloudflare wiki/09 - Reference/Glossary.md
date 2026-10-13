---
type: reference
status: active
area: reference
tags: [glossary]
related:
  - "[[Home]]"
---

# Glossary

| Term | Meaning in THIS codebase |
|---|---|
| Company / Tenant | Isolated business configuration unit; selected via `x-company-name`; owns models/prompt/resources/creds ([[Multi-Tenancy & Company Config]]) |
| RAG store / Config store | Per-company key/value persistence (SQLite file or MySQL company_config) — distinct from gateway DB [[Data Stores]] |
| Gateway | Optional MySQL platform layer at /gateway providing catalog/credentials/resources/KB/assistants/execute/audit [[AI Gateway Platform]] |
| Connection (Credential) | Tenant-scoped encrypted field-set bound to a catalog provider+environment; drives probes/rotation [[AI Gateway Platform]] |
| Provider | Global catalog row describing an upstream API family + auth-form schema; models/pricing/endpoints hang off it |
| Resource | Provisioned concrete infra binding (vector_index/object_bucket/graph_database…) owned by a tenant, optionally linked to real cloud entity via external_id |
| Knowledge Base (KB) | Tenant unit binding embedding model + storage + vector resource + source config; target of ingestion; assistant retrieval anchor [[Knowledge Bases]] |
| Assistant | Named persona override bundle (prompt/model/temp/tokens/primary KB/graph DB/variables) selectable per tenant [[Assistant Personas]] |
| Fast path / Canned reply | Regex-intent shortcut bypassing RAG (greeting/contact/vague/…) — returned before cache or assistant logic [[Ask Pipeline]] |
| Rewrite / Followup query | SMALL_LLM standalone-query transform when history non-empty |
| Hybrid score | clamp01(0.85·vector + 0.15·keywordTF-capped) [[ADR - Hybrid scoring and gated reranking]] |
| Rerank gating | Skip cross-encoder below 4 candidate matches |
| Chunk JSON | R2 object with {content,title,…} backing answer context; address from vector metadata r2_key [[Vector Data & Chunk Files]] |
| Vector ID | sha256(prefix/slug)[0..48]-i deterministic point id (KB-prefixed uniqueness) |
| Registry fingerprint | __metaFingerprint hash forcing re-ingest on settings change [[ADR - File-based ingestion registry]] |
| Transport | stream-contract object owning frames+abort+timeout over res.write [[ADR - Transport-owned SSE streaming contract]] |
| Start frame | structured __start metadata carrying sources/matches/graph before tokens |
| Sentinel | legacy "__START_RESPONSE__" token retained for compat |
| AppError family | typed error classes mapping to HTTP envelope centrally [[Error Handling]] |
| wrap() / gate() | gateway router helpers: status-mapping try/catch; 503-until-MySQL guard |
| requireGatewayCompany-style helper | resolves :key to company row else 404 inside gateway routers |
| runnable model | model_key matching ^@(cf|cloudflare)/ executable by ask pipeline today |
| probe | live credential connectivity test returning ok/warning/error w/ latency (per-provider override map) |
| execute chat/embeddings | audited real inference through stored credentials normalized OpenAI-style |
| Preset | saved cron template row (db/presets/app.db) |
| Job key | jobId:company[:kb] concurrency/identity token of runner maps |
| diag tag | short failure bucket (AUTH/429/5XX/NET/RUNTIME/ERR) computed by shared error-tag mirroring 9Router heuristics |
| Askable KB | KB whose embedding provider + vector store support query-path resolution; pre-ADR-012 only CF-backed KBs qualified ([[Multi-Tenancy & Company Config]] era term now gated by ADR-012 roadmap) |
| Retrieval binding | assistant primary-KB ↓ company-config fallback mechanism choosing index+embedding per request; sole selection axis, no overrides by design |
| Content doctrine / Vendor-payload | where chunk text lives: target state stores `{text,title,url,type,slug,chunkIndex}` inside each vector record; CF's R2-mirror is transitional-canonical (ADR-012) |
| Dual-mode adapter | vector adapter exposing ensure/upsert/query over one credential set, used symmetrically by ingestion and ask retrieval (ADR-012) |
| wrangler | CF dev CLI dependency (tooling availability; not invoked by app code) |