import { runCloudflareAI, fetchCloudflareAI } from "../services/cloudflare_ai.js";
import { env } from "../env.js";
import { checkFastPath, matchesBlockedTopics } from "./intent.js";
import { getCacheKey, getCached, setCache } from "./cache.js";
import { retrieveContext } from "./retrieval.js";
import { rewriteFollowup, getLlmModel, generatePossibleQuestions, MAX_HISTORY } from "./llm.js";
import { getSystemMessage, buildResponses } from "./prompts.js";
import { buildUserMessage } from "./context.js";
import { retrieveGraphContext } from "./graph.js";
import { getR2Bucket } from "../services/r2.js";
import { createStreamTransport, createSseParser } from "./stream-contract.js";
import { resolveAssistantOverrides, isRunnableModel, checkModelAccess } from "./assistant.js";
import { getCompanyConfig } from "../config/index.js";

// --------------------------
// PROVIDER-EXECUTOR SEAM (lazy)
// Non-Workers-AI assistant models run through the gateway provider executor
// (ADR-012 ask runtime). Lazy-imported so query/ stays zero-dep for tests;
// streamed delivery goes through the same onToken callback as Workers AI.
// --------------------------
async function runProviderChat({ companyName, execution, model, input, signal, onToken }) {
  const { streamChat } = await import("../mysql/services/provider-executor.js");
  const { messages, temperature, max_tokens } = input;
  const out = await streamChat({
    companyKey: companyName,
    credentialId: execution.credentialId,
    providerKey: execution.providerKey || undefined,
    model,
    messages,
    options: {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(max_tokens !== undefined ? { max_tokens } : {}),
    },
    signal,
    onToken,
  });
  return { response: out.content || "" };
}

/**
 * The LLM adapter the pipeline executes: the assistant's own provider via the
 * gateway executor when its catalog model is a non-Workers-AI key bound to a
 * credential, otherwise the company's Workers AI model (legacy path).
 * @returns {{ model: string, execution: object|null }}
 */
function resolveLlmBinding(companyName, assistant) {
  if (assistant?.model && !isRunnableModel(assistant.model) && assistant.execution?.credentialId) {
    return { model: assistant.model, execution: assistant.execution };
  }
  return { model: assistantModel(companyName, assistant), execution: null };
}

// --------------------------
// USAGE LOGGING
// --------------------------
/**
 * Best-effort usage logging — never throws, never blocks the response.
 * Lazily imports UsageRepository + cost calculator so query/ tests stay zero-dep.
 */
async function logUsage(companyName, { model, inputTokens, outputTokens, durationMs, action, responseStatus, requestId }) {
  try {
    // Resolve company_id from the config store (MySQL or SQLite).
    let companyId = null;
    let credentialId = null;
    try {
      const { CompanyRepository, CredentialRepository } = await import("../mysql/repositories.js");
      const company = await CompanyRepository.findByKey(companyName);
      if (company) {
        companyId = company.id;
        // Find the Cloudflare credential for this company.
        const creds = await CredentialRepository.listByCompany(companyId);
        const cfCred = creds?.find((c) => c.provider_key === "cloudflare" || c.provider_key === "cloudflare-ai");
        if (cfCred) credentialId = cfCred.id;
      }
    } catch { /* MySQL unavailable — skip logging */ }

    if (!companyId) return; // No company found — skip.

    // Estimate cost from pricing table.
    let costUsd = 0;
    try {
      const { estimateCost } = await import("../mysql/services/cost.js");
      const { getPool } = await import("../mysql/pool.js");
      const costResult = await estimateCost({
        modelKey: model,
        inputTokens: inputTokens || 0,
        outputTokens: outputTokens || 0,
        getPool,
      });
      costUsd = costResult.costUsd;
    } catch { /* pricing unavailable — cost stays 0 */ }

    const { UsageRepository } = await import("../mysql/repositories.js");
    await UsageRepository.log({
      companyId,
      credentialId,
      action: action || "ask",
      modelUsed: model,
      inputUnits: inputTokens || null,
      outputUnits: outputTokens || null,
      durationMs: durationMs || null,
      costUsd: costUsd || null,
      responseStatus: responseStatus || 200,
      requestId: requestId || null,
    });
  } catch {
    // Best-effort — usage logging must never disrupt the ask path.
  }
}

// --------------------------
// ASSISTANT-AWARE PIPELINE HELPERS
// --------------------------
function assistantModel(companyName, assistant) {
  return assistant?.model && isRunnableModel(assistant.model) ? assistant.model : getLlmModel(companyName);
}

/**
 * Model-access gate condition: the gate runs when the assistant's catalog
 * model is the one the pipeline will actually execute — a Workers AI key, or
 * a non-CF key bound to the assistant's own credential (execution block).
 * A non-CF model with no credential binding falls back to the company LLM,
 * so gating it would deny an ask whose model is never called.
 */
