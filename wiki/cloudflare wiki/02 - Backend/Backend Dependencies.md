---
type: backend
status: active
area: backend
tags: [dependencies]
related:
  - "[[Frontend Dependencies]]"
  - "[[Dependency Map]]"
---

# Backend Dependencies

From root `package.json` (verified). Node ≥22.5 required for `node:sqlite`.

## Runtime dependencies

| Package | Used for | Where |
|---|---|---|
| express ^5.2 | HTTP framework (Express5 quirks noted in app.js) | app.js |
| cors ^2.8 | dynamic origin middleware | app.js |
| express-rate-limit ^8.5 | global/AI/login tiers | app.js, routes/ask.js, routes/auth.js |
| dotenv ^17 | .env loading (imported for side effect) | env.js etc |
| mysql2 ^3.23 | lazy pool + migrations | mysql/*, config/mysql-store.js |
| cloudflare ^5.2 | Workers AI/Vectorize/R2 SDK surface | client.js, services/* |
| @aws-sdk/client-s3 ^3 | R2 S3-API ops | services/r2.js, client.js |
| neo4j-driver ^6 | GraphRAG (lazy import) | query/graph.js |
| node-cron ^4 | cron scheduling | cron/lifecycle.js |
| node-fetch ^3 | WP & URL sources, embeddings REST | services/wp.js, ingest/sources/url.js, cloudflare_embeddings.js |
| p-limit ^7 | concurrency caps (embeddings, uploads) | cloudflare_embeddings.js, ingest/pipeline.js |
| turndown ^7 | HTML→Markdown cleaning | utils/cleaner.js |
| cheerio ^1.2 | HTML parsing (URL/file sources) | ingest/sources/* |
| mammoth ^1.12 | DOCX extraction | ingest/sources/file.js |
| pdf-parse ^2.4 | PDF text extraction (lazy CJS) | ingest/sources/file.js |
| multer ^2.2 | multipart upload endpoint(s) | gateway ingestion/upload routes |
| swagger-ui-express ^5 + swagger-ui-dist | /api-docs | app.js |
| wrangler ^4 | Cloudflare tooling availability (dev convenience) | — |
| axios ^1.18 | present but usage not located in reviewed core paths (**unknown / not confirmed**) | — |

> The `axios` entry is listed as dependency yet no import was found during this pass — flagged as dead-dependency candidate in [[Technical Debt]]; verify before removal.

## Overrides & install policy

```jsonc
"overrides": { "undici": "7.29.0" },   // pins transitive dep w/o upstream fix; npm audit clean
"allowScripts": { esbuild@0.28.1:true, sharp@0.35.2:true, workerd@… :true }
```
`@scarf/scarf` telemetry intentionally blocked per repo conventions ([[Local Setup]]).

## DevDependencies

eslint ^10 flat config + @eslint/js + eslint-plugin-react-hooks + globals; `@sentropic/graphify` powers `.graphify/` knowledge-graph artifacts regenerable offline.

## Native/runtime constraints

- ESM-only tree; two CJS interop exceptions handled via dynamic import (`pdf-parse`) or default export shape.
- No bundler server-side; module graph is plain files — circular-import safety is maintained manually (documented seam: config/store must not import config/index — see [[Configuration]]).