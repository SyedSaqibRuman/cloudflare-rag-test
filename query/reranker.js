import { runCloudflareAI } from "../services/cloudflare_ai.js";
import { getRerankingModel } from "./llm.js";

// --------------------------
// RERANKING
// --------------------------
// Reranking is skipped when there are few matches — the expensive cross-encode
// call buys nothing below this count. The gating lives here so retrieval.js
// can state the invariant without knowing the number.
export const MIN_RERANK_MATCHES = 4;

/**
 * Rerank matches by asking a cross-encoder model to score each against the
 * question. Contract: called after hybrid scoring + dedupe; skips when
 * matches.length < MIN_RERANK_MATCHES; on any failure falls back to the
 * input order unchanged. Returns a new array sorted by rerankScore desc.
 */
export async function rerankMatches(matches, question, companyName) {
  if (matches.length < MIN_RERANK_MATCHES) return matches;
  try {
    const scored = await Promise.all(
      matches.map(async (m) => {
        const text2 = `${m.metadata?.title || ""} ${m.metadata?.preview || ""}`.trim();
        try {
          const res = await runCloudflareAI(companyName, getRerankingModel(companyName), {
            text: question,
            text2,
          });
          return { ...m, rerankScore: res?.score ?? m.hybrid };
        } catch {
          return { ...m, rerankScore: m.hybrid };
        }
      })
    );
    return scored.sort((a, b) => b.rerankScore - a.rerankScore);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.warn("⚠️ Rerank failed:", err.message);
    return matches;
  }
}
