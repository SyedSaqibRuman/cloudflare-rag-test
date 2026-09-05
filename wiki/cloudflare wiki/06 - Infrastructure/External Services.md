---
type: infrastructure
status: active
area: infra
tags: [external-services]
related:
  - "[[Integration Architecture]]"
---

# External Services

Operational directory — what an environment must reach, and what degrades when it can't.

## Required vs optional at runtime

| Service | Needed for | If absent/unreachable |
|---|---|---|
| Cloudflare Workers AI + token | every ask/ingest | ask returns graceful error; ingest fails job |
| Vectorize | retrieval + upserts | query→empty matches→noContext answers; health degraded |
| R2 | chunk fetch/store | chunks null → context build empty |
| MySQL (gateway/config) | admin platform; CONFIG_STORE=mysql runtime | /gateway 503; boot continues w/ warning when store unset-but-unreachable |
| Neo4j | only if company creds configured | graph step silently skipped |
| WordPress site / target URLs / uploaded files | sources per KB type | per-item fetch errors logged, batch continues where possible |
| Slack/Discord/custom webhook | optional notifications | fire-and-forget failure logs only |
| LLM providers via catalog (openai-compatible families, anthropic-style minimax/glm/kimi, gemini, cloudflare) | gateway execute/test actions & future chat bindings | probe verifies fail w/ tagged reasons; runtime ask unaffected |

## Auth materials per tenant (mirror source)

api_token/account_id (+R2 keypair optionally separate) collected once on Providers page connections; neo4j uri/user/pass + graph_database resource name. Rotation supported through credential service ([[AI Gateway Platform]]).

## Hard-coded operational constants worth knowing

Embeddings batching(4×2 conc,5 retries) · WP pacing 300ms/per_page100 · URL crawl concurrency3 timeout15s max1000 · stream timeout30s · cypher 15s · webhook 10s · health probes 5s · pool limits/keepalive tuned for remote Hostinger-style hosts.

## Adding a new external provider checklist (condensed)

1. Import catalog JSON or seed SQL rows (auth schema fields!).
2. Add dedicated probe if auth style novel.
3. If inference-capable + wanted by assistant execution → executor translator + runnable-gate update discussion ([[ADR - Provider-agnostic adapter layer]]).
4. Resource template if provisioning applies.
