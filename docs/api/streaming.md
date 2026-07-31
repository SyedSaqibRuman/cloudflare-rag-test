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
```

**Response:** `text/event-stream`

```
data: {"token":"ISO"}

data: {"token":" 9001"}

data: {"token":" is"}

data: {"token":" an"}

data: {"token":" internationally"}

data: [DONE]
```

**Event Format:**

| Event | Description |
|-------|-------------|
| `data: {"token":"..."}` | Each streamed token |
| `data: [DONE]` | Stream completed successfully |
| `data: {"error":"..."}` | Error occurred |

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
