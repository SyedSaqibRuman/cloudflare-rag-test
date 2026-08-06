import "dotenv/config";

/**
 * Smoke-test the Cloudflare AI stream endpoint.
 *
 * Output channel: pass `onToken(token)` to receive each token as it streams
 * (used by POST /test to frame SSE); without it, tokens are written straight
 * to process.stdout (CLI use). Errors are thrown, never swallowed — the caller
 * decides how to surface them.
 *
 * @param {string} [prompt="Hello"] - The user query.
 * @param {((token: string) => void)|null} [onToken=null] - Per-token callback.
 * @param {{ CLOUDFLARE_ACCOUNT_ID?: string, CLOUDFLARE_API_TOKEN?: string }} [creds={}]
 *        Per-company Cloudflare credentials (resolved by the caller).
 * @returns {Promise<string>} The full concatenated response text.
 */
export async function testStream(prompt = "Hello", onToken = null, creds = {}) {
  const MODEL = "@cf/meta/llama-3-8b-instruct";
  const { CLOUDFLARE_ACCOUNT_ID = "", CLOUDFLARE_API_TOKEN = "" } = creds;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  if (!response.body) {
    throw new Error("No response body received from Cloudflare");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let fullText = "";
  let buffer = ""; // Tracks partial lines across chunks

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Decode current chunk and prepend any leftover buffer
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");

    // Keep the last partial line in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const cleaned = line.trim();

      // Skip empty lines or the termination signal
      if (!cleaned || cleaned === "data: [DONE]") {
        continue;
      }

      if (cleaned.startsWith("data: ")) {
        try {
          // Remove 'data: ' prefix and parse
          const parsed = JSON.parse(cleaned.slice(6));

          if (parsed.response) {
            if (onToken) onToken(parsed.response);
            else process.stdout.write(parsed.response);
            fullText += parsed.response;
          }
        } catch (e) {
          // If parsing fails, the line might still be partial
          // We prepend it back to the buffer for the next chunk
          buffer = line + buffer;
        }
      }
    }
  }

  if (!onToken) console.log("\n\n✅ Stream completed");
  return fullText;
}

// await testStream("Write a short poem about AI");
