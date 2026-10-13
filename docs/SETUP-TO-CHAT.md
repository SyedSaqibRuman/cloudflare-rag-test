# Full Setup → Ingestion → Chat Walkthrough

A complete, click-by-click flow from a **fresh clone** to **asking questions in the Test AI chat**.
Everything runs locally against Cloudflare (Workers AI, Vectorize, R2) with MySQL as the config/gateway store.
Vector retrieval can also be pointed at an **external provider** — Pinecone, Qdrant, Weaviate, or OpenAI Vector Stores — see **Part 9**.

> Time: ~30–40 minutes (plus one-time Cloudflare/MySQL account setup).

---

## Part 0 — Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 22.5+** | Needed for `node:sqlite` (`DatabaseSync`). Check: `node -v` |
| **MySQL 8.0+** | Local or remote. MariaDB needs the `PARTITION` clause dropped from migration `001_init.sql` |
| **Cloudflare account** | Free tier works. You'll create an API token, a Vectorize index, and an R2 bucket |
| **A WordPress site** (for content) | Any `wp-json` REST API reachable site; or use file/URL sources instead |

```bash
node -v && mysql --version
```

---

## Part 1 — Project setup

```bash
# 1. Install dependencies (root: API server + scheduler; web/: admin portal)
npm install
cd web && npm install && cd ..

# 2. Configure environment
cp .env.example .env
```

Edit `.env`:

```ini
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-mysql-password
MYSQL_DATABASE=ai_gateway
CONFIG_STORE=mysql

# Credential encryption at rest (generate once, keep safe):
#   openssl rand -hex 32
APP_ENCRYPTION_KEY=<64-hex-chars>

# Admin portal login (also enables auth on all admin routes)
# Two backends — Clerk takes priority when CLERK_SECRET_KEY is set:
#   1. Clerk: create users in the Clerk dashboard; the portal login verifies
#      against Clerk's Backend API. Get the key from Dashboard → API keys.
#      Optionally restrict access: CLERK_ALLOWED_EMAILS=a@x.com, b@x.com
#   2. Legacy: ADMIN_USERNAME/ADMIN_PASSWORD (used when Clerk is unset)
# If NEITHER is set, admin auth is disabled (portal stays open — dev only).
CLERK_SECRET_KEY=sk_test_your_key_here
CLERK_ALLOWED_EMAILS=
ADMIN_USERNAME=admin@example.com
ADMIN_PASSWORD=choose-a-strong-password
ADMIN_TOKEN_TTL_HOURS=12

PORT=3000
```

```bash
# 3. Create the database schema (tables, views, procedures, migrations 001+)
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS ai_gateway CHARACTER SET utf8mb4;"
node mysql/migrate.js          # add --dry-run to preview

# 4. Build the admin portal (REQUIRED — the server serves web/dist)
cd web && npm run build && cd ..

# 5. Start the server
node app.js                    # or: npm run dev (nodemon reload)
```

Verify: open **http://localhost:3000** → log in with your `ADMIN_USERNAME`/`ADMIN_PASSWORD`. Health check: `curl localhost:3000/_health` should report `"status":"healthy"` with MySQL `connected`.

---

## Part 2 — Cloudflare one-time setup

### 2a. Create an API token

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token**.
2. Use the **Edit Cloudflare Workers** template, then add permissions:
   - `Account → Workers AI → Edit`
   - `Account → Vectorize → Edit`
   - `Account → Workers R2 Storage → Edit`
3. Copy the token (shown once).

### 2b. Create a Vectorize index

The index dimensions **must match the embedding model** — the default
`@cf/baai/bge-base-en-v1.5` needs **768** dimensions:

```bash
npx wrangler vectorize create my-first-index --dimensions 768 --metric cosine
```

(You can also create the index from the portal later — Cloud Services page.)

### 2c. Create an R2 bucket

```bash
npx wrangler r2 bucket create my-first-bucket
```

---

## Part 3 — Create the company (workspace)

1. Portal → **Companies** page → **+ New Company**.
2. Company key: lowercase letters/digits/hyphens only, e.g. `mycompany` (this becomes the `x-company-name` everywhere).
3. Company name + URL: e.g. `MyCompany`, `https://mycompany.com`.

**Why it matters:** the company owns its own credentials, models, KBs, vector index, and answer cache — all multi-tenant isolation keys off this company key.

---

## Part 4 — Connect the Cloudflare provider (credentials)

1. Portal → **AI Providers** (catalog) → **Cloudflare** → connect/add credential.
2. Paste the **API token** and **Account ID** from Part 2a.
3. Click **Verify** — should come back green (the token is probed live).
4. Stay on the provider detail page and add the two **resources**:
   - **Vector index** → external id `my-first-index` (from 2b)
   - **Object storage bucket** → external id `my-first-bucket` (from 2c)
5. When the connection saves, the app **mirrors the credentials into the RAG config store automatically** (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) — no manual copying needed.

> Optional: connect a **Neo4j** provider + a Graph Database resource if you want GraphRAG-enhanced answers.

---

## Part 5 — Configure the workspace

