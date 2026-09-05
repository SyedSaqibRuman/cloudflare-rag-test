import { getConfig } from "../config/index.js";
import { runCloudflareAI } from "../services/cloudflare_ai.js";

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
export async function rewriteFollowup(question, history = [], companyName) {
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
    const res = await runCloudflareAI(companyName, getSmallLlm(companyName), {
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 120,
    });
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
// Follow-up suggestions must stay on-topic — drop anything that drifts into
// code/programming or entertainment (the assistant is a certification bot).
const OFF_TOPIC_QUESTION_REGEX =
  /\b(code|programming|script|function|poem|joke|recipe|movie|song|debug|compile)\b/i;

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

export async function generatePossibleQuestions(answer, companyName) {
  if (!answer || !answer.trim()) return [];

  const prompt = `
You are a helpful assistant for a certification services company. Based on the answer below, suggest 3-5 concise follow-up questions a user might ask next. Only suggest questions related to certification, standards, compliance, or this company's services. If the answer is a refusal or does not contain useful certification-related content, return nothing. Return ONLY the questions, one per line, no numbering, no explanation.

Answer:
${answer.slice(0, 4000)}
`.trim();

  try {
    const res = await runCloudflareAI(companyName, getSmallLlm(companyName), {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    });
    const text = res.response?.trim();
    if (!text) return [];
    const blocked = companyBlockedTopics(companyName);
    return text
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => {
        if (!q || OFF_TOPIC_QUESTION_REGEX.test(q)) return false;
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
