// --------------------------
// STARTER SUGGESTIONS
// Per-company starter questions for the Test AI page's empty state. Retrieves
// representative chunks from the selected assistant's KB (or the company's
// configured index) and asks the LLM for 3-4 questions a reader of THAT
// CONTENT would ask — never generic company-services questions.
//
// Provider-aware: the generation call executes through the selected
// assistant's own provider credential when its model is a non-Workers-AI key
// (same execution binding as the main answer path). The gateway executor is
// lazy-imported so query/ stays zero-dep for tests.
//
// Best-effort by design: any failure (no credentials, empty index, LLM error,
// provider capacity) returns [] and the client falls back to neutral starters.
// --------------------------
import { runCloudflareAI } from "../services/cloudflare_ai.js";
import { getSmallLlm } from "./llm.js";
import { retrieveContext } from "./retrieval.js";
import { getCompanyConfig } from "../config/index.js";
import { resolveAssistantOverrides, isRunnableModel } from "./assistant.js";

// Neutral seed query — topic-oriented rather than "company services", so a
// Python book pulls representative book chunks instead of service-shaped
// questions. Retrieval is nearest-neighbour: any query returns the top chunks;
// the framing of the generation prompt is what keeps questions on-content.
const SEED_QUERY = "main topics and key concepts covered in this content";

// Fail fast so a misconfigured company (no creds / dead endpoint, where the
// embedding client retries with backoff) can't leave the UI hanging. The route
// stays best-effort: [] → client falls back to neutral starters.
const RETRIEVE_TIMEOUT_MS = 10000;
const LLM_TIMEOUT_MS = 12000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("suggestion step timed out")), ms)),
  ]);

/**
 * The generation prompt: strictly content-grounded, no company framing.
 * Exported for tests.
 * @param {string} context — retrieved KB chunks
 * @returns {string}
 */
export function buildStarterPrompt(context) {
  return `You are seeding starter questions for a chat assistant grounded in a specific knowledge base. Based ONLY on the content below, suggest 3-4 short questions a reader of THIS content would naturally ask. Each question must be answerable from the content itself. Stay on the content's own topic and language. Return ONLY the questions, one per line, no numbering, no explanation.

Content:
${context.slice(0, 4000)}`.trim();
}

/**
 * Parse the LLM's line-separated reply into clean questions.
 * Exported for tests.
 * @param {string} text
 * @returns {string[]}
 */
export function parseStarterQuestions(text) {
  return String(text || "")
    .split("\n")
    .map((q) => q.trim().replace(/^[-*\d.)\s]+/, ""))
    .filter(Boolean)
    .slice(0, 4);
}

/**
 * Generate 3-4 starter questions grounded in the company's knowledge base.
 * @param {string} companyName
 * @returns {Promise<string[]>} — [] on any failure
 */
export async function generateStarterQuestions(companyName) {
  try {
    // The selected assistant decides WHERE to search (its primary KB's index)
    // and HOW to generate (its own provider credential when non-Workers-AI).
    const assistant = await resolveAssistantOverrides(companyName);
    const execution = assistant?.execution || null;
    const indexName =
      assistant?.vectorIndex || getCompanyConfig(companyName)?.VECTOR_INDEX || null;

    const { context, matches } = await withTimeout(
      retrieveContext(SEED_QUERY, companyName, { indexName }),
      RETRIEVE_TIMEOUT_MS
    );
    if (!context || !matches.length) return [];

    const prompt = buildStarterPrompt(context);
    const smallModel = getSmallLlm(companyName);
    let text;
    if (execution?.credentialId && !isRunnableModel(smallModel)) {
      // The assistant's own provider executes the generation call.
      const { streamChat } = await import("../mysql/services/provider-executor.js");
      const out = await withTimeout(
        streamChat({
          companyKey: companyName,
          credentialId: execution.credentialId,
          providerKey: execution.providerKey || undefined,
          model: smallModel,
          messages: [{ role: "user", content: prompt }],
          options: { temperature: 0.7, max_tokens: 200 },
        }),
        LLM_TIMEOUT_MS
      );
      text = out.content;
    } else {
      const res = await withTimeout(
        runCloudflareAI(companyName, smallModel, {
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 200,
        }),
        LLM_TIMEOUT_MS
      );
      text = res.response;
    }

    return parseStarterQuestions(text);
  } catch {
    return [];
  }
}
