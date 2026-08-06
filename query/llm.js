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

export { MAX_HISTORY };
