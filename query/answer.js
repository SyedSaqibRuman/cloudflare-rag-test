import { runCloudflareAI, fetchCloudflareAI } from "../services/cloudflare_ai.js";
import { env } from "../env.js";
import { checkFastPath } from "./intent.js";
import { getCacheKey, getCached, setCache } from "./cache.js";
import { retrieveContext } from "./retrieval.js";
import { rewriteFollowup, getLlmModel, generatePossibleQuestions, MAX_HISTORY } from "./llm.js";
import { getSystemMessage, buildResponses } from "./prompts.js";
import { buildUserMessage } from "./context.js";
import { retrieveGraphContext } from "./graph.js";
import { createStreamTransport, createSseParser } from "./stream-contract.js";
import { resolveAssistantOverrides, isRunnableModel } from "./assistant.js";

// --------------------------
// ASSISTANT-AWARE PIPELINE HELPERS
// --------------------------
function assistantModel(companyName, assistant) {
  return assistant?.model && isRunnableModel(assistant.model) ? assistant.model : getLlmModel(companyName);
}

function assistantGraphOptions(assistant) {
  if (!assistant) return { enabled: true };
  return { enabled: assistant.enableGraph, database: assistant.graphDatabase || null };
}

// --------------------------
// SHARED PIPELINE ORCHESTRATOR
// --------------------------
/**
 * Canonical RAG pipeline flow. Both askQuestion and askQuestionStream call
 * this; the only difference is the llmCall adapter and the final framing.
 *
 * All step functions default to the real module imports so production callers
 * use the standard path. Tests inject fakes via the step options.
 *
 * @param {object} opts
 * @param {string} opts.question
 * @param {Array<{role:string,content:string}>} [opts.history=[]]
 * @param {string} opts.companyName
 * @param {object} opts.llmCall — adapter that knows how to execute the LLM.
 *   Signature: ({ messages, model, temperature, max_tokens, onToken? }) => Promise<{ response: string }>
 * @param {function} [opts.onToken] — optional streaming callback for token delivery.
 * @param {function} [opts.steps] — overrides for individual pipeline steps.
 * @returns {Promise<{ answer: string, sources: Array, matches: Array, graph: object|null, cached: boolean }>}
 */
export async function runPipeline({
  question,
  history = [],
  companyName,
  llmCall,
  onToken,
  steps = {},
}) {
  const {
    checkFastPath: fastPathFn = checkFastPath,
    resolveAssistantOverrides: resolveFn = resolveAssistantOverrides,
    rewriteFollowup: rewriteFn = rewriteFollowup,
    getCacheKey: cacheKeyFn = getCacheKey,
    getCached: cachedFn = getCached,
    setCache: setCacheFn = setCache,
    retrieveContext: retrieveFn = retrieveContext,
    retrieveGraphContext: graphFn = retrieveGraphContext,
    getSystemMessage: sysMsgFn = getSystemMessage,
    buildUserMessage: userMsgFn = buildUserMessage,
    buildResponses: responsesFn = buildResponses,
  } = steps;
  const trimmed = question?.trim();
  if (!trimmed) return { answer: "", sources: [], matches: [], graph: null, cached: false };

  const fastResponse = fastPathFn(trimmed, companyName);
  if (fastResponse) return { answer: fastResponse, sources: [], matches: [], graph: null, cached: false };

  const assistant = await resolveFn(companyName);
  const R = responsesFn(companyName, assistant?.assistantName || null);

  const cleanQuestion = (await rewriteFn(trimmed, history, companyName)).trim();

  const cacheKey = cacheKeyFn(cleanQuestion, companyName, assistant?.assistantKey);
  const cached = cachedFn(cacheKey);
  if (cached) return { ...cached, cached: true };

  const { context, matches } = await retrieveFn(cleanQuestion, companyName, {
    indexName: assistant?.vectorIndex || null,
  });
  if (!context) return { answer: R.noContext, sources: [], matches: [], graph: null, cached: false };

  const graph = await graphFn(cleanQuestion, companyName, assistantGraphOptions(assistant));
  const fullContext = graph ? `${context}\n${graph.context}` : context;

  const messages = [
    sysMsgFn(companyName, assistant?.systemPrompt || null, assistant?.assistantName || null, assistant?.variables || []),
    ...history.slice(-MAX_HISTORY),
    { role: "user", content: userMsgFn(fullContext, cleanQuestion) },
  ];

  const ai = await llmCall({
    messages,
    model: assistantModel(companyName, assistant),
    temperature: assistant?.temperature ?? 0.3,
    max_tokens: assistant?.maxTokens ?? 500,
    onToken,
  });
  const answer = ai.response || R.error;

  const result = {
    answer,
    sources: matches.map((m) => ({ title: m.metadata?.title, score: m.score })),
    matches,
    graph,
    cached: false,
  };

  setCacheFn(cacheKey, result, companyName);
  return result;
}