1. Portal → **Settings** (`#config`), with your company selected in the sidebar.
2. Check:
   - **Models** — defaults are fine (`@cf/baai/bge-base-en-v1.5` embeddings 768d, `@cf/meta/llama-3.1-8b-instruct-fp8` LLM).
   - **Vector index** — should show `my-first-index` (mirrored from the resource; if not, set it here).
   - **R2 bucket** — should show `my-first-bucket`.
   - **URLs** — set Contact/Services/Locations URLs to *your* domain (they appear in canned fallback answers).
3. (Optional) **Ask API Key** card → generate a key. When set, `/ask` calls must send `x-api-key` — you'll need it in the Test AI page.

---

## Part 6 — Create the knowledge base

1. Portal → **Knowledge** (`#ingestion`) → **+ Create KB**.
2. Fill the wizard:
   - **Name/key**: e.g. `my-kb` (key: lowercase-hyphen).
   - **Source type**: `WordPress` (site URL), `URL` (sitemap/crawl list), or `File` (upload PDF/MD/DOCX/HTML).
   - For WordPress: paste the site URL and pick a scope (All / Limit N / Selected pages).
   - **Vector store**: pick `my-first-index` — **dimensions must match the embedding model** (768). Resources from external providers (Pinecone / Qdrant / Weaviate / OpenAI) also appear in this dropdown once configured — see **Part 9**.
   - **Object storage**: pick `my-first-bucket`.
   - **Embedding model**: default `@cf/baai/bge-base-en-v1.5`.
   - **Chunk size**: 512 (chars) is a good default; smaller = more precise retrieval.
   - **GraphRAG**: off unless you configured Neo4j in Part 4.
3. Save. The KB card appears on the Knowledge page.

---

## Part 7 — Run ingestion

1. On the KB card (or the KB detail page → **Ingestion** tab) → **Ingest**.
2. Watch it live:
   - The card shows a progress bar with the phase (`Fetching…` → `Processing…` → graph sub-phase if enabled).
   - **Pause** (⏸) checkpoints at the next document boundary — the job survives server restarts; **Resume** (▶) continues, skipping already-processed documents. **Stop** (⏹) ends the run; completed documents stay ingested.
   - The Scheduler page lists the standalone job if you prefer managing from there.
3. When it finishes the KB badge flips to **Active** and the card shows Documents/Vectors/Chunks counts.

**Under the hood** (what you just triggered):
```
WordPress/files → clean HTML→Markdown → chunk (512 chars) → upload chunk JSON
to R2 (kb/<kbKey>/<type>/<slug>/chunk-N.json) → embed → upsert to Vectorize →
record document in the registry (processed-<company>[-<kb>].json) so re-runs skip it
```

**Sanity checks:**
- KB detail → **Documents** tab: every ingested document is listed with an **eye (preview) button** that reassembles the document from its R2 chunks — this proves storage round-trips.
- KB detail → **Overview** tab: Documents + Vectors counts are non-zero.

---

## Part 8 — Chat with your content (Test AI)

1. Portal → **Test AI** (`#ask`), with your company selected.
2. If you generated an **Ask API Key** in Part 5, paste it into the **API key** field in the page header (stored per-company in localStorage). Without it, a key-gated company returns *"Invalid or missing API key."*
3. (Optional) pick an **assistant persona** from the dropdown — assistants can override the system prompt, model, temperature, and knowledge binding.
4. Ask a question about your ingested content, or click a **starter question**.
5. What you should see:
   - A "Thinking…" indicator, then **token-by-token streaming** with a live **TTFB / token count** badge.
   - The finished answer renders as markdown with a **Sources** list (chunk titles + scores) and **Suggested questions** to continue the conversation.
   - Follow-ups understand context: ask *"How long does it take?"* after an ISO-9001 question and the rewriter resolves "it".
6. **Reset** (header) clears the chat and purges the company's server-side answer cache; **Clear** only empties the view.

Equivalent raw API call:

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -H "x-company-name: mycompany" \
  -H "x-api-key: <your ask key if set>" \
  -d '{"question":"What services do you offer?"}'
```

Streaming (`/ask-stream`) speaks SSE: `data: {"token":"..."}` frames, a sources start frame, and `data: [DONE]`.

---

## Part 9 — Optional: bind a non-Cloudflare vector provider

By default vectors live in **Cloudflare Vectorize**. The KB wizard can instead bind an
**external vector provider** — ingestion, `/ask`, and the Test AI chat all route through the
provider's adapter unchanged. Four providers are supported:

| Provider | What you need from their console |
|---|---|
| **Pinecone** | API key (`pc-…` user key or `pcsk_…` serverless key) + an index's data-plane host |
| **Qdrant** | Cluster URL (e.g. `https://xyz.cloud.qdrant.io:6333`) + API key (required on Qdrant Cloud) |
| **Weaviate** | Cluster URL (e.g. `https://xyz.weaviate.cloud`) + API key (required on Weaviate Cloud) |
| **OpenAI** | API key (`sk-…`) + a Vector Store id (`vs_…`) |

### 9a. Connect the provider (credential)

