# AI API Reference

A machine-readable API reference for the PopularCert RAG API. This document is designed for AI agents, LLMs, and automated systems to understand and interact with the API.

---

## Table of Contents

- [Base URL](#base-url)
- [Multi-Company Architecture](#multi-company-architecture)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Handling](#error-handling)
- [Endpoints](#endpoints)
  - [Health Check](#health-check)
  - [Ask Question (JSON)](#ask-question-json)
  - [Ask Question (Streaming)](#ask-question-streaming)
  - [Test Streaming](#test-streaming)
  - [Scheduler - Job Control](#scheduler---job-control)
  - [Scheduler - Cron Control](#scheduler---cron-control)
  - [Scheduler - List Jobs](#scheduler---list-jobs)
  - [Scheduler - Status](#scheduler---status)
  - [Cloudflare - Company Management](#cloudflare---company-management)
  - [Cloudflare - Vector Indexes](#cloudflare---vector-indexes)
  - [Cloudflare - R2 Buckets](#cloudflare---r2-buckets)
  - [Cloudflare - Config](#cloudflare---config)
  - [Cloudflare - System Prompt](#cloudflare---system-prompt)
  - [Gateway - Provider Catalog](#gateway---provider-catalog)
  - [Gateway - Knowledge Bases](#gateway---knowledge-bases)

---

## Base URL

```
http://localhost:3000
```

## Multi-Company Architecture

The API is multi-tenant. Each request must specify which company to use via the **`x-company-name`** header. This determines:

- Which **Vectorize index** to search
- Which **R2 bucket** to fetch chunks from
- Which **system prompt**, models, URLs, and brand settings to use
- Which **WordPress site** to ingest from

Companies are managed via the `/cloudflare/companies` endpoints. Each company has its own isolated config (models, resources, prompt, URLs).

```
x-company-name: popularcert
```

## Authentication

Cloudflare endpoints (`/cloudflare/*`) require an API key in the header if `ADMIN_API_KEY` environment variable is set:

```
x-api-key: YOUR_ADMIN_API_KEY
```

If `ADMIN_API_KEY` is not set, Cloudflare routes are unprotected (development mode).

## Rate Limiting

| Tier | Routes | Default Limit |
|------|--------|---------------|
| Global | All routes except `GET /` | 100 req/min |
| AI | `POST /ask`, `POST /ask-stream` | 20 req/min |
| Login | `POST /auth/login` (brute-force guard) | 10 req/min |

Limits are hardcoded constants in `app.js` / `routes/ask.js` / `routes/auth.js` — there are **no** `RATE_LIMIT_*` env vars.

Admin routes (`/cloudflare/*`, `/gateway/*`, `/logs`, `/api-docs`) are **not** rate-limited — authenticated admin sessions also bypass the global baseline, so heavy portal/catalog work never trips a 429.

Rate-limited responses include standard `RateLimit-*` headers and return HTTP 429 with error message.

## Error Handling

All endpoints follow consistent error response format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

---

## Endpoints

### Health Check

**Endpoint:** `GET /`

**Description:** Returns server status and uptime.

**Rate Limit:** None

**Request:**
```http
GET / HTTP/1.1
```

**Response (200):**
```json
{
  "success": true,
  "status": "ok",
  "message": "PopularCert RAG API is active",
  "uptime": 123.456,
  "timestamp": 1717900000000
}
```

---

### Ask Question (JSON)

**Endpoint:** `POST /ask`

**Description:** Sends a question and receives a complete answer with source references.

**Rate Limit:** AI tier (20 req/min)

**Required Header:** `x-company-name`

**Request:**
```http
POST /ask HTTP/1.1
Content-Type: application/json
x-company-name: popularcert

{
  "question": "What is ISO 9001 certification?",
  "history": []
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | The user's question |
| `history` | array | No | Conversation history, array of `{role, content}` objects |

**Response (200):**
```json
{
  "success": true,
  "answer": "ISO 9001 is an internationally recognized quality management standard...",
  "sources": [
    { "title": "ISO 9001 Certification", "score": 0.92 }
  ]
}
```

**Response (cached):**
```json
{
  "success": true,
  "answer": "...",
  "sources": [...],
  "cached": true
}
```

**Error Responses:**
- 400: Empty question, invalid history, or missing `x-company-name` header
- 500: Internal server error

---

### Ask Question (Streaming)

**Endpoint:** `POST /ask-stream`

**Description:** Sends a question and receives a streaming response via Server-Sent Events (SSE).

**Rate Limit:** AI tier (20 req/min)

**Required Header:** `x-company-name`

**Request:**
```http
POST /ask-stream HTTP/1.1
Content-Type: application/json
x-company-name: popularcert

{
  "question": "What is ISO 9001 certification?",
  "history": []
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | The user's question |
| `history` | array | No | Conversation history |

**Response:** `text/event-stream`

```
data: {"token":"__START_RESPONSE__"}

data: {"sources":[{"title":"ISO 9001 in Angola","score":0.86},{"title":"ISO Certification in Seoul","score":0.85}]}

data: {"token":"ISO"}

data: {"token":" 9001"}

data: {"token":" is"}

data: {"token":" an"}

data: [DONE]
```

**Event Types:**
| Event | Format | Description |
|-------|--------|-------------|
| Start sentinel | `data: {"token":"__START_RESPONSE__"}` | Sent before the first real token; clears the client's "Thinking..." state |
| Sources | `data: {"sources":[{title, score}]}` | Retrieval sources for RAG answers (same shape as the non-streaming `/ask` response); emitted before tokens |
| Token | `data: {"token":"..."}` | Each streamed token |
| Done | `data: [DONE]` | Stream completed successfully |
| Error | `data: {"error":"..."}` | Error occurred |

**Client Example (JavaScript):**
```javascript
const response = await fetch('/ask-stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-company-name': 'popularcert'
  },
  body: JSON.stringify({ question: 'What is ISO 9001?' })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') break;
      const { token } = JSON.parse(data);
      process.stdout.write(token);
    }
  }
}
```

**Abort Handling:**
- Closing the SSE connection automatically aborts the request
- 30-second timeout on the LLM streaming call

---

### Test Streaming

**Endpoint:** `POST /test`

**Description:** Tests the streaming infrastructure by capturing stdout chunks.

**Request:**
```http
POST /test HTTP/1.1
Content-Type: application/json

{
  "prompt": "Hello"
}
```

**Response:** `text/event-stream` (stdout capture format)

---

### Scheduler - Job Control

#### Start Standalone Job

**Endpoint:** `POST /cloudflare/job/start`

**Description:** Starts a job immediately. Multiple concurrent jobs allowed (up to 5).

**Request:**
```http
POST /cloudflare/job/start HTTP/1.1
Content-Type: application/json

{
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | string | Yes | Job to run (`ingest` or `testing`) |
| `companyName` | string | No | Company to run the job for (isolates resources) |

**Response (200):**
```json
{
  "success": true,
  "message": "Job 'Ingest Job [company: popularcert]' started.",
  "jobId": "ingest",
  "startedAt": "2024-06-08T12:00:00.000Z",
  "companyName": "popularcert"
}
```

#### Stop Standalone Job

**Endpoint:** `POST /cloudflare/job/stop`

**Description:** Stops a specific running job, or the first running job if no params given.

**Request:**
```http
POST /cloudflare/job/stop HTTP/1.1
Content-Type: application/json

{
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | string | No | Job to stop (stops first running job if omitted) |
| `companyName` | string | No | Company scope |

**Response (200):**
```json
{
  "success": true,
  "message": "Job 'Ingest Job [company: popularcert]' stopped.",
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

---

### Scheduler - Cron Control

#### Start Cron

**Endpoint:** `POST /cloudflare/cron/start`

**Description:** Schedules a job with a cron expression. Multiple concurrent cron schedules allowed.

**Request:**
```http
POST /cloudflare/cron/start HTTP/1.1
Content-Type: application/json

{
  "jobId": "ingest",
  "schedule": "0 2 * * *",
  "companyName": "popularcert"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | string | Yes | Job to schedule (`ingest` or `testing`) |
| `schedule` | string | Yes | Cron expression (e.g., `0 2 * * *` for daily at 2 AM) |
| `companyName` | string | No | Company to run the job for |

**Response (200):**
```json
{
  "success": true,
  "message": "Cron scheduled for 'Ingest Job [company: popularcert]'.",
  "jobId": "ingest",
  "schedule": "0 2 * * *",
  "companyName": "popularcert"
}
```

#### Stop Cron

**Endpoint:** `POST /cloudflare/cron/stop`

**Description:** Stops a specific scheduled cron, or the first scheduled one if no params given.

**Request:**
```http
POST /cloudflare/cron/stop HTTP/1.1
Content-Type: application/json

{
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Cron stopped for 'Ingest Job [company: popularcert]'.",
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

---

### Scheduler - List Jobs

**Endpoint:** `GET /cloudflare/jobs`

**Description:** Returns all registered jobs.

**Request:**
```http
GET /cloudflare/jobs HTTP/1.1
```

**Response (200):**
```json
{
  "success": true,
  "jobs": [
    { "id": "testing", "name": "Testing Job", "description": "Runs test workflow" },
    { "id": "ingest", "name": "Ingest Job", "description": "Runs ingest workflow" }
  ]
}
```

---

### Scheduler - Status

**Endpoint:** `GET /cloudflare/status`

**Description:** Returns all active jobs (standalone + cron). If nothing is active, returns a summary of available jobs.

**Request:**
```http
GET /cloudflare/status HTTP/1.1
```

**Response (active):**
```json
{
  "success": true,
  "mode": "active",
  "standalone": [
    {
      "key": "ingest:popularcert",
      "jobId": "ingest",
      "companyName": "popularcert",
      "status": "running",
      "startedAt": "2024-06-08T12:00:00.000Z",
      "completedAt": null,
      "duration": null,
      "error": null
    }
  ],
  "cron": [
    {
      "key": "ingest:maxicert",
      "jobId": "ingest",
      "companyName": "maxicert",
      "status": "scheduled",
      "schedule": "0 2 * * *",
      "startedAt": "2024-06-01T00:00:00.000Z",
      "lastRun": "2024-06-08T02:00:00.000Z",
      "lastError": null,
      "runCount": 7,
      "lastDuration": "320000ms",
      "avgDuration": "325000ms"
    }
  ]
}
```

**Response (idle):**
```json
{
  "success": true,
  "mode": "idle",
  "standalone": [],
  "cron": [],
  "jobs": [
    { "id": "ingest", "name": "Ingest Job" },
    { "id": "testing", "name": "Testing Job" }
  ]
}
```

---

### Cloudflare - Company Management

#### List Companies

**Endpoint:** `GET /cloudflare/companies`

**Description:** Returns all configured companies with a summary of their config.

**Auth Required:** Yes

**Request:**
```http
GET /cloudflare/companies HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "companies": [
    {
      "name": "popularcert",
      "COMPANY_NAME": "Popularcert",
      "CONSULTANT_NAME": "Sarah",
      "BASE_URL": "https://popularcert.com",
      "VECTOR_INDEX": "popularcert-vectors",
      "R2_BUCKET_NAME": "popularcert-r2",
      "hasCredentials": true,
      "hasCloudflareApi": true
    }
  ]
}
```

#### Create Company

**Endpoint:** `POST /cloudflare/companies`

**Description:** Creates a new company with isolated config. All optional fields fall back to defaults.

**Auth Required:** Yes

**Request:**
```http
POST /cloudflare/companies HTTP/1.1
Content-Type: application/json
x-api-key: YOUR_ADMIN_API_KEY

{
  "name": "another-co",
  "config": {
    "BASE_URL": "https://anotherco.com",
    "LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8",
    "VECTOR_INDEX": "anotherco-vectors",
    "R2_BUCKET_NAME": "anotherco-r2"
  }
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Company identifier (lowercase, alphanumeric + hyphens, 2–63 chars) |
| `config` | object | No | Config overrides (models, URLs, resources, prompt) |

**Response (201):**
```json
{
  "success": true,
  "message": "Company 'another-co' created.",
  "config": {
    "COMPANY_NAME": "another-co",
    "CONSULTANT_NAME": "Sarah",
    "BASE_URL": "https://anotherco.com",
    "EMBEDDING_MODEL": "@cf/baai/bge-base-en-v1.5",
    "EMBEDDING_DIMENSIONS": 768,
    "LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8",
    "SMALL_LLM": "@cf/meta/llama-3.2-3b-instruct",
    "RERANKING_MODEL": "@cf/baai/bge-reranker-base",
    "VECTOR_INDEX": "anotherco-vectors",
    "R2_BUCKET_NAME": "anotherco-r2",
    "SYSTEM_PROMPT": "..."
  }
}
```

#### Get Company

**Endpoint:** `GET /cloudflare/companies/:name`

**Description:** Returns a single company's full config.

**Auth Required:** Yes

**Request:**
```http
GET /cloudflare/companies/popularcert HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "config": {
    "COMPANY_NAME": "Popularcert",
    "CONSULTANT_NAME": "Sarah",
    "BASE_URL": "https://popularcert.com",
    "LLM_MODEL": "@cf/meta/llama-3.1-8b-instruct-fp8",
    "VECTOR_INDEX": "popularcert-vectors",
    "R2_BUCKET_NAME": "popularcert-r2",
    "SYSTEM_PROMPT": "..."
  }
}
```

#### Update Company

**Endpoint:** `PUT /cloudflare/companies/:name`

**Description:** Updates a company's config. Only provided keys are changed.

**Auth Required:** Yes

**Request:**
```http
PUT /cloudflare/companies/popularcert HTTP/1.1
Content-Type: application/json
x-api-key: YOUR_ADMIN_API_KEY

{
  "LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8",
  "CONSULTANT_NAME": "Alex"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Company 'popularcert' updated.",
  "config": {
    "COMPANY_NAME": "Popularcert",
    "CONSULTANT_NAME": "Alex",
    "LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8",
    ...
  }
}
```

#### Delete Company

**Endpoint:** `DELETE /cloudflare/companies/:name`

**Description:** Deletes a company and its config.

**Auth Required:** Yes

**Request:**
```http
DELETE /cloudflare/companies/another-co HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "message": "Company 'another-co' deleted."
}
```

#### Reset Company

**Endpoint:** `POST /cloudflare/companies/:name/reset`

**Description:** Resets a company's config to environment defaults.

**Auth Required:** Yes

**Request:**
```http
POST /cloudflare/companies/popularcert/reset HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "message": "Company 'popularcert' reset to defaults.",
  "config": {
    "COMPANY_NAME": "popularcert",
    "CONSULTANT_NAME": "Sarah",
    ...
  }
}
```

---

### Cloudflare - Vector Indexes

#### List Vector Indexes

**Endpoint:** `GET /cloudflare/indexes`

**Description:** Returns all Vectorize indexes in the account.

**Auth Required:** Yes (x-api-key header)

**Request:**
```http
GET /cloudflare/indexes HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "indexes": [
    {
      "name": "popularcert-vectors",
      "config": { "dimensions": 768, "metric": "cosine" },
      "createdOn": "2024-01-01T00:00:00Z",
      "modifiedOn": "2024-06-08T00:00:00Z"
    }
  ]
}
```

#### Create Vector Index

**Endpoint:** `POST /cloudflare/indexes`

**Description:** Creates a new Vectorize index.

**Auth Required:** Yes

**Request:**
```http
POST /cloudflare/indexes HTTP/1.1
Content-Type: application/json
x-api-key: YOUR_ADMIN_API_KEY

{
  "name": "my-new-index",
  "dimensions": 768
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | — | Index name |
| `dimensions` | number | No | 768 | Vector dimensions |

**Response (201 — created):**
```json
{
  "success": true,
  "index": { "name": "my-new-index", "config": { "dimensions": 768, "metric": "cosine" } }
}
```

**Response (200 — already exists):**
```json
{
  "success": true,
  "index": { "name": "my-new-index", "..." : "..." },
  "message": "Index already exists."
}
```

#### Delete Vector Index

**Endpoint:** `DELETE /cloudflare/indexes/:name`

**Description:** Deletes a Vectorize index by name.

**Auth Required:** Yes

**Request:**
```http
DELETE /cloudflare/indexes/my-new-index HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "message": "my-new-index deleted"
}
```

**Response (404):**
```json
{
  "success": false,
  "error": "Index 'my-new-index' not found."
}
```

---

### Cloudflare - R2 Buckets

#### List R2 Buckets

**Endpoint:** `GET /cloudflare/buckets`

**Description:** Returns all R2 buckets in the account.

**Auth Required:** Yes

**Request:**
```http
GET /cloudflare/buckets HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "buckets": [
    { "name": "popularcert-rag", "created": "2024-01-01T00:00:00Z" }
  ]
}
```

#### Create R2 Bucket

**Endpoint:** `POST /cloudflare/buckets`

**Description:** Creates a new R2 bucket.

**Auth Required:** Yes

**Request:**
```http
POST /cloudflare/buckets HTTP/1.1
Content-Type: application/json
x-api-key: YOUR_ADMIN_API_KEY

{
  "name": "my-new-bucket"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Bucket name |

**Response (201):**
```json
{
  "success": true,
  "bucket": { "name": "my-new-bucket" }
}
```

#### Delete R2 Bucket

**Endpoint:** `DELETE /cloudflare/buckets/:name`

**Description:** Clears all objects and deletes an R2 bucket.

**Auth Required:** Yes

**Request:**
```http
DELETE /cloudflare/buckets/my-new-bucket HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "message": "Bucket 'my-new-bucket' deleted."
}
```

**Response (404):**
```json
{
  "success": false,
  "error": "Bucket 'my-new-bucket' not found or could not be deleted."
}
```

#### Clear R2 Bucket

**Endpoint:** `POST /cloudflare/buckets/:name/clear`

**Description:** Clears all objects from an R2 bucket without deleting it.

**Auth Required:** Yes

**Request:**
```http
POST /cloudflare/buckets/my-new-bucket/clear HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "message": "Bucket 'my-new-bucket' cleared."
}
```

---

### Cloudflare - Config

#### Get Current Config

**Endpoint:** `GET /cloudflare/config`

**Description:** Returns the current runtime configuration for the specified company.

**Auth Required:** Yes

**Required Header:** `x-company-name`

**Request:**
```http
GET /cloudflare/config HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
x-company-name: popularcert
```

**Response (200):**
```json
{
  "success": true,
  "config": {
    "GENERAL": {
      "BASE_URL": "https://popularcert.com",
      "CONTACT_US_URL": "https://popularcert.com/contact-us/",
      "LOCATIONS_URL": "https://popularcert.com/locations/",
      "SERVICES_URL": "https://popularcert.com/services/",
      "CONSULTANT_NAME": "Sarah",
      "COMPANY_NAME": "Popularcert"
    },
    "MODELS": {
      "EMBEDDING_MODEL": "@cf/baai/bge-base-en-v1.5",
      "EMBEDDING_DIMENSIONS": 768,
      "LLM_MODEL": "@cf/meta/llama-3.1-8b-instruct-fp8",
      "SMALL_LLM": "@cf/meta/llama-3.2-3b-instruct",
      "RERANKING_MODEL": "@cf/baai/bge-reranker-base"
    },
    "STORAGE": {
      "VECTOR_INDEX": "my-vector-index",
      "R2_BUCKET_NAME": "my-r2-bucket"
    }
  }
}
```

#### Update Config

**Endpoint:** `PUT /cloudflare/config`

**Description:** Update any supported configuration key for a company. Supports three request formats.

**Auth Required:** Yes

**Required Header:** `x-company-name`

**Format 1 — Update WordPress URL:**
```http
PUT /cloudflare/config HTTP/1.1
Content-Type: application/json
x-api-key: YOUR_ADMIN_API_KEY
x-company-name: popularcert

{
  "baseUrl": "https://new-site.com"
}
```

**Format 2 — Update multiple models:**
```http
PUT /cloudflare/config HTTP/1.1
Content-Type: application/json
x-api-key: YOUR_ADMIN_API_KEY
x-company-name: popularcert

{
  "models": {
    "LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8",
    "EMBEDDING_MODEL": "@cf/baai/bge-large-en-v1.5"
  }
}
```

**Format 3 — Update single key:**
```http
PUT /cloudflare/config HTTP/1.1
Content-Type: application/json
x-api-key: YOUR_ADMIN_API_KEY
x-company-name: popularcert

{
  "key": "LLM_MODEL",
  "value": "@cf/meta/llama-3.2-3b-instruct"
}
```

**Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `baseUrl` | string | WordPress domain URL (must include protocol) |
| `models` | object | One or more model keys to update |
| `key` | string | A single config key to update (models or resources) |
| `value` | string | The value for the single key |

Resource keys (`VECTOR_INDEX`, `R2_BUCKET_NAME`) and brand keys (`CONSULTANT_NAME`, `COMPANY_NAME`, `CONTACT_US_URL`, `LOCATIONS_URL`, `SERVICES_URL`) can be updated using the `key`/`value` format.

**Response (200):**
```json
{
  "success": true,
  "message": "Config updated.",
  "config": {
    "BASE_URL": "https://new-site.com",
    "LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8",
    "CONSULTANT_NAME": "Alex"
  }
}
```

**Response (400 — validation error):**
```json
{
  "success": false,
  "errors": ["LLM_MODEL 'invalid-model' is not in the allowed list: ..."]
}
```

#### Reset Config

**Endpoint:** `POST /cloudflare/config/reset`

**Description:** Resets all runtime config to environment defaults and deletes the persisted `runtime-config.json` file.

**Auth Required:** Yes

**Request:**
```http
POST /cloudflare/config/reset HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
```

**Response (200):**
```json
{
  "success": true,
  "message": "Config reset to env defaults.",
  "config": {
    "BASE_URL": "https://popularcert.com",
    "CONTACT_US_URL": "https://popularcert.com/contact-us/",
    "LOCATIONS_URL": "https://popularcert.com/locations/",
    "SERVICES_URL": "https://popularcert.com/services/",
    "COMPANY_NAME": "Popularcert",
    "CONSULTANT_NAME": "Sarah",
    "EMBEDDING_MODEL": "@cf/baai/bge-base-en-v1.5",
    "EMBEDDING_DIMENSIONS": 768,
    "LLM_MODEL": "@cf/meta/llama-3.1-8b-instruct-fp8",
    "SMALL_LLM": "@cf/meta/llama-3.2-3b-instruct",
    "RERANKING_MODEL": "@cf/baai/bge-reranker-base",
    "VECTOR_INDEX": "my-vector-index",
    "R2_BUCKET_NAME": "my-r2-bucket"
  }
}
```

---

## Model Configuration

AI models can be changed at runtime without restarting the server.

### Supported Model Keys

| Key | Purpose | Default | Allowed Values |
|-----|---------|---------|----------------|
| `EMBEDDING_MODEL` | Text embedding | `@cf/baai/bge-base-en-v1.5` | `@cf/baai/bge-base-en-v1.5`, `@cf/baai/bge-large-en-v1.5`, `@cf/baai/bge-small-en-v1.5`, `@cf/baai/bge-m3`, `@cf/llmware/bge-small-en-v1.5` |
| `EMBEDDING_DIMENSIONS` | Vector dimensions | `768` | Positive integer (auto-set when EMBEDDING_MODEL changes) |
| `LLM_MODEL` | Primary LLM | `@cf/meta/llama-3.1-8b-instruct-fp8` | `@cf/meta/llama-3.1-8b-instruct-fp8`, `@cf/meta/llama-3.3-70b-instruct-fp8`, `@cf/meta/llama-3.2-3b-instruct`, `@cf/meta/llama-3.1-70b-instruct`, `@cf/meta/llama-3.1-8b-instruct`, `@cf/meta/llama-4-scout-17b-16e-instruct` |
| `SMALL_LLM` | Query rewriting | `@cf/meta/llama-3.2-3b-instruct` | `@cf/meta/llama-3.2-3b-instruct`, `@cf/meta/llama-3.1-8b-instruct-fp8`, `@cf/meta/llama-3.2-1b-instruct` |
| `RERANKING_MODEL` | Cross-encoder reranking | `@cf/baai/bge-reranker-base` | `@cf/baai/bge-reranker-base`, `@cf/baai/bge-reranker-large` |

### Behavior

- Model values are validated against an allowlist before being applied
- When `EMBEDDING_MODEL` changes, `EMBEDDING_DIMENSIONS` is automatically updated
- Changes are persisted to `runtime-config.json` and survive server restarts
- Use `POST /cloudflare/config/reset` to revert to environment defaults

**Warning:** Changing the embedding model requires re-indexing existing vectors if dimensions change.

---

## Resource Configuration

Cloudflare resources (vector indexes, R2 buckets) can be switched at runtime without restarting the server.

### Supported Resource Keys

| Key | Purpose | Default | Validation |
|-----|---------|---------|------------|
| `VECTOR_INDEX` | Vectorize index for semantic search | From `VECTOR_INDEX` env var | Lowercase letters, numbers, hyphens; 3–63 chars |
| `R2_BUCKET_NAME` | R2 bucket storing chunk data | From `R2_BUCKET_NAME` env var | Lowercase letters, numbers, hyphens; 3–63 chars |

### Behavior

- Resource names are validated against Cloudflare naming rules before being applied
- Changes take effect immediately for all subsequent `ask`/`ask-stream` requests
- Falls back to environment variables if not set in runtime config
- Changes are persisted to `runtime-config.json` and survive server restarts
- Use `POST /cloudflare/config/reset` to revert to environment defaults

### Example: Switch Vector Index

```bash
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-company-name: popularcert" \
  -d '{"key": "VECTOR_INDEX", "value": "production-index"}'
```

### Example: Switch R2 Bucket

```bash
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-company-name: popularcert" \
  -d '{"key": "R2_BUCKET_NAME", "value": "production-bucket"}'
```

### Discover Available Resources

```bash
# List vector indexes
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3000/cloudflare/indexes

# List R2 buckets
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3000/cloudflare/buckets
```

> **Warning:** Ensure the selected vector index and R2 bucket contain matching data. Switching to mismatched resources will produce incorrect results.

---

### Cloudflare - System Prompt

#### Get Current Prompt

**Endpoint:** `GET /cloudflare/prompt`

**Description:** Returns the system prompt template, resolved preview, and available variables.

**Auth Required:** Yes

**Required Header:** `x-company-name`

**Request:**
```http
GET /cloudflare/prompt HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
x-company-name: popularcert
```

**Response (200):**
```json
{
  "success": true,
  "prompt": {
    "template": "You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}...",
    "resolved": "You are Sarah, an AI assistant for Popularcert...",
    "variables": {
      "CONSULTANT_NAME": "Sarah",
      "COMPANY_NAME": "Popularcert",
      "CONTACT_US_URL": "https://popularcert.com/contact-us/",
      "LOCATIONS_URL": "https://popularcert.com/locations/",
      "SERVICES_URL": "https://popularcert.com/services/",
      "BASE_URL": "https://popularcert.com"
    }
  }
}
```

#### Update Prompt

**Endpoint:** `PUT /cloudflare/prompt`

**Description:** Updates the system prompt template with `{{VARIABLE}}` placeholders resolved at runtime.

**Auth Required:** Yes

**Required Header:** `x-company-name`

**Request:**
```http
PUT /cloudflare/prompt HTTP/1.1
Content-Type: application/json
x-api-key: YOUR_ADMIN_API_KEY
x-company-name: popularcert

{
  "template": "You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}. Be professional."
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `template` | string | Yes | System prompt template with `{{VARIABLE}}` placeholders |

**Supported Variables:**

| Variable | Resolves To |
|----------|-------------|
| `{{CONSULTANT_NAME}}` | Assistant name from config |
| `{{COMPANY_NAME}}` | Company name from config |
| `{{CONTACT_US_URL}}` | Contact page URL |
| `{{LOCATIONS_URL}}` | Locations page URL |
| `{{SERVICES_URL}}` | Services page URL |
| `{{BASE_URL}}` | Base URL |

**Response (200):**
```json
{
  "success": true,
  "message": "System prompt updated.",
  "prompt": {
    "template": "You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}...",
    "resolved": "You are Sarah, an AI assistant for Popularcert..."
  }
}
```

**Behavior:**
- Variables are resolved at request time, so changing a config value (e.g., consultant name) automatically updates the prompt
- Stored in `runtime-config.json` as `SYSTEM_PROMPT`
- Reset to default with `POST /cloudflare/prompt/reset`

#### Reset Prompt

**Endpoint:** `POST /cloudflare/prompt/reset`

**Description:** Resets the system prompt to the default template. Does not affect other config settings.

**Auth Required:** Yes

**Required Header:** `x-company-name`

**Request:**
```http
POST /cloudflare/prompt/reset HTTP/1.1
x-api-key: YOUR_ADMIN_API_KEY
x-company-name: popularcert
```

**Response (200):**
```json
{
  "success": true,
  "message": "System prompt reset to default.",
  "prompt": {
    "template": "You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}...",
    "resolved": "You are Sarah, an AI assistant for Popularcert..."
  }
}
```

---

## Gateway - Provider Catalog

The MySQL-backed gateway layer (`/gateway/*`) is a multi-tenant catalog of AI providers, endpoints, and pricing. It powers the admin portal's Catalog page. Every gateway route sits behind `requireAdmin` (same auth as `/cloudflare/*`) and returns **503** when the `MYSQL_*` env vars are unset. Admin routes carry no rate limiter.

> For UI walkthroughs, see [docs/providers.md](providers.md) (9Router-style Providers page: status cards, Test All, custom compatible providers) and [docs/credentials.md](credentials.md) (per-company provider connection, encrypted storage, auto-verify, rotation).

**Auth:** `Authorization: Bearer <token>` (or `x-auth-token`) from `POST /auth/login`.

### Provider - Create

**Endpoint:** `POST /gateway/providers`

**Description:** Creates a blank-slate provider row (no auth schema, models, or endpoints yet). `providerKey` must match `/^[a-z0-9_]+$/` (3-50 chars); duplicate keys return 409. Audit-logged as `provider.created`.

**Request:**
```json
{
  "providerKey": "myprovider",
  "providerName": "My Provider",
  "category": "ai",
  "authType": "api_key",
  "websiteUrl": "https://example.com",
  "documentationUrl": "https://example.com/docs",
  "defaultApiBaseUrl": "https://api.example.com/v1"
}
```

**Response (201):**
```json
{ "success": true, "message": "Provider 'myprovider' created.", "providerId": 16 }
```

**Errors:** `400` validation (`providerKey` regex/length, `category` must be one of `ai, embedding, vector, storage, graph, image, speech, search, database, email, analytics`, `authType` one of `api_key, bearer_token, oauth2, basic_auth, custom`, URL fields must parse), `409` duplicate key.

### Provider - List

**Endpoint:** `GET /gateway/providers`

**Description:** Catalog rows enriched with the stats the Service Catalog page renders (model/endpoint/capability counts, supported capability keys, pricing flag).

**Response (200):**
```json
{ "success": true, "providers": [{ "providerKey": "openai", "providerName": "OpenAI", "category": "ai", "authType": "bearer_token", "models": 5, "endpoints": 0, "capabilities": 7, "capabilityKeys": ["chat", "streaming", "embeddings"], "hasPricing": true }] }
```

### Provider - Detail

**Endpoint:** `GET /gateway/providers/{key}`

**Description:** Full metadata for one provider, including `capabilities`, `authForm`, and `resourceTemplates` (with their `config` / `config_schema` JSON).

### Provider - Delete

**Endpoint:** `DELETE /gateway/providers/{key}`

**Description:** Hard-deletes a provider from the catalog. Catalog child tables (`provider_models`, `provider_capabilities`, `provider_auth_schemas`, `provider_resource_types`, `provider_endpoints`) cascade; the key becomes immediately reusable. `credentials`/`provider_resources` RESTRICT on `provider_id`, so deleting a provider those rows reference is refused with `409`. Audit-logged (`provider.deleted`).

**Errors:** `404` unknown provider, `409` referenced by tenant credentials/resources.

### Provider Models - CRUD

**Endpoints:** `GET /gateway/providers/{key}/models` · `POST /gateway/providers/{key}/models` · `PUT /gateway/providers/{key}/models/{id}` · `DELETE /gateway/providers/{key}/models/{id}`

**Description:** Models belong to the **provider catalog** (never to a company — tenant access is granted separately via `POST /gateway/credentials/:id/models`). The category is one of `chat`, `embedding`, `reranker`, `image`, `tts`, `stt`, `vision`; the model key is the unique key per provider and **can be renamed** via `PUT` (renaming onto a key already used by another model on the same provider is refused with 409). Pricing is a child of the model and cascades away with it. All three write routes invalidate the registry cache and are audit-logged (`provider.model.upserted` / `updated` / `deleted`).

**UI flow (same walkthrough as [docs/providers.md](providers.md)):** models are managed from the provider's **Models** tab on the Catalog detail page — the wizard never touches models. Click **Add Model**; the first field is the **model name**, and the **model key auto-generates** from it (lowercased, dots and any `@`/`/` preserved, spaces/other chars → `-`; typing in the key manually stops the auto-sync). `category` drives which Config-page dropdown a model appears in (`chat` → LLM/small LLM, `embedding` → embedding, `reranker` → reranker). Optional capability toggles (`streaming`/`functionCalling`/`vision`) and context/output windows are stored as row flags. A **starting price** (input/output `$ / 1M`) creates the first pricing row immediately; otherwise pricing is managed inline on the Models tab (time-bucketed `effectiveAt`/`expiresAt` history, add/edit/delete via `/gateway/pricing`). **Edit** opens the same modal prefilled with the key editable (rename is supported — pricing + tenant `credential_model_access` grants follow the model row; renaming onto an existing key on the same provider is refused); **delete** is a hard delete that cascades pricing + tenant `credential_model_access` grants. After every create/update/delete the **registry cache is invalidated**, so the model appears in the provider's Models tab **and** every company Config-page model dropdown immediately.

> **Cloudflare model IDs (`@cf/…`):** the runtime passes config model values **verbatim** to Workers AI (`/ai/run/{model}`), so full IDs like `@cf/meta/llama-3.3-70b-instruct-fp8` work end-to-end once set on the Config page. The catalog accepts these as model keys too — the key charset includes `@`, `/` and mixed case (e.g. `@cf/moondream/moondream3.1-9B-A2B`) — and the Add Model modal's auto-key preserves `@`/`/`.

#### Model - List

**Endpoint:** `GET /gateway/providers/{key}/models`

**Description:** Models for a provider; each entry carries its current price row (from `pricing`).

**Example (curl):**
```bash
curl http://localhost:3000/gateway/providers/openai/models \
  -H "Authorization: Bearer <token>"
```

**Response (200):**
```json
{
  "success": true,
  "providerKey": "openai",
  "models": [
    {
      "id": 42,
      "model_key": "gpt-4o-mini",
      "model_name": "GPT-4o Mini",
      "model_family": "gpt-4o",
      "category": "chat",
      "supports_streaming": true,
      "supports_function_calling": true,
      "supports_vision": false,
      "max_context_window": 128000,
      "max_output_tokens": 16384,
      "pricing": [
        { "effective_at": "2025-01-01", "input_price_per_million": "0.150", "output_price_per_million": "0.600", "currency": "USD", "is_current": true }
      ]
    }
  ]
}
```

**Errors:** `404` unknown provider.

#### Model - Upsert (create or refresh)

**Endpoint:** `POST /gateway/providers/{key}/models`

**Description:** Upserts a single model for a provider — the importer only runs full definitions, so this is the UI's way to add one model at a time. Upsert semantics: the same `provider_id + model_key` refreshes the row in place (no duplicate). An optional `pricing` array adds price rows (`effectiveFrom` defaults to today, `priceCurrency` to `USD`).

**Request:**
```json
{
  "key": "gpt-4o-mini",
  "name": "GPT-4o Mini",
  "category": "chat",
  "family": "gpt-4o",
  "streaming": true,
  "functionCalling": true,
  "vision": false,
  "maxContextWindow": 128000,
  "maxOutputTokens": 16384,
  "pricing": [
    { "inputPricePerMillion": 0.15, "outputPricePerMillion": 0.6 }
  ]
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` (or `modelKey`) | string | Yes | Model key: 1-100 chars, `/^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]*$/` — plain slugs (`gpt-4o-mini`) or vendor-prefixed IDs (`@cf/baai/bge-base-en-v1.5`, `xai/grok-4.6`, `@cf/moondream/moondream3.1-9B-A2B`) |
| `name` (or `modelName`) | string | Yes | Display name (max 200 chars) |
| `category` | string | Yes | One of `chat`, `embedding`, `reranker`, `image`, `tts`, `stt`, `vision` |
| `family` | string | No | Model family label |
| `streaming` / `functionCalling` / `vision` | boolean | No | Capability flags (default `false`) |
| `maxContextWindow` | integer | No | Context window in tokens |
| `maxOutputTokens` | integer | No | Max output tokens |
| `pricing` | array | No | Price rows: `{ effectiveFrom?, inputPricePerMillion?, outputPricePerMillion?, priceCurrency? }` — note these keys use `inputPricePerMillion`/`outputPricePerMillion`, **not** the `pricePerMillionInput`/`pricePerMillionOutput` shape of `POST /gateway/pricing`; unknown keys are silently stored as `null` |

**Example (curl):**
```bash
curl -X POST http://localhost:3000/gateway/providers/openai/models \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "gpt-4o-mini",
    "name": "GPT-4o Mini",
    "category": "chat",
    "family": "gpt-4o",
    "streaming": true,
    "functionCalling": true,
    "vision": false,
    "maxContextWindow": 128000,
    "maxOutputTokens": 16384,
    "pricing": [
      { "inputPricePerMillion": 0.15, "outputPricePerMillion": 0.6 }
    ]
  }'
```

Cloudflare-prefixed keys work the same way — vendor IDs are passed through verbatim:
```bash
curl -X POST http://localhost:3000/gateway/providers/cloudflare_worker_ai/models \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "@cf/baai/bge-base-en-v1.5",
    "name": "BGE Base (English) v1.5",
    "category": "embedding",
    "maxContextWindow": 512
  }'
```

**Response (201):**
```json
{ "success": true, "message": "Model 'gpt-4o-mini' upserted for 'openai'. 1 price row(s) added.", "modelId": 42 }
```

**Errors:** `400` bad key regex/length, missing name, or category not in the ENUM; `404` unknown provider.

#### Model - Update

**Endpoint:** `PUT /gateway/providers/{key}/models/{id}`

**Description:** Partial update of a model's metadata. Present fields are merged over the stored row; `name`/`category` are re-validated. The **model key is editable** — sending a different `key` renames the model (pricing and credential model-access grants follow the row); a rename that collides with an existing key on the same provider returns **409**. Pass an explicit `null` to clear optional fields (`family`, `maxContextWindow`, `maxOutputTokens`). Pricing is managed via `/gateway/pricing`, not here.

**Request:**
```json
{ "name": "GPT-4o Mini (fast)", "streaming": true, "maxContextWindow": 128000 }
```

**Example (curl):**
```bash
curl -X PUT http://localhost:3000/gateway/providers/openai/models/42 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GPT-4o Mini (fast)",
    "streaming": true,
    "maxContextWindow": 128000
  }'
```

**Response (200):**
```json
{ "success": true, "message": "Model 'gpt-4o-mini' updated for 'openai'.", "modelId": 42 }
```

**Errors:** `400` empty name, bad category, or invalid key format; `404` unknown provider or model id not owned by that provider; `409` rename onto an existing key on the same provider.

#### Model - Delete

**Endpoint:** `DELETE /gateway/providers/{key}/models/{id}`

**Description:** Hard-deletes a model. Pricing rows and `credential_model_access` grants for it CASCADE (`schema/v5.sql` FKs), so tenant grants disappear with the model.

**Example (curl):**
```bash
curl -X DELETE http://localhost:3000/gateway/providers/openai/models/42 \
  -H "Authorization: Bearer <token>"
```

**Response (200):**
```json
{ "success": true, "message": "Model 'gpt-4o-mini' deleted for 'openai'." }
```

**Errors:** `404` unknown provider or model id not owned by that provider.

### Endpoints - CRUD

**Endpoints:** `GET /gateway/endpoints` · `POST /gateway/endpoints` · `PUT /gateway/endpoints/{id}` · `DELETE /gateway/endpoints/{id}`

**Description:** Catalog of API endpoints per provider. `endpointKey` must match `/^[a-z0-9_-]+$/` (2-100 chars); `method` one of `GET/POST/PUT/DELETE/PATCH`; `pathTemplate` like `/v1/chat/completions`; `bodyParams` is a JSON-encoded string. Creating an endpoint that overlaps an existing one on the same provider+method is rejected (409). Deleting an endpoint referenced by a pricing row is refused (409). Audit-logged (`endpoint.created/updated/deleted`).

**Create request:**
```json
{
  "providerKey": "openai",
  "endpointKey": "chat_completions",
  "method": "POST",
  "pathTemplate": "/v1/chat/completions",
  "description": "Create a chat completion",
  "category": "ai"
}
```

### Pricing - CRUD

**Endpoints:** `GET /gateway/pricing` · `POST /gateway/pricing` · `PUT /gateway/pricing/{id}` · `DELETE /gateway/pricing/{id}`

**Description:** Price rows per model (optionally per endpoint). `pricePerMillionInput` / `pricePerMillionOutput` are DECIMAL values; `effectiveAt` / `expiresAt` are `YYYY-MM-DD`. `GET /gateway/pricing` accepts `?modelId=` and `?provider=` filters. Audit-logged (`pricing.created/updated/deleted`).

**Create request:**
```json
{
  "modelId": 3,
  "endpointId": 5,
  "pricePerMillionInput": 2.5,
  "pricePerMillionOutput": 10,
  "currency": "USD",
  "effectiveAt": "2026-08-01"
}
```

---

### Gateway - Knowledge Bases

**Endpoints:** `GET /gateway/kbs/options` · `GET /gateway/kbs` · `POST /gateway/kbs` · `GET /gateway/kbs/{key}` · `PUT /gateway/kbs/{key}` · `DELETE /gateway/kbs/{key}` · `POST /gateway/kbs/{key}/ingest` · `GET /gateway/kbs/{key}/status`

**Description:** Tenant-scoped RAG knowledge bases (rows in the `knowledge_bases` table). All routes require the `x-company-name` header (or `?company=` / `body.company`) and resolve the tenant via the gateway `companies` table. KBs can bind `provider_resources` rows (vector index / storage bucket) and a catalog embedding model, falling back to the company's RAG config when unset. Ingestion uploads chunks under the R2 `kb/<kbKey>/` prefix, tracks progress in a per-KB registry (`processed-<company>-<kbKey>.json`), and flips the KB `status` (`indexing` → `active` / `error`). Graph RAG is stored disabled in M2.

**Create request:**
```json
{
  "kbKey": "popularcert-kb",
  "kbName": "PopularCert KB",
  "description": "Certification docs",
  "chunkSize": 512,
  "chunkOverlap": 50,
  "retrievalTopK": 10,
  "retrievalScoreThreshold": 0.7,
  "enableHybridSearch": true,
  "enableGraphRag": false,
  "isActive": true
}
```

**Responses:** `POST /gateway/kbs` → `201 { success, message, kbId, kbKey }`. `GET /gateway/kbs` → `{ success, kbs: [...] }` (each row denormalized with `vector_resource_name` / `vector_external_id` / `storage_resource_name` / `storage_external_id` / `embedding_model_key` / `embedding_model_name` from the KB_SELECT join). `GET /gateway/kbs/{key}/status` → `{ success, status: { kbKey, status, inProgress, lastSyncAt, documentCount, vectorCount, lastError } }` — `vectorCount` is best-effort (null when Vectorize is unreachable), `lastSyncAt` maps to the row `updated_at` (last status flip), `lastError` comes from the live job state. `POST /gateway/kbs/{key}/ingest` → `409` when an ingest for the same KB is already running; success → `{ success, message, startedAt }`. Audit actions: `kb.created`, `kb.updated`, `kb.deleted`, `kb.ingest.started`, `kb.ingest.failed`. Errors: `400` validation / resource ownership, `404` unknown company or KB, `409` duplicate key / KB limit reached / ingest already running.

---

## RAG Pipeline Overview

For AI agents understanding the data flow:

```
User Question (with x-company-name header)
  → Intent Detection (greeting/block check)
  → Query Rewriting (standalone query via SMALL_LLM)
  → Embedding (EMBEDDING_MODEL)
  → Vector Search (Cloudflare Vectorize, top 10)
  → Hybrid Scoring (85% vector + 15% keyword)
  → Deduplication
  → Reranking (RERANKING_MODEL)
  → Chunk Retrieval (Cloudflare R2, top 5)
  → Context Building (max 4000 chars)
  → LLM Generation (LLM_MODEL)
  → Final Answer
```

### Caching

- In-memory cache with 60-minute TTL
- Max 200 entries with FIFO eviction
- Cache key: MD5 of `companyName:rewrittenQuestion` (company-scoped)
- Cached responses include `"cached": true` flag

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Required |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | Required |
| `VECTOR_INDEX` | Vectorize index name | Required |
| `R2_BUCKET_NAME` | R2 bucket name | Required |
| `R2_ACCESS_KEY_ID` | R2 access key | Required |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | Required |
| `R2_TOKEN_VALUE` | R2 token value | Optional |
| `R2_JURISDICTION_END_POINT` | R2 endpoint URL | Optional |
| `BASE_URL` | WordPress domain URL | — |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `ADMIN_API_KEY` | Admin API key | Optional |
| `EMBEDDING_MODEL` | Embedding model | `@cf/baai/bge-base-en-v1.5` |
| `EMBEDDING_DIMENSIONS` | Vector dimensions | `768` |
| `LLM_MODEL` | Primary LLM | `@cf/meta/llama-3.1-8b-instruct-fp8` |
| `SMALL_LLM` | Query rewriting LLM | `@cf/meta/llama-3.2-3b-instruct` |
| `RERANKING_MODEL` | Reranking model | `@cf/baai/bge-reranker-base` |
| `DELAY_MS` | Ingestion delay | Optional |
| `BATCH_SIZE` | Ingestion batch size | Optional |
| `CONTACT_US_URL` | Contact page URL | `https://popularcert.com/contact-us/` |
| `LOCATIONS_URL` | Locations page URL | `https://popularcert.com/locations/` |
| `SERVICES_URL` | Services page URL | `https://popularcert.com/services/` |
| `COMPANY_NAME` | Company name | `Popularcert` |
| `CONSULTANT_NAME` | Consultant/assistant name | `Sarah` |

---

## CORS

Allowed origins:
- `https://dev.popularcert.com`
- `https://staging.popularcert.com`
- `https://www.popularcert.com`
- `https://popularcert.com`
- `https://crm.popularcert.com`
- `http://localhost:3000`
- `http://localhost:5173`
- `http://localhost:8080`

Allowed headers: `Content-Type`, `X-WP-Nonce`, `X-Company-Name`

---

## Example Workflows

### 1. Ask a Question

```bash
# Simple question
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"question": "What is ISO 9001?"}'

# With history
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{
    "question": "What about ISO 14001?",
    "history": [
      {"role": "user", "content": "Tell me about certifications"},
      {"role": "assistant", "content": "PopularCert offers various ISO certifications..."}
    ]
  }'
```

### 2. Stream Response

```bash
curl -N -X POST http://localhost:3000/ask-stream \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"question": "What is ISO 9001?"}'
```

### 3. Create a New Company

```bash
curl -X POST http://localhost:3000/cloudflare/companies \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "name": "another-co",
    "config": {
      "BASE_URL": "https://anotherco.com",
      "VECTOR_INDEX": "anotherco-vectors",
      "R2_BUCKET_NAME": "anotherco-r2"
    }
  }'
```

### 4. Run Ingestion Job

```bash
# Start job
curl -X POST http://localhost:3000/cloudflare/job/start \
  -H "Content-Type: application/json" \
  -d '{"jobId": "ingest"}'

# Check status
curl http://localhost:3000/cloudflare/status
```

### 5. Switch to 70B Model

```bash
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-company-name: popularcert" \
  -d '{"key": "LLM_MODEL", "value": "@cf/meta/llama-3.3-70b-instruct-fp8"}'
```

---

*Generated for AI agent reference. Last updated: July 6, 2026*
