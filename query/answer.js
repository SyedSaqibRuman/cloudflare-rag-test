import { runCloudflareAI, fetchCloudflareAI } from "../services/cloudflare_ai.js";
import { env } from "../env.js";
import { checkFastPath } from "./intent.js";
import { getCacheKey, getCached, setCache } from "./cache.js";
import { retrieveContext } from "./retrieval.js";
import { rewriteFollowup, getLlmModel, MAX_HISTORY } from "./llm.js";
import { getSystemMessage, buildResponses } from "./prompts.js";
import { buildUserMessage } from "./context.js";
import { createStreamTransport, createSseParser } from "./stream-contract.js";

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
      { role: "user", content: buildUserMessage(context, cleanQuestion) },
    ];

    const ai = await runCloudflareAI(companyName, getLlmModel(companyName), {
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
export async function askQuestionStream(
  question,
  history = [],
  transport = createStreamTransport({ write: () => {} }),
  companyName
) {
  try {
    const trimmed = question?.trim();
    const R = buildResponses(companyName);

    const fastResponse = checkFastPath(trimmed, companyName);
    if (fastResponse) {
      transport.sendStart();
      transport.sendToken(fastResponse);
      return true;
    }

    transport.sendToken("Thinking...");

    const cleanQuestion = (await rewriteFollowup(trimmed, history, companyName)).trim();

    const { context } = await retrieveContext(cleanQuestion, companyName);
    if (!context) {
      transport.sendStart();
      transport.sendToken(R.noContext);
      return false;
    }

    const messages = [
      getSystemMessage(companyName),
      ...history.slice(-MAX_HISTORY),
      { role: "user", content: buildUserMessage(context, cleanQuestion) },
    ];

    const response = await fetchCloudflareAI(
      companyName,
      getLlmModel(companyName),
      { stream: true, messages, temperature: 0.3, max_tokens: 500 },
      { signal: transport.signal }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    if (!response.body) throw new Error("No response body received from Cloudflare.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let firstTokenReceived = false;

    // Buffering, line splitting, and partial-JSON recovery live in
    // stream-contract.createSseParser — same wire rules as the framing side.
    const parser = createSseParser((parsed) => {
      if (parsed.response && !firstTokenReceived) {
        firstTokenReceived = true;
        transport.sendStart();
      }
      if (parsed.response) transport.sendToken(parsed.response);
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.flush();
    } finally {
      reader.releaseLock();
    }

    if (env.NODE_ENV !== "production") console.log("✅ Stream completed:", cleanQuestion);
    return true;
  } catch (err) {
    if (err.name === "AbortError" || transport.signal.aborted) {
      if (env.NODE_ENV !== "production") console.log("ℹ️ Stream cancelled by client.");
      return false;
    }
    console.error("❌ Stream error:", err.message);
    transport.sendError(buildResponses(companyName).error);
    return false;
  }
}