function assistantModelExecutes(companyName, assistant) {
  if (!assistant?.assistantKey || !assistant?.model) return false;
  if (isRunnableModel(assistant.model)) return true;
  return Boolean(assistant.execution?.credentialId);
}

/**
 * Compute the retrieval binding fingerprint for cache key isolation.
 * This ensures cache entries are only served when all retrieval factors
 * (embedding model, vector index, LLM model) match exactly.
 *
 * ADR-012 Phase 1: When any of these changes, the cache key changes and
 * stale answers from incompatible vector spaces or LLM models are never served.
 *
 * @param {string} companyName
 * @param {object} assistant — resolved assistant overrides
 * @returns {{ embeddingModel: string, vectorIndex: string, llmModel: string }}
 */
function getRetrievalBinding(companyName, assistant) {
  // Embedding model: assistant's KB binding → company config fallback.
  const embeddingModel = assistant?.embeddingModel || getEmbeddingModel(companyName);
  // Vector index: assistant's primary KB → company config fallback.
  const vectorIndex = assistant?.vectorIndex || getVectorIndex(companyName);
  // Storage bucket: assistant's primary KB → company config fallback. Part of
  // the fingerprint so switching a KB's chunk bucket never serves answers
  // built from the previous bucket's chunks.
  const storageBucket = assistant?.storageBucket || getR2Bucket(companyName) || "";
  // LLM model: assistant's model → company config fallback.
  // The fingerprint uses the model that will actually execute — including the
  // assistant's non-CF catalog model bound to its own credential.
  const executedModel =
    assistant?.model && !isRunnableModel(assistant.model) && assistant.execution?.credentialId
      ? assistant.model
      : assistantModel(companyName, assistant);
  return { embeddingModel, vectorIndex, storageBucket, llmModel: executedModel };
}

/** Resolve the embedding model for cache binding. */
function getEmbeddingModel(companyName) {
  try {
    const config = getCompanyConfig(companyName);
    return config?.EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5";
  } catch {
    return "@cf/baai/bge-base-en-v1.5";
  }
}

/** Resolve the vector index for cache binding. */
function getVectorIndex(companyName) {
  try {
    const config = getCompanyConfig(companyName);
    return config?.VECTOR_INDEX || "";
  } catch {
    return "";
  }
}

function assistantGraphOptions(assistant) {
  if (!assistant) return { enabled: true };
  return { enabled: assistant.enableGraph, database: assistant.graphDatabase || null };
}

// --------------------------
// CUSTOM Q&A
// --------------------------
/**
 * Check if a question matches any custom Q&A entry in the company's KBs.
 * Returns the matching entry or null.
 * Best-effort: DB errors are caught and treated as no-match.
 */
