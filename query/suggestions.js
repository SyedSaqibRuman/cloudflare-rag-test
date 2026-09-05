// --------------------------
// STARTER SUGGESTIONS
// Per-company starter questions for the Test AI page's empty state. Retrieves
// the company's top chunks via the standard RAG retrieval path and asks the
// small LLM for 3-4 natural questions a first-time visitor might ask.
// Best-effort by design: any failure (no credentials, empty index, LLM error)
// returns [] and the client falls back to static starter questions.
// --------------------------
import { runCloudflareAI } from "../services/cloudflare_ai.js";
import { getSmallLlm } from "./llm.js";
import { retrieveContext } from "./retrieval.js";

// Neutral seed query — just enough to pull the company's most representative
// chunks out of the vector index for the LLM to write questions from.
const SEED_QUERY = "What products, services, and information does this company provide?";

// Fail fast so a misconfigured company (no creds / dead endpoint, where the
// embedding client retries with backoff) can't leave the UI hanging. The route
// stays best-effort: [] → client falls back to static starters.
const RETRIEVE_TIMEOUT_MS = 10000;
const LLM_TIMEOUT_MS = 12000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("suggestion step timed out")), ms)),
  ]);

/**
 * Generate 3-4 starter questions from the company's knowledge base.
 * @param {string} companyName
 * @returns {Promise<string[]>} — [] on any failure
 */
export async function generateStarterQuestions(companyName) {
  try {
    const { context, matches } = await withTimeout(retrieveContext(SEED_QUERY, companyName), RETRIEVE_TIMEOUT_MS);
    if (!context || !matches.length) return [];

    const prompt = `You are helping to build a website chat assistant for a company. Based on the company's content below, suggest 3-4 concise questions a first-time visitor might ask about the company. They should be short, natural, and answerable from the content. Return ONLY the questions, one per line, no numbering, no explanation.

Company content:
${context.slice(0, 4000)}`.trim();

    const res = await withTimeout(
      runCloudflareAI(companyName, getSmallLlm(companyName), {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      }),
      LLM_TIMEOUT_MS
    );
    const text = res.response?.trim();
    if (!text) return [];
    return text
      .split("\n")
      .map((q) => q.trim().replace(/^[-*\d.)\s]+/, ""))
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}