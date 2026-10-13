# API: Streaming

## Ask Question (Streaming SSE)

```
POST /ask-stream
```

Sends a question and receives a streaming response via Server-Sent Events.

**Required Header:** `x-company-name`

**Example:**
```bash
# Stream with curl (use --no-buffer to see tokens in real-time)
curl -N -X POST http://localhost:3000/ask-stream \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"question": "What is ISO 9001 certification?"}'

# With conversation history
curl -N -X POST http://localhost:3000/ask-stream \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"question": "What about ISO 14001?", "history": [{"role": "user", "content": "Tell me about certifications"}]}'
```

**Request Body:**
```json
{
  "question": "What is ISO 9001 certification?",
  "history": []
}
```**Response:** `text/event-stream`

```
data: {"__start":true,"sources":[{"title":"ISO 9001 in Angola","score":0.86}],"matches":[{"id":"chunk-1","score":0.86}],"graph":null}

data: {"token":"ISO"}

data: {"token":" 9001"}

data: {"token":" is"}

data: {"token":" an"}
data: {"token":" internationally"}
data: {"possibleQuestions":["What are the ISO 9001 requirements?","How long does certification take?"]}
data: [DONE]
```

**Event Format:**

| Event | Description |
|-------|-------------|
| `data: {"__start":true,"sources":[...],"matches":[...],"graph":{...}\|null}` | Structured start frame carrying retrieval metadata (same shapes as the non-streaming `/ask` response). **Arrives AFTER the tokens**, once the pipeline finishes — see the ordering note below. |
| `data: {"token":"..."}` | Each streamed token |
| `data: {"possibleQuestions":[...]}` | 3–5 suggested follow-up questions generated from the answer (small LLM); rendered by the Test AI page as clickable "Suggested questions" chips. Best-effort — omitted/empty on errors, canned fast-path answers, or aborted requests |
| `data: {"error":"..."}` | Error occurred |
| `data: [DONE]` | Stream completed successfully |

> **Frame order:** on a RAG answer the tokens stream first and the `__start` metadata frame follows them (`query/answer.js` sends it after the run completes), so clients must not rely on `__start` to clear a "Thinking…" placeholder. On the fast path (greetings, identity, contact) there is no `__start` frame at all — instead the legacy `__START_RESPONSE__` sentinel is emitted as a token, then one token, then `[DONE]`. Filter the sentinel or it renders as visible text. Full integration guide: `docs/api/chat-integration.md`.

> **Legacy frames (still parsed by clients, no longer emitted on the normal path):** the standalone `data: {"sources":[...]}` frame and the `data: {"token":"__START_RESPONSE__"}` sentinel. The transport still sends the sentinel as the preamble of `__start:false` start frames (empty-question / fast-path / error responses); well-behaved clients filter it. The structured `__start` frame above replaced both on RAG answers.

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

## Stream Test

```
POST /test
```

Tests the streaming infrastructure by capturing stdout chunks.

**Example:**
```bash
curl -N -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello"}'
```

**Request Body:**
```json
{
  "prompt": "Hello"
}
```

**Response:** `text/event-stream` (stdout capture format)
