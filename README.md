# PopularCert RAG API

A Retrieval-Augmented Generation (RAG) API powered by Cloudflare AI, Vectorize, and R2. Provides intelligent question-answering for PopularCert's certification services using semantic vector search, hybrid ranking, and LLM response generation.

---

## Quick Start

```bash
npm install
cp .env.example .env
node app.js
```

The server starts on `http://localhost:3000` by default.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, environment variables, tech stack, project structure |
| [Architecture](docs/architecture.md) | System overview, RAG pipeline, CORS, rate limiting, logging |
| [API: Ask](docs/api/ask.md) | Health check, `POST /ask` (JSON response) |
| [API: Streaming](docs/api/streaming.md) | `POST /ask-stream` (SSE), `POST /test` |
| [API: Scheduler](docs/api/scheduler.md) | Background job management (`/scheduler/*`) |
| [API: Cloudflare](docs/api/cloudflare.md) | Vector indexes, R2 buckets (`/cloudflare/*`) |
| [API: Config](docs/api/config.md) | Runtime config, model configuration (`/cloudflare/config`) |
| [Models](docs/models.md) | Available AI models and how to switch them |

---

## Author

Syed Saqib Ruman

## License

MIT