async function checkCustomQa(companyName, assistant, question) {
  try {
    const { KbRepository } = await import("../mysql/repositories.js");
    const { CompanyRepository } = await import("../mysql/repositories.js");
    const company = await CompanyRepository.findByKey(companyName);
    if (!company) return null;

    // Get all active KBs for this company
    const kbs = await KbRepository.listByCompany(company.id);
    if (!kbs?.length) return null;

    // Check each KB's custom Q&A entries
    for (const kb of kbs) {
      const match = await KbRepository.matchCustomQa(kb.id, question);
      if (match) return match;
    }
    return null;
  } catch {
    // Custom Q&A is best-effort — DB errors don't break the ask path
    return null;
  }
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
  assistantKey = null,
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
    checkModelAccess: modelAccessFn = null,
  } = steps;
  const trimmed = question?.trim();
  if (!trimmed) return { answer: "", sources: [], matches: [], graph: null, cached: false };

  // Resolve the assistant BEFORE the fast path so canned responses (identity,
  // greeting, contact…) carry the assistant's persona name — otherwise
  // "what is your name?" answers as the company consultant even when an
  // assistant with its own name is selected.
  const assistant = await resolveFn(companyName, { assistantKey });
  const R = responsesFn(companyName, assistant?.assistantName || null);

  // The fast-path resolves blocked patterns through the configurable tiers —
  // assistant.blockedPatterns > company BLOCKED_PATTERNS > built-ins (shared/
  // blocked-patterns.js). An assistant that ships its own pattern set fully
  // replaces the built-ins (a recipes persona must not veto "recipe").
  const fastResponse = fastPathFn(
    trimmed,
    companyName,
    assistant?.assistantName || null,
    assistant
  );
  if (fastResponse) return { answer: fastResponse, sources: [], matches: [], graph: null, cached: false };

  // Assistant-level guardrail: blocked topics configured on the selected
  // assistant are refused before any retrieval or LLM work (they add to the
  // company BLOCKED_TOPICS + built-in patterns already handled by the fast path).
  if (assistant?.blockedTopics && matchesBlockedTopics(trimmed, assistant.blockedTopics)) {
    return { answer: R.blocked, sources: [], matches: [], graph: null, cached: false };
  }

  // Model-access gate: if an assistant has a credential + model, verify the
  // credential_model_access grant allows this model before making a paid LLM call.
  //
  // Only meaningful when the assistant's catalog model is the one the pipeline
  // will actually execute (assistantModelExecutes): a Workers AI key, or a
  // non-CF key bound to the assistant's own credential (execution block).
  // A non-CF model with NO credential binding falls back to the company's own
  // LLM via assistantModel() — gating that fallback would deny an ask whose
  // denied model is never called, blanking the answer. Denial itself is
  // grants-aware: a credential with zero access grants is unmanaged and
  // everything is allowed (see checkModelAccess in assistant.js).
  if (modelAccessFn && assistantModelExecutes(companyName, assistant)) {
    const accessResult = await modelAccessFn(companyName, assistant);
    if (accessResult && !accessResult.allowed) {
      // denied:true marks a pre-LLM refusal — callers suppress follow-up
      // suggestions so no questions are generated from this error string.
      return {
        answer: `Model access denied: ${accessResult.reason || "not authorized"}.`,
        sources: [],
        matches: [],
        graph: null,
        cached: false,
        denied: true,
      };
    }
  }

  const cleanQuestion = (await rewriteFn(trimmed, history, companyName, { execution: assistant?.execution || null })).trim();

  // ADR-012 Phase 1: Cache key includes the full retrieval binding fingerprint
  // so that changing the embedding model, vector index, or LLM model invalidates
  // the cache and prevents serving stale answers from incompatible vector spaces.
  const binding = getRetrievalBinding(companyName, assistant);
  const cacheKey = cacheKeyFn(cleanQuestion, companyName, assistant?.assistantKey, binding);
  const cached = cachedFn(cacheKey);
  if (cached) return { ...cached, cached: true };

  // Custom Q&A: check if the question matches any direct-answer entry in the KB.
  // If a match is found, return it immediately without going through the RAG pipeline.
  const customQaMatch = await checkCustomQa(companyName, assistant, cleanQuestion);
  if (customQaMatch) {
    const result = {
      answer: customQaMatch.answer,
      sources: [{ title: "Custom Q&A", score: 1.0 }],
      matches: [],
      graph: null,
      cached: false,
      customQa: true,
    };
    setCacheFn(cacheKey, result, companyName);
    return result;
  }

  const { context, matches } = await retrieveFn(cleanQuestion, companyName, {
    // Assistant persona override wins; otherwise the company's configured
    // VECTOR_INDEX is the resolved retrieval index — it may name a non-CF
    // store (Pinecone/Qdrant/Weaviate KB binding), which retrieval.js routes
    // through the KB's own adapters (ADR-012 Phase 2).
    indexName: assistant?.vectorIndex || getVectorIndex(companyName) || null,
    // Chunk bucket: the assistant's primary KB storage binding wins; otherwise
    // the pipeline falls back to the company config bucket (getChunk default).
    storageBucket: assistant?.storageBucket || null,
  });
  if (!context) return { answer: R.noContext, sources: [], matches: [], graph: null, cached: false };

  const graph = await graphFn(cleanQuestion, companyName, assistantGraphOptions(assistant));
  const fullContext = graph ? `${context}\n${graph.context}` : context;

  const messages = [
    sysMsgFn(
      companyName,
      assistant?.systemPrompt || null,
      assistant?.assistantName || null,
      assistant?.variables || [],
      assistant?.guardrailPrompt || null
    ),
    ...history.slice(-MAX_HISTORY),
    { role: "user", content: userMsgFn(fullContext, cleanQuestion) },
  ];

  const llmBinding = resolveLlmBinding(companyName, assistant);
  const ai = await llmCall({
    messages,
    model: llmBinding.model,
    temperature: assistant?.temperature ?? 0.3,
    max_tokens: assistant?.maxTokens ?? 500,
    // Function calling: pass tools when the assistant has them enabled.
    ...(assistant?.enableFunctionCalling && assistant?.tools ? { tools: assistant.tools } : {}),
    onToken,
    execution: llmBinding.execution,
  });
  const answer = ai.response || R.error;

  const result = {
    answer,
    sources: matches.map((m) => ({ title: m.metadata?.title, score: m.score })),
    matches,
    graph,
    cached: false,
    // Execution binding — callers use it to route side-calls (suggestions)
    // through the same provider as the answer. llmModel records what ran.
    execution: llmBinding.execution,
    llmModel: llmBinding.model,
  };

  setCacheFn(cacheKey, result, companyName);
  return result;
}