// --------------------------
// ASKQUESTION (Non-streaming)
// Accepts { signal } so the route can abort the (paid) AI call when the
// client disconnects mid-request.
// --------------------------
export async function askQuestion(question, history = [], companyName, { signal } = {}) {
  try {
    const result = await runPipeline({
      question,
      history,
      companyName,
      llmCall: async ({ messages, model, temperature, max_tokens }) => {
        const ai = await runCloudflareAI(
          companyName,
          model,
          { messages, temperature, max_tokens },
          { signal }
        );
        return { response: ai.response };
      },
    });

    // Client gone — skip the follow-up suggestions call entirely.
    const possibleQuestions = signal?.aborted
      ? []
      : await generatePossibleQuestions(result.answer, companyName);
    return { ...result, possibleQuestions };
  } catch (err) {
    if (signal?.aborted || err.name === "AbortError") {
      // Client disconnected — no error response to build.
      return { answer: "", sources: [], matches: [], graph: null, error: "aborted", possibleQuestions: [] };
    }
    if (env.NODE_ENV !== "production") console.error("❌ ASK ERROR:", err);
    return { answer: buildResponses(companyName).error, sources: [], matches: [], graph: null, error: err.message, possibleQuestions: [] };
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
    if (!trimmed) {
      transport.sendStart({ __start: false });
      transport.sendError("Question is required");
      transport.finish();
      return false;
    }

    const fastResponse = checkFastPath(trimmed, companyName);
    if (fastResponse) {
      transport.sendStart({ __start: false });
      transport.sendToken(fastResponse);
      transport.finish();
      return true;
    }

    let answer = "";

    const result = await runPipeline({
      question,
      history,
      companyName,
      onToken: (token) => {
        transport.sendToken(token);
      },
      llmCall: async ({ messages, model, temperature, max_tokens }) => {
        const response = await fetchCloudflareAI(
          companyName,
          model,
          { stream: true, messages, temperature, max_tokens },
          { signal: transport.signal }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        if (!response.body) throw new Error("No response body received from Cloudflare.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let firstTokenReceived = false;

        const parser = createSseParser((parsed) => {
          if (parsed.response && !firstTokenReceived) {
            firstTokenReceived = true;
          }
          if (parsed.response) {
            answer += parsed.response;
            transport.sendToken(parsed.response);
          }
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

        return { response: answer };
      },
    });

    if (!result.answer) {
      transport.sendStart({ __start: false });
      transport.sendError(buildResponses(companyName).error);
      transport.finish();
      return false;
    }

    const possibleQuestions = await generatePossibleQuestions(result.answer, companyName);

    transport.sendStart({ sources: result.sources, matches: result.matches, graph: result.graph });
    transport.sendPossibleQuestions(possibleQuestions);
    transport.finish();

    if (env.NODE_ENV !== "production") console.log("✅ Stream completed:", trimmed);
    return true;
  } catch (err) {
    if (err.name === "AbortError" || transport.signal.aborted) {
      if (env.NODE_ENV !== "production") console.log("ℹ️ Stream cancelled by client.");
      return false;
    }
    console.error("❌ Stream error:", err.message);
    transport.sendError(buildResponses(companyName).error);
    transport.finish();
    return false;
  }
}
