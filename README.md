# PopularCert RAG API

A Retrieval-Augmented Generation (RAG) API powered by Cloudflare AI, Vectorize, and R2. Provides intelligent question-answering for PopularCert's certification services using semantic vector search, hybrid ranking, and LLM response generation.

---
freebuff --continue 2026-08-12T05-16-47.513Z
## Quick Start

```bash
npm install

# Build the admin portal UI (served by the API server)
cd web
npm install
npm run build
cd ..

# Start the server (serves both the API and the admin UI)
cp .env.example .env
node app.js
```

The server starts on `http://localhost:3000` by default. Browsers get the admin dashboard; API clients get JSON.

For UI development with hot reload, run `cd web && npm run dev` and the Vite dev server (port 5173) proxies API requests to the backend.

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
| [Providers](docs/providers.md) | Adding & editing AI gateway providers (Catalog wizard) |
| [Credentials](docs/credentials.md) | Provider connection, encrypted storage, auto-verify, rotation |

---

## Author

Syed Saqib Ruman

## License

MIT
