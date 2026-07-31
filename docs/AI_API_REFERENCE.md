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

| Tier | Routes | Default Limit | Env Var |
|------|--------|---------------|---------|
| Global | All routes except `GET /` | 100 req/min | `RATE_LIMIT_GLOBAL` |
| AI | `POST /ask`, `POST /ask-stream` | 20 req/min | `RATE_LIMIT_AI` |
| Cloudflare | All `/cloudflare/*` routes | 30 req/min | `RATE_LIMIT_ADMIN` |

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
data: {"token":"ISO"}

data: {"token":" 9001"}

data: {"token":" is"}

data: {"token":" an"}

data: [DONE]
```

**Event Types:**
| Event | Format | Description |
|-------|--------|-------------|
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
      "R2_BUCKET_NAME": "popularcert-r2"
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
| `RATE_LIMIT_GLOBAL` | Global rate limit | `100` |
| `RATE_LIMIT_AI` | AI rate limit | `20` |
| `RATE_LIMIT_ADMIN` | Admin rate limit | `30` |
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
