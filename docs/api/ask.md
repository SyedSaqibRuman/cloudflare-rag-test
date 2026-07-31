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

| Status | Condition |
|--------|-----------|
| 400 | Empty question, invalid history, or missing `x-company-name` header |
| 500 | Internal server error |
