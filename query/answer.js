import "dotenv/config";
import readline from "readline";
import { getConfig } from "../config/index.js";
import { env } from "../env.js";
import { checkFastPath } from "./intent.js";
import { getCacheKey, getCached, setCache } from "./cache.js";
import { retrieveContext } from "./retrieval.js";
import { rewriteFollowup, getLlmModel, cfClient, MAX_HISTORY } from "./llm.js";
import { getSystemMessage, buildResponses } from "./prompts.js";
import { sanitizeText } from "./context.js";

// --------------------------
// CONFIGURATION
// --------------------------
const STREAM_TIMEOUT_MS = 30_000;

// --------------------------
// ASKQUESTION (Non-streaming)
// --------------------------
export async function askQuestion(question, history = [], companyName) {
  try {
    const trimmed = question?.trim();
    const R = buildResponses(companyName);

    const fastResponse = checkFastPath(trimmed, companyName);
    if (fastResponse) return { answer: fastResponse };

    const cleanQuestion = (await rewriteFollowup(trimmed, history, companyName)).trim();

    const cacheKey = getCacheKey(cleanQuestion, companyName);
    const cached = getCached(cacheKey);
    if (cached) return { ...cached, cached: true };

    const { context, matches } = await retrieveContext(cleanQuestion, companyName);
    if (!context) return { answer: R.noContext };

    const messages = [
      getSystemMessage(companyName),
      ...history.slice(-MAX_HISTORY),
      { role: "user", content: `CONTEXT:\n${sanitizeText(context)}\n\nQUESTION:\n${cleanQuestion}` },
    ];

    const ai = await cfClient.ai.run(getLlmModel(companyName), {
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      messages,
      temperature: 0.3,
      max_tokens: 500,
    });

    const result = {
      answer: ai.response || R.error,
      sources: matches.map((m) => ({ title: m.metadata?.title, score: m.score })),
    };

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    if (env.NODE_ENV !== "production") console.error("❌ ASK ERROR:", err);
    return { answer: buildResponses(companyName).error, error: err.message };
  }
}

// --------------------------
// ASKQUESTIONSTREAM (Streaming)
// --------------------------
export async function askQuestionStream(question, history = [], onToken = () => {}, signal, companyName) {
  let combinedSignal = null;

  try {
    const trimmed = question?.trim();
    const R = buildResponses(companyName);

    const fastResponse = checkFastPath(trimmed, companyName);
    if (fastResponse) {
      onToken("__START_RESPONSE__");
      onToken(fastResponse);
      return true;
    }

    onToken("Thinking...");

    const timeoutSignal = AbortSignal.timeout(STREAM_TIMEOUT_MS);
    combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const cleanQuestion = (await rewriteFollowup(trimmed, history, companyName)).trim();

    const { context } = await retrieveContext(cleanQuestion, companyName);
    if (!context) {
      onToken("__START_RESPONSE__");
      onToken(R.noContext);
      return false;
    }

    const messages = [
      getSystemMessage(companyName),
      ...history.slice(-MAX_HISTORY),
      { role: "user", content: `CONTEXT:\n${sanitizeText(context)}\n\nQUESTION:\n${cleanQuestion}` },
    ];

    const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${getLlmModel(companyName)}`;

    const response = await fetch(url, {
      method: "POST",
      signal: combinedSignal,
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ stream: true, messages, temperature: 0.3, max_tokens: 500 }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    if (!response.body) throw new Error("No response body received from Cloudflare.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      firstTokenReceived = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const cleaned = line.trim();
          if (!cleaned || cleaned === "data: [DONE]") continue;
          if (!cleaned.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(cleaned.slice(6));
            if (parsed.response && !firstTokenReceived) {
              firstTokenReceived = true;
              onToken("__START_RESPONSE__");
            }
            if (parsed.response) onToken(parsed.response);
          } catch {
            buffer = line + "\n" + buffer;
          }
        }
      }

      // Flush trailing buffer
      if (buffer.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(buffer.slice(6));
          if (parsed.response) onToken(parsed.response);
        } catch { /* ignore malformed trailing chunk */ }
      }
    } finally {
      reader.releaseLock();
    }

    if (env.NODE_ENV !== "production") console.log("✅ Stream completed:", cleanQuestion);
    return true;
  } catch (err) {
    if (err.name === "AbortError" || combinedSignal?.aborted) {
      if (env.NODE_ENV !== "production") console.log("ℹ️ Stream cancelled by client.");
      return false;
    }
    console.error("❌ Stream error:", err.message);
    onToken("__START_RESPONSE__");
    onToken(buildResponses(companyName).error);
    return false;
  }
}

// --------------------------
// CLI MODE
// --------------------------
if (process.argv[1]?.includes("query.js") || process.argv[1]?.endsWith("/answer.js")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const history = [];
  let cliCompany = null;

  rl.question("🏢 Company name: ", (co) => {
    cliCompany = co.trim();
    if (!cliCompany) {
      console.log("❌ Company name is required. Exiting.");
      rl.close();
      return;
    }
    const config = getConfig(cliCompany);
    console.log(`\n🤖 ${config.CONSULTANT_NAME || "Assistant"} RAG System Active | Type 'exit' to quit.\n`);

    const ask = () => {
      rl.question("❓ Ask: ", async (q) => {
        const input = q.trim();
        if (!input) return ask();
        if (["exit", "quit"].includes(input.toLowerCase())) return rl.close();

        history.push({ role: "user", content: input });
        const res = await askQuestion(input, history, cliCompany);
        const consultantName = getConfig(cliCompany).CONSULTANT_NAME || "Assistant";
        console.log(`\n💡 ${consultantName}:\n${res.answer}\n`);
        history.push({ role: "assistant", content: res.answer });

        while (history.length > MAX_HISTORY * 2) history.splice(0, 2);
        ask();
      });
    };

    ask();
  });
}
