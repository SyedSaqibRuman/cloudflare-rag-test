# API: Ask

## Health Check

```
GET /
```

Returns server status and uptime.

**Example:**
```bash
curl http://localhost:3000/
```

**Response:**
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

## Ask Question (JSON)

```
POST /ask
```

Sends a question and receives a complete answer with source references.

**Required Header:** `x-company-name`

**Example:**
```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"question": "What is ISO 9001 certification?"}'

# With conversation history
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"question": "What about ISO 14001?", "history": [{"role": "user", "content": "Tell me about certifications"}, {"role": "assistant", "content": "PopularCert offers various ISO certifications..."}]}'
```

**Request Body:**
```json
{
  "question": "What is ISO 9001 certification?",
  "history": [
    { "role": "user", "content": "Tell me about certifications" },
    { "role": "assistant", "content": "PopularCert offers various ISO certifications..." }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | The user's question |
| `history` | array | No | Conversation history (default: `[]`) |

**Response (200):**
```json
{
  "success": true,
  "answer": "ISO 9001 is an internationally recognized quality management standard...",
  "sources": [
    { "title": "ISO 9001 Certification", "score": 0.92 }
  ],
  "matches": [
    { "id": "chunk-42", "score": 0.92, "metadata": { "title": "ISO 9001 Certification", "r2_key": "site/pages/iso-9001/chunk-0.json" } }
  ],
  "graph": null,
  "cached": false,
  "possibleQuestions": [
    "What are the ISO 9001 requirements?",
    "How long does certification take?"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `answer` | string | The AI answer (Markdown) |
| `sources` | array | `{ title, score }` retrieval sources for RAG answers |
| `matches` | array | Full retrieval matches incl. metadata (vector chunks) |
| `graph` | object \| null | `{ context, cypher }` when GraphRAG context was used, else `null` |
| `cached` | boolean | `true` when served from the in-memory answer cache |
| `possibleQuestions` | array | 3–5 suggested follow-up questions generated from the answer (best-effort; `[]` when unavailable — e.g. errors, fast-path/canned answers, aborted requests) |

**Response (cached):**
```json
{
  "success": true,
  "answer": "...",
  "sources": [...],
  "matches": [...],
  "graph": null,
  "cached": true,
  "possibleQuestions": [...]
}
```

**Error Responses:**

| Status | Condition |
|--------|-----------|
| 400 | Empty question, invalid history, or missing `x-company-name` header |
| 401 | Company has an ask API key set and the request didn't supply a valid one |
| 429 | AI rate limit reached (20 req/min) |
| 500 | Internal server error |

---

## Suggested Questions

The Test AI page (admin portal) surfaces two kinds of suggested questions built on the same data:

### Follow-up chips (after an answer)

The `possibleQuestions` field in `/ask` responses (and the `possibleQuestions` SSE frame in `/ask-stream`) contains 3–5 follow-up questions generated from the answer by the small LLM. The portal renders them as clickable "Suggested questions" chips under each answer — clicking one sends that question as the next turn. Best-effort: `[]` on errors, canned fast-path answers, or aborted requests.

### Starter chips (empty conversation)

```
GET /ask/suggestions
```

Returns per-company starter questions for the empty conversation state, generated from the company's knowledge base (top chunks → small LLM). Same auth as `/ask` (`x-company-name`, optional per-company API key) and rate limited by the AI tier.

**Example:**
```bash
curl http://localhost:3000/ask/suggestions \
  -H "x-company-name: popularcert"
```

**Response (200):**
```json
{
  "success": true,
  "questions": [
    "What services does this company offer?",
    "How long does certification take?",
    "What are the first steps to get started?"
  ]
}
```

The portal caches these per company (24h) and falls back to generic static starters when the knowledge base is empty, credentials are missing, or the request fails (`questions: []`).