// --------------------------
// ASKQUESTION (Non-streaming)
// Accepts { signal } so the route can abort the (paid) AI call when the
// client disconnects mid-request.
// --------------------------
export async function askQuestion(question, history = [], companyName, { signal, requestId, assistantKey = null } = {}) {
  const startTime = Date.now();
  try {
    const result = await runPipeline({
      question,
      history,
      companyName,
      assistantKey,
      llmCall: async ({ messages, model, temperature, max_tokens, tools, onToken, execution }) => {
        if (execution) {
          return runProviderChat({
            companyName,
            execution,
            model,
            input: { messages, temperature, max_tokens },
            signal,
            onToken,
          });
        }
        const ai = await runCloudflareAI(
          companyName,
          model,
          { messages, temperature, max_tokens },
          { signal, tools }
        );
        return { response: ai.response };
      },
      steps: { checkModelAccess },
    });

    // Log usage (best-effort, non-blocking) — against the model that actually
    // executed (assistant's provider model or the company's Workers AI model).
    const durationMs = Date.now() - startTime;
    const model = result.execution ? result.llmModel || getLlmModel(companyName) : getLlmModel(companyName);
    logUsage(companyName, { model, durationMs, action: "ask", responseStatus: 200, requestId }).catch(() => {});

    // Client gone — skip the follow-up suggestions call entirely. A pre-LLM
    // denial is not an answer: never generate suggestions from it.
    const possibleQuestions = signal?.aborted || result.denied
      ? []
      : await generatePossibleQuestions(result.answer, companyName, { execution: result.execution || null });
    // execution is an internal routing binding — never leak it to API clients.
    const { execution: _execution, llmModel: _llmModel, ...publicResult } = result;
    return { ...publicResult, possibleQuestions };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const model = getLlmModel(companyName);
    logUsage(companyName, { model, durationMs, action: "ask", responseStatus: 500, requestId }).catch(() => {});

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
  companyName,
  { assistantKey = null } = {}
) {
  const startTime = Date.now();
  try {
    const trimmed = question?.trim();
    if (!trimmed) {
      transport.sendStart({ __start: false });
      transport.sendError("Question is required");
      transport.finish();
      return false;
    }

    // Resolve the assistant before the fast path so canned identity/greeting
    // responses carry the assistant's persona (parity with runPipeline).
    const assistant = await resolveAssistantOverrides(companyName, { assistantKey });
    const fastResponse = checkFastPath(trimmed, companyName, assistant?.assistantName || null, assistant);
    if (fastResponse) {
      transport.sendStart({ __start: false });
      transport.sendToken(fastResponse);
      transport.finish();
      return true;
    }

    let answer = "";
    // Tracks whether ANY text reached the client. Every runPipeline early return
    // (cache hit, custom Q&A, no-context, model-access denial) yields answer text
    // without calling the LLM, so no token is ever streamed — the client would
    // render an empty bubble while still receiving the metadata frames.
    let streamed = false;

    const result = await runPipeline({
      question,
      history,
      companyName,
      assistantKey,
      onToken: (token) => {
        if (token) streamed = true;
        transport.sendToken(token);
      },
      steps: { checkModelAccess },
      llmCall: async ({ messages, model, temperature, max_tokens, tools, onToken, execution }) => {
        if (execution) {
          return runProviderChat({
            companyName,
            execution,
            model,
            input: { messages, temperature, max_tokens },
            signal: transport.signal,
            onToken: (token) => {
              if (token) streamed = true;
              if (onToken) onToken(token);
            },
          });
        }
        const body = { stream: true, messages, temperature, max_tokens };
        if (tools && Array.isArray(tools) && tools.length > 0) {
          body.tools = tools;
        }
        const response = await fetchCloudflareAI(
          companyName,
          model,
          body,
          { signal: transport.signal }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        if (!response.body) throw new Error("No response body received from Cloudflare.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const parser = createSseParser((parsed) => {
          if (parsed.response) {
            streamed = true;
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

    // Non-streamed answer (cache hit / custom Q&A / no-context / denial / an LLM
    // stream that produced no text): deliver the text as a single token so the
    // bubble is never blank and the SSE contract stays token-based.
    if (!streamed) transport.sendToken(result.answer);

    // A pre-LLM denial is not an answer — never generate suggestions from it.
    const possibleQuestions = result.denied
      ? []
      : await generatePossibleQuestions(result.answer, companyName, { execution: result.execution || null });

    transport.sendStart({ sources: result.sources, matches: result.matches, graph: result.graph });
    transport.sendPossibleQuestions(possibleQuestions);
    transport.finish();

    if (env.NODE_ENV !== "production") console.log("✅ Stream completed:", trimmed);
    return true;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const model = getLlmModel(companyName);
    logUsage(companyName, { model, durationMs, action: "ask-stream", responseStatus: err.name === "AbortError" ? 499 : 500 }).catch(() => {});

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