1. Portal → **AI Providers** → pick the provider → **Connect**.
2. Fill the credential form (labels come from the provider's auth schema):

| Provider | Fields |
|---|---|
| Pinecone | **Pinecone API Key** (required) · **Data-Plane Host** (paste the index endpoint from the Pinecone console — `https://` optional, it's normalized) · **Environment** (legacy pod indexes only) · **Namespace** (optional, under *Advanced*) |
| Qdrant | **Qdrant Host** (full cluster URL) · **Qdrant API Key** |
| Weaviate | **Weaviate Host** (full cluster URL) · **Weaviate API Key** |
| OpenAI | **API Key** (`sk-…`) — the same credential used for OpenAI embeddings/LLMs |

3. Click **Verify** — the provider is probed live (Pinecone control plane, Qdrant/Weaviate
   cluster endpoint, OpenAI `GET /v1/models`).

### 9b. Register the vector resource

Stay on the provider detail page → add a **vector index** resource:

| Provider | Resource | Config fields |
|---|---|---|
| Pinecone | **Pinecone Index** | `index_name` (create the index in Pinecone's console first — the app registers it, it doesn't create it) · `dimension` (**must equal the embedding model's** — 768 for `bge-base-en-v1.5`; the template default is 1536, override it) · `metric` · `cloud` / `region` |
| Qdrant | **Qdrant Collection** | `collection_name` · `distance` (`Cosine` default / `Euclid` / `Dot`) — the collection is created automatically on first ingest if missing |
| Weaviate | **Weaviate Class** | `class_name` · `vectorizer` (fixed to `none` — the app supplies its own vectors); the class is auto-created on first ingest |
| OpenAI | **Vector Store** | `vector_store_id` (`vs_…`, created via the OpenAI dashboard or `POST /v1/vector_stores`) · `max_num_results` (default 10) |

> **OpenAI is text-based.** Its Vector Stores embed and rank internally — chunk text uploads
> as files and the question is sent as text, so the KB's embedding model isn't exercised on
> this path. The other three are classic vector indexes: keep the resource `dimension` aligned
> with the embedding model or upserts fail with *Invalid embedding detected*.

### 9c. Bind it in the KB + ingest

1. Create the KB exactly as in **Part 6** — the **Vector store** dropdown lists vector-index
   resources from **every** provider (the label shows the provider name).
2. Keep an **R2 object storage** resource bound as well — chunk JSONs are always stored in R2
   (`kb/<kbKey>/…`) no matter where the vectors live, and previews/sources read from there.
3. **Ingest** as in Part 7. Under the hood the pipeline swaps the Vectorize upsert step for the
   provider adapter (`ensureIndex → upsert`), deriving provider-specific ids (Qdrant unsigned
   int, Weaviate UUID, Pinecone ≤ 40 chars) from the pipeline id — so re-ingestion **overwrites**
   the same points/objects instead of duplicating them.

### 9d. Chat

Nothing changes for the ask flow: `/ask`, `/ask-stream`, and **Test AI** detect the KB's bound
vector provider at ask time and retrieve through its adapter — no assistant persona required.
Server-log marker that it's working: `🔎 KB-driven retrieval: '<kbKey>' → <provider>`.
The company's Settings → Vector index field remains the fallback for the legacy Cloudflare path;
the KB's binding wins.

---

## Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| `Invalid or missing API key.` on ask | Company has an Ask API Key set — paste it in the Test AI header (or delete the key on the Settings page) |
| `Model access denied: No access grant found…` | The assistant's credential has no `credential_model_access` row for its model — AI Providers → credential → grant the model |
| Upserts fail with *Invalid embedding detected* | Vector index dimensions ≠ embedding model dimensions — recreate the index (768 for bge-base), or fix the resource `dimension` for external providers (Part 9) |
| `Pinecone host is not configured` on ingest | The bound Pinecone resource has no **Data-Plane Host** — edit the resource on the provider detail page and save |
| Ask 404s with `index not found` while a non-CF KB is bound | A request path hit Cloudflare Vectorize instead of the bound provider — check for a `🔎 KB-driven retrieval` log line right before the error; if it's missing, update to the latest code (all ask paths + suggestions route via the KB binding) |
| Answers mention the wrong company's URLs | Company config still has default `CONTACT_US_URL`/`SERVICES_URL`/`LOCATIONS_URL` — fix on the Settings page |
| Login asks forever / 401 on admin routes | No login backend configured — set `CLERK_SECRET_KEY` (Clerk users) or `ADMIN_USERNAME`+`ADMIN_PASSWORD` (legacy) in `.env` |
| Login returns 503 with a Clerk message | Clerk's API is unreachable or the `CLERK_SECRET_KEY` is invalid — check dashboard → API keys; deliberate: no silent fallback while Clerk is configured |
| Portal loads but API calls fail with 503 | MySQL env vars missing/wrong — check `MYSQL_*` in `.env`, run `node mysql/migrate.js` |
| Ingestion crawls with GraphRAG on | Graph extraction is LLM-per-chunk — lower the KB's graph settings (e.g. 3 chunks/3 parallel) or turn GraphRAG off |
| `web/dist` missing at boot | The dashboard won't serve — run `cd web && npm run build` before starting the server |
