# Getting Started

## Quick Start

```bash
# Install dependencies
npm install

# Create .env file (see Environment Variables below)
cp .env.example .env

# Start the server
node app.js
```

The server starts on `http://localhost:3000` by default.

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Cloudflare
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=

# WordPress (for ingestion — used as default for new companies)
BASE_URL=

# Cloudflare API (optional — protects /cloudflare routes with x-api-key header)
ADMIN_API_KEY=

# AI Models (optional — defaults for new companies, can also be changed at runtime per company)
EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5
EMBEDDING_DIMENSIONS=768
LLM_MODEL=@cf/meta/llama-3.1-8b-instruct-fp8
SMALL_LLM=@cf/meta/llama-3.2-3b-instruct
RERANKING_MODEL=@cf/baai/bge-reranker-base

# Rate Limiting
RATE_LIMIT_GLOBAL=100
RATE_LIMIT_AI=20
RATE_LIMIT_ADMIN=30

# Server
PORT=3000
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Yes | — | Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | Yes | — | Cloudflare API token with AI, Vectorize, and R2 permissions |
| `BASE_URL` | Yes | `""` | Default WordPress site URL for content ingestion |
| `ADMIN_API_KEY` | No | — | API key for Cloudflare routes (unprotected if not set) |
| `EMBEDDING_MODEL` | No | `@cf/baai/bge-base-en-v1.5` | Default embedding model for new companies |
| `EMBEDDING_DIMENSIONS` | No | `768` | Vector dimensions (auto-set when embedding model changes) |
| `LLM_MODEL` | No | `@cf/meta/llama-3.1-8b-instruct-fp8` | Default primary LLM for new companies |
| `SMALL_LLM` | No | `@cf/meta/llama-3.2-3b-instruct` | Default query rewriting LLM |
| `RERANKING_MODEL` | No | `@cf/baai/bge-reranker-base` | Default reranking model |
| `RATE_LIMIT_GLOBAL` | No | `100` | Global rate limit (req/min) for all routes except health check |
| `RATE_LIMIT_AI` | No | `20` | Rate limit (req/min) for AI endpoints (`POST /ask`, `POST /ask-stream`) |
| `RATE_LIMIT_ADMIN` | No | `30` | Rate limit (req/min) for admin routes (`/cloudflare/*`) |
| `PORT` | No | `3000` | Server port |

> **Note:** Model, brand, and resource settings are configured per-company via the Cloudflare API, not via environment variables. See [Config API](./api/config.md) and [Company Management](#company-management) below.

---

## Multi-Company Architecture

The API is multi-tenant. Every request to `/ask`, `/ask-stream`, or config/prompt endpoints must include the `x-company-name` header specifying which company to use. Each company has its own isolated:

- **Vector index** (semantic search)
- **R2 bucket** (chunk storage)
- **WordPress source** (`BASE_URL`)
- **System prompt** and brand settings
- **AI models** (LLM, embedding, reranking)

### Creating a Company

```bash
curl -X POST http://localhost:3000/cloudflare/companies \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "name": "my-company",
    "config": {
      "BASE_URL": "https://mycompany.com",
      "VECTOR_INDEX": "my-company-vectors",
      "R2_BUCKET_NAME": "my-company-r2"
    }
  }'
```

### Making Requests

All AI endpoints (`/ask`, `/ask-stream`) require the `x-company-name` header. Config and prompt endpoints also require it:

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -H "x-company-name: my-company" \
  -d '{"question": "What is ISO 9001?"}'
```

If the header is missing, the API returns `400: x-company-name header is required.`

### Company Management Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/cloudflare/companies` | `GET` | List all companies |
| `/cloudflare/companies` | `POST` | Create a new company |
| `/cloudflare/companies/:name` | `GET` | Get a company's full config |
| `/cloudflare/companies/:name` | `PUT` | Update a company's config |
| `/cloudflare/companies/:name` | `DELETE` | Delete a company |
| `/cloudflare/companies/:name/reset` | `POST` | Reset a company to defaults |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js (ES Modules) |
| Framework | Express 5 |
| AI | Cloudflare Workers AI |
| Vector DB | Cloudflare Vectorize |
| Object Storage | Cloudflare R2 |
| Scheduler | node-cron |
| HTML Parsing | Turndown |
| Rate Limiting | express-rate-limit |

---

## Project Structure

```
cloudflare-rag/
├── app.js                          # Express server & route mounting
├── client.js                       # Shared Cloudflare & S3 clients
├── config.js                       # Runtime config (models, persistence, validation)
├── env.js                          # Environment variable config
├── query.js                        # RAG query engine (ask, stream, rerank)
├── ingest.js                       # WordPress content ingestion pipeline
├── cron.js                         # Standalone & cron job manager
├── jobs.js                         # Job registry (ingest, testing)
├── streamTest.js                   # Streaming infrastructure test
├── package.json
│
├── routes/
│   ├── cron.js                     # Scheduler API routes
│   └── cloudflare.js              # Cloudflare API (indexes, buckets, config)
│
├── services/
│   ├── vectorize.js                # Vectorize CRUD & query
│   ├── cloudflare_embeddings.js    # Batch embedding generation
│   ├── r2.js                       # R2 bucket & object management
│   └── wp.js                       # WordPress API client
│
├── utils/
│   ├── helpers.js                  # Shared utilities (retry, chunkArray, sleep)
│   ├── cleaner.js                  # HTML → Markdown cleaning
│   ├── chunker.js                  # Markdown → chunk splitting
│   ├── fileWriter.js               # File output helper
│   └── logger.js                   # Async file logger with rotation
│
├── logs/                           # Runtime logs (auto-created)
└── runtime-config.json             # Persisted runtime config (auto-created, gitignored)
```
