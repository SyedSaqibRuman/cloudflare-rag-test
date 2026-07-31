import { getCFClient } from "../client.js";
import { env } from "../env.js";
import { getRerankingModel } from "./llm.js";

const cfClient = getCFClient();

// --------------------------
// RERANKING
// --------------------------
export async function rerankMatches(matches, question, companyName) {
  if (matches.length <= 3) return matches;
  try {
    const scored = await Promise.all(
      matches.map(async (m) => {
        const text2 = `${m.metadata?.title || ""} ${m.metadata?.preview || ""}`.trim();
        try {
          const res = await cfClient.ai.run(getRerankingModel(companyName), {
            account_id: env.CLOUDFLARE_ACCOUNT_ID,
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
    if (env.NODE_ENV !== "production") console.warn("⚠️ Rerank failed:", err.message);
    return matches;
  }
}
