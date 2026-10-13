import { getConfig } from "../config/index.js";
import { runCloudflareAI } from "../services/cloudflare_ai.js";
import { isRunnableModel } from "./assistant.js";

// --------------------------
// SIDE-CALL EXECUTION SEAM
// Side-calls (query rewrite, follow-up suggestions) run on the assistant's
// own provider when its catalog model is a non-Workers-AI key bound to a
// credential — the same execution binding the main answer call uses. The
// gateway executor is lazy-imported so query/ stays zero-dep for tests.
// --------------------------
export async function runSideCallAI(companyName, model, input, { execution, signal } = {}) {
  if (execution?.credentialId && !isRunnableModel(model)) {
    const { streamChat } = await import("../mysql/services/provider-executor.js");
    const out = await streamChat({
      companyKey: companyName,
      credentialId: execution.credentialId,
      providerKey: execution.providerKey || undefined,
      model,
      messages: input.messages,
      options: {
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
      },
      signal,
    });
    return { response: out.content || "" };
  }
  return runCloudflareAI(companyName, model, input, { signal });
}

// --------------------------
// CONFIGURATION
// --------------------------
const MAX_HISTORY = 6;

// --------------------------
// MODEL GETTERS
// --------------------------
export const getLlmModel = (co) =>
  getConfig(co).LLM_MODEL || "@cf/meta/llama-3.1-8b-instruct-fp8";
export const getSmallLlm = (co) =>
  getConfig(co).SMALL_LLM || "@cf/meta/llama-3.2-3b-instruct";
export const getRerankingModel = (co) =>
  getConfig(co).RERANKING_MODEL || "@cf/baai/bge-reranker-base";


// --------------------------
// QUERY REWRITER
// --------------------------
export async function rewriteFollowup(question, history = [], companyName, { execution } = {}) {
  if (!history.length) return question;

  const recentHistory = history
    .slice(-MAX_HISTORY)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const companyNameStr = getConfig(companyName).COMPANY_NAME || "the company";

  const prompt = `
Rewrite the follow-up question below into a standalone search query for ${companyNameStr}, a certification services company.

RULES:
- Rewrite ONLY if the question clearly relates to the conversation or certification topics.
- Do NOT infer, assume, or add details not explicitly stated in the question or conversation.
- Do NOT expand pronouns like "that", "it", "this" unless the conversation clearly defines them.
- Do NOT answer the question — only rewrite it.
- If the question is a single meaningless word, random characters, or completely unrelated to the conversation or certification, return exactly: INVALID

Conversation:
${recentHistory}

Follow-up question:
${question}

Return ONLY the rewritten search query or INVALID. No explanation.
  `.trim();

  try {
    const res = await runSideCallAI(companyName, getSmallLlm(companyName), {
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 120,
    }, { execution });
    const rewritten = res.response?.trim();
    if (!rewritten || rewritten === "INVALID") return question;
    return rewritten;
  } catch {
    return question;
  }
}

// --------------------------
// POSSIBLE QUESTIONS GENERATOR
// --------------------------
/**
 * Generate 3-5 concise follow-up questions based on the answer.
 * Best-effort: returns [] on any failure.
 * @param {string} answer — the LLM answer text
 * @param {string} companyName — for model resolution
 * @returns {Promise<string[]>}
 */
/**
 * Company-customized blocked topics (BLOCKED_TOPICS, one per line) as
 * lowercase substrings, so follow-up suggestions never re-introduce a topic
 * the company explicitly banned. Best-effort: [] on any failure.
 */
function companyBlockedTopics(companyName) {
  if (!companyName) return [];
  try {
    const raw = getConfig(companyName)?.BLOCKED_TOPICS;
    if (!raw || typeof raw !== "string") return [];
    return raw.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function generatePossibleQuestions(answer, companyName, { execution } = {}) {
  if (!answer || !answer.trim()) return [];

  // Grounded in the answer — no vertical is hardcoded here. The assistant may
  // be bound to any KB (a Java textbook, a certification site, …), so the
  // follow-ups must stay on the answer's own topic. Tenant-owned BLOCKED_TOPICS
  // still filters, and a refusal/error answer yields nothing.
  const prompt = `
You are generating suggested follow-up questions for a chat assistant.

Based on the answer below, suggest 3-5 concise follow-up questions a user might ask next.

RULES:
- Every question must stay on the same topic, domain, and language as the answer.
- Use only information the answer covers or clearly implies.
- Keep each question short, natural, and standalone.
- If the answer is empty, a refusal, an error, or contains no useful information, return nothing.

Answer:
${answer.slice(0, 4000)}

Return ONLY the questions, one per line, no numbering, no explanation.
`.trim();

  try {
    const res = await runSideCallAI(companyName, getSmallLlm(companyName), {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    }, { execution });
    const text = res.response?.trim();
    if (!text) return [];
    const blocked = companyBlockedTopics(companyName);
    return text
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => {
        if (!q) return false;
        if (!blocked.length) return true;
        const lower = q.toLowerCase();
        return !blocked.some((b) => lower.includes(b));
      })
      .slice(0, 5);
  } catch {
    return [];
  }
}

export { MAX_HISTORY };
