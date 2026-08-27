import { generateEmbeddings } from "../services/cloudflare_embeddings.js";
import { vectorQuery } from "../services/vectorize.js";
import { getChunk } from "../services/r2.js";
import { rerankMatches } from "./reranker.js";
import { buildContext } from "./context.js";
import { hybridScore, dedupeMatches } from "./scoring.js";

// --------------------------
// CONFIGURATION
// --------------------------
const VECTOR_LIMIT = 10;
const FINAL_TOP_K = 5;
const SCORE_THRESHOLD = 0.75;
const ABSOLUTE_MIN_SCORE = 0.5;

// --------------------------
// RAG CONTEXT RETRIEVAL
//
// Pipeline contract (order matters, every step's precondition is set by the
// step before it):
//   1. vectorQuery top 10 → filter (≥75% of top score AND ≥0.5 abs)
//   2. hybridScore (0–1, clamped) → sort desc
//   3. dedupeMatches — requires .hybrid to be set (step 2 did it)
//   4. rerankMatches — skips itself when < MIN_RERANK_MATCHES
//   5. slice top 5 → fetch chunks → buildContext
// --------------------------
export async function retrieveContext(question, companyName, { indexName = null } = {}) {
  const embeddings = await generateEmbeddings([question], companyName);
  if (!embeddings?.[0]) return { context: null, matches: [] };

  const res = await vectorQuery(embeddings[0], VECTOR_LIMIT, companyName, { indexName });
  let matches = res?.matches || [];
  if (!matches.length) return { context: null, matches: [] };

  matches.sort((a, b) => b.score - a.score);
  const topScore = matches[0].score || 0;

  matches = matches.filter(
    (m) => (m.score || 0) >= topScore * SCORE_THRESHOLD && (m.score || 0) >= ABSOLUTE_MIN_SCORE
  );
  if (!matches.length) return { context: null, matches: [] };

  matches = matches.map((m) => ({ ...m, hybrid: hybridScore(m, question) }));
  matches.sort((a, b) => b.hybrid - a.hybrid);
  matches = dedupeMatches(matches);
  matches = await rerankMatches(matches.slice(0, 10), question, companyName);
  matches = matches.slice(0, FINAL_TOP_K);

  const chunks = await Promise.all(matches.map((m) => getChunk(m.metadata?.r2_key, companyName)));
  return { context: buildContext(chunks), matches };
}
